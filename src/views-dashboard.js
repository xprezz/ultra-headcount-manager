/* ============================================================================
   CUHM 2.0 — Dashboard: the "what is my situation" answer, gap waterfall,
   risk radar and the 12-month capacity curve.
   ========================================================================== */
const VIEW_DASHBOARD = (() => {
  'use strict';
  const { el, frag, nf, sgn, statePill, table, dualBand, kpi, section, lineChart, legend, toast, modal, APP } = UI;
  const E = ENGINE;

  function render() {
    const s = APP.state;
    const date = APP.date;
    const scope = APP.scope();
    const ev = E.evaluate(s, date, APP.scenario, { filter: scope });
    const t = ev.totals;
    const wrap = el('div', {});
    const scopeNote = APP.scopeActive() ? ` · ${APP.scopeLabel()}` : '';

    /* --- scope selector --------------------------------------------------- */
    wrap.appendChild(UI.scopeBar());

    /* --- headline answer ------------------------------------------------- */
    const where = APP.scopeActive() ? ` for ${APP.scopeLabel()}` : '';
    const headline = t.gapEffective < -0.001
      ? `At ${E.longDate(date)} you are ${nf(Math.abs(t.gapEffective))} FTE short of your ${t.seats} blueprint seats${where}.`
      : t.gapEffective > 0.001
        ? `At ${E.longDate(date)} you are ${nf(t.gapEffective)} FTE above your ${t.seats} blueprint seats${where}.`
        : `At ${E.longDate(date)} you are exactly on blueprint${where}.`;
    const because = [];
    if (t.departed) because.push(`${t.departed} ${t.departed === 1 ? 'person has' : 'people have'} left`);
    if (t.onLeave) because.push(`${t.onLeave} on leave (${nf(t.onLeaveFte)} FTE of seats filled but delivering nothing)`);
    if (t.onGarden) because.push(`${t.onGarden} on garden leave (${nf(t.onGardenFte)} FTE paid but out of the rota)`);
    if (t.onNotice) because.push(`${t.onNotice} serving notice`);
    if (t.ramping) because.push(`${t.ramping} still ramping`);
    if (t.notStarted) because.push(`${t.notStarted} not yet started`);

    wrap.appendChild(section('The answer', headline,
      el('p', { class: 'small', style: { marginTop: '-6px' } },
        because.length ? `Because: ${because.join(', ')}.` : 'No leave, leavers or ramping affect this date.'),
      t.headsSupplementary ? el('p', { class: 'small' },
        `On top of the establishment you have `,
        el('b', {}, `${nf(t.supplementaryEffective)} FTE`),
        ` of supplementary capacity from ${t.headsSupplementary} student worker${t.headsSupplementary === 1 ? '' : 's'} / contractor${t.headsSupplementary === 1 ? '' : 's'}, which consumes no seat and never closes the gap above.`) : null,
      dualBand(t)));

    /* --- KPI strip -------------------------------------------------------- */
    const rb = E.ribbon(s, APP.scenario, APP.fy, scope);
    const cf = E.capacityFlow(s, date, APP.scenario, scope);
    const worst = rb.totalsRow.reduce((a, b) => (b.gapEffective < a.gapEffective ? b : a), rb.totalsRow[0]);
    const bestDrag = rb.totalsRow.reduce((a, b) => (b.leaveDrag > a.leaveDrag ? b : a), rb.totalsRow[0]);
    const spanList = E.spans(s, date, APP.scenario, scope);
    const wide = spanList.filter(m => m.flag === 'wide').length;

    wrap.appendChild(el('div', { class: 'grid g4', style: { marginBottom: '14px' } },
      kpi('Deepest trough this FY', worst.label,
        `${nf(worst.effective)} effective vs ${worst.seats} seats (${sgn(worst.gapEffective)})`,
        worst.gapEffective < -0.001 ? 'red' : 'green'),
      kpi('Worst month for leave', bestDrag.leaveDrag > 0 ? bestDrag.label : '—',
        bestDrag.leaveDrag > 0 ? `${nf(bestDrag.leaveDrag)} FTE unavailable` : 'No leave impact this FY', 'amber'),
      kpi('Leavers in FY' + APP.fy, String(countLeavers(s, scope)),
        countLeavers(s, scope) ? `${nf(leaverFte(s, scope))} FTE departing` : 'None recorded', countLeavers(s, scope) ? 'red' : 'green'),
      kpi('Open requisitions', String(openReqs(s, scope).length),
        `${nf(openReqs(s, scope).reduce((a, r) => a + (+r.fte || 1), 0))} FTE in pipeline`,
        openReqs(s, scope).length ? 'purple' : 'amber'),
      kpi('Capacity down to leave', `${nf(cf.totals.pctLeaveOfSeats)}%`,
        cf.totals.leaveLoss > 0
          ? `capacity down · ${cf.totals.headsOnLeave} of ${cf.totals.headsOnRoll} people (${nf(cf.totals.pctHeadsOnLeave)}%) · ${nf(cf.totals.leaveLoss)} FTE`
          : 'Nobody on leave at this date',
        cf.totals.leaveLoss > 0 ? 'amber' : 'green'),
      kpi('Managers over span', String(wide),
        wide ? spanList.filter(m => m.flag === 'wide').map(m => `${m.manager.split(' ')[0]} (${m.span})`).join(', ') : `All within ${s.settings.spanMax}`,
        wide ? 'amber' : 'green'),
      kpi('Bus-factor risks', String(E.busFactor(s, date, APP.scenario, scope).filter(b => b.risk === 'high').length),
        'Single points of failure at high risk', 'red'),
      kpi('Data quality issues', String(E.dataQuality(s).length),
        `${E.dataQuality(s).filter(i => i.severity === 'high').length} high severity`, 'blue')));

    /* --- where every seat goes -------------------------------------------- */
    wrap.appendChild(flowCard(cf, date));

    /* --- 12 month curve --------------------------------------------------- */
    const chart = lineChart({
      labels: rb.totalsRow.map(r => r.label),
      target: rb.totalsRow[0].seats,
      targetLabel: `Blueprint ${rb.totalsRow[0].seats}`,
      height: 250,
      series: [
        { name: 'On-roll', values: rb.totalsRow.map(r => r.onRoll), color: 'var(--cp-accent)', dash: '5 4' },
        { name: 'Effective', values: rb.totalsRow.map(r => r.effective), color: 'var(--cp-danger)', width: 3 }
      ]
    });
    const curve = section('Capacity across FY' + APP.fy + scopeNote,
      'The gap between the two lines is what leave costs you. The dashed line is what HR sees; the solid line is what you can actually deploy.',
      chart,
      legend([
        { color: 'var(--cp-accent)', label: 'On-roll headcount (leave still fills the seat)' },
        { color: 'var(--cp-danger)', label: 'Effective capacity (leave = zero)' },
        { color: 'var(--cp-text)', label: 'Blueprint seats' }
      ]));
    wrap.appendChild(curve);

    /* --- waterfall + radar ------------------------------------------------ */
    const two = el('div', { class: 'grid g2' });
    two.appendChild(waterfallCard(date, scope));
    two.appendChild(radarCard(scope));
    wrap.appendChild(two);

    /* --- who is affected right now ---------------------------------------- */
    const affected = ev.perPerson.filter(r => r.state !== E.STATES.ACTIVE)
      .sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
    wrap.appendChild(section(`Who is not fully available at ${E.longDate(date)}`,
      affected.length ? `${affected.length} of ${ev.perPerson.length} people are on leave, leaving, departed, ramping or not yet started.`
        : 'Everyone is fully available at this date.',
      affected.length ? table([
        { label: 'Name', render: r => el('b', {}, r.name) },
        { label: 'State', render: r => statePill(r.state) },
        { label: 'Detail', key: 'reason' },
        { label: 'Manager', key: 'manager' },
        { label: 'Role', render: r => `${r.family || '—'} · ${r.role || 'N/A'}` },
        { label: 'On-roll', num: true, render: r => nf(r.onRoll) },
        { label: 'Effective', num: true, render: r => el('b', { style: { color: r.effective === 0 ? 'var(--cp-danger)' : '' } }, nf(r.effective)) }
      ], affected, { onRow: r => VIEW_PEOPLE.openPerson(r.id) }) : UI.emptyBox('Nobody is on leave or leaving at this date.')));

    return wrap;
  }

  const leavers = (s, scope) => s.people
    .filter(p => !scope || scope(p))
    .filter(p => (p.events || []).some(e =>
      e.type === 'exit' && E.valid(e.date) && e.date >= E.fyStart(s.settings.fy) && e.date <= E.fyEnd(s.settings.fy)));
  const countLeavers = (s, scope) => leavers(s, scope).length;
  const leaverFte = (s, scope) => leavers(s, scope).reduce((a, p) => a + (+p.fte || 1), 0);
  const openReqs = (s, scope) => (s.requisitions || [])
    .filter(r => r.hiringStage !== 'Cancelled')
    .filter(r => !scope || scope({
      family: r.targetFamily, blueprintRole: r.targetRole, role: r.targetRole,
      level: r.targetLevel, manager: r.hiringManager || ''
    }));

  /* ---------- capacity flow (Sankey) --------------------------------------- */
  function flowCard(cf, date) {
    const t = cf.totals;

    const chip = (label, value, tone, note) => el('div', { class: `flowstat tone-${tone}` },
      el('div', { class: 'v' }, value),
      el('div', { class: 'l' }, label),
      note ? el('div', { class: 'n' }, note) : null);

    const kindText = t.byKind.length
      ? t.byKind.map(k => `${nf(k.fte)} FTE ${k.kind.toLowerCase()}`).join(', ')
      : 'none';

    const narrative = t.leaveLoss > 0 || t.gardenLoss > 0
      ? `${nf(t.leaveLoss + t.gardenLoss)} FTE of your establishment is filled but delivering nothing — `
      + `that is ${nf(t.pctAwayOfSeats)}% of the ${t.seats} seats you are funded for. `
      + (t.leaveLoss > 0 ? `On leave: ${kindText}. ` : '')
      + (t.gardenLoss > 0 ? `On garden leave ahead of an exit: ${nf(t.gardenLoss)} FTE across ${t.headsOnGarden} ${t.headsOnGarden === 1 ? 'person' : 'people'}, already gone in practice but still on your payroll.` : '')
      : 'Nobody is on leave or garden leave at this date, so every filled seat is producing.';

    return section(`Where every seat goes · ${E.longDate(date)}${APP.scopeActive() ? ' · ' + APP.scopeLabel() : ''}`,
      'Follow the establishment left to right. The three branches add back to your seat count exactly, so nothing is hidden in a rounding.',
      el('div', { class: 'grid g5', style: { marginBottom: '12px' } },
        chip('of seats producing', `${nf(t.pctSeatsProducing)}%`, t.pctSeatsProducing >= 95 ? 'green' : 'amber',
          `${nf(t.effective)} of ${t.seats} FTE`),
        chip('capacity down to leave', `${nf(t.pctLeaveOfSeats)}%`, t.leaveLoss > 0 ? 'leave' : 'green',
          `${nf(t.leaveLoss)} FTE · ${t.headsOnLeave} ${t.headsOnLeave === 1 ? 'person' : 'people'}`),
        chip('of people on leave', `${nf(t.pctHeadsOnLeave)}%`, t.headsOnLeave > 0 ? 'leave' : 'green',
          `${t.headsOnLeave} of ${t.headsOnRoll} on roll`),
        chip('down to garden leave', `${nf(t.pctGardenOfSeats)}%`, t.gardenLoss > 0 ? 'amber' : 'green',
          t.gardenLoss > 0 ? `${nf(t.gardenLoss)} FTE · ${t.headsOnGarden} awaiting exit` : 'Nobody on garden leave'),
        chip('of seats empty', `${nf(t.pctSeatsEmpty)}%`, t.emptySeats > 0 ? 'red' : 'green',
          `${nf(t.emptySeats)} seat${t.emptySeats === 1 ? '' : 's'} · ${nf(t.noReq)} unrecruited`)),
      UI.sankey({ nodes: cf.nodes, links: cf.links, height: 320 }),
      el('p', { class: 'small', style: { marginTop: '10px' } }, narrative),
      el('div', { class: 'row', style: { marginTop: '10px' } },
        el('button', {
          class: 'btn sm', onclick: () => { APP.go('timeline'); }
        }, 'See the leave timeline'),
        t.noReq > 0 ? el('button', {
          class: 'btn sm', onclick: () => { APP.go('blueprint'); }
        }, `Fill the ${nf(t.noReq)} unrecruited seat${t.noReq === 1 ? '' : 's'}`) : null));
  }

  /* ---------- waterfall ---------------------------------------------------- */
  function waterfallCard(date, scope) {
    const wf = E.waterfall(APP.state, date, APP.scenario, scope);
    const maxAbs = Math.max(...wf.steps.map(s => Math.abs(s.value || 0)), 1);
    const box = el('div', { class: 'wf' });

    wf.steps.forEach(step => {
      const v = step.value || 0;
      const w = (Math.abs(v) / maxAbs) * 100;
      const barCls = step.kind === 'neg' ? 'neg' : step.kind === 'pos' ? 'pos'
        : step.kind === 'total' ? 'tot' : step.kind === 'subtotal' ? 'sub' : 'base';
      const row = el('div', { class: `wf-row ${step.kind}` },
        el('div', { class: 'lab' }, step.label),
        el('div', { class: 'wf-bar' }, el('i', { class: barCls, style: { width: `${Math.max(w, 1)}%` } })),
        el('div', { class: 'wf-val', style: { color: step.kind === 'gap' ? (v < 0 ? 'var(--cp-danger)' : 'var(--cp-success)') : '' } },
          step.kind === 'gap' ? sgn(v) : nf(v)));
      box.appendChild(row);
      if (step.detail && step.detail.length) {
        box.appendChild(el('div', { class: 'wf-detail' }, step.detail.join(' · ')));
      }
    });

    return section('Gap waterfall', `How ${E.longDate(date)} gets from blueprint to reality. This is the slide for your leadership review.`, box,
      el('div', { class: 'row', style: { marginTop: '10px' } },
        el('button', { class: 'btn sm', onclick: () => copyNarrative(wf, date) }, '📋 Copy as narrative')));
  }

  function copyNarrative(wf, date) {
    const g = wf.effectiveNow - wf.seatTotal;
    const lines = [
      `Position at ${E.longDate(date)} (scenario: ${APP.scenario})`,
      `Blueprint: ${wf.seatTotal} seats.`,
      `On roll: ${nf(wf.onRollNow)} FTE. Effective capacity: ${nf(wf.effectiveNow)} FTE.`,
      g < 0 ? `Shortfall of ${nf(Math.abs(g))} FTE against blueprint.` : `Surplus of ${nf(g)} FTE against blueprint.`,
      ''
    ];
    wf.steps.filter(s => s.detail && s.detail.length).forEach(s => {
      lines.push(`${s.label} (${nf(s.value)}): ${s.detail.join('; ')}`);
    });
    navigator.clipboard.writeText(lines.join('\n')).then(
      () => toast('Narrative copied to clipboard', 'ok'),
      () => toast('Could not access the clipboard', 'err'));
  }

  /* ---------- risk radar --------------------------------------------------- */
  function radarCard(scope) {
    const risks = E.riskRadar(APP.state, APP.scenario, APP.fy, scope);
    const bus = E.busFactor(APP.state, APP.date, APP.scenario, scope).filter(b => b.risk === 'high');
    const body = el('div', {});

    if (!risks.length && !bus.length) {
      body.appendChild(UI.emptyBox('No capacity shortfalls or single points of failure found this fiscal year.'));
    }

    risks.slice(0, 6).forEach(r => {
      const sev = r.severity >= 2 ? 'high' : r.severity >= 1 ? 'medium' : 'low';
      body.appendChild(el('div', { class: `find sev-${sev}` },
        el('h4', {}, r.headline),
        el('p', {}, r.detail.trim()),
        el('div', { class: 'acts' },
          el('button', { class: 'btn sm', onclick: () => APP.setDate(r.worstSample) }, `Jump to ${r.worstMonth}`),
          !r.hasBackfill ? el('button', {
            class: 'btn sm primary',
            onclick: () => VIEW_PIPELINE.newRequisition({ targetFamily: r.family, targetRole: r.role })
          }, '+ Raise requisition') : null)));
    });

    bus.slice(0, 4).forEach(b => {
      body.appendChild(el('div', { class: 'find sev-high' },
        el('h4', {}, `Single point of failure: ${b.label}`),
        el('p', {}, `${b.holder} — ${b.note}.`)));
    });

    return section('Risk radar', 'Your bad news, found for you and ranked by depth × duration.', body,
      risks.length > 6 ? el('button', { class: 'btn sm', onclick: () => APP.go('risk') }, `See all ${risks.length} findings`) : null);
  }

  return { render, waterfallCard, radarCard };
})();
