/* ============================================================================
   CUHM 2.0 — Persistence
   IndexedDB is the primary local-first store. File System Access remains an
   optional user-controlled JSON mirror, with its handle cached in IndexedDB.
   localStorage acts as a crash net. Rolling backups protect bulk edits.
   ========================================================================== */
const STORE = (() => {
  'use strict';

  const DB_NAME = 'ultra-headcount-manager';
  const DB_STORE = 'handles';
  const DB_STATE = 'state';
  const LS_KEY = 'uhm:mirror';
  const LS_META = 'uhm:meta';
  const MAX_BACKUPS = 20;
  const SAVE_DEBOUNCE = 800;
  const desktop = typeof DESKTOP !== 'undefined' && DESKTOP.available;

  const supported = !desktop && typeof window !== 'undefined' && 'showSaveFilePicker' in window;

  /* ---------- IndexedDB (handle cache only) ------------------------------- */
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
        if (!req.result.objectStoreNames.contains(DB_STATE)) req.result.createObjectStore(DB_STATE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(key) {
    try {
      const db = await idb();
      return await new Promise((res, rej) => {
        const t = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
        t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error);
      });
    } catch { return null; }
  }
  async function idbSet(key, val) {
    try {
      const db = await idb();
      return await new Promise((res, rej) => {
        const t = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(val, key);
        t.onsuccess = () => res(true); t.onerror = () => rej(t.error);
      });
    } catch { return false; }
  }
  async function idbDel(key) {
    try {
      const db = await idb();
      return await new Promise(res => {
        const t = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).delete(key);
        t.onsuccess = () => res(true); t.onerror = () => res(false);
      });
    } catch { return false; }
  }

  async function idbStateGet() {
    try {
      const db = await idb();
      return await new Promise((res, rej) => {
        const t = db.transaction(DB_STATE, 'readonly').objectStore(DB_STATE).get('current');
        t.onsuccess = () => res(t.result || null); t.onerror = () => rej(t.error);
      });
    } catch { return null; }
  }

  async function idbStateSet(state) {
    try {
      const db = await idb();
      return await new Promise((res, rej) => {
        const t = db.transaction(DB_STATE, 'readwrite').objectStore(DB_STATE).put(state, 'current');
        t.onsuccess = () => res(true); t.onerror = () => rej(t.error);
      });
    } catch { return false; }
  }

  /* ---------- state ------------------------------------------------------- */
  let fileHandle = null;
  let dirHandle = null;
  let saveTimer = null;
  let listeners = [];
  let status = {
    mode: desktop ? 'desktop' : 'browser',
    file: desktop ? 'Headcount plan' : '',
    lastSaved: null,
    dirty: false,
    error: ''
  };

  const on = fn => { listeners.push(fn); return () => { listeners = listeners.filter(l => l !== fn); }; };
  const emit = () => listeners.forEach(fn => { try { fn(Object.assign({}, status)); } catch (e) { console.error(e); } });
  const setStatus = patch => { Object.assign(status, patch); emit(); };
  const getStatus = () => Object.assign({}, status);

  /* ---------- permissions ------------------------------------------------- */
  async function verifyPermission(handle, write = true) {
    if (!handle) return false;
    // Origin-private handles have no permission model — they are always granted.
    if (!handle.queryPermission) return true;
    const opts = { mode: write ? 'readwrite' : 'read' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    try { return (await handle.requestPermission(opts)) === 'granted'; }
    catch { return false; }
  }

  /* ---------- localStorage mirror ----------------------------------------- */
  function mirror(state) {
    if (desktop) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      localStorage.setItem(LS_META, JSON.stringify({ at: new Date().toISOString(), file: status.file }));
    } catch (e) { /* quota — the file is the source of truth anyway */ }
    idbStateSet(state);
  }
  function readMirror() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function mirrorMeta() {
    try { return JSON.parse(localStorage.getItem(LS_META) || 'null'); } catch { return null; }
  }

  /* ---------- file operations --------------------------------------------- */
  async function readHandle(handle) {
    const file = await handle.getFile();
    const text = await file.text();
    if (!text.trim()) return null;
    return JSON.parse(text);
  }

  async function writeHandle(handle, state) {
    const w = await handle.createWritable();
    await w.write(JSON.stringify(state, null, 2));
    await w.close();
  }

  /** Connect to a data file the user chooses. */
  async function chooseFile(create) {
    if (!supported) throw new Error('This browser cannot write files directly. Use Edge or Chrome.');
    const opts = {
      types: [{ description: 'Headcount data', accept: { 'application/json': ['.json'] } }],
      suggestedName: 'UHM_data.json'
    };
    fileHandle = create
      ? await window.showSaveFilePicker(opts)
      : (await window.showOpenFilePicker(Object.assign({ multiple: false }, opts)))[0];
    await idbSet('file', fileHandle);
    setStatus({ mode: 'file', file: fileHandle.name, error: '' });
    return fileHandle;
  }

  /** Silently reconnect to the previously used file. */
  async function reconnect() {
    if (desktop) {
      setStatus({ mode: 'desktop', file: 'Headcount plan', error: '' });
      return null;
    }
    const h = await idbGet('file');
    if (!h) return null;
    fileHandle = h;
    dirHandle = await idbGet('dir');
    const okPerm = !h.queryPermission ? true
      : (await h.queryPermission({ mode: 'readwrite' })) === 'granted';
    setStatus({ mode: okPerm ? 'file' : 'needs-permission', file: h.name });
    return { handle: h, granted: okPerm };
  }

  /** Called after a user gesture to re-grant permission on a cached handle. */
  async function grant() {
    if (!fileHandle) return false;
    const ok = await verifyPermission(fileHandle, true);
    setStatus({ mode: ok ? 'file' : 'needs-permission', error: ok ? '' : 'Permission denied' });
    return ok;
  }

  async function load() {
    if (desktop) {
      const result = await DESKTOP.invoke('state.load');
      if (!result || !result.json) return { data: null, source: 'desktop-empty' };
      setStatus({
        mode: 'desktop',
        file: result.displayName || 'Headcount plan',
        lastSaved: result.lastSaved || null,
        dirty: false,
        error: ''
      });
      return {
        data: JSON.parse(result.json),
        source: result.recovered ? 'desktop-recovery' : 'desktop',
        recovered: Boolean(result.recovered)
      };
    }
    if (fileHandle && status.mode === 'file') {
      try {
        const data = await readHandle(fileHandle);
        if (data) return { data, source: 'file' };
        return { data: null, source: 'file-empty' };
      } catch (e) {
        setStatus({ error: `Could not read ${status.file}: ${e.message}` });
      }
    }
    const durable = await idbStateGet();
    if (durable) return { data: durable, source: 'indexeddb' };
    const m = readMirror();
    if (m) return { data: m, source: 'mirror' };
    return { data: null, source: 'none' };
  }

  /* ---------- backups ----------------------------------------------------- */
  async function ensureBackupDir() {
    if (!dirHandle) return null;
    try { return await dirHandle.getDirectoryHandle('UHM_backups', { create: true }); }
    catch { return null; }
  }

  async function writeBackup(state) {
    const dir = await ensureBackupDir();
    if (!dir) return false;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    try {
      const h = await dir.getFileHandle(`UHM_${stamp}.json`, { create: true });
      await writeHandle(h, state);
      // Prune to the most recent MAX_BACKUPS.
      const names = [];
      for await (const [name, entry] of dir.entries()) {
        if (entry.kind === 'file' && name.startsWith('UHM_')) names.push(name);
      }
      names.sort();
      while (names.length > MAX_BACKUPS) { await dir.removeEntry(names.shift()); }
      return true;
    } catch { return false; }
  }

  /** Let the user nominate a folder for rolling backups. */
  async function chooseBackupFolder() {
    if (!window.showDirectoryPicker) throw new Error('Directory picker unavailable in this browser.');
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await idbSet('dir', dirHandle);
    return dirHandle.name;
  }

  /* ---------- saving ------------------------------------------------------ */
  async function saveNow(state, opts = {}) {
    state.savedAt = new Date().toISOString();
    if (desktop) {
      try {
        setStatus({ mode: 'desktop', dirty: true, error: '' });
        const result = await DESKTOP.invoke('state.save', {
          json: JSON.stringify(state),
          backup: Boolean(opts.backup)
        });
        setStatus({
          mode: 'desktop',
          file: result.displayName || 'Headcount plan',
          dirty: false,
          lastSaved: result.lastSaved || new Date().toISOString(),
          error: ''
        });
        return { ok: true, source: 'desktop' };
      } catch (error) {
        setStatus({ mode: 'desktop', dirty: true, error: error.message });
        return { ok: false, reason: error.message };
      }
    }
    mirror(state);
    if (!fileHandle || status.mode !== 'file') {
      setStatus({ mode: 'browser', dirty: false, lastSaved: new Date().toISOString(), error: '' });
      return { ok: true, source: 'indexeddb' };
    }
    try {
      if (!(await verifyPermission(fileHandle, true))) {
        setStatus({ mode: 'needs-permission', dirty: true });
        return { ok: false, reason: 'permission' };
      }
      await writeHandle(fileHandle, state);
      setStatus({ dirty: false, lastSaved: new Date().toISOString(), error: '' });
      if (opts.backup) writeBackup(state);
      return { ok: true };
    } catch (e) {
      setStatus({ dirty: true, error: e.message });
      return { ok: false, reason: e.message };
    }
  }

  /** Debounced autosave — call on every mutation. */
  function save(state, opts) {
    setStatus({ dirty: true });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveNow(state, opts), desktop ? 250 : SAVE_DEBOUNCE);
  }

  function flush(state) { clearTimeout(saveTimer); return saveNow(state); }

  async function disconnect() {
    fileHandle = null; dirHandle = null;
    await idbDel('file'); await idbDel('dir');
    setStatus({ mode: 'browser', file: '', dirty: false });
  }

  /* ---------- download / upload fallbacks --------------------------------- */
  function download(filename, text, mime = 'application/json') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function uploadJson() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json,application/json';
      input.onchange = () => {
        const f = input.files[0];
        if (!f) return reject(new Error('No file chosen'));
        const r = new FileReader();
        r.onload = () => { try { resolve(JSON.parse(r.result)); } catch (e) { reject(e); } };
        r.onerror = () => reject(r.error);
        r.readAsText(f);
      };
      input.click();
    });
  }

  return {
    supported, desktop, on, getStatus, setStatus,
    chooseFile, reconnect, grant, load, save, saveNow, flush, disconnect,
    chooseBackupFolder, writeBackup, download, uploadJson, readMirror, mirrorMeta,
    idbStateGet, idbStateSet
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = STORE;
