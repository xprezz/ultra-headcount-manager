/* ============================================================================
   CUHM 2.0 — Capacity Ribbon: 12 months × every blueprint role.
   The view that answers "when does it hurt".
   ========================================================================== */
const VIEW_RIBBON = (() => {
  'use strict';
  const { el, frag, nf, sgn, statePill, section, table, modal, gapClass, toast, APP } = UI;
  const E = ENGINE;

  let mode = 'effective'; // effective | onroll | drag | headroom

  function render() {
    const s = APP.state;
    const rb = E.ribbon(s, APP.scenario, APP.fy);
    const wrap = el('div', {});

    const controls = el('div', { class: 'row', style: { marginBottom: '12px' } },
      el('label', { class: 'field' }, 'Show',
        el('select', { onchange: e => { mode = e.target.value; APP.render(); } },
          el('option', { value: 'effective', selected: mode === 'effective' }, 'Effective capacity vs seats'),
          el('option', { value: 'onroll', selected: mode === 'onroll' }, 'On-roll vs seats'),
          el('option', { value: 'drag', selected: mode === 'drag' }, 'Lost to leave only'),
          el('option', { value: 'headroom', selected: mode === 'headroom' }, 'Absolute effective FTE'))),
      el('div', { class: 'right small muted' },
        'Each cell samples the last day of the month. Click any cell for the people behind it.'));

    const rows = rb.rows.filter(r => {
      const f = APP.filters;
      if (f.family && r.family !== f.family) return false;
      if (f.role && r.role !== f.role) return false;
      return true;
    });

    /* --- the grid --------------------------------------------------------- */
    const thead = el('thead', {}, el('tr', {},
      el('th', { class: 'rolecol' }, 'Blueprint role'),
      el('th', { class: 'num' }, 'Seats'),
      rb.cols.map(c => el('th', { class: 'center', style: { textAlign: 'center' } }, c.label))));

    const tbody = el('tbody', {});
    rows.forEach(row => {
      const tr = el('tr', {},
        el('td', { class: 'rolecol' },
          el('b', {}, row.role || 'N/A'),
          el('div', { class: 'tiny muted' }, row.family)),
        el('td', { class: 'num mono' }, row.cells[0].seats));
      row.cells.forEach(c => tr.appendChild(cell(c, row)));
      tbody.appendChild(tr);
    });

    // totals row
    const tot = el('tr', { class: 'totals' },
      el('td', { class: 'rolecol' }, el('b', {}, 'TOTAL')),
      el('td', { class: 'num mono' }, rb.totalsRow[0].seats));
    rb.totalsRow.forEach(c => tot.appendChild(cell(c, null, true)));
    tbody.appendChild(tot);

    wrap.appendChild(section('Capacity ribbon · FY' + APP.fy,
      'Every blueprint role across the whole year. Red means you cannot staff the seats you have been given.',
      controls,
      el('div', { class: 'ribbon' }, el('table', {}, thead, tbody)),
      legendRow()));

    /* --- narrative summary ------------------------------------------------ */
    const worst = rb.totalsRow.reduce((a, b) => (b.gapEffective < a.gapEffective ? b : a), rb.totalsRow[0]);
    const monthsShort = rb.totalsRow.filter(c => c.gapEffective < -0.001).length;
    wrap.appendChild(section('What the ribbon says',
      null,
      el('ul', { class: 'small', style: { margin: 0, paddingLeft: '20px', lineHeight: '1.8' } },
        el('li', {}, `You are below blueprint in `, el('b', {}, `${monthsShort} of 12 months`), ` this fiscal year.`),
        el('li', {}, `The deepest month is `, el('b', {}, worst.label), ` at ${nf(worst.effective)} effective FTE against ${worst.seats} seats (`,
          el('b', { style: { color: 'var(--cp-danger)' } }, sgn(worst.gapEffective)), `).`),
        el('li', {}, `Leave alone removes up to `, el('b', {}, nf(Math.max(...rb.totalsRow.map(c => c.leaveDrag)))),
          ` FTE in ${rb.totalsRow.reduce((a, b) => b.leaveDrag > a.leaveDrag ? b : a).label}.`),
        el('li', {}, `Roles never at full strength all year: `,
          el('b', {}, rb.rows.filter(r => r.cells.every(c => c.gapEffective < -0.001)).map(r => r.role).join(', ') || 'none'), `.`))));

    return wrap;
  }

  function cell(c, row, isTotal) {
    let value, cls, sub;
    if (mode === 'effective') {
      value = nf(c.gapEffective === 0 ? 0 : c.gapEffective, 1);
      value = c.gapEffective > 0 ? `+${nf(c.gapEffective)}` : nf(c.gapEffective);
      cls = gapClass(c.gapEffective, c.seats);
      sub = `${nf(c.effective)}/${c.seats}`;
    } else if (mode === 'onroll') {
      value = c.gapOnRoll > 0 ? `+${nf(c.gapOnRoll)}` : nf(c.gapOnRoll);
      cls = gapClass(c.gapOnRoll, c.seats);
      sub = `${nf(c.onRoll)}/${c.seats}`;
    } else if (mode === 'drag') {
      value = c.leaveDrag > 0 ? `−${nf(c.leaveDrag)}` : '·';
      cls = c.leaveDrag > 0 ? (c.leaveDrag >= 2 ? 'c-r2' : 'c-w2') : 'c-ok';
      sub = c.leaveDrag > 0 ? 'on leave' : '';
    } else {
      value = nf(c.effective);
      cls = gapClass(c.gapEffective, c.seats);
      sub = `of ${c.seats}`;
    }
    return el('td', {
      class: `cell ${cls} ${c.leaveDrag > 0 ? 'drag' : ''}`,
      title: `${c.label}: ${nf(c.onRoll)} on-roll, ${nf(c.effective)} effective, ${c.seats} seats`,
      onclick: () => drill(c, row, isTotal)
    }, value, el('span', { class: 'sm' }, sub));
  }

  function legendRow() {
    const item = (cls, label) => el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } },
      el('i', { class: cls, style: { display: 'inline-block', width: '15px', height: '13px', borderRadius: '3px' } }), label);
    return el('div', { class: 'legend', style: { marginTop: '10px' } },
      item('c-surplus', 'Above blueprint'), item('c-full', 'On blueprint'),
      item('c-w1', 'Slightly short'), item('c-w2', 'Short'),
      item('c-r1', 'Materially short'), item('c-r2', 'Badly short'), item('c-r3', 'Critical'),
      el('span', {}, el('i', { style: { display: 'inline-block', width: '15px', height: '4px', background: 'repeating-linear-gradient(90deg,var(--cp-warning),var(--cp-warning) 3px,transparent 3px,transparent 6px)', verticalAlign: 'middle', marginRight: '5px' } }), 'Underline = leave is reducing this cell'));
  }

  /* ---------- drill-down --------------------------------------------------- */
  function drill(c, row, isTotal) {
    const ev = E.evaluate(APP.state, c.sample, APP.scenario);
    const members = isTotal
      ? ev.all.filter(m => m.onRoll > 0 || m.state === E.STATES.DEPARTED)
      : (ev.perRole.get(row.key) || { members: [] }).members;
    const departed = isTotal ? [] : ev.perPerson.filter(p =>
      E.roleKey(p.family, p.role) === row.key && p.state === E.STATES.DEPARTED);
    const all = members.concat(departed);

    const body = el('div', {},
      el('div', { class: 'grid g4', style: { marginBottom: '14px' } },
        UI.kpi('Seats', String(c.seats), 'Blueprint'),
        UI.kpi('On-roll', nf(c.onRoll), sgn(c.gapOnRoll) + ' vs seats', c.gapOnRoll < 0 ? 'amber' : 'green'),
        UI.kpi('Lost to leave', c.leaveDrag > 0 ? `−${nf(c.leaveDrag)}` : '0', 'Seats filled, no capacity', 'amber'),
        UI.kpi('Effective', nf(c.effective), sgn(c.gapEffective) + ' vs seats', c.gapEffective < 0 ? 'red' : 'green')),
      all.length ? table([
        { label: 'Name', render: r => el('b', {}, r.name) },
        { label: 'State', render: r => statePill(r.state) },
        { label: 'Detail', key: 'reason' },
        { label: 'Level', render: r => r.level || '—' },
        { label: 'On-roll', num: true, render: r => nf(r.onRoll) },
        { label: 'Effective', num: true, render: r => el('b', { style: { color: r.effective === 0 ? 'var(--cp-danger)' : '' } }, nf(r.effective)) }
      ], all) : UI.emptyBox('No one is assigned to this role at this date.'),
      el('div', { class: 'row', style: { marginTop: '12px' } },
        el('button', { class: 'btn primary', onclick: () => { UI.closeModal(); APP.setDate(c.sample); APP.go('dashboard'); } },
          `Set the whole app to ${E.longDate(c.sample)}`),
        !isTotal ? el('button', {
          class: 'btn', onclick: () => { UI.closeModal(); VIEW_PIPELINE.newRequisition({ targetFamily: row.family, targetRole: row.role }); }
        }, '+ Raise a requisition for this role') : null));

    modal(isTotal ? `All roles · ${c.label}` : `${row.role || 'N/A'} · ${c.label}`, body,
      { sub: `${row ? row.family + ' · ' : ''}Position sampled at ${E.longDate(c.sample)}`, size: 'wide' });
  }

  return { render };
})();

