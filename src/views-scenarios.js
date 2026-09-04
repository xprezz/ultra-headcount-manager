/* ============================================================================
   CUHM 2.0 — Scenarios: A/B comparison, one-click stress tests and the
   attrition band.
   ========================================================================== */
const VIEW_SCENARIOS = (() => {
  'use strict';
  const { el, frag, nf, sgn, section, table, modal, toast, confirmDialog, lineChart, legend, APP } = UI;
  const E = ENGINE;

  function render() {
    const s = APP.state;
    const wrap = el('div', {});
    const scenarios = s.scenarios || [{ id: 'Baseline', name: 'Baseline' }];
    if (!APP.compareScenario) APP.compareScenario = scenarios.find(x => x.id !== APP.scenario)?.id || '';

    /* --- scenario manager -------------------------------------------------- */
    wrap.appendChild(section('Scenarios',
      'People and requisitions tagged "Baseline" appear in every scenario. Tag a record to a named scenario to make it scenario-specific.',
      el('div', { class: 'row', style: { marginBottom: '10px' } },
        scenarios.map(sc => el('span', {
          class: `pill ${sc.id === APP.scenario ? 'p-blue' : 'p-low'}`,
          style: { cursor: 'pointer', padding: '5px 12px', fontSize: '12.5px' },
          onclick: () => APP.setScenario(sc.id)
        }, sc.name,
          sc.id !== 'Baseline' ? el('b', {
            style: { marginLeft: '7px', cursor: 'pointer' },
            onclick: e => {
              e.stopPropagation();
              confirmDialog('Delete scenario', `Delete "${sc.name}"? Records tagged to it revert to Baseline.`, () => {
                APP.mutate(`Delete scenario ${sc.name}`, st => {
                  st.scenarios = st.scenarios.filter(x => x.id !== sc.id);
                  st.people.forEach(p => { if (p.scenario === sc.id) p.scenario = 'Baseline'; });
                  (st.requisitions || []).forEach(r => { if (r.scenario === sc.id) r.scenario = 'Baseline'; });
                  if (st.settings.selectedScenario === sc.id) st.settings.selectedScenario = 'Baseline';
                });
              });
            }
          }, '✕') : null)),
        el('button', { class: 'btn sm', onclick: addScenario }, '+ New scenario')),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => stressTest('leaver') }, '⚡ What if someone else leaves?'),
        el('button', { class: 'btn', onclick: () => stressTest('leave') }, '⚡ What if someone goes on leave?'),
        el('button', { class: 'btn', onclick: () => stressTest('freeze') }, '⚡ What if hiring is frozen?'))));

    /* --- A/B compare -------------------------------------------------------- */
    wrap.appendChild(compareCard(scenarios));

    /* --- attrition band ----------------------------------------------------- */
    wrap.appendChild(attritionCard());

    return wrap;
  }

  function addScenario() {
    const input = el('input', { type: 'text', placeholder: 'e.g. Downside, Upside, Reorg', style: { width: '100%' } });
    modal('New scenario', el('div', {},
      el('p', { class: 'sub' }, 'A scenario is an overlay. Baseline records always apply; scenario-tagged records only apply in that scenario.'),
      input,
      el('div', { class: 'row', style: { marginTop: '14px' } },
        el('button', {
          class: 'btn primary', onclick: () => {
            const name = input.value.trim();
            if (!name) return toast('Give it a name', 'err');
            APP.mutate(`Add scenario ${name}`, st => {
              if (st.scenarios.some(x => x.id === name)) return false;
              st.scenarios.push({ id: name, name });
              st.settings.selectedScenario = name;
            });
            UI.closeModal();
          }
        }, 'Create'),
        el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'))), { size: 'narrow' });
    setTimeout(() => input.focus(), 30);
  }

  /* ---------- compare ------------------------------------------------------ */
  function compareCard(scenarios) {
    const A = APP.scenario, B = APP.compareScenario;
    if (!B || B === A || scenarios.length < 2) {
      return section('Scenario comparison',
        'Create a second scenario to compare side by side.',
        UI.emptyBox('You currently have one scenario. Use "+ New scenario" above, then tag people or requisitions to it.'));
    }

    const rbA = E.ribbon(APP.state, A, APP.fy);
    const rbB = E.ribbon(APP.state, B, APP.fy);
    const evA = E.evaluate(APP.state, APP.date, A);
    const evB = E.evaluate(APP.state, APP.date, B);

    const chart = lineChart({
      labels: rbA.totalsRow.map(r => r.label),
      target: rbA.totalsRow[0].seats, targetLabel: 'Blueprint',
      height: 240,
      series: [
        { name: A, values: rbA.totalsRow.map(r => r.effective), color: 'var(--cp-accent)', width: 3 },
        { name: B, values: rbB.totalsRow.map(r => r.effective), color: 'var(--cp-accent)', width: 3, dash: '6 4' }
      ]
    });

    const roleKeys = new Set([...rbA.rows.map(r => r.key), ...rbB.rows.map(r => r.key)]);
    const rows = [...roleKeys].map(k => {
      const a = evA.perRole.get(k) || { seats: 0, effective: 0 };
      const b = evB.perRole.get(k) || { seats: 0, effective: 0 };
      return { key: k, seats: a.seats || b.seats, a: a.effective, b: b.effective, delta: +(b.effective - a.effective).toFixed(2) };
    }).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.key.localeCompare(y.key));

    return section('Scenario comparison',
      `Effective capacity in ${A} against ${B} across FY${APP.fy}.`,
      el('div', { class: 'row', style: { marginBottom: '12px' } },
        el('label', { class: 'field' }, 'Scenario A (active)',
          el('select', { onchange: e => APP.setScenario(e.target.value) },
            scenarios.map(sc => el('option', { value: sc.id, selected: sc.id === A }, sc.name)))),
        el('label', { class: 'field' }, 'Scenario B',
          el('select', { onchange: e => { APP.compareScenario = e.target.value; APP.render(); } },
            scenarios.filter(sc => sc.id !== A).map(sc => el('option', { value: sc.id, selected: sc.id === B }, sc.name))))),
      chart,
      legend([{ color: 'var(--cp-accent)', label: A }, { color: 'var(--cp-accent)', label: B }, { color: 'var(--cp-text)', label: 'Blueprint' }]),
      el('h3', { style: { marginTop: '16px' } }, `Delta at ${E.longDate(APP.date)}`),
      table([
        { label: 'Role', key: 'key' },
        { label: 'Seats', num: true, key: 'seats' },
        { label: A, num: true, render: r => nf(r.a) },
        { label: B, num: true, render: r => nf(r.b) },
        {
          label: 'Delta', num: true, render: r => el('b', {
            style: { color: r.delta < 0 ? 'var(--cp-danger)' : r.delta > 0 ? 'var(--cp-success)' : 'var(--cp-text-muted)' }
          }, r.delta === 0 ? '—' : sgn(r.delta))
        }
      ], rows));
  }

  /* ---------- stress tests -------------------------------------------------- */
  function stressTest(kind) {
    const s = APP.state;
    const ev = APP.ev();
    const candidates = ev.perPerson.filter(r => r.state === E.STATES.ACTIVE || r.state === E.STATES.RAMPING);

    if (kind === 'freeze') {
      const withPipe = E.ribbon(s, APP.scenario, APP.fy);
      const saved = s.settings.includePipeline;
      s.settings.includePipeline = false;
      const without = E.ribbon(s, APP.scenario, APP.fy);
      s.settings.includePipeline = saved;
      const body = el('div', {},
        el('p', { class: 'sub' }, 'Effective capacity with your current pipeline against a full hiring freeze.'),
        lineChart({
          labels: withPipe.totalsRow.map(r => r.label), target: withPipe.totalsRow[0].seats, height: 230,
          series: [
            { name: 'With pipeline', values: withPipe.totalsRow.map(r => r.effective), color: 'var(--cp-accent)', width: 3 },
            { name: 'Hiring frozen', values: without.totalsRow.map(r => r.effective), color: 'var(--cp-danger)', width: 3, dash: '6 4' }
          ]
        }),
        legend([{ color: 'var(--cp-accent)', label: 'With pipeline' }, { color: 'var(--cp-danger)', label: 'Hiring frozen' }, { color: 'var(--cp-text)', label: 'Blueprint' }]),
        el('p', { class: 'small', style: { marginTop: '12px' } },
          `At year end a freeze costs you `, el('b', {}, nf(withPipe.totalsRow[11].effective - without.totalsRow[11].effective)), ` FTE.`));
      return modal('Stress test: hiring freeze', body, { size: 'wide' });
    }

    const sel = el('select', { style: { minWidth: '240px' } },
      candidates.sort((a, b) => a.name.localeCompare(b.name)).map(r => el('option', { value: r.id }, `${r.name} — ${r.role || 'N/A'}`)));
    const when = el('input', { type: 'date', value: E.addMonths(APP.date, 1) });
    const until = el('input', { type: 'date', value: E.addMonths(APP.date, 7) });
    const scenarioName = el('input', { type: 'text', value: kind === 'leaver' ? 'What-if leaver' : 'What-if leave' });
    const result = el('div', { style: { marginTop: '14px' } });

    const run = (commit) => {
      const clone = JSON.parse(JSON.stringify(s));
      const target = clone.people.find(p => p.id === sel.value);
      if (!target) return;
      target.events = target.events || [];
      if (kind === 'leaver') target.events.push({ id: E.uid('ev'), type: 'exit', date: when.value, note: 'What-if' });
      else target.events.push({ id: E.uid('ev'), type: 'leave', date: when.value, endDate: until.value, kind: 'Other', note: 'What-if' });

      const before = E.ribbon(s, APP.scenario, APP.fy);
      const after = E.ribbon(clone, APP.scenario, APP.fy);
      const worstAfter = after.totalsRow.reduce((a, b) => b.gapEffective < a.gapEffective ? b : a);
      const worstBefore = before.totalsRow.reduce((a, b) => b.gapEffective < a.gapEffective ? b : a);

      result.innerHTML = '';
      result.appendChild(lineChart({
        labels: before.totalsRow.map(r => r.label), target: before.totalsRow[0].seats, height: 220,
        series: [
          { name: 'Current plan', values: before.totalsRow.map(r => r.effective), color: 'var(--cp-accent)', width: 3 },
          { name: 'With this event', values: after.totalsRow.map(r => r.effective), color: 'var(--cp-danger)', width: 3, dash: '6 4' }
        ]
      }));
      result.appendChild(legend([{ color: 'var(--cp-accent)', label: 'Current plan' }, { color: 'var(--cp-danger)', label: 'With this event' }, { color: 'var(--cp-text)', label: 'Blueprint' }]));
      result.appendChild(el('div', { class: 'find sev-high', style: { marginTop: '12px' } },
        el('h4', {}, `Your deepest month moves from ${worstBefore.label} (${sgn(worstBefore.gapEffective)}) to ${worstAfter.label} (${sgn(worstAfter.gapEffective)})`),
        el('p', {}, `${target.name}'s ${kind === 'leaver' ? 'departure' : 'leave'} removes up to ${nf(Math.max(...before.totalsRow.map((b, i) => b.effective - after.totalsRow[i].effective)))} FTE at its worst point.`)));

      if (commit) {
        const name = scenarioName.value.trim() || 'What-if';
        APP.mutate(`Save stress test as scenario "${name}"`, st => {
          if (!st.scenarios.some(x => x.id === name)) st.scenarios.push({ id: name, name });
          const t = st.people.find(p => p.id === sel.value);
          const copy = JSON.parse(JSON.stringify(t));
          copy.id = E.uid('person'); copy.scenario = name;
          copy.events = (copy.events || []).concat(kind === 'leaver'
            ? [{ id: E.uid('ev'), type: 'exit', date: when.value, note: 'What-if' }]
            : [{ id: E.uid('ev'), type: 'leave', date: when.value, endDate: until.value, kind: 'Other', note: 'What-if' }]);
          // Baseline copy must not double-count in the scenario.
          t.scenario = 'Baseline';
          st.people.push(copy);
        });
        UI.closeModal();
        toast(`Saved as scenario "${scenarioName.value.trim() || 'What-if'}"`, 'ok');
      }
    };

    const body = el('div', {},
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Person', sel),
        el('label', { class: 'field' }, kind === 'leaver' ? 'Last day' : 'Leave starts', when),
        kind === 'leave' ? el('label', { class: 'field' }, 'Returns', until) : null,
        el('button', { class: 'btn primary', style: { alignSelf: 'flex-end' }, onclick: () => run(false) }, 'Run test')),
      result,
      el('div', { class: 'row', style: { marginTop: '14px' } },
        el('label', { class: 'field' }, 'Save as scenario named', scenarioName),
        el('button', { class: 'btn', style: { alignSelf: 'flex-end' }, onclick: () => run(true) }, 'Save as scenario'),
        el('button', { class: 'btn right', style: { alignSelf: 'flex-end' }, onclick: UI.closeModal }, 'Close')));

    modal(kind === 'leaver' ? 'Stress test: another leaver' : 'Stress test: another leave', body, { size: 'wide' });
    run(false);
  }

  /* ---------- attrition ----------------------------------------------------- */
  function attritionCard() {
    const s = APP.state;
    const rate = s.settings.attritionRate ?? 8;
    const band = E.attritionBand(s, APP.scenario, APP.fy, rate);

    return section('Unplanned attrition stress test',
      'Your plan currently assumes nobody resigns unexpectedly all year, which has never once been true. This applies an annualised rate on top of your known leavers.',
      el('div', { class: 'row', style: { marginBottom: '12px' } },
        el('label', { class: 'field' }, `Assumed annual attrition: ${rate}%`,
          el('input', {
            type: 'range', min: '0', max: '25', step: '1', value: rate, style: { width: '260px' },
            dataset: { focusKey: 'attrition-rate' },
            oninput: e => APP.setSetting('attritionRate', parseInt(e.target.value, 10))
          }))),
      lineChart({
        labels: band.map(b => b.label), target: band[0].seats, targetLabel: 'Blueprint', height: 240,
        band: { hi: band.map(b => b.plan), lo: band.map(b => b.p80), color: 'var(--cp-danger-soft)' },
        series: [
          { name: 'Plan', values: band.map(b => b.plan), color: 'var(--cp-accent)', width: 3 },
          { name: 'P50', values: band.map(b => b.p50), color: 'var(--cp-warning)', width: 2 },
          { name: 'P80', values: band.map(b => b.p80), color: 'var(--cp-danger)', width: 2, dash: '5 4' }
        ]
      }),
      legend([
        { color: 'var(--cp-accent)', label: 'Plan (known leavers only)' },
        { color: 'var(--cp-warning)', label: 'P50 — expected attrition' },
        { color: 'var(--cp-danger)', label: 'P80 — bad year' },
        { color: 'var(--cp-text)', label: 'Blueprint' }
      ]),
      el('p', { class: 'small', style: { marginTop: '12px' } },
        `At ${rate}% attrition you should plan for `, el('b', {}, nf(band[11].plan - band[11].p50)),
        ` FTE of unplanned loss by year end, and up to `, el('b', { style: { color: 'var(--cp-danger)' } }, nf(band[11].plan - band[11].p80)),
        ` in a bad year — on top of the ${(s.people.filter(p => (p.events || []).some(e => e.type === 'exit')).length)} departures you already know about.`));
  }

  return { render };
})();
