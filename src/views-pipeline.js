/* ============================================================================
   CUHM 2.0 — Pipeline: requisitions, backfill planner with realistic hiring
   lag, ramp curves, and the blueprint seat editor.
   ========================================================================== */
const VIEW_PIPELINE = (() => {
  'use strict';
  const { el, frag, nf, sgn, section, table, modal, toast, confirmDialog, APP } = UI;
  const E = ENGINE;

  function render() {
    const s = APP.state;
    const wrap = el('div', {});
    const reqs = (s.requisitions || []).slice()
      .sort((a, b) => String(a.expectedStartDate || '9999').localeCompare(String(b.expectedStartDate || '9999')));

    /* --- uncovered windows: the real cost of a departure ------------------ */
    const gaps = [];
    s.people.forEach(p => {
      const ex = (p.events || []).find(e => e.type === 'exit' && E.valid(e.date));
      if (!ex) return;
      const backfill = reqs.find(r => r.backfillFor === p.id && r.hiringStage !== 'Cancelled');
      const rampLen = (s.settings.rampProfile || E.DEFAULT_RAMP).length - 1;
      const coveredFrom = backfill && E.valid(backfill.expectedStartDate)
        ? E.addMonths(backfill.expectedStartDate, rampLen) : null;
      gaps.push({
        person: p, exit: ex.date, backfill,
        coveredFrom,
        days: coveredFrom ? E.daysBetween(ex.date, coveredFrom) : null
      });
    });

    if (gaps.length) {
      wrap.appendChild(section('Uncovered windows',
        'The true gap between someone walking out and a fully ramped replacement — almost always far longer than the notice period suggests.',
        table([
          { label: 'Leaver', render: g => el('b', {}, g.person.name) },
          { label: 'Role', render: g => `${g.person.family || '—'} · ${g.person.blueprintRole || 'N/A'}` },
          { label: 'Last day', render: g => E.longDate(g.exit) },
          { label: 'Backfill', render: g => g.backfill ? el('span', { class: 'pill p-pipeline' }, g.backfill.hiringStage) : el('span', { class: 'pill p-high' }, 'None raised') },
          { label: 'Replacement starts', render: g => g.backfill && E.valid(g.backfill.expectedStartDate) ? E.longDate(g.backfill.expectedStartDate) : '—' },
          { label: 'Fully productive', render: g => g.coveredFrom ? E.longDate(g.coveredFrom) : '—' },
          {
            label: 'Uncovered', num: true, render: g => g.days === null
              ? el('b', { style: { color: 'var(--cp-danger)' } }, 'Indefinite')
              : el('b', { style: { color: g.days > 150 ? 'var(--cp-danger)' : g.days > 60 ? 'var(--cp-warning)' : 'var(--cp-success)' } }, `${g.days} days`)
          },
          {
            label: '', render: g => g.backfill
              ? el('button', { class: 'btn sm', onclick: () => editRequisition(g.backfill.id) }, 'Edit')
              : el('button', {
                class: 'btn sm primary', onclick: () => newRequisition({
                  targetFamily: g.person.family, targetRole: g.person.blueprintRole, targetLevel: g.person.level,
                  backfillFor: g.person.id, pcnId: `BACKFILL-${(g.person.name || '').split(' ')[0]}`,
                  expectedStartDate: E.addDays(g.exit, s.settings.timeToHireDays || 90)
                })
              }, '+ Backfill')
          }
        ], gaps)));
    }

    /* --- requisitions ----------------------------------------------------- */
    wrap.appendChild(section(`Requisitions · ${reqs.length}`,
      'Weighted pipeline. Probability defaults from the hiring stage unless you override it.',
      el('div', { class: 'row', style: { marginBottom: '10px' } },
        el('button', { class: 'btn primary', onclick: () => newRequisition() }, '+ New requisition'),
        el('label', { class: 'switch' },
          el('input', {
            type: 'checkbox', checked: s.settings.probabilityWeighting,
            onchange: e => APP.setSetting('probabilityWeighting', e.target.checked)
          }), 'Weight pipeline by probability'),
        el('label', { class: 'switch' },
          el('input', {
            type: 'checkbox', checked: s.settings.includePipeline !== false,
            onchange: e => APP.setSetting('includePipeline', e.target.checked)
          }), 'Include pipeline in capacity'),
        el('label', { class: 'field right' }, 'Assumed time to hire (days)',
          el('input', {
            type: 'number', style: { width: '90px' }, value: s.settings.timeToHireDays || 90,
            onchange: e => APP.setSetting('timeToHireDays', parseInt(e.target.value, 10) || 90)
          }))),
      reqs.length ? table([
        { label: 'PCN', render: r => el('b', {}, r.pcnId || '(untitled)') },
        { label: 'Target role', render: r => `${r.targetFamily || '—'} · ${r.targetRole || '—'}` },
        { label: 'Level', render: r => r.targetLevel || '—' },
        { label: 'Stage', render: r => el('span', { class: `pill ${r.hiringStage === 'Cancelled' ? 'p-departed' : r.hiringStage === 'Offer accepted' ? 'p-active' : 'p-pipeline'}` }, r.hiringStage || 'Not started') },
        {
          label: 'Probability', num: true, render: r => {
            const p = typeof r.probability === 'number' && r.probability !== null ? r.probability : (E.STAGE_PROBABILITY[r.hiringStage] ?? 0);
            return `${p}%`;
          }
        },
        { label: 'Expected start', render: r => E.valid(r.expectedStartDate) ? E.longDate(r.expectedStartDate) : el('span', { class: 'pill p-medium' }, 'No date') },
        { label: 'Backfill for', render: r => { const p = APP.personById(r.backfillFor); return p ? p.name : '—'; } },
        { label: 'FTE', num: true, render: r => nf(r.fte ?? 1) },
        {
          label: 'At selected date', render: r => {
            const res = E.evaluateRequisition(r, APP.date, { applyRamp: s.settings.applyRamp, rampProfile: s.settings.rampProfile, probabilityWeighting: s.settings.probabilityWeighting });
            return res.effective > 0
              ? el('span', { class: 'pill p-active' }, `${nf(res.effective)} FTE`)
              : el('span', { class: 'tiny muted' }, res.reason);
          }
        },
        { label: '', render: r => el('button', { class: 'btn sm', onclick: () => editRequisition(r.id) }, 'Edit') }
      ], reqs) : UI.emptyBox('No requisitions yet. Raise one from a leaver above, or from any gap on the Risk view.',
        '+ New requisition', () => newRequisition())));

    /* --- ramp curve ------------------------------------------------------- */
    wrap.appendChild(rampCard());

    /* --- blueprint -------------------------------------------------------- */
    wrap.appendChild(blueprintCard());

    return wrap;
  }

  /* ---------- ramp editor -------------------------------------------------- */
  function rampCard() {
    const s = APP.state;
    const prof = s.settings.rampProfile || E.DEFAULT_RAMP;
    const bars = el('div', { class: 'row', style: { alignItems: 'flex-end', gap: '12px' } },
      prof.map((v, i) => el('div', { style: { textAlign: 'center' } },
        el('div', {
          style: {
            width: '52px', height: `${Math.max(v * 90, 3)}px`, background: 'var(--cp-accent)',
            borderRadius: '5px 5px 0 0', marginBottom: '5px'
          }
        }),
        el('input', {
          type: 'number', step: '0.1', min: '0', max: '1', style: { width: '58px' }, value: v,
          onchange: e => {
            const next = prof.slice(); next[i] = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0));
            APP.mutate('Edit ramp curve', st => { st.settings.rampProfile = next; });
          }
        }),
        el('div', { class: 'tiny muted' }, i === prof.length - 1 ? `Month ${i}+` : `Month ${i}`))),
      el('div', { style: { alignSelf: 'flex-end' } },
        el('button', {
          class: 'btn sm', onclick: () => APP.mutate('Add ramp month', st => {
            st.settings.rampProfile = (st.settings.rampProfile || E.DEFAULT_RAMP).concat(1);
          })
        }, '+ Month'),
        prof.length > 1 ? el('button', {
          class: 'btn sm', onclick: () => APP.mutate('Remove ramp month', st => {
            st.settings.rampProfile = st.settings.rampProfile.slice(0, -1);
          })
        }, '− Month') : null));

    return section('Hire ramp curve',
      'A new joiner starting on 1 October is not 1.0 FTE on 1 October. Most headcount plans are optimistic by a full quarter because they ignore this.',
      el('label', { class: 'switch', style: { marginBottom: '12px' } },
        el('input', {
          type: 'checkbox', checked: APP.state.settings.applyRamp !== false,
          onchange: e => APP.setSetting('applyRamp', e.target.checked)
        }), 'Apply ramp curve to new hires'),
      bars,
      el('p', { class: 'small muted', style: { marginTop: '10px' } },
        `A hire landing today reaches full productivity on ${E.longDate(E.addMonths(APP.date, prof.length - 1))}.`));
  }

  /* ---------- blueprint editor --------------------------------------------- */
  function blueprintCard() {
    const s = APP.state;
    const ev = APP.ev();
    const rows = (s.blueprint || []).slice().sort((a, b) =>
      String(a.family).localeCompare(String(b.family)) || String(a.role).localeCompare(String(b.role)));

    const upd = (id, k, v) => APP.mutate('Edit blueprint', st => {
      const b = st.blueprint.find(x => x.id === id); if (!b) return false;
      b[k] = k === 'seats' ? (parseFloat(v) || 0) : v;
    });

    const total = rows.reduce((a, b) => a + (+b.seats || 0), 0);

    return section(`Blueprint · ${total} seats`,
      'Your approved shape. Set an effective-from date if a role\'s seat count legitimately changes mid-year.',
      el('div', { class: 'row', style: { marginBottom: '10px' } },
        el('button', {
          class: 'btn primary', onclick: () => APP.mutate('Add blueprint row', st => {
            st.blueprint.push({ id: E.uid('bp'), family: '', role: '', seats: 1, effectiveFrom: '' });
          })
        }, '+ Add role')),
      el('div', { class: 'tbl-wrap' }, el('table', { class: 'grid-tbl' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Family'), el('th', {}, 'Role'), el('th', { class: 'num' }, 'Seats'),
          el('th', {}, 'Effective from'), el('th', { class: 'num' }, 'On-roll now'),
          el('th', { class: 'num' }, 'Effective now'), el('th', { class: 'num' }, 'Gap'), el('th', {}, ''))),
        el('tbody', {}, rows.map(b => {
          const v = ev.perRole.get(E.roleKey(b.family, b.role)) || { onRoll: 0, effective: 0 };
          const gap = +(v.effective - (+b.seats || 0)).toFixed(2);
          return el('tr', {},
            el('td', { class: 'ed' }, el('input', { value: b.family || '', onchange: e => upd(b.id, 'family', e.target.value) })),
            el('td', { class: 'ed' }, el('input', { value: b.role || '', onchange: e => upd(b.id, 'role', e.target.value) })),
            el('td', { class: 'ed num' }, el('input', { type: 'number', step: '1', value: b.seats ?? 0, style: { textAlign: 'right' }, onchange: e => upd(b.id, 'seats', e.target.value) })),
            el('td', { class: 'ed' }, el('input', { type: 'date', value: b.effectiveFrom || '', onchange: e => upd(b.id, 'effectiveFrom', e.target.value) })),
            el('td', { class: 'num mono' }, nf(v.onRoll)),
            el('td', { class: 'num mono' }, nf(v.effective)),
            el('td', { class: 'num mono' }, el('b', { style: { color: gap < 0 ? 'var(--cp-danger)' : gap > 0 ? 'var(--cp-accent-hover)' : 'var(--cp-success)' } }, sgn(gap))),
            el('td', {}, el('button', {
              class: 'btn sm danger', onclick: () => APP.mutate('Delete blueprint row', st => {
                st.blueprint = st.blueprint.filter(x => x.id !== b.id);
              })
            }, '✕')));
        })))));
  }

  /* ---------- requisition editor ------------------------------------------- */
  function newRequisition(seed) {
    const id = E.uid('req');
    APP.mutate('Add requisition', st => {
      st.requisitions = st.requisitions || [];
      st.requisitions.push(Object.assign({
        id, pcnId: '', targetFamily: '', targetRole: '', targetLevel: '',
        hiringStage: 'Not started', expectedStartDate: E.addDays(APP.date, st.settings.timeToHireDays || 90),
        probability: null, backfillFor: '', fte: 1, scenario: APP.scenario, notes: ''
      }, seed || {}));
    });
    editRequisition(id);
  }

  function editRequisition(id) {
    const r = (APP.state.requisitions || []).find(x => x.id === id);
    if (!r) return;
    const set = (k, v) => APP.mutate('Edit requisition', st => {
      const t = st.requisitions.find(x => x.id === id); if (!t) return false; t[k] = v;
    });
    const rerender = () => { UI.closeModal(); editRequisition(id); };

    const defaultProb = E.STAGE_PROBABILITY[r.hiringStage] ?? 0;
    const body = el('div', {},
      el('div', { class: 'grid g3' },
        el('label', { class: 'field' }, 'PCN / requisition ID',
          el('input', { value: r.pcnId || '', onchange: e => set('pcnId', e.target.value) })),
        el('label', { class: 'field' }, 'Job family',
          el('select', { onchange: e => set('targetFamily', e.target.value) },
            el('option', { value: '' }, '—'),
            APP.families().map(f => el('option', { value: f, selected: r.targetFamily === f }, f)))),
        el('label', { class: 'field' }, 'Blueprint role',
          el('select', { onchange: e => set('targetRole', e.target.value) },
            el('option', { value: '' }, '—'),
            APP.roles().map(f => el('option', { value: f, selected: r.targetRole === f }, f)))),
        el('label', { class: 'field' }, 'Target level',
          el('input', { value: r.targetLevel || '', onchange: e => set('targetLevel', e.target.value) })),
        el('label', { class: 'field' }, 'Hiring stage',
          el('select', { onchange: e => { set('hiringStage', e.target.value); rerender(); } },
            E.HIRING_STAGES.map(h => el('option', { value: h, selected: r.hiringStage === h }, h)))),
        el('label', { class: 'field' }, `Probability (stage default ${defaultProb}%)`,
          el('input', {
            type: 'number', min: '0', max: '100',
            placeholder: String(defaultProb),
            value: r.probability ?? '',
            onchange: e => set('probability', e.target.value === '' ? null : parseInt(e.target.value, 10))
          })),
        el('label', { class: 'field' }, 'Expected start date',
          el('input', { type: 'date', value: r.expectedStartDate || '', onchange: e => { set('expectedStartDate', e.target.value); rerender(); } })),
        el('label', { class: 'field' }, 'FTE',
          el('input', { type: 'number', step: '0.1', value: r.fte ?? 1, onchange: e => set('fte', parseFloat(e.target.value) || 1) })),
        el('label', { class: 'field' }, 'Backfill for',
          el('select', { onchange: e => set('backfillFor', e.target.value) },
            el('option', { value: '' }, '— not a backfill —'),
            APP.state.people.map(p => el('option', { value: p.id, selected: r.backfillFor === p.id }, p.name)))),
        el('label', { class: 'field' }, 'Scenario',
          el('select', { onchange: e => set('scenario', e.target.value) },
            APP.state.scenarios.map(sc => el('option', { value: sc.id, selected: r.scenario === sc.id }, sc.name))))),
      el('label', { class: 'field', style: { marginTop: '12px' } }, 'Notes',
        el('textarea', { rows: 2, onchange: e => set('notes', e.target.value) }, r.notes || '')),
      el('div', { class: 'card', style: { marginTop: '14px', background: 'var(--cp-surface-soft)', boxShadow: 'none' } },
        el('h3', {}, 'What this requisition actually delivers'),
        E.valid(r.expectedStartDate) ? el('div', { class: 'small' },
          el('p', {}, `Starts ${E.longDate(r.expectedStartDate)}. With your ramp curve, fully productive from `,
            el('b', {}, E.longDate(E.addMonths(r.expectedStartDate, (APP.state.settings.rampProfile || E.DEFAULT_RAMP).length - 1))), '.'),
          el('div', { class: 'row' }, (APP.state.settings.rampProfile || E.DEFAULT_RAMP).map((v, i) =>
            el('span', { class: 'pill p-blue' }, `${E.monthLabel(E.addMonths(r.expectedStartDate, i))}: ${Math.round(v * 100)}%`))))
          : el('p', { class: 'small muted' }, 'Set an expected start date to see the delivery profile.')),
      el('div', { class: 'row', style: { marginTop: '16px' } },
        el('button', { class: 'btn primary', onclick: UI.closeModal }, 'Done'),
        el('button', {
          class: 'btn danger right', onclick: () => confirmDialog('Delete requisition',
            'Remove this requisition from the model?', () => {
              APP.mutate('Delete requisition', st => { st.requisitions = st.requisitions.filter(x => x.id !== id); });
              UI.closeModal();
            })
        }, 'Delete')));

    modal(r.pcnId || 'Requisition', body, { sub: 'Pipeline position', size: 'wide' });
  }

  return { render, newRequisition, editRequisition };
})();
