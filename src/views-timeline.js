/* ============================================================================
   CUHM 2.0 — Timeline views: the Leave & Leaver Gantt and the time-aware
   org chart. Makes the impact of leave and leavers spatial and immediate.
   ========================================================================== */
const VIEW_TIMELINE = (() => {
  'use strict';
  const { el, frag, nf, sgn, section, statePill, toast, APP } = UI;
  const E = ENGINE;

  let showAll = false;

  function render() {
    const s = APP.state;
    const fy = APP.fy;
    const start = E.fyStart(fy), end = E.fyEnd(fy);
    const totalDays = E.daysBetween(start, end) || 365;
    const pos = d => Math.max(0, Math.min(100, (E.daysBetween(start, d) / totalDays) * 100));
    const wrap = el('div', {});

    /* --- build rows -------------------------------------------------------- */
    const rows = [];
    s.people.filter(p => APP.matches(p)).forEach(p => {
      const bars = [];
      const evts = (p.events || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const hire = evts.find(e => e.type === 'hire' && E.valid(e.date));
      const exit = evts.find(e => e.type === 'exit' && E.valid(e.date));

      evts.filter(e => e.type === 'leave' && E.valid(e.date)).forEach(e => {
        const from = e.date < start ? start : e.date;
        const to = E.valid(e.endDate) ? (e.endDate > end ? end : e.endDate) : end;
        if (to <= start || from >= end) return;
        bars.push({
          cls: 'leave', from, to,
          label: `${e.kind || 'Leave'}${E.valid(e.endDate) ? '' : ' (open-ended)'}`,
          title: `${e.kind || 'Leave'} ${E.longDate(e.date)} → ${E.valid(e.endDate) ? E.longDate(e.endDate) : 'open-ended'}`
        });
      });

      if (exit) {
        const noticeFrom = E.valid(exit.noticeFrom) ? exit.noticeFrom : E.addDays(exit.date, -90);
        const nf0 = noticeFrom < start ? start : noticeFrom;
        /* Garden leave splits the notice period in two: still working, then
           paid but gone. Only the first half is capacity. */
        const garden = E.valid(exit.gardenFrom) && exit.gardenFrom <= exit.date ? exit.gardenFrom : null;
        const noticeEnd = garden && garden > nf0 ? garden : (garden ? nf0 : exit.date);
        if (exit.date > start && nf0 < noticeEnd) {
          bars.push({ cls: 'notice', from: nf0, to: noticeEnd > end ? end : noticeEnd,
            label: 'Notice period', title: `Serving notice and still working, last day ${E.longDate(exit.date)}` });
        }
        if (garden && exit.date > start) {
          const g0 = garden < start ? start : garden;
          if (g0 < exit.date) {
            bars.push({ cls: 'garden', from: g0, to: exit.date > end ? end : exit.date,
              label: 'Garden leave',
              title: `Garden leave from ${E.longDate(garden)} until ${E.longDate(exit.date)} — paid, on roll, zero capacity` });
          }
        }
        if (exit.date < end) {
          bars.push({ cls: 'gone', from: exit.date > start ? exit.date : start, to: end,
            label: `Gone (${E.longDate(exit.date)})`, title: `Left ${E.longDate(exit.date)} — seat empty from here` });
        }
      }

      if (hire && hire.date <= end && hire.date >= start) {
        const rampEnd = E.addMonths(hire.date, (s.settings.rampProfile || E.DEFAULT_RAMP).length - 1);
        bars.push({ cls: 'rampb', from: hire.date, to: rampEnd > end ? end : rampEnd,
          label: 'Ramping', title: `Started ${E.longDate(hire.date)} — not at full productivity until ${E.longDate(rampEnd)}` });
      }

      if (!bars.length && !showAll) return;
      rows.push({ id: p.id, name: p.name, sub: `${p.blueprintRole || 'N/A'} · ${p.manager || '—'}`, bars, kind: 'person' });
    });

    (s.requisitions || []).filter(r => r.hiringStage !== 'Cancelled' && E.valid(r.expectedStartDate)).forEach(r => {
      const rampEnd = E.addMonths(r.expectedStartDate, (s.settings.rampProfile || E.DEFAULT_RAMP).length - 1);
      rows.push({
        id: r.id, name: r.pcnId || 'Open requisition',
        sub: `${r.targetRole || '—'} · ${r.hiringStage}`,
        kind: 'req',
        bars: [{ cls: 'pipe', from: r.expectedStartDate < start ? start : r.expectedStartDate,
          to: rampEnd > end ? end : rampEnd, label: `Lands ${E.longDate(r.expectedStartDate)}`,
          title: `Expected start ${E.longDate(r.expectedStartDate)} · ${r.hiringStage}` }]
      });
    });

    /* --- header ------------------------------------------------------------ */
    const months = E.fyMonths(fy);
    const head = el('div', { class: 'gantt-head' },
      el('div', { class: 'gname' }, 'Person / requisition'),
      el('div', { class: 'gmonths' }, months.map(m => el('span', {}, E.monthLabel(m)))));

    const body = el('div', {});
    rows.forEach(r => {
      const track = el('div', { class: 'gtrack' });
      r.bars.forEach(b => {
        const left = pos(b.from), right = pos(b.to);
        const bar = el('div', {
          class: `gbar ${b.cls}`, style: { left: `${left}%`, width: `${Math.max(right - left, 1.2)}%` },
          title: b.title
        }, b.label);
        track.appendChild(bar);
      });
      track.appendChild(el('div', { class: 'gnow', style: { left: `${pos(APP.date)}%` } }));
      body.appendChild(el('div', { class: 'gantt-row', onclick: () => r.kind === 'person' ? VIEW_PEOPLE.openPerson(r.id) : VIEW_PIPELINE.editRequisition(r.id) },
        el('div', { class: 'gname' }, el('b', {}, r.name), el('i', {}, r.sub)),
        track));
    });

    const controls = el('div', { class: 'row', style: { marginBottom: '12px' } },
      el('label', { class: 'switch' },
        el('input', { type: 'checkbox', checked: showAll, onchange: e => { showAll = e.target.checked; APP.render(); } }),
        'Show everyone (not just people affected by leave, notice, ramp or pipeline)'),
      el('div', { class: 'right small muted' }, `Blue line = ${E.longDate(APP.date)}`));

    wrap.appendChild(section('Leave & leaver timeline · FY' + fy,
      'Every absence, notice period, ramp and pipeline hire on one canvas. Drag the Time Machine and the blue line moves with you.',
      controls,
      rows.length ? el('div', { class: 'gantt' }, head, body)
        : UI.emptyBox('Nobody has leave, notice or ramp events in this fiscal year. Tick "show everyone" to see the full roster.'),
      el('div', { class: 'legend' },
        lg('var(--cp-warning)', 'Leave (seat filled, zero capacity)'),
        lg('var(--cp-danger)', 'Notice period (still working)'),
        lg('var(--cp-warning)', 'Garden leave (paid, zero capacity)'),
        lg('var(--cp-border-strong)', 'Seat empty after departure'),
        lg('var(--cp-accent)', 'New hire ramping up'),
        lg('var(--cp-link)', 'Pipeline requisition landing'))));

    /* --- month-by-month event list ---------------------------------------- */
    wrap.appendChild(eventCalendar(fy));
    return wrap;
  }

  const lg = (color, label) => el('span', {}, el('i', { style: { background: color } }), label);

  /** Chronological list of everything that changes headcount this year. */
  function eventCalendar(fy) {
    const s = APP.state;
    const start = E.fyStart(fy), end = E.fyEnd(fy);
    const items = [];
    s.people.forEach(p => (p.events || []).forEach(e => {
      if (!E.valid(e.date)) return;
      const push = (d, kind, text, delta) => {
        if (d < start || d > end) return;
        items.push({ date: d, person: p, kind, text, delta });
      };
      if (e.type === 'exit') push(e.date, 'Leaver', `${p.name} leaves (last day)`, -(+p.fte || 1));
      if (e.type === 'leave') {
        push(e.date, 'Leave starts', `${p.name} starts ${(e.kind || 'leave').toLowerCase()}`, -(+p.fte || 1));
        if (E.valid(e.endDate)) push(e.endDate, 'Leave ends', `${p.name} returns from ${(e.kind || 'leave').toLowerCase()}`, +(+p.fte || 1));
      }
      if (e.type === 'hire') push(e.date, 'Starter', `${p.name} starts`, +(+p.fte || 1));
      if (e.type === 'fte_change') push(e.date, 'FTE change', `${p.name} moves to ${e.fte} FTE`, null);
    }));
    (s.requisitions || []).filter(r => r.hiringStage !== 'Cancelled' && E.valid(r.expectedStartDate)).forEach(r => {
      if (r.expectedStartDate < start || r.expectedStartDate > end) return;
      items.push({ date: r.expectedStartDate, person: null, kind: 'Pipeline', text: `${r.pcnId || 'Requisition'} expected to start (${r.targetRole || '—'})`, delta: +(+r.fte || 1) });
    });
    items.sort((a, b) => a.date.localeCompare(b.date));

    if (!items.length) return section('Change calendar', null, UI.emptyBox('No headcount events recorded in FY' + fy + '.'));

    const byMonth = new Map();
    items.forEach(i => {
      const k = i.date.slice(0, 7);
      if (!byMonth.has(k)) byMonth.set(k, []);
      byMonth.get(k).push(i);
    });

    const box = el('div', {});
    byMonth.forEach((list, monthKey) => {
      const net = list.reduce((a, i) => a + (i.delta || 0), 0);
      const det = el('details', { class: 'acc', open: monthKey === APP.date.slice(0, 7) },
        el('summary', {}, `${E.monthLabel(monthKey + '-01')} — ${list.length} event${list.length === 1 ? '' : 's'}`,
          el('span', {
            class: `pill ${net < 0 ? 'p-notice' : net > 0 ? 'p-active' : 'p-low'}`,
            style: { marginLeft: '9px' }
          }, `net ${sgn(net)} FTE`)),
        el('div', {}, list.map(i => el('div', {
          class: 'row', style: { padding: '4px 0', borderBottom: '1px solid var(--cp-surface-soft)' }
        },
          el('span', { class: 'mono small muted', style: { minWidth: '92px' } }, E.longDate(i.date)),
          el('span', { class: `pill ${i.kind === 'Leaver' ? 'p-notice' : i.kind === 'Leave starts' ? 'p-leave' : i.kind === 'Leave ends' || i.kind === 'Starter' ? 'p-active' : 'p-pipeline'}` }, i.kind),
          el('span', {}, i.text),
          el('span', { class: 'right mono small', style: { color: (i.delta || 0) < 0 ? 'var(--cp-danger)' : 'var(--cp-success)' } },
            i.delta === null ? '' : sgn(i.delta)),
          el('button', { class: 'btn sm', onclick: () => APP.setDate(i.date) }, 'Go')))));
      box.appendChild(det);
    });

    return section('Change calendar',
      'Everything that moves your headcount this year, month by month, with the net FTE effect.', box);
  }

  return { render };
})();

/* ============================================================================
   Org chart — hierarchy coloured by state at the selected date.
   ========================================================================== */
const VIEW_ORG = (() => {
  'use strict';
  const { el, nf, sgn, section, statePill, APP } = UI;
  const E = ENGINE;

  const collapsed = new Set();

  function render() {
    const s = APP.state;
    const ev = APP.ev();
    const wrap = el('div', {});

    const byManager = new Map();
    s.people.forEach(p => {
      const m = p.manager || '';
      if (!byManager.has(m)) byManager.set(m, []);
      byManager.get(m).push(p);
    });
    const names = new Set(s.people.map(p => p.name));
    // Roots: no manager, or a manager who isn't in the model.
    const roots = s.people.filter(p => !p.manager || !names.has(p.manager));

    const hideDeparted = !APP.filters.search;

    function node(p) {
      const r = ev.byId.get(p.id) || { state: 'Active', onRoll: p.fte, effective: p.fte, reason: '' };
      const kids = (byManager.get(p.name) || []).sort((a, b) => a.name.localeCompare(b.name));
      const teamStats = teamRollup(p.name, ev, byManager);
      const isCollapsed = collapsed.has(p.id);
      const atRisk = teamStats.count > 0 && teamStats.effective < teamStats.onRoll * 0.8;

      const box = el('div', {
        class: `node s-${r.state} ${atRisk ? 'risk' : ''}`,
        onclick: e => { e.stopPropagation(); VIEW_PEOPLE.openPerson(p.id); },
        title: r.reason
      },
        kids.length ? el('button', {
          class: 'tw', title: isCollapsed ? 'Expand' : 'Collapse',
          onclick: e => { e.stopPropagation(); isCollapsed ? collapsed.delete(p.id) : collapsed.add(p.id); APP.render(); }
        }, isCollapsed ? '+' : '−') : el('span', { class: 'tw', style: { visibility: 'hidden' } }, ''),
        el('div', {},
          el('div', { class: 'nm' }, p.name || '(unnamed)'),
          el('div', { class: 'rl' }, `${p.jobTitle || p.blueprintRole || '—'}${p.level ? ' · ' + p.level : ''}`)),
        el('div', { class: 'caps' },
          statePill(r.state),
          kids.length ? el('div', { class: 'tiny' },
            el('b', {}, nf(teamStats.effective)), ` / ${nf(teamStats.onRoll)} team FTE`,
            teamStats.drag > 0 ? el('span', { style: { color: 'var(--cp-warning)' } }, ` (−${nf(teamStats.drag)})`) : null) : null));

      const li = el('li', {}, box);
      if (kids.length && !isCollapsed) {
        li.appendChild(el('ul', {}, kids
          .filter(k => hideDeparted ? (ev.byId.get(k.id) || {}).state !== E.STATES.DEPARTED || true : true)
          .map(node)));
      }
      return li;
    }

    const tree = el('div', { class: 'org' }, el('ul', {}, roots.map(node)));

    wrap.appendChild(section('Org chart at ' + E.longDate(APP.date),
      'Nodes are coloured by each person\'s state on the selected date. Scrub the Time Machine and watch the org thin out. A red halo means a manager\'s team has lost more than 20% of its capacity.',
      el('div', { class: 'row', style: { marginBottom: '10px' } },
        el('button', { class: 'btn sm', onclick: () => { collapsed.clear(); APP.render(); } }, 'Expand all'),
        el('button', {
          class: 'btn sm', onclick: () => { s.people.forEach(p => collapsed.add(p.id)); collapsed.delete(roots[0] && roots[0].id); APP.render(); }
        }, 'Collapse all'),
        el('div', { class: 'right legend', style: { marginTop: 0 } },
          lgd('var(--cp-warning-soft)', 'On leave'), lgd('var(--cp-danger-soft)', 'Leaving'),
          lgd('var(--cp-accent-soft)', 'Ramping'), lgd('var(--cp-muted-soft)', 'Departed'))),
      tree));

    /* --- team capacity table --------------------------------------------- */
    const spanList = E.spans(s, APP.date, APP.scenario).filter(m => m.manager && m.manager !== '—');
    wrap.appendChild(section('Team capacity at ' + E.longDate(APP.date), null,
      UI.table([
        { label: 'Manager', render: m => el('b', {}, m.manager) },
        { label: 'Reports', num: true, key: 'span' },
        { label: 'On-roll', num: true, render: m => nf(m.onRoll) },
        { label: 'Effective', num: true, render: m => el('b', { style: { color: m.leaveDrag > 0 ? 'var(--cp-danger)' : '' } }, nf(m.effective)) },
        {
          label: 'Capacity', render: m => {
            const p = m.onRoll ? (m.effective / m.onRoll) * 100 : 100;
            return el('div', { class: 'row', style: { gap: '7px' } },
              el('div', { class: 'bar-mini', style: { flex: '1' } },
                el('i', { style: { width: `${p}%`, background: p < 80 ? 'var(--cp-danger)' : p < 95 ? 'var(--cp-warning)' : 'var(--cp-success)' } })),
              el('span', { class: 'tiny mono' }, `${Math.round(p)}%`));
          }
        },
        { label: 'Unavailable', render: m => el('span', { class: 'tiny muted' },
            m.reports.filter(r => r.state !== E.STATES.ACTIVE).map(r => `${r.name.split(' ')[0]} (${UI.STATE_PILL[r.state] ? UI.STATE_PILL[r.state][1] : r.state})`).join(', ') || '—') }
      ], spanList)));

    return wrap;
  }

  const lgd = (bg, label) => el('span', {},
    el('i', { style: { background: bg, border: '1px solid var(--cp-border)' } }), label);

  /** Recursively roll a manager's whole sub-tree. */
  function teamRollup(managerName, ev, byManager, seen) {
    seen = seen || new Set();
    if (seen.has(managerName)) return { onRoll: 0, effective: 0, drag: 0, count: 0 };
    seen.add(managerName);
    let onRoll = 0, effective = 0, count = 0;
    (byManager.get(managerName) || []).forEach(p => {
      const r = ev.byId.get(p.id);
      if (r && r.state !== E.STATES.DEPARTED && r.state !== E.STATES.NOT_STARTED) {
        onRoll += r.onRoll; effective += r.effective; count++;
      }
      const sub = teamRollup(p.name, ev, byManager, seen);
      onRoll += sub.onRoll; effective += sub.effective; count += sub.count;
    });
    return { onRoll: +onRoll.toFixed(2), effective: +effective.toFixed(2), drag: +(onRoll - effective).toFixed(2), count };
  }

  return { render };
})();
