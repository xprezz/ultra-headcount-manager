/* ============================================================================
   CUHM 2.0 — UI core: DOM helpers, app state, mutation/journal/undo, toasts,
   modals, and shared formatting.
   ========================================================================== */
const UI = (() => {
  'use strict';
  const E = ENGINE;

  /* ---------- DOM ---------------------------------------------------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    kids.flat(9).forEach(k => {
      if (k === null || k === undefined || k === false) return;
      node.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    });
    return node;
  }
  const frag = (...kids) => { const f = document.createDocumentFragment(); kids.flat(9).forEach(k => k && f.appendChild(k instanceof Node ? k : document.createTextNode(String(k)))); return f; };

  /* ---------- formatting --------------------------------------------------- */
  const nf = (n, p) => {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const prec = p === undefined ? (APP.state.settings.precision ?? 1) : p;
    const v = Number(n);
    return Number.isInteger(v) && prec <= 1 ? String(v) : v.toFixed(prec);
  };
  const sgn = (n, p) => (n > 0 ? '+' : '') + nf(n, p);
  const pct = n => `${Math.round(n)}%`;

  const STATE_PILL = {
    Active: ['p-active', 'Active'],
    Ramping: ['p-ramp', 'Ramping'],
    OnLeave: ['p-leave', 'On leave'],
    GardenLeave: ['p-garden', 'Garden leave'],
    OnNotice: ['p-notice', 'Leaving'],
    Departed: ['p-departed', 'Departed'],
    NotYetStarted: ['p-future', 'Not started']
  };
  const statePill = st => {
    const [cls, label] = STATE_PILL[st] || ['p-low', st];
    return el('span', { class: `pill ${cls}` }, label);
  };

  const ROLE_TONE = {
    green: 'p-active', blue: 'p-blue', amber: 'p-medium', red: 'p-high',
    leave: 'p-leave', purple: 'p-ramp', grey: 'p-departed'
  };
  /** Pill for a role's status. `status` is an ENGINE.ROLE_STATUS member. */
  const rolePill = status => el('span',
    { class: `pill ${ROLE_TONE[status.tone] || 'p-low'}` }, status.label);

  /** Seats · filled · effective as one compact readable bar. */
  function seatBar(row) {
    const seats = Math.max(row.seats, row.filled + row.pipeline, 1);
    const w = v => `${Math.max(0, Math.min(100, (v / seats) * 100))}%`;
    return el('div', { class: 'seatbar', title: `${row.filled} filled of ${row.seats} seats · ${row.effective} deployable` },
      el('i', { class: 'sb-eff', style: { width: w(row.effective) } }),
      row.leaveDrag > 0 ? el('i', { class: 'sb-drag', style: { width: w(row.leaveDrag) } }) : null,
      row.pipeline > 0 ? el('i', { class: 'sb-pipe', style: { width: w(row.pipeline) } }) : null,
      row.openSeats > 0 ? el('i', { class: 'sb-open', style: { width: w(row.openSeats) } }) : null);
  }

  /** Colour class for a capacity cell, from gap vs seats. */
  function gapClass(gap, seats) {
    if (seats === 0) return gap > 0 ? 'c-surplus' : '';
    if (gap > 0.001) return 'c-surplus';
    if (gap > -0.001) return 'c-full';
    const ratio = Math.abs(gap) / Math.max(seats, 1);
    if (ratio <= 0.08) return 'c-w1';
    if (ratio <= 0.16) return 'c-w2';
    if (ratio <= 0.3) return 'c-r1';
    if (ratio <= 0.5) return 'c-r2';
    return 'c-r3';
  }

  /* ---------- toasts ------------------------------------------------------- */
  let toastBox;
  function toast(msg, kind) {
    if (!toastBox) { toastBox = el('div', { class: 'toasts' }); document.body.appendChild(toastBox); }
    const t = el('div', { class: `toast ${kind || ''}` }, msg);
    toastBox.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.3s'; setTimeout(() => t.remove(), 320); }, kind === 'err' ? 6000 : 3200);
  }

  /* ---------- modal -------------------------------------------------------- */
  let openModal = null;
  function modal(title, bodyNode, opts = {}) {
    closeModal();
    const box = el('div', { class: `modal ${opts.size || ''}` },
      el('div', { class: 'modal-head' },
        el('div', {}, el('h2', {}, title), opts.sub ? el('div', { class: 'sub' }, opts.sub) : null),
        el('button', { class: 'btn', onclick: closeModal, title: 'Close (Esc)' }, '✕ Close')),
      bodyNode);
    const scrim = el('div', { class: 'scrim', onclick: e => { if (e.target === scrim) closeModal(); } }, box);
    document.body.appendChild(scrim);
    openModal = scrim;
    return { scrim, box, close: closeModal };
  }
  function closeModal() { if (openModal) { openModal.remove(); openModal = null; } }

  function confirmDialog(title, message, onYes, yesLabel) {
    const body = el('div', {},
      el('p', { class: 'sub' }, message),
      el('div', { class: 'row', style: { marginTop: '14px' } },
        el('button', { class: 'btn danger', onclick: () => { closeModal(); onYes(); } }, yesLabel || 'Yes, do it'),
        el('button', { class: 'btn', onclick: closeModal }, 'Cancel')));
    modal(title, body, { size: 'narrow' });
  }

  /* ---------- application state ------------------------------------------- */
  const APP = {
    state: E.emptyState(),
    view: 'dashboard',
    undoStack: [],
    redoStack: [],
    filters: { family: '', role: '', manager: '', search: '', level: '', employmentType: '' },
    compareScenario: '',
    ready: false,

    /** Every mutation goes through here: journals it, pushes undo, autosaves. */
    mutate(label, fn, opts = {}) {
      const before = JSON.stringify(this.state);
      const result = fn(this.state);
      if (result === false) return false;
      this.undoStack.push({ label, snapshot: before });
      if (this.undoStack.length > 80) this.undoStack.shift();
      this.redoStack.length = 0;
      this.state.journal = this.state.journal || [];
      this.state.journal.unshift({ ts: new Date().toISOString(), action: label });
      if (this.state.journal.length > 800) this.state.journal.length = 800;
      STORE.save(this.state, { backup: !!opts.backup });
      if (opts.silent !== true) this.render();
      return true;
    },

    undo() {
      const item = this.undoStack.pop();
      if (!item) return toast('Nothing to undo');
      this.redoStack.push({ label: item.label, snapshot: JSON.stringify(this.state) });
      this.state = JSON.parse(item.snapshot);
      STORE.save(this.state);
      this.render();
      toast(`Undone: ${item.label}`);
    },
    redo() {
      const item = this.redoStack.pop();
      if (!item) return toast('Nothing to redo');
      this.undoStack.push({ label: item.label, snapshot: JSON.stringify(this.state) });
      this.state = JSON.parse(item.snapshot);
      STORE.save(this.state);
      this.render();
      toast(`Redone: ${item.label}`);
    },

    /* --- convenience accessors --- */
    get date() { return this.state.settings.selectedDate; },
    get scenario() { return this.state.settings.selectedScenario; },
    get fy() { return this.state.settings.fy || 27; },

    setDate(d) {
      if (!E.valid(d)) return;
      this.state.settings.selectedDate = d;
      STORE.save(this.state);
      this.render();
    },
    setScenario(s) { this.state.settings.selectedScenario = s; STORE.save(this.state); this.render(); },
    setSetting(k, v) { this.state.settings[k] = v; STORE.save(this.state); this.render(); },

    /** Cached evaluation for the currently selected date + scenario. */
    ev(date, scenario) {
      return E.evaluate(this.state, date || this.date, scenario || this.scenario);
    },

    personById(id) { return this.state.people.find(p => p.id === id); },
    peopleNames() { return this.state.people.map(p => p.name).filter(Boolean).sort(); },
    families() { return [...new Set(this.state.people.map(p => p.family).concat(this.state.blueprint.map(b => b.family)).filter(Boolean))].sort(); },
    roles() { return [...new Set(this.state.people.map(p => p.blueprintRole).concat(this.state.blueprint.map(b => b.role)).filter(Boolean))].sort(); },
    levels() { return [...new Set(this.state.people.map(p => p.level).filter(Boolean))].sort(); },

    /** Applies the global filter bar to a person record. */
    matches(p) {
      const f = this.filters;
      if (f.family && p.family !== f.family) return false;
      if (f.role && (p.blueprintRole || p.role) !== f.role) return false;
      if (f.manager && p.manager !== f.manager) return false;
      if (f.level && p.level !== f.level) return false;
      if (f.employmentType && (p.employmentType || 'Employee') !== f.employmentType) return false;
      if (f.search) {
        const q = f.search.toLowerCase();
        const hay = `${p.name} ${p.jobTitle} ${p.email} ${p.family} ${p.blueprintRole} ${p.level} ${p.location} ${(p.skills || []).join(' ')} ${p.notes || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    },
    filterActive() { return Object.values(this.filters).some(Boolean); },

    /** Structural scope only — the axes that also exist on blueprint seats and
        open requisitions, so the establishment can be recomputed against them.
        Manager, level and free-text search are roster-only and excluded here. */
    scopeActive() {
      const f = this.filters;
      return !!(f.family || f.role || f.employmentType);
    },
    /** Predicate to hand to the engine so a whole view recomputes in scope.
        Returns null when nothing is filtered, which keeps the fast path fast. */
    scope() {
      if (!this.scopeActive()) return null;
      const f = this.filters;
      return rec => {
        if (f.family && rec.family !== f.family) return false;
        if (f.role && (rec.blueprintRole || rec.role) !== f.role) return false;
        if (f.employmentType && rec.employmentType !== undefined
          && (rec.employmentType || 'Employee') !== f.employmentType) return false;
        return true;
      };
    },
    /** Label describing the current scope, for card subtitles. */
    scopeLabel() {
      const f = this.filters;
      return [f.role, f.family, f.employmentType].filter(Boolean).join(' · ');
    },

    render() { /* replaced by app.js */ }
  };

  /* ---------- shared small components -------------------------------------- */
  function kpi(label, value, note, tone) {
    return el('div', { class: `kpi ${tone ? 'k-' + tone : ''}` },
      el('div', { class: 'lab' }, label),
      el('div', { class: 'val' }, value),
      note ? el('div', { class: 'note' }, note) : null);
  }

  /** The dual on-roll / leave-drag / effective band. Used on every major view. */
  function dualBand(totals, opts = {}) {
    const drag = totals.leaveDrag || 0;
    return el('div', { class: 'dual' },
      el('div', { class: 'd-onroll' },
        el('div', { class: 'lab' }, 'On-roll headcount'),
        el('div', { class: 'val mono' }, nf(totals.onRoll)),
        el('div', { class: 'note' }, `${totals.headsOnRoll ?? ''} people occupying seats · ${sgn(totals.gapOnRoll)} vs ${totals.seats} blueprint`)),
      el('div', { class: 'd-drag' },
        el('div', { class: 'lab' }, 'Lost to leave'),
        el('div', { class: 'val mono' }, drag > 0 ? `−${nf(drag)}` : '0'),
        el('div', { class: 'note' }, drag > 0
          ? `${totals.onLeave} on leave, seats still filled`
          : 'Nobody on leave at this date')),
      el('div', { class: 'd-eff' },
        el('div', { class: 'lab' }, 'Effective capacity'),
        el('div', { class: 'val mono', style: { color: totals.gapEffective < 0 ? 'var(--cp-danger)' : 'var(--cp-success)' } }, nf(totals.effective)),
        el('div', { class: 'note' }, `${sgn(totals.gapEffective)} vs ${totals.seats} blueprint seats`)));
  }

  function emptyBox(msg, actionLabel, action) {
    return el('div', { class: 'empty' }, msg, actionLabel
      ? frag(el('br'), el('button', { class: 'btn primary', style: { marginTop: '10px' }, onclick: action }, actionLabel))
      : null);
  }

  function section(title, sub, ...kids) {
    return el('section', { class: 'card' },
      el('h2', {}, title),
      sub ? el('div', { class: 'sub' }, sub) : null,
      ...kids);
  }

  /** Sortable/scrollable table from column defs. */
  function table(cols, rows, opts = {}) {
    const thead = el('thead', {}, el('tr', {}, cols.map(c =>
      el('th', { class: c.num ? 'num' : '', style: c.width ? { width: c.width } : null }, c.label))));
    const tbody = el('tbody', {}, rows.map(r => {
      const tr = el('tr', { class: r._class || '', onclick: opts.onRow ? () => opts.onRow(r) : null,
        style: opts.onRow ? { cursor: 'pointer' } : null });
      cols.forEach(c => {
        const v = c.render ? c.render(r) : r[c.key];
        const cell = el('td', { class: (c.num ? 'num ' : '') + (c.cls || '') });
        if (Array.isArray(v)) cell.appendChild(frag(v));
        else if (v instanceof Node) cell.appendChild(v);
        else cell.textContent = (v === null || v === undefined || v === '') ? '—' : String(v);
        tr.appendChild(cell);
      });
      return tr;
    }));
    return el('div', { class: 'tbl-wrap' }, el('table', { class: opts.class || '' }, thead, tbody));
  }

  /* ---------- filter bar --------------------------------------------------- */
  const NO_FILTERS = () => ({ family: '', role: '', manager: '', search: '', level: '', employmentType: '' });

  /** Every control re-renders the whole page, which throws away the element you
      were typing into. Tag a control with dataset.focusKey and run the re-render
      through this: the replacement element gets the focus and the caret back.
      A handler can also name the key explicitly via focusAfterRender(), for
      events that fire once the browser has already moved focus elsewhere. */
  let focusHint = '';
  const focusAfterRender = key => { focusHint = key; };

  function preservingFocus(fn) {
    const a = document.activeElement;
    const key = focusHint || (a && a.dataset ? a.dataset.focusKey : '');
    focusHint = '';
    let from = null, to = null;
    if (key && a) { try { from = a.selectionStart; to = a.selectionEnd; } catch (_) { /* not a text field */ } }
    fn();
    if (!key) return;
    const next = document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
    if (!next || next === document.activeElement) return;
    next.focus({ preventScroll: true });
    if (from !== null && typeof next.setSelectionRange === 'function') {
      try { next.setSelectionRange(from, to); } catch (_) { /* input type has no caret */ }
    }
  }

  function filterSelect(key, label, options, onChange) {
    return el('label', { class: 'field' }, label,
      el('select', {
        dataset: { focusKey: `filter-${key}` },
        onchange: e => {
          APP.filters[key] = e.target.value;
          focusAfterRender(`filter-${key}`);
          (onChange || APP.render.bind(APP))();
        }
      },
        el('option', { value: '' }, `All ${label.toLowerCase()}`),
        options.map(o => el('option', { value: o, selected: APP.filters[key] === o }, o))));
  }

  function filterBar(onChange) {
    const mk = (key, label, options) => filterSelect(key, label, options, onChange);

    return el('div', { class: 'row', style: { marginBottom: '12px' } },
      el('label', { class: 'field', style: { flex: '1 1 220px' } }, 'Search',
        el('input', {
          type: 'text', placeholder: 'Name, title, skill, note…', value: APP.filters.search,
          dataset: { focusKey: 'filter-search' },
          oninput: e => {
            APP.filters.search = e.target.value;
            focusAfterRender('filter-search');
            (onChange || APP.render.bind(APP))();
          }
        })),
      mk('family', 'Family', APP.families()),
      mk('role', 'Role', APP.roles()),
      mk('manager', 'Manager', APP.peopleNames()),
      mk('level', 'Level', APP.levels()),
      mk('employmentType', 'Engagement', E.EMPLOYMENT_TYPES),
      APP.filterActive()
        ? el('button', { class: 'btn sm', style: { alignSelf: 'flex-end' },
          onclick: () => { APP.filters = NO_FILTERS(); (onChange || APP.render.bind(APP))(); } }, 'Clear filters')
        : null);
  }

  /** Compact structural scope selector: no free-text search, just the axes that
      the whole model — people, seats and requisitions alike — can be recomputed
      against. Manager and level are deliberately absent: blueprint seats carry
      neither, so scoping by them would invent a gap that isn't real. */
  function scopeBar(onChange) {
    const mk = (key, label, options) => filterSelect(key, label, options, onChange);
    const active = APP.scopeActive();
    return el('div', { class: `scopebar${active ? ' on' : ''}` },
      el('span', { class: 'scope-tag' }, active ? '⛭ Scoped' : '⛭ Whole org'),
      mk('role', 'Role', APP.roles()),
      mk('family', 'Family', APP.families()),
      mk('employmentType', 'Engagement', E.EMPLOYMENT_TYPES),
      active
        ? el('button', {
          class: 'btn sm', onclick: () => {
            const s = APP.filters.search;
            APP.filters = Object.assign(NO_FILTERS(), { search: s });
            (onChange || APP.render.bind(APP))();
          }
        }, 'Back to whole org')
        : el('span', { class: 'tiny muted' }, 'Pick a role or family and every number below recomputes for it.'));
  }

  /* ---------- tiny SVG chart helpers --------------------------------------- */
  const NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, ...kids) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    kids.flat(9).forEach(k => k && n.appendChild(k instanceof Node ? k : document.createTextNode(String(k))));
    return n;
  }

  /**
   * Layered Sankey. Nodes are placed in columns derived from the link graph;
   * ribbon thickness is the flow value. Nodes that carry nothing are dropped,
   * so a zero pipeline simply doesn't draw rather than collapsing the layout.
   *
   *   sankey({ nodes: [{id, label, color, note}],
   *            links: [{from, to, value, color}], height, width })
   */
  function sankey(opts) {
    const W = opts.width || 980, H = opts.height || 300;
    const NW = opts.nodeWidth || 13;      // node bar thickness
    const GAP = opts.gap || 14;           // vertical gap between nodes in a column
    const PAD = { t: 6, b: 6, l: 2, r: 2 };

    const links = (opts.links || []).filter(l => +l.value > 0.0001);
    const byId = new Map((opts.nodes || []).map(n => [n.id, Object.assign({}, n)]));
    const live = new Set();
    links.forEach(l => { live.add(l.from); live.add(l.to); });
    const nodes = [...byId.values()].filter(n => live.has(n.id));
    if (!nodes.length) return el('div', { class: 'empty' }, 'Nothing to chart at this date.');

    /* depth = longest path from any source, so columns line up sensibly */
    const inc = new Map(), out = new Map();
    nodes.forEach(n => { inc.set(n.id, []); out.set(n.id, []); });
    links.forEach(l => { out.get(l.from).push(l); inc.get(l.to).push(l); });

    const depth = new Map();
    const depthOf = (id, guard) => {
      if (depth.has(id)) return depth.get(id);
      if (guard.has(id)) return 0;                       // cycle guard
      guard.add(id);
      const ins = inc.get(id) || [];
      const d = ins.length ? Math.max(...ins.map(l => depthOf(l.from, guard) + 1)) : 0;
      depth.set(id, d);
      return d;
    };
    nodes.forEach(n => depthOf(n.id, new Set()));

    /* a node's size is the larger of what flows in and what flows out */
    const sum = ls => ls.reduce((a, l) => a + +l.value, 0);
    nodes.forEach(n => {
      n.depth = depth.get(n.id);
      n.value = Math.max(sum(inc.get(n.id)), sum(out.get(n.id)));
    });

    const cols = [...new Set(nodes.map(n => n.depth))].sort((a, b) => a - b);
    const colNodes = cols.map(d => nodes.filter(n => n.depth === d));
    const maxTotal = Math.max(...colNodes.map(ns => ns.reduce((a, n) => a + n.value, 0)), 1);
    const maxCount = Math.max(...colNodes.map(ns => ns.length), 1);
    const usable = H - PAD.t - PAD.b - GAP * (maxCount - 1);
    const scale = usable / maxTotal;

    const colX = i => PAD.l + (cols.length === 1 ? 0 : i * ((W - PAD.l - PAD.r - NW) / (cols.length - 1)));

    const place = () => colNodes.forEach((ns, i) => {
      const height = ns.reduce((a, n) => a + Math.max(n.value * scale, 1.5), 0) + GAP * (ns.length - 1);
      let y = PAD.t + (H - PAD.t - PAD.b - height) / 2;
      ns.forEach(n => {
        n.x = colX(i); n.y = y; n.col = i;
        n.h = Math.max(n.value * scale, 1.5);
        y += n.h + GAP;
      });
    });
    place();

    /* Barycentre ordering: pull each node level with the flows feeding it, so
       ribbons run roughly parallel instead of crossing over one another. */
    const centre = n => n.y + n.h / 2;
    const bary = (ls, pick) => {
      const w = ls.reduce((a, l) => a + +l.value, 0);
      if (!w) return null;
      return ls.reduce((a, l) => {
        const other = nodes.find(n => n.id === pick(l));
        return a + (other ? centre(other) * +l.value : 0);
      }, 0) / w;
    };
    for (let pass = 0; pass < 4; pass++) {
      const forward = pass % 2 === 0;
      const order = forward ? colNodes : [...colNodes].reverse();
      order.forEach(ns => {
        ns.forEach(n => {
          const b = forward ? bary(inc.get(n.id), l => l.from) : bary(out.get(n.id), l => l.to);
          n._b = b === null ? centre(n) : b;
        });
        ns.sort((a, b) => a._b - b._b);
      });
      place();
    }

    /* stack ribbons on each side of a node, ordered by where the other end sits,
       so ribbons leaving a node never cross each other */
    const cursorOut = new Map(), cursorIn = new Map();
    const y0s = new Map(), y1s = new Map();
    const yOf = id => { const n = nodes.find(x => x.id === id); return n ? n.y + n.h / 2 : 0; };
    nodes.forEach(n => {
      cursorOut.set(n.id, n.y); cursorIn.set(n.id, n.y);
      [...out.get(n.id)].sort((a, b) => yOf(a.to) - yOf(b.to))
        .forEach(l => { y0s.set(l, cursorOut.get(n.id)); cursorOut.set(n.id, cursorOut.get(n.id) + +l.value * scale); });
      [...inc.get(n.id)].sort((a, b) => yOf(a.from) - yOf(b.from))
        .forEach(l => { y1s.set(l, cursorIn.get(n.id)); cursorIn.set(n.id, cursorIn.get(n.id) + +l.value * scale); });
    });

    const g = svg('svg', {
      class: 'sankey', viewBox: `0 0 ${W} ${H}`, width: '100%', height: H,
      preserveAspectRatio: 'xMidYMid meet', role: 'img'
    });

    const ribbons = svg('g', { class: 'sankey-links' });
    links.forEach(l => {
      const a = byId.get(l.from), b = byId.get(l.to);
      const A = nodes.find(n => n.id === l.from), B = nodes.find(n => n.id === l.to);
      if (!A || !B) return;
      const t = +l.value * scale;
      const y0 = y0s.get(l), y1 = y1s.get(l);

      const x0 = A.x + NW, x1 = B.x;
      const cx = (x0 + x1) / 2;
      const d = `M${x0},${y0} C${cx},${y0} ${cx},${y1} ${x1},${y1}`
        + ` L${x1},${y1 + t} C${cx},${y1 + t} ${cx},${y0 + t} ${x0},${y0 + t} Z`;
      const path = svg('path', {
        d, fill: l.color || B.color || a.color || 'var(--cp-accent)',
        'fill-opacity': l.opacity || 0.28, class: 'sankey-link'
      });
      path.appendChild(svg('title', {}, `${a.label} → ${b.label}: ${nf(l.value)}${l.note ? ' · ' + l.note : ''}`));
      ribbons.appendChild(path);
    });
    g.appendChild(ribbons);

    nodes.forEach(n => {
      const bar = svg('rect', {
        x: n.x, y: n.y, width: NW, height: n.h, rx: 3,
        fill: n.color || 'var(--cp-accent)', class: 'sankey-node'
      });
      bar.appendChild(svg('title', {}, `${n.label}: ${nf(n.value)}${n.note ? ' · ' + n.note : ''}`));
      g.appendChild(bar);

      const last = n.col === cols.length - 1;
      const tx = last ? n.x - 8 : n.x + NW + 8;
      const anchor = last ? 'end' : 'start';
      const mid = n.y + n.h / 2;
      const label = svg('text', {
        x: tx, y: mid - 1, 'text-anchor': anchor, class: 'sankey-label'
      }, n.label);
      const val = svg('text', {
        x: tx, y: mid + 12, 'text-anchor': anchor, class: 'sankey-value'
      }, nf(n.value) + (n.note ? ` · ${n.note}` : ''));
      g.appendChild(label); g.appendChild(val);
    });

    return g;
  }

  /** Multi-series line chart with an optional target line and shaded band. */
  function lineChart(opts) {
    const W = opts.width || 900, H = opts.height || 240;
    const P = { t: 14, r: 16, b: 26, l: 40 };
    const labels = opts.labels || [];
    const series = opts.series || [];
    const all = series.flatMap(s => s.values).concat(opts.target ? [opts.target] : []).filter(v => typeof v === 'number');
    let min = Math.min(...all), max = Math.max(...all);
    const pad = Math.max((max - min) * 0.15, 1);
    min = Math.floor(min - pad); max = Math.ceil(max + pad);
    if (typeof opts.min === 'number') min = opts.min;
    if (typeof opts.max === 'number') max = opts.max;
    const x = i => P.l + (i / Math.max(labels.length - 1, 1)) * (W - P.l - P.r);
    const y = v => H - P.b - ((v - min) / Math.max(max - min, 1)) * (H - P.t - P.b);

    const g = svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', height: H });
    // gridlines
    for (let i = 0; i <= 4; i++) {
      const v = min + (max - min) * (i / 4);
      g.appendChild(svg('line', { class: 'axis', x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), 'stroke-dasharray': i ? '3 4' : '' }));
      g.appendChild(svg('text', { x: P.l - 6, y: y(v) + 3.5, 'text-anchor': 'end' }, nf(v, 0)));
    }
    labels.forEach((l, i) => g.appendChild(svg('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' }, l)));

    if (opts.band) {
      const pts = opts.band.hi.map((v, i) => `${x(i)},${y(v)}`)
        .concat(opts.band.lo.map((v, i) => `${x(i)},${y(v)}`).reverse()).join(' ');
      g.appendChild(svg('polygon', { points: pts, fill: opts.band.color || 'var(--cp-danger-soft)' }));
    }
    if (typeof opts.target === 'number') {
      g.appendChild(svg('line', { x1: P.l, x2: W - P.r, y1: y(opts.target), y2: y(opts.target),
        stroke: 'var(--cp-text)', 'stroke-width': 1.6, 'stroke-dasharray': '6 4' }));
      g.appendChild(svg('text', { x: W - P.r, y: y(opts.target) - 5, 'text-anchor': 'end',
        fill: 'var(--cp-text)', 'font-weight': '700' }, opts.targetLabel || 'Blueprint'));
    }
    series.forEach(s => {
      const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
      if (s.fill) g.appendChild(svg('polygon', { points: `${P.l},${y(min)} ${pts} ${x(labels.length - 1)},${y(min)}`, fill: s.fill }));
      g.appendChild(svg('polyline', { points: pts, fill: 'none', stroke: s.color, 'stroke-width': s.width || 2.4,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dash || '' }));
      s.values.forEach((v, i) => {
        const c = svg('circle', { cx: x(i), cy: y(v), r: 3.4, fill: s.color });
        c.appendChild(svg('title', {}, `${s.name} · ${labels[i]}: ${nf(v)}`));
        g.appendChild(c);
      });
    });
    return g;
  }

  function legend(items) {
    return el('div', { class: 'legend' }, items.map(i =>
      el('span', {}, el('i', { style: { background: i.color } }), i.label)));
  }

  /* ---------- CSV ---------------------------------------------------------- */
  function toCSV(rows, cols) {
    const q = v => {
      const s = String(v ?? '');
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [cols.map(c => q(c.label)).join(',')]
      .concat(rows.map(r => cols.map(c => q(c.value ? c.value(r) : r[c.key])).join(',')))
      .join('\r\n');
  }

  /** Tolerant CSV/TSV parser for paste-import. */
  function parseDelimited(text) {
    const t = text.replace(/\r\n?/g, '\n').trim();
    if (!t) return [];
    const delim = (t.split('\n')[0].match(/\t/g) || []).length >= (t.split('\n')[0].match(/[,;]/g) || []).length ? '\t'
      : (t.split('\n')[0].match(/;/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], cell = '', inQ = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (inQ) {
        if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
        else cell += c;
      } else if (c === '"') inQ = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    row.push(cell); rows.push(row);
    return rows.filter(r => r.some(c => String(c).trim()));
  }

  return {
    $, $$, el, frag, esc, svg, nf, sgn, pct, statePill, rolePill, seatBar,
    gapClass, toast, modal, closeModal, confirmDialog, APP, kpi, dualBand,
    emptyBox, section, table, filterBar, scopeBar, preservingFocus, focusAfterRender, lineChart, legend, toCSV, sankey,
    parseDelimited, STATE_PILL, ROLE_TONE
  };
})();