/* ============================================================================
   Risk view — the full radar, bus factor, and span of control.
   ========================================================================== */
const VIEW_RISK = (() => {
  'use strict';
  const { el, nf, sgn, section, table, statePill, APP } = UI;
  const E = ENGINE;

  function render() {
    const s = APP.state;
    const wrap = el('div', {});
    const risks = E.riskRadar(s, APP.scenario, APP.fy);
    const bus = E.busFactor(s, APP.date, APP.scenario);
    const spanList = E.spans(s, APP.date, APP.scenario);

    /* --- gaps ------------------------------------------------------------- */
    const gapBox = el('div', {});
    if (!risks.length) gapBox.appendChild(UI.emptyBox('No role falls below its blueprint seats at any point this year.'));
    risks.forEach(r => {
      const sev = r.severity >= 2 ? 'high' : r.severity >= 1 ? 'medium' : 'low';
      gapBox.appendChild(el('div', { class: `find sev-${sev}` },
        el('h4', {}, r.headline),
        el('p', {}, r.detail.trim()),
        el('div', { class: 'acts' },
          el('button', { class: 'btn sm', onclick: () => APP.setDate(r.worstSample) }, `Jump to ${r.worstMonth}`),
          el('button', { class: 'btn sm', onclick: () => { APP.filters.role = r.role; APP.go('people'); } }, 'Show the people'),
          !r.hasBackfill ? el('button', {
            class: 'btn sm primary',
            onclick: () => VIEW_PIPELINE.newRequisition({ targetFamily: r.family, targetRole: r.role })
          }, '+ Raise requisition') : el('span', { class: 'pill p-pipeline' }, 'Requisition exists'))));
    });
    wrap.appendChild(section('Capacity shortfalls', 'Ranked by depth × duration — the longest, deepest holes first.', gapBox));

    /* --- bus factor ------------------------------------------------------- */
    const busBox = el('div', {});
    if (!bus.length) busBox.appendChild(UI.emptyBox('No single points of failure detected. Add skills to people to sharpen this analysis.'));
    bus.forEach(b => busBox.appendChild(el('div', { class: `find sev-${b.risk === 'high' ? 'high' : 'medium'}` },
      el('h4', {}, `${b.kind === 'role' ? 'Role' : b.kind === 'skill' ? 'Skill' : 'Seniority'}: ${b.label}`),
      el('p', {}, `${b.holder} — ${b.note}.`))));
    wrap.appendChild(section('Single points of failure',
      'Roles, skills and seniority held by exactly one person. Losing two people is bad; losing your only senior is a different problem.',
      busBox));

    /* --- spans ------------------------------------------------------------ */
    wrap.appendChild(section('Span of control',
      `Direct reports per manager at ${E.longDate(APP.date)}. Flags anything outside ${s.settings.spanMin}–${s.settings.spanMax}.`,
      table([
        { label: 'Manager', render: m => el('b', {}, m.manager || '(top of org)') },
        { label: 'Span', num: true, key: 'span' },
        { label: 'On-roll FTE', num: true, render: m => nf(m.onRoll) },
        { label: 'Effective FTE', num: true, render: m => el('b', { style: { color: m.leaveDrag > 0 ? 'var(--cp-danger)' : '' } }, nf(m.effective)) },
        { label: 'Lost to leave', num: true, render: m => m.leaveDrag > 0 ? el('span', { style: { color: 'var(--cp-warning)' } }, `−${nf(m.leaveDrag)}`) : '—' },
        {
          label: 'Flag', render: m => el('span', { class: `pill ${m.flag === 'wide' ? 'p-medium' : m.flag === 'narrow' ? 'p-low' : 'p-active'}` },
            m.flag === 'wide' ? 'Span too wide' : m.flag === 'narrow' ? 'Span narrow' : 'Healthy')
        },
        { label: 'Team', render: m => el('span', { class: 'tiny muted' }, m.reports.map(r => r.name.split(' ')[0]).join(', ')) }
      ], spanList)));

    return wrap;
  }
  return { render };
})();
