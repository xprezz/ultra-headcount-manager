/* ============================================================================
   CUHM 2.0 — Application shell: Time Machine, navigation, command palette,
   status bar and boot sequence.
   ========================================================================== */
(() => {
  'use strict';
  const { el, $, nf, sgn, toast, modal, APP } = UI;
  const E = ENGINE;

  const VIEWS = [
    { id: 'dashboard', label: 'Dashboard', render: () => VIEW_DASHBOARD.render() },
    { id: 'ribbon', label: 'Capacity ribbon', render: () => VIEW_RIBBON.render() },
    { id: 'blueprint', label: 'Seats & roles', render: () => VIEW_BLUEPRINT.render() },
    { id: 'timeline', label: 'Leave & leavers', render: () => VIEW_TIMELINE.render() },
    { id: 'org', label: 'Org chart', render: () => VIEW_ORG.render() },
    { id: 'people', label: 'Roster', render: () => VIEW_PEOPLE.render() },
    { id: 'pipeline', label: 'Pipeline', render: () => VIEW_PIPELINE.render() },
    { id: 'workload', label: 'Customers & levels', render: () => VIEW_WORKLOAD.render() },
    { id: 'risk', label: 'Risk', render: () => VIEW_RISK.render() },
    { id: 'scenarios', label: 'Scenarios', render: () => VIEW_SCENARIOS.render() },
    { id: 'data', label: 'Data & reports', render: () => VIEW_DATA.render() }
  ];

  /* ---------- global app wiring --------------------------------------------- */
  APP.go = function (view) {
    if (!VIEWS.some(v => v.id === view)) return;
    APP.view = view;
    APP.state.settings.lastView = view;
    APP.render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  APP.render = function () {
    if (!APP.ready) return;
    UI.preservingFocus(() => {
      renderHero();
      renderNav();
      renderBody();
      renderStatus();
    });
  };

  APP.renderStatusOnly = function () { UI.preservingFocus(() => { renderHero(); renderStatus(); }); };

  /* ---------- hero + Time Machine -------------------------------------------- */
  function renderHero() {
    const host = $('#hero'); if (!host) return;
    host.innerHTML = '';
    const scoped = APP.scopeActive();
    const ev = scoped ? E.evaluate(APP.state, APP.date, APP.scenario, { filter: APP.scope() }) : APP.ev();
    const t = ev.totals;

    host.appendChild(el('div', { class: 'hero-top' },
      el('div', { class: 'hero-title' },
        el('div', { class: 'eyebrow' }, `FY${APP.fy} headcount blueprint · scenario ${APP.scenario}${scoped ? ` · scoped to ${APP.scopeLabel()}` : ''}`),
        el('h1', {}, 'Ultra Headcount Manager'),
        el('p', {}, `At ${E.longDate(APP.date)} you hold ${nf(t.onRoll)} on roll against ${t.seats} blueprint seats${scoped ? ` for ${APP.scopeLabel()}` : ''} — `,
          el('b', {}, `but only ${nf(t.effective)} FTE of real capacity`),
          t.leaveDrag > 0 ? `. ${nf(t.leaveDrag)} FTE is sitting in seats you cannot deploy.` : '.')),
      el('div', { class: 'hero-actions' },
        PWA.installButton(),
        el('button', { class: 'btn', onclick: () => VIEW_DATA.boardPack(), title: 'Self-contained HTML briefing' }, '📄 Board pack'),
        el('button', { class: 'btn', onclick: () => VIEW_DATA.takeSnapshot() }, '📸 Snapshot'),
        el('button', { class: 'btn', onclick: openPalette, title: 'Ctrl+K' }, '⌘ Command'),
        el('button', { class: 'btn', onclick: () => APP.undo(), disabled: !APP.undoStack.length, title: 'Ctrl+Z' }, '↶'),
        el('button', { class: 'btn', onclick: () => APP.redo(), disabled: !APP.redoStack.length, title: 'Ctrl+Y' }, '↷'))));

    host.appendChild(timeMachine());
  }

  function timeMachine() {
    const months = E.fyMonths(APP.fy);
    const start = months[0], end = E.fyEnd(APP.fy);
    const total = E.daysBetween(start, end);
    const pos = Math.max(0, Math.min(total, E.daysBetween(start, APP.date)));

    const slider = el('input', {
      type: 'range', min: '0', max: String(total), value: String(pos), step: '1',
      dataset: { focusKey: 'tm-slider' },
      oninput: e => {
        const d = E.addDays(start, parseInt(e.target.value, 10));
        dateLabel.textContent = E.longDate(d);
        pending = d;
        clearTimeout(timer);
        timer = setTimeout(() => APP.setDate(pending), 90);
      }
    });
    let timer = null, pending = APP.date;

    const dateLabel = el('div', { class: 'tm-date' }, E.longDate(APP.date));
    const ticks = el('div', { class: 'tm-ticks' }, months.map(m => el('span', {
      class: E.monthStart(APP.date) === m ? 'on' : '',
      style: { cursor: 'pointer' },
      onclick: () => APP.setDate(E.monthEnd(m))
    }, E.monthLabel(m).split(' ')[0])));

    const chip = (label, d, title) => el('button', {
      class: `btn sm${APP.date === d ? ' primary' : ''}`, title, onclick: () => APP.setDate(d)
    }, label);

    return el('div', { class: 'tm' },
      el('div', { class: 'tm-row' },
        el('div', {},
          el('div', { class: 'tm-sub' }, 'Position at'),
          dateLabel),
        el('div', { class: 'tm-slider' }, slider, ticks),
        el('input', { type: 'date', value: APP.date, onchange: e => e.target.value && APP.setDate(e.target.value) })),
      el('div', { class: 'tm-row', style: { marginTop: '9px' } },
        chip('Today', E.today()),
        chip('End of this month', E.monthEnd(E.today())),
        chip('+3 months', E.monthEnd(E.addMonths(E.today(), 3))),
        chip('Oct ' + (2000 + APP.fy - 1), E.monthEnd(`${1999 + APP.fy}-10-01`), 'The month you always ask about'),
        chip(`FY${APP.fy} end`, E.fyEnd(APP.fy)),
        el('span', { class: 'right tiny', style: { opacity: '.85' } },
          'Drag the slider — the whole application recomputes live')));
  }

  /* ---------- nav ------------------------------------------------------------- */
  function renderNav() {
    const host = $('#nav'); if (!host) return;
    host.innerHTML = '';
    VIEWS.forEach(v => host.appendChild(el('button', {
      class: APP.view === v.id ? 'on' : '', onclick: () => APP.go(v.id)
    }, v.label)));
    host.appendChild(el('span', { class: 'spacer' }));
    const dq = E.dataQuality(APP.state).filter(i => i.severity === 'high').length;
    if (dq) host.appendChild(el('button', {
      style: { borderColor: 'var(--cp-danger)', color: 'var(--cp-danger)' }, onclick: () => APP.go('data')
    }, `⚠ ${dq} data issues`));
  }

  /* ---------- body ------------------------------------------------------------ */
  function renderBody() {
    const host = $('#body'); if (!host) return;
    const v = VIEWS.find(x => x.id === APP.view) || VIEWS[0];
    host.innerHTML = '';
    try {
      host.appendChild(v.render());
    } catch (err) {
      console.error(err);
      host.appendChild(el('div', { class: 'card' },
        el('h2', { style: { color: 'var(--cp-danger)' } }, 'Something went wrong rendering this view'),
        el('p', { class: 'sub' }, 'Your data is safe and has been saved. The technical detail is below.'),
        el('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '12px', color: 'var(--cp-text-muted)' } }, String(err && err.stack || err))));
    }
  }

  /* ---------- status bar -------------------------------------------------------- */
  function renderStatus() {
    const host = $('#statusbar'); if (!host) return;
    const st = STORE.getStatus();
    host.innerHTML = '';
    const dot = st.mode === 'desktop' && !st.dirty ? el('span', { class: 'ok' }, '● Saved on this PC')
      : st.mode === 'desktop' ? el('span', { class: 'warn' }, '● Saving…')
      : st.mode === 'file' && !st.dirty ? el('span', { class: 'ok' }, '● Saved to file')
      : st.mode === 'file' ? el('span', { class: 'warn' }, '● Saving…')
        : st.mode === 'needs-permission' ? el('span', { class: 'warn' }, '● Permission needed')
          : el('span', { class: 'ok' }, '● Saved locally');

    host.appendChild(el('div', { class: 'row', style: { width: '100%' } },
      dot,
      el('span', { class: 'muted' }, st.mode === 'desktop' ? 'Protected app data with rolling backups' : (st.file ? st.file : 'IndexedDB on this device')),
      st.lastSaved ? el('span', { class: 'muted' }, `Last saved ${new Date(st.lastSaved).toLocaleTimeString('en-GB')}`) : null,
      st.mode === 'needs-permission' ? el('button', {
        class: 'btn sm', onclick: async () => {
          if (await STORE.grant()) {
            const res = await STORE.load();
            if (res.data) APP.state = E.migrate(res.data);
            APP.render();
            toast('Reconnected', 'ok');
          } else toast('Permission denied', 'err');
        }
      }, 'Reconnect') : null,
      st.mode === 'browser' ? el('button', { class: 'btn sm', onclick: () => connect(true) }, 'Also save to a file') : null,
      st.mode === 'file' ? el('button', {
        class: 'btn sm', title: 'Keep rolling backups in a folder of your choice',
        onclick: async () => {
          try { const n = await STORE.chooseBackupFolder(); toast(`Backups will be written to ${n}\\UHM_backups`, 'ok'); }
          catch (e) { if (e.name !== 'AbortError') toast(e.message, 'err'); }
        }
      }, 'Backup folder') : null,
      el('span', { class: 'right muted' },
        `${APP.state.people.length} people · ${APP.state.requisitions.length} reqs · ${APP.state.accounts.length} customers`),
      el('span', { class: 'muted' }, 'Ctrl+K')));
  }

  /* ---------- command palette ----------------------------------------------------- */
  let paletteOpen = false;
  function openPalette() {
    if (paletteOpen) return;
    paletteOpen = true;
    const input = el('input', { type: 'text', placeholder: 'Jump to a view, find a person, or type "Alex Morgan leaves 31 Dec"…' });
    const list = el('div', { class: 'cmdk-list' });
    const box = el('div', { class: 'cmdk-box' }, input, list,
      el('div', { class: 'cmdk-hint' }, 'Try: "October" · "Alex Morgan leaves 31 Dec" · "Taylor Lee on leave from 1 Nov to 1 Mar" · "hire Security start 1 Feb" · "board pack"'));
    const scrim = el('div', { class: 'cmdk', onclick: e => { if (e.target === scrim) close(); } }, box);
    document.body.appendChild(scrim);
    let items = [], sel = 0;

    function close() { scrim.remove(); paletteOpen = false; }

    function refresh() {
      const q = input.value.trim();
      items = commands(q);
      sel = 0;
      list.innerHTML = '';
      items.slice(0, 12).forEach((it, i) => list.appendChild(el('div', {
        class: `cmdk-item${i === sel ? ' on' : ''}`,
        onclick: () => { close(); it.run(); }
      }, el('b', {}, it.title), it.sub ? el('span', {}, it.sub) : null)));
    }

    input.addEventListener('input', refresh);
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
        [...list.children].forEach((c, i) => c.classList.toggle('on', i === sel));
        return;
      }
      if (e.key === 'Enter' && items[sel]) { const it = items[sel]; close(); it.run(); }
    });
    refresh();
    setTimeout(() => input.focus(), 20);
  }

  /** Natural-language-ish parsing. Deliberately forgiving — the point is to remove
      the friction that stops a plan from being kept current. */
  function commands(q) {
    const out = [];
    const lower = q.toLowerCase();

    if (!q) {
      VIEWS.forEach(v => out.push({ title: `Go to ${v.label}`, sub: 'View', run: () => APP.go(v.id) }));
      out.push({ title: 'Build board pack', sub: 'Export', run: () => VIEW_DATA.boardPack() });
      return out;
    }

    /* --- natural language --- */
    const nl = parseNatural(q);
    if (nl) out.push(nl);

    /* --- dates --- */
    const d = parseDateish(q);
    if (d) out.push({ title: `Jump to ${E.longDate(d)}`, sub: 'Time Machine', run: () => APP.setDate(d) });

    /* --- people --- */
    APP.state.people.filter(p => (p.name || '').toLowerCase().includes(lower)).slice(0, 6).forEach(p =>
      out.push({ title: p.name, sub: `${p.jobTitle || p.blueprintRole || 'Person'} — open record`, run: () => VIEW_PEOPLE.openPerson(p.id) }));

    /* --- views --- */
    VIEWS.filter(v => v.label.toLowerCase().includes(lower) || v.id.includes(lower))
      .forEach(v => out.push({ title: `Go to ${v.label}`, sub: 'View', run: () => APP.go(v.id) }));

    /* --- actions --- */
    const actions = [
      ['board pack', 'Build board pack', () => VIEW_DATA.boardPack()],
      ['snapshot', 'Take a snapshot', () => VIEW_DATA.takeSnapshot()],
      ['export', 'Export JSON backup', () => STORE.download(`UHM_backup_${E.today()}.json`, JSON.stringify(APP.state, null, 2), 'application/json')],
      ['add person', 'Add a person', () => VIEW_PEOPLE.addPerson()],
      ['add role', 'Add a role and allocate seats', () => { APP.go('blueprint'); VIEW_BLUEPRINT.editRole(null); }],
      ['seats', 'Go to Seats & roles', () => APP.go('blueprint')],
      ['seat plan', 'Paste a seat plan', () => { APP.go('blueprint'); VIEW_BLUEPRINT.pasteSeats(); }],
      ['requisition', 'New requisition', () => VIEW_PIPELINE.newRequisition()],
      ['customer', 'Add a customer', () => VIEW_WORKLOAD.addAccount()],
      ['undo', 'Undo the last change', () => APP.undo()]
    ];
    actions.filter(a => a[0].includes(lower) || lower.includes(a[0].split(' ')[0]))
      .forEach(a => out.push({ title: a[1], sub: 'Action', run: a[2] }));

    return out;
  }

  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

  /** "31 Dec", "1 Feb 2027", "October", "2026-11-02" → ISO date. */
  function parseDateish(str, anchorFy) {
    const s = String(str).trim().toLowerCase();
    let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];

    const fy = anchorFy || APP.fy;
    const monthOf = name => MONTHS.findIndex(x => x.startsWith(name.slice(0, 3)));
    // A month in FY27 is Jul-Dec 2026 or Jan-Jun 2027.
    const yearFor = mi => (mi >= 6 ? 1999 + fy : 2000 + fy);

    m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?\s*(\d{4})?/);
    if (m) {
      const mi = monthOf(m[2]);
      if (mi >= 0) {
        const y = m[3] ? +m[3] : yearFor(mi);
        return `${y}-${String(mi + 1).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
      }
    }
    m = s.match(/([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?/);
    if (m) {
      const mi = monthOf(m[1]);
      if (mi >= 0) {
        const y = m[3] ? +m[3] : yearFor(mi);
        return `${y}-${String(mi + 1).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
      }
    }
    m = s.match(/^([a-z]{3,9})\.?(?:\s+(\d{4}))?$/);
    if (m) {
      const mi = monthOf(m[1]);
      if (mi >= 0) {
        const y = m[2] ? +m[2] : yearFor(mi);
        return E.monthEnd(`${y}-${String(mi + 1).padStart(2, '0')}-01`);
      }
    }
    if (s === 'today') return E.today();
    return null;
  }

  function findPerson(fragment) {
    const f = fragment.trim().toLowerCase();
    if (!f) return null;
    const ppl = APP.state.people;
    return ppl.find(p => (p.name || '').toLowerCase() === f)
      || ppl.find(p => (p.name || '').toLowerCase().startsWith(f))
      || ppl.find(p => (p.name || '').toLowerCase().includes(f))
      || null;
  }

  function parseNatural(q) {
    const s = q.trim();

    /* "<name> leaves|resigns|exits <date>" */
    let m = s.match(/^(.+?)\s+(?:leaves|leaving|resigns|exits|last day)\s+(?:on\s+)?(.+)$/i);
    if (m) {
      const p = findPerson(m[1]), d = parseDateish(m[2]);
      if (p && d) return {
        title: `${p.name} leaves — last working day ${E.longDate(d)}`,
        sub: 'Adds an exit event to their timeline',
        run: () => {
          APP.mutate(`${p.name} leaves ${d}`, st => {
            const t = st.people.find(x => x.id === p.id);
            t.events = (t.events || []).filter(e => e.type !== 'exit');
            t.events.push({ id: E.uid('ev'), type: 'exit', date: d, note: 'Added via command palette' });
          });
          toast(`${p.name} now leaves ${E.longDate(d)}`, 'ok');
          VIEW_PEOPLE.openPerson(p.id);
        }
      };
    }

    /* "<name> on leave from <date> to <date>" */
    m = s.match(/^(.+?)\s+(?:on|goes on|starts)\s+(parental|maternity|paternity|sick|sabbatical|study|other)?\s*leave\s+(?:from\s+)?(.+?)(?:\s+(?:to|until|till|returns?)\s+(.+))?$/i);
    if (m) {
      const p = findPerson(m[1]);
      const from = parseDateish(m[3] || ''), to = m[4] ? parseDateish(m[4]) : null;
      const kindRaw = (m[2] || 'other').toLowerCase();
      const kind = E.LEAVE_KINDS.find(k => k.toLowerCase().startsWith(kindRaw.slice(0, 4))) || 'Other';
      if (p && from) return {
        title: `${p.name} on ${kind.toLowerCase()} leave from ${E.longDate(from)}${to ? ` until ${E.longDate(to)}` : ' (open-ended)'}`,
        sub: 'Adds a leave window to their timeline',
        run: () => {
          APP.mutate(`${p.name} on leave ${from}`, st => {
            const t = st.people.find(x => x.id === p.id);
            t.events = t.events || [];
            t.events.push({ id: E.uid('ev'), type: 'leave', date: from, endDate: to || '', kind, note: 'Added via command palette' });
          });
          toast(`${p.name} recorded as on leave`, 'ok');
          VIEW_PEOPLE.openPerson(p.id);
        }
      };
    }

    /* "<role> has|to N seats [from <date>]" */
    m = s.match(/^(.+?)\s+(?:has|=|to|set to|seats?)\s*(\d+)\s*(?:seats?)?(?:\s+(?:from|effective|starting)\s+(.+))?$/i);
    if (m) {
      const roleTxt = m[1].trim().replace(/\s+seats?$/i, '');
      const n = +m[2];
      const from = m[3] ? parseDateish(m[3]) : '';
      const rows = E.roleStatus(APP.state, APP.date, APP.scenario).rows;
      const hit = rows.find(r => String(r.role || '').toLowerCase() === roleTxt.toLowerCase())
        || rows.find(r => String(r.role || '').toLowerCase().startsWith(roleTxt.toLowerCase()))
        || rows.find(r => String(r.role || '').toLowerCase().includes(roleTxt.toLowerCase()));
      if (hit && (!m[3] || from)) return {
        title: `${hit.role || 'N/A'}: ${hit.seats} → ${n} seats${from ? ` from ${E.longDate(from)}` : ''}`,
        sub: `${hit.family} · ${hit.filled} currently in seat`,
        run: () => {
          APP.mutate(`${hit.role || 'N/A'}: ${hit.seats} → ${n} seats`, st =>
            E.setSeats(st, hit.family, hit.role, n, from || ''));
          toast(`${hit.role || 'N/A'} now has ${n} seat${n === 1 ? '' : 's'}`, 'ok');
          APP.go('blueprint');
        }
      };
    }

    /* "hire <role> start <date>" */
    m = s.match(/^(?:hire|recruit|req|requisition)\s+(.+?)(?:\s+(?:start(?:ing|s)?|from)\s+(.+))?$/i);
    if (m) {
      const roleTxt = m[1].trim();
      const d = m[2] ? parseDateish(m[2]) : E.monthStart(E.addMonths(APP.date, Math.round(APP.state.settings.timeToHire || 4)));
      const role = APP.roles().find(r => r.toLowerCase().includes(roleTxt.toLowerCase()))
        || APP.state.blueprint.map(b => b.role).find(r => r && r.toLowerCase().includes(roleTxt.toLowerCase()));
      const bp = APP.state.blueprint.find(b => b.role === role);
      return {
        title: `New requisition${role ? ` for ${role}` : ''}${d ? ` starting ${E.longDate(d)}` : ''}`,
        sub: 'Opens the requisition editor pre-filled',
        run: () => VIEW_PIPELINE.newRequisition({
          targetFamily: bp ? bp.family : '', targetRole: role || roleTxt, expectedStartDate: d || ''
        })
      };
    }
    return null;
  }

  /* ---------- boot -------------------------------------------------------------- */
  async function connect(create) {
    try {
      await STORE.chooseFile(create);
    } catch (err) {
      if (err && err.name === 'AbortError') return false;   // user cancelled
      toast(err.message || 'Could not open that file', 'err');
      return false;
    }
    const res = await STORE.load();
    if (res.data) {
      /* Existing file — adopt what is in it. */
      APP.state = E.migrate(res.data);
      toast(`Loaded ${APP.state.people.length} people from ${STORE.getStatus().file}`, 'ok');
    } else {
      /* Brand new / empty file — write whatever we already have into it. */
      await STORE.saveNow(APP.state);
      toast(`Connected. Autosaving to ${STORE.getStatus().file}`, 'ok');
    }
    APP.ready = true;
    APP.view = APP.state.settings.lastView || 'dashboard';
    APP.render();
    return true;
  }

  function importBackup() {
    STORE.uploadJson().then(async raw => {
      APP.state = E.migrate(raw);
      APP.ready = true;
      STORE.save(APP.state);
      APP.render();
      toast(`Imported ${APP.state.people.length} people`, 'ok');
      if (STORE.supported && STORE.getStatus().mode !== 'file') {
        UI.confirmDialog('Save this somewhere permanent?',
          'Your plan is loaded but only lives in this browser. Choose a file now and everything from here on autosaves to disk.',
          () => connect(true), 'Choose a file');
      }
    }).catch(err => toast('Could not read that file: ' + err.message, 'err'));
  }

  function welcome() {
    const host = $('#body');
    host.innerHTML = '';
    const opt = (title, sub, fn) => el('div', { class: 'opt', onclick: fn }, el('b', {}, title), el('span', {}, sub));
    host.appendChild(el('div', { class: 'card welcome' },
      el('h2', {}, 'Build your organization model'),
      el('p', { class: 'sub' },
        'Start from your company directory, import a roster, or build the organization manually. Your work saves automatically in this installed app.'),
      el('div', { class: 'opts' },
        opt('Populate from Microsoft 365',
          'Sign in and pull your reporting organization, or start from another leader.',
          () => DIRECTORY_SYNC.open()),
        opt('Import CSV or Excel',
          'Load a roster from CSV, TSV, XLS or XLSX. Review the column mapping before anything changes.',
          () => IMPORTS.openRosterImport()),
        opt('Start manually',
          'Begin with an empty model. Add people, roles and blueprint seats directly in the app.',
          () => { APP.ready = true; STORE.saveNow(APP.state); APP.render(); APP.go('people'); }),
        opt('Import a JSON backup',
          'Continue from an existing Ultra Headcount Manager or CUHM backup.',
          importBackup),
        STORE.supported ? opt('Open a connected JSON data file',
          'Use a file as the source of truth, with automatic saving and optional rolling backups.',
          () => connect(false)) : null,
        !STORE.supported ? el('p', { class: 'small muted' },
          'Direct file saving is unavailable in this browser. IndexedDB persistence still works.') : null)));
    $('#hero').innerHTML = '<div class="hero-title"><div class="eyebrow">Setup</div>' +
      '<h1>Ultra Headcount Manager</h1>' +
      '<p>Model your org across time. See exactly what leave and leavers cost you, month by month.</p></div>';
    $('#nav').innerHTML = '';
    renderStatus();
  }

  async function boot() {
    PWA.init();
    let conn = null;
    try { conn = await STORE.reconnect(); } catch (e) { console.warn('reconnect failed', e); }

    if (conn && conn.granted) {
      /* Silent reconnect worked — load straight from the file. */
      const res = await STORE.load();
      if (res.data) {
        APP.state = E.migrate(res.data);
        APP.ready = true;
        APP.view = APP.state.settings.lastView || 'dashboard';
        APP.render();
        return finish();
      }
    }

    if (conn && !conn.granted) {
      /* Handle cached but Chrome/Edge needs a click before it will read the file. */
      const host = $('#body');
      host.innerHTML = '';
      host.appendChild(el('div', { class: 'card welcome' },
        el('h2', {}, 'Reconnect to your plan'),
        el('p', { class: 'sub' }, `Your data lives in ${conn.handle.name}. Browsers require one click before an app may reopen a file.`),
        el('div', { class: 'opts' },
          el('div', {
            class: 'opt', onclick: async () => {
              if (await STORE.grant()) {
                const res = await STORE.load();
                if (res.data) APP.state = E.migrate(res.data);
                APP.ready = true;
                APP.view = APP.state.settings.lastView || 'dashboard';
                APP.render();
              } else { toast('Permission denied', 'err'); }
            }
          }, el('b', {}, `🔓 Reconnect to ${conn.handle.name}`), el('span', {}, 'One click and everything is exactly as you left it.')),
          el('div', { class: 'opt', onclick: () => welcome() },
            el('b', {}, '… or choose a different file'), el('span', {}, 'Open, create or import somewhere else.')))));
      $('#hero').innerHTML = '<div class="hero-title"><div class="eyebrow">Welcome back</div>' +
        '<h1>Ultra Headcount Manager</h1><p>Reconnecting to your saved plan.</p></div>';
      renderStatus();
      return finish();
    }

    /* No file handle — load the durable installed-app database. */
    const cached = await STORE.load();
    if (cached.data) {
      try {
        APP.state = E.migrate(cached.data);
        APP.ready = true;
        APP.view = APP.state.settings.lastView || 'dashboard';
        APP.render();
        if (cached.recovered) {
          toast('The latest save was damaged, so the app safely restored the previous copy.', 'warn');
        }
        toast('Loaded your locally saved plan', 'ok');
      } catch (err) { console.error(err); welcome(); }
    } else {
      welcome();
    }
    return finish();
  }

  function finish() {
    STORE.on(() => renderStatus());

    /* keyboard */
    document.addEventListener('keydown', e => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); STORE.saveNow(APP.state).then(() => toast('Saved', 'ok')); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { if (typing) return; e.preventDefault(); APP.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { if (typing) return; e.preventDefault(); APP.redo(); return; }
      if (typing) return;
      if (e.key === '[') { e.preventDefault(); APP.setDate(E.monthEnd(E.addMonths(APP.date, -1))); }
      if (e.key === ']') { e.preventDefault(); APP.setDate(E.monthEnd(E.addMonths(APP.date, 1))); }
      const n = parseInt(e.key, 10);
      if (!isNaN(n) && n >= 1 && n <= 9 && VIEWS[n - 1]) APP.go(VIEWS[n - 1].id);
    });

    /* sticky nav shadow */
    const nav = $('#nav');
    window.addEventListener('scroll', () => {
      if (nav) nav.classList.toggle('stuck', nav.getBoundingClientRect().top <= 1);
    }, { passive: true });

    /* never lose work */
    window.addEventListener('blur', () => { if (APP.ready) STORE.flush(APP.state); });
    window.addEventListener('beforeunload', e => {
      if (!APP.ready) return;
      STORE.flush(APP.state);
      const st = STORE.getStatus();
      if (st.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && APP.ready) STORE.flush(APP.state);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* exposed for the console and for tests */
  window.CUHM = {
    APP, ENGINE: E, STORE, UI, IMPORTS, DIRECTORY_SYNC, PWA, DESKTOP, VIEWS, parseDateish, parseNatural, openPalette,
    views: {
      dashboard: VIEW_DASHBOARD, ribbon: VIEW_RIBBON, risk: VIEW_RISK,
      timeline: VIEW_TIMELINE, org: VIEW_ORG, people: VIEW_PEOPLE,
      pipeline: VIEW_PIPELINE, workload: VIEW_WORKLOAD, blueprint: VIEW_BLUEPRINT,
      scenarios: VIEW_SCENARIOS, data: VIEW_DATA
    }
  };
})();
