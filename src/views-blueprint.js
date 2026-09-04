/* ============================================================================
   CUHM 2.0 — Blueprint & seats.
   Where seats are established per role, and where each role's status is read.
   Seats are effective-dated, so "we lost two seats in January" is a fact in the
   model rather than a note in someone's inbox.
   ========================================================================== */
const VIEW_BLUEPRINT = (() => {
  'use strict';
  const { el, frag, nf, sgn, rolePill, seatBar, statePill, section, table, modal,
    toast, confirmDialog, emptyBox, APP } = UI;
  const E = ENGINE;

  let group = 'status';   // status | family | gap | name
  let hideDormant = true;

  /* ---------- main ---------------------------------------------------------- */
  function render() {
    const s = APP.state;
    const rb = E.ribbon(s, APP.scenario, APP.fy);
    const rs = E.roleStatus(s, APP.date, APP.scenario, rb);
    const t = rs.totals;
    const wrap = el('div', {});

    if (!s.blueprint.length) {
      return section('Blueprint & seats',
        'Nothing is established yet. Seats are what every gap in this app is measured against.',
        emptyBox('No seats have been allocated to any role.', '+ Establish the first role', () => editRole(null)),
        el('div', { class: 'row', style: { justifyContent: 'center' } },
          el('button', { class: 'btn', onclick: pasteSeats }, 'Paste a seat plan from Excel'),
          el('button', { class: 'btn', onclick: seedFromPeople }, 'Build one from who I already have')));
    }

    /* --- KPI band --------------------------------------------------------- */
    wrap.appendChild(el('div', { class: 'grid g5', style: { marginBottom: '14px' } },
      UI.kpi('Seats allocated', String(nf(t.seats)), `${t.roles} roles established`),
      UI.kpi('Filled', nf(t.filled), `${nf(t.vacantSeats)} seats with nobody in them`,
        t.vacantSeats > 0 ? 'amber' : 'green'),
      UI.kpi('Deployable', nf(t.effective), `${sgn(+(t.effective - t.seats).toFixed(1))} vs allocated`,
        t.effective < t.seats ? 'red' : 'green'),
      UI.kpi('Open, nobody recruiting', nf(t.openSeats),
        t.pipeline > 0 ? `${nf(t.pipeline)} FTE already in pipeline` : 'No requisitions raised',
        t.openSeats > 0 ? 'red' : 'green'),
      UI.kpi('Roles needing attention', String(t.atRisk),
        t.unbudgeted ? `${t.unbudgeted} with no seats allocated` : 'Vacant, short or on leave', t.atRisk ? 'amber' : 'green')));

    /* --- status board ----------------------------------------------------- */
    wrap.appendChild(statusBoard(rs));

    /* --- the editable establishment --------------------------------------- */
    const controls = el('div', { class: 'row', style: { marginBottom: '10px' } },
      el('button', { class: 'btn primary', onclick: () => editRole(null) }, '+ Add a role'),
      el('button', { class: 'btn', onclick: pasteSeats }, 'Paste seat plan'),
      el('button', { class: 'btn', onclick: () => exportSeats(rs) }, 'Export CSV'),
      el('button', { class: 'btn', onclick: () => bulkChange(rs) }, 'Bulk seat change'),
      el('label', { class: 'field' }, 'Order by',
        el('select', { onchange: e => { group = e.target.value; APP.render(); } },
          el('option', { value: 'status', selected: group === 'status' }, 'Worst status first'),
          el('option', { value: 'gap', selected: group === 'gap' }, 'Biggest gap first'),
          el('option', { value: 'family', selected: group === 'family' }, 'Job family'),
          el('option', { value: 'name', selected: group === 'name' }, 'Role name'))),
      el('label', { class: 'chk', style: { marginLeft: 'auto' } },
        el('input', {
          type: 'checkbox', checked: hideDormant,
          onchange: e => { hideDormant = e.target.checked; APP.render(); }
        }), ' Hide dormant roles'));

    let rows = rs.rows.slice();
    if (hideDormant) rows = rows.filter(r => r.status !== E.ROLE_STATUS.DORMANT);
    if (APP.filters.family) rows = rows.filter(r => r.family === APP.filters.family);
    if (group === 'family') rows.sort((a, b) => a.family.localeCompare(b.family) || a.key.localeCompare(b.key));
    if (group === 'name') rows.sort((a, b) => String(a.role).localeCompare(String(b.role)));
    if (group === 'gap') rows.sort((a, b) => a.gapEffective - b.gapEffective);

    wrap.appendChild(section(`Establishment · ${E.longDate(APP.date)}`,
      'Type straight into the Seats column. Every other number in the application is measured against it.',
      controls,
      rows.length ? seatTable(rows) : emptyBox('No roles match the current filter.'),
      el('div', { class: 'legend', style: { marginTop: '12px' } },
        swatch('sb-eff', 'Deployable'), swatch('sb-drag', 'Filled but on leave'),
        swatch('sb-pipe', 'Requisition in flight'), swatch('sb-open', 'Open seat, nobody recruiting'))));

    /* --- what changed ----------------------------------------------------- */
    const dated = s.blueprint.filter(b => b.effectiveFrom);
    if (dated.length) {
      wrap.appendChild(section('Dated seat changes',
        'Seat movements booked for a future date. They apply automatically as the Time Machine passes them.',
        table([
          { label: 'Role', render: b => el('b', {}, b.role || 'N/A') },
          { label: 'Family', render: b => el('span', { class: 'tiny muted' }, b.family) },
          { label: 'Seats', num: true, render: b => nf(b.seats) },
          { label: 'From', render: b => E.longDate(b.effectiveFrom) },
          {
            label: 'Status', render: b => el('span',
              { class: `pill ${b.effectiveFrom <= APP.date ? 'p-active' : 'p-future'}` },
              b.effectiveFrom <= APP.date ? 'In force' : 'Pending')
          },
          { label: 'Note', render: b => el('span', { class: 'tiny muted' }, b.note || '—') },
          {
            label: '', render: b => el('button', {
              class: 'btn sm', onclick: () => { APP.setDate(b.effectiveFrom); }
            }, 'Jump to it')
          }
        ], dated.slice().sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)))));
    }

    return wrap;
  }

  const swatch = (cls, label) => el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } },
    el('i', { class: cls, style: { display: 'inline-block', width: '15px', height: '10px', borderRadius: '2px', position: 'static' } }), label);

  /* ---------- status board -------------------------------------------------- */
  function statusBoard(rs) {
    const order = [E.ROLE_STATUS.VACANT, E.ROLE_STATUS.CRITICAL, E.ROLE_STATUS.SHORT,
    E.ROLE_STATUS.LEAVE_HIT, E.ROLE_STATUS.UNBUDGETED, E.ROLE_STATUS.WATCH,
    E.ROLE_STATUS.OVER, E.ROLE_STATUS.FULL, E.ROLE_STATUS.DORMANT];
    const box = el('div', { class: 'statusboard' });
    order.forEach(st => {
      const hits = rs.rows.filter(r => r.status === st);
      if (!hits.length) return;
      box.appendChild(el('button', {
        class: `sb-card tone-${st.tone}`,
        onclick: () => { APP.filters.family = ''; group = 'status'; hideDormant = false; APP.render(); openStatus(st, hits); }
      },
        el('div', { class: 'n' }, String(hits.length)),
        el('div', { class: 'l' }, st.label),
        el('div', { class: 'd' }, hits.slice(0, 3).map(r => r.role || 'N/A').join(', ') + (hits.length > 3 ? ` +${hits.length - 3}` : ''))));
    });
    return section(`Status by role · ${E.longDate(APP.date)}`,
      'A role can be fully seated and still deliver nothing. Those two facts are separated here on purpose.',
      box);
  }

  function openStatus(st, hits) {
    modal(st.label, el('div', {},
      el('p', { class: 'sub' }, explain(st)),
      table([
        { label: 'Role', render: r => el('b', {}, r.role || 'N/A') },
        { label: 'Family', render: r => el('span', { class: 'tiny muted' }, r.family) },
        { label: 'Seats', num: true, render: r => nf(r.seats) },
        { label: 'Filled', num: true, render: r => nf(r.filled) },
        { label: 'Deployable', num: true, render: r => el('b', { style: { color: r.effective < r.seats ? 'var(--cp-danger)' : '' } }, nf(r.effective)) },
        { label: 'Open', num: true, render: r => r.openSeats > 0 ? nf(r.openSeats) : '—' },
        { label: 'Why', render: r => el('span', { class: 'tiny muted' }, why(r)) }
      ], hits, { onRow: r => { UI.closeModal(); openRole(r.key); } })),
      { sub: `${hits.length} role${hits.length === 1 ? '' : 's'} at ${E.longDate(APP.date)}`, size: 'wide' });
  }

  const explain = st => ({
    vacant: 'Seats are allocated but nobody at all is in them. These are the purest recruitment gaps.',
    critical: 'Less than 70% of the allocated seats are producing. Treat these as escalations.',
    short: 'Between 70% and 90% covered — visible pressure, not yet a crisis.',
    leavehit: 'The seats are occupied, so an establishment report says you are staffed. You are not: the people in them are on leave, on notice or still ramping.',
    unbudgeted: 'People are doing this work but no seats have been allocated to it. Either establish the role or move them.',
    watch: 'Within 10% of full strength. Worth watching, not worth acting on yet.',
    over: 'More people than allocated seats. Legitimate during a handover, a problem if it persists.',
    full: 'Allocated seats are filled and producing.',
    dormant: 'No seats and nobody — the role is defined but not in use.'
  })[st.id] || '';

  function why(r) {
    const bits = [];
    if (r.onLeave.length) bits.push(`${r.onLeave.length} on leave`);
    if (r.onNotice.length) bits.push(`${r.onNotice.length} on notice`);
    if (r.ramping.length) bits.push(`${r.ramping.length} ramping`);
    if (r.vacantSeats > 0) bits.push(`${nf(r.vacantSeats)} seat${r.vacantSeats === 1 ? '' : 's'} empty`);
    if (r.pipeline > 0) bits.push(`${nf(r.pipeline)} in pipeline`);
    if (r.overfill > 0) bits.push(`${nf(r.overfill)} over establishment`);
    return bits.join(' · ') || 'At full strength';
  }

  /* ---------- the editable table -------------------------------------------- */
  function seatTable(rows) {
    const thead = el('thead', {}, el('tr', {},
      el('th', {}, 'Blueprint role'),
      el('th', { class: 'num', style: { width: '80px' } }, 'Seats'),
      el('th', { style: { width: '150px' } }, 'Coverage'),
      el('th', { class: 'num' }, 'Filled'),
      el('th', { class: 'num' }, 'Deployable'),
      el('th', { class: 'num' }, 'Open'),
      el('th', {}, 'Status'),
      el('th', {}, 'Why'),
      el('th', { style: { width: '150px' } }, '')));

    const tbody = el('tbody', {});
    rows.forEach(r => {
      const input = el('input', {
        type: 'number', min: '0', step: '1', value: String(r.seats),
        title: 'Seats allocated to this role',
        onchange: e => commitSeats(r, e.target.value, e.target),
        onkeydown: e => { if (e.key === 'Enter') e.target.blur(); }
      });
      tbody.appendChild(el('tr', {},
        el('td', {},
          el('b', {}, r.role || 'N/A'),
          el('div', { class: 'tiny muted' }, r.family),
          r.effectiveFrom ? el('div', { class: 'tiny', style: { color: 'var(--cp-accent)' } }, `seats effective ${E.longDate(r.effectiveFrom)}`) : null),
        el('td', { class: 'ed num' }, input),
        el('td', {}, seatBar(r)),
        el('td', { class: 'num mono' }, nf(r.filled)),
        el('td', { class: 'num mono' }, el('b', { style: { color: r.effective + 1e-6 < r.seats ? 'var(--cp-danger)' : '' } }, nf(r.effective))),
        el('td', { class: 'num mono' }, r.openSeats > 0 ? el('b', { style: { color: 'var(--cp-danger)' } }, nf(r.openSeats)) : '—'),
        el('td', {}, rolePill(r.status)),
        el('td', {}, el('span', { class: 'tiny muted' }, why(r))),
        el('td', {},
          el('div', { class: 'row', style: { gap: '4px', flexWrap: 'nowrap' } },
            el('button', { class: 'btn sm', onclick: () => openRole(r.key) }, 'Open'),
            r.openSeats > 0 ? el('button', {
              class: 'btn sm primary',
              onclick: () => VIEW_PIPELINE.newRequisition({ targetFamily: r.family, targetRole: r.role })
            }, '+ Req') : null))));
    });

    const t = rows.reduce((a, r) => ({
      seats: a.seats + r.seats, filled: a.filled + r.filled,
      effective: a.effective + r.effective, open: a.open + r.openSeats
    }), { seats: 0, filled: 0, effective: 0, open: 0 });
    tbody.appendChild(el('tr', { class: 'totals' },
      el('td', {}, el('b', {}, `TOTAL · ${rows.length} roles`)),
      el('td', { class: 'num mono' }, el('b', {}, nf(t.seats))),
      el('td', {}), el('td', { class: 'num mono' }, nf(t.filled)),
      el('td', { class: 'num mono' }, el('b', { style: { color: t.effective < t.seats ? 'var(--cp-danger)' : '' } }, nf(t.effective))),
      el('td', { class: 'num mono' }, t.open > 0 ? nf(t.open) : '—'),
      el('td', { colspan: '3' }, el('span', { class: 'tiny muted' },
        `${sgn(+(t.effective - t.seats).toFixed(1))} FTE against allocated seats`))));

    return el('div', { class: 'tbl-wrap' }, el('table', { class: 'grid-tbl seats-tbl' }, thead, tbody));
  }

  function commitSeats(r, raw, input) {
    const n = Math.max(0, Math.round(+raw || 0));
    if (n === r.seats) return;
    const older = r.seats;
    APP.mutate(`${r.role || 'N/A'}: ${older} → ${n} seats`, st => {
      E.setSeats(st, r.family, r.role, n, r.effectiveFrom || '');
    });
    input.classList.remove('bad');
    toast(`${r.role || 'N/A'} now has ${n} seat${n === 1 ? '' : 's'}`, 'ok');
  }

  /* ---------- role drawer ---------------------------------------------------- */
  function openRole(key) {
    const rb = E.ribbon(APP.state, APP.scenario, APP.fy);
    const rs = E.roleStatus(APP.state, APP.date, APP.scenario, rb);
    const r = rs.rows.find(x => x.key === key);
    if (!r) return toast('That role is no longer in the model', 'err');
    const hist = E.seatHistory(APP.state, key);

    const body = el('div', {},
      el('div', { class: 'grid g4', style: { marginBottom: '14px' } },
        UI.kpi('Seats', nf(r.seats), r.effectiveFrom ? `effective ${E.longDate(r.effectiveFrom)}` : 'no dated change'),
        UI.kpi('Filled', nf(r.filled), `${r.heads} ${r.heads === 1 ? 'person' : 'people'} in seat`, r.vacantSeats > 0 ? 'amber' : 'green'),
        UI.kpi('Lost to leave', r.leaveDrag > 0 ? `−${nf(r.leaveDrag)}` : '0', 'seat filled, no output', r.leaveDrag > 0 ? 'amber' : undefined),
        UI.kpi('Deployable', nf(r.effective), sgn(r.gapEffective) + ' vs seats', r.gapEffective < 0 ? 'red' : 'green')),

      el('div', { class: 'find sev-' + (r.status.rank <= 1 ? 'high' : r.status.rank <= 3 ? 'medium' : 'info'), style: { marginBottom: '14px' } },
        el('h4', {}, frag(rolePill(r.status), ' ', why(r))),
        el('p', {}, narrative(r))),

      /* seats over the year */
      r.trend ? el('div', { style: { marginBottom: '14px' } },
        UI.lineChart({
          height: 160,
          min: 0,
          labels: rb.cols.map(c => c.label),
          series: [
            { name: 'Deployable', values: r.trend, color: 'var(--cp-danger)' },
            { name: 'Seats', values: r.trendSeats, color: 'var(--cp-text)', dash: '6 4' }
          ]
        }),
        UI.legend([{ label: 'Deployable capacity', color: 'var(--cp-danger)' }, { label: 'Seats allocated', color: 'var(--cp-text)' }])) : null,

      /* who is in it */
      section('Who is in this role',
        `At ${E.longDate(APP.date)}.`,
        r.members.length ? table([
          { label: 'Name', render: m => el('b', {}, m.name) },
          { label: 'State', render: m => statePill(m.state) },
          { label: 'Detail', key: 'reason' },
          { label: 'Level', render: m => m.level || '—' },
          { label: 'On-roll', num: true, render: m => nf(m.onRoll) },
          { label: 'Deployable', num: true, render: m => el('b', { style: { color: m.effective === 0 ? 'var(--cp-danger)' : '' } }, nf(m.effective)) }
        ], r.members) : emptyBox('Nobody is in this role at this date.')),

      r.requisitions.length ? section('Requisitions against this role', null, table([
        { label: 'Requisition', render: q => el('b', {}, q.pcnId || q.title || 'Untitled') },
        { label: 'Stage', render: q => el('span', { class: 'pill p-pipeline' }, q.hiringStage || '—') },
        { label: 'Expected start', render: q => q.expectedStartDate ? E.longDate(q.expectedStartDate) : 'no date' },
        { label: 'FTE', num: true, render: q => nf(q.fte ?? 1) }
      ], r.requisitions)) : null,

      /* seat history */
      section('Seat history', 'Every change to this role\'s establishment.',
        hist.length ? table([
          { label: 'Seats', num: true, render: b => el('b', {}, nf(b.seats)) },
          { label: 'Effective from', render: b => b.effectiveFrom ? E.longDate(b.effectiveFrom) : 'start of plan' },
          { label: 'Note', render: b => b.note || '—' },
          {
            label: '', render: b => el('button', {
              class: 'btn sm', onclick: () => {
                confirmDialog('Remove this seat row?',
                  `${b.seats} seats${b.effectiveFrom ? ' from ' + E.longDate(b.effectiveFrom) : ''} will be deleted. The role falls back to the previous row, or disappears if this is the only one.`,
                  () => {
                    APP.mutate(`Removed a seat row from ${r.role || 'N/A'}`, st => E.removeSeatRow(st, b.id));
                    UI.closeModal(); toast('Seat row removed', 'ok');
                  });
              }
            }, 'Remove')
          }
        ], hist) : emptyBox('No seats have ever been allocated to this role.')),

      el('div', { class: 'row', style: { marginTop: '14px' } },
        el('button', { class: 'btn primary', onclick: () => { UI.closeModal(); editRole(r); } }, 'Edit role & seats'),
        el('button', { class: 'btn', onclick: () => { UI.closeModal(); scheduleChange(r); } }, 'Schedule a dated seat change'),
        r.openSeats > 0 ? el('button', {
          class: 'btn', onclick: () => { UI.closeModal(); VIEW_PIPELINE.newRequisition({ targetFamily: r.family, targetRole: r.role }); }
        }, `+ Requisition for ${nf(r.openSeats)} open seat${r.openSeats === 1 ? '' : 's'}`) : null,
        el('button', {
          class: 'btn', onclick: () => { UI.closeModal(); APP.filters.role = r.role; APP.filters.family = r.family; APP.go('people'); }
        }, 'Show these people in the roster')));

    modal(r.role || 'N/A', body, { sub: r.family, size: 'wide' });
  }

  function narrative(r) {
    if (r.status === E.ROLE_STATUS.DORMANT) return 'No seats and no people. Delete it or allocate seats to bring it into play.';
    if (r.status === E.ROLE_STATUS.UNBUDGETED) {
      return `${r.heads} ${r.heads === 1 ? 'person is' : 'people are'} doing this work carrying ${nf(r.filled)} FTE, but the role has no allocated seats, so none of it appears in your establishment.`;
    }
    const parts = [];
    parts.push(`${nf(r.filled)} of ${nf(r.seats)} seats are filled`);
    if (r.leaveDrag > 0) parts.push(`but ${nf(r.leaveDrag)} FTE of that is on leave, so only ${nf(r.effective)} is actually deployable`);
    else if (r.effective < r.filled) parts.push(`though ramp-up costs you ${nf(+(r.filled - r.effective).toFixed(2))} FTE`);
    if (r.openSeats > 0) parts.push(`${nf(r.openSeats)} seat${r.openSeats === 1 ? ' has' : 's have'} no requisition raised`);
    else if (r.pipeline > 0) parts.push(`${nf(r.pipeline)} FTE is already in the pipeline`);
    let out = parts.join('; ') + '.';
    if (r.monthsShort) {
      out += ` This role is below its seats in ${r.monthsShort} of 12 months`;
      out += r.firstBreach ? `, first in ${r.firstBreach}.` : '.';
    }
    return out;
  }

  /* ---------- add / edit a role --------------------------------------------- */
  function editRole(r) {
    const s = APP.state;
    const families = [...new Set(s.people.map(p => p.family).concat(s.blueprint.map(b => b.family)).filter(Boolean))].sort();
    const famIn = el('input', { list: 'bp-fams', value: r ? r.family : '', placeholder: 'e.g. Cloud Solution Architecture IC' });
    const roleIn = el('input', { value: r ? r.role : '', placeholder: 'e.g. Cloud & AI Data' });
    const seatIn = el('input', { type: 'number', min: '0', step: '1', value: r ? String(r.seats) : '1' });
    const ownerIn = el('input', { value: r ? r.owner : '', placeholder: 'Who owns this role' });
    const noteIn = el('input', { value: r ? r.note : '', placeholder: 'Why these seats exist' });

    const body = el('div', {},
      el('datalist', { id: 'bp-fams' }, families.map(f => el('option', { value: f }))),
      el('div', { class: 'grid g2' },
        field('Job family', famIn),
        field('Blueprint role', roleIn)),
      el('div', { class: 'grid g3', style: { marginTop: '10px' } },
        field('Seats', seatIn),
        field('Owner', ownerIn),
        field('Note', noteIn)),
      r ? el('p', { class: 'sub', style: { marginTop: '12px' } },
        'Renaming the family or role moves every person and requisition on it too, so nothing is orphaned.') : null,
      el('div', { class: 'row', style: { marginTop: '16px' } },
        el('button', {
          class: 'btn primary', onclick: () => {
            const fam = famIn.value.trim(), role = roleIn.value.trim();
            const seats = Math.max(0, Math.round(+seatIn.value || 0));
            if (!fam) return toast('A job family is required — without one the role can never match a person', 'err');
            const key = E.roleKey(fam, role);
            if (!r && s.blueprint.some(b => E.roleKey(b.family, b.role) === key)) {
              return toast('That role already exists', 'err');
            }
            APP.mutate(r ? `Edited ${role || 'N/A'}` : `Established ${role || 'N/A'} with ${seats} seats`, st => {
              if (r && (r.family !== fam || r.role !== role)) E.renameRole(st, r.family, r.role, fam, role);
              const row = E.setSeats(st, fam, role, seats, r ? r.effectiveFrom || '' : '');
              row.owner = ownerIn.value.trim();
              row.note = noteIn.value.trim();
            });
            UI.closeModal();
            toast(r ? 'Role updated' : `${role || 'N/A'} established with ${seats} seats`, 'ok');
          }
        }, r ? 'Save' : 'Establish role'),
        r ? el('button', {
          class: 'btn danger', onclick: () => {
            confirmDialog('Retire this role?',
              `Every seat row for ${r.role || 'N/A'} will be deleted. People stay in the model but will show as having no seats allocated.`,
              () => {
                APP.mutate(`Retired ${r.role || 'N/A'}`, st => {
                  st.blueprint = st.blueprint.filter(b => E.roleKey(b.family, b.role) !== r.key);
                });
                UI.closeModal(); toast('Role retired', 'ok');
              });
          }
        }, 'Retire role') : null,
        el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel')));

    modal(r ? 'Edit role' : 'Add a role', body, { size: 'wide' });
  }

  const field = (label, input) => el('label', { class: 'field col' }, el('span', {}, label), input);

  /* ---------- dated change --------------------------------------------------- */
  function scheduleChange(r) {
    const seatIn = el('input', { type: 'number', min: '0', step: '1', value: String(r.seats) });
    const dateIn = el('input', { type: 'date', value: APP.date });
    const noteIn = el('input', { placeholder: 'e.g. approved in the Q3 review' });
    const preview = el('div', { class: 'sub', style: { marginTop: '10px' } });

    const update = () => {
      const n = Math.max(0, Math.round(+seatIn.value || 0));
      const d = dateIn.value;
      const delta = n - r.seats;
      preview.textContent = !d ? 'Pick a date.'
        : `From ${E.longDate(d)}, ${r.role || 'N/A'} moves from ${r.seats} to ${n} seats (${sgn(delta)}). Before that date it keeps ${r.seats}.`;
    };
    seatIn.addEventListener('input', update);
    dateIn.addEventListener('input', update);
    update();

    modal('Schedule a seat change', el('div', {},
      el('p', { class: 'sub' }, 'Seats change on a date, not retrospectively. The ribbon and every gap in the app pick this up automatically as the Time Machine passes it.'),
      el('div', { class: 'grid g3' }, field('New seat count', seatIn), field('Effective from', dateIn), field('Note', noteIn)),
      preview,
      el('div', { class: 'row', style: { marginTop: '16px' } },
        el('button', {
          class: 'btn primary', onclick: () => {
            const n = Math.max(0, Math.round(+seatIn.value || 0));
            if (!E.valid(dateIn.value)) return toast('Pick a valid date', 'err');
            APP.mutate(`${r.role || 'N/A'}: ${r.seats} → ${n} seats from ${dateIn.value}`, st => {
              const row = E.setSeats(st, r.family, r.role, n, dateIn.value);
              row.note = noteIn.value.trim();
            });
            UI.closeModal();
            toast(`Booked: ${n} seats from ${E.longDate(dateIn.value)}`, 'ok');
          }
        }, 'Book the change'),
        el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'))),
      { sub: `${r.family} · currently ${r.seats} seats`, size: 'wide' });
  }

  /* ---------- bulk change ---------------------------------------------------- */
  function bulkChange(rs) {
    const pctIn = el('input', { type: 'number', value: '-10', step: '5' });
    const dateIn = el('input', { type: 'date', value: APP.date });
    const famIn = el('select', {}, el('option', { value: '' }, 'Every role'),
      [...new Set(rs.rows.map(r => r.family))].sort().map(f => el('option', { value: f }, f)));
    const preview = el('div', { style: { marginTop: '12px' } });

    const targets = () => rs.rows.filter(r => r.seats > 0 && (!famIn.value || r.family === famIn.value));
    const proposed = () => targets().map(r => ({
      r, next: Math.max(0, Math.round(r.seats * (1 + (+pctIn.value || 0) / 100)))
    })).filter(x => x.next !== x.r.seats);

    const update = () => {
      const p = proposed();
      preview.replaceChildren(p.length ? table([
        { label: 'Role', render: x => el('b', {}, x.r.role || 'N/A') },
        { label: 'Family', render: x => el('span', { class: 'tiny muted' }, x.r.family) },
        { label: 'Now', num: true, render: x => x.r.seats },
        { label: 'Becomes', num: true, render: x => el('b', {}, x.next) },
        { label: 'Change', num: true, render: x => el('span', { style: { color: x.next < x.r.seats ? 'var(--cp-danger)' : 'var(--cp-success)' } }, sgn(x.next - x.r.seats)) },
        { label: 'People in seat', num: true, render: x => nf(x.r.filled) },
        {
          label: 'Consequence', render: x => x.next < x.r.filled
            ? el('span', { class: 'pill p-high' }, `${nf(+(x.r.filled - x.next).toFixed(1))} over establishment`)
            : el('span', { class: 'tiny muted' }, '—')
        }
      ], p) : emptyBox('No role changes at this percentage.'));
    };
    pctIn.addEventListener('input', update);
    famIn.addEventListener('change', update);
    update();

    modal('Bulk seat change', el('div', {},
      el('p', { class: 'sub' }, 'Model a top-down establishment cut or expansion. Nothing is applied until you confirm, and it lands as one undoable step.'),
      el('div', { class: 'grid g3' }, field('Change by %', pctIn), field('Apply to', famIn), field('Effective from', dateIn)),
      preview,
      el('div', { class: 'row', style: { marginTop: '16px' } },
        el('button', {
          class: 'btn primary', onclick: () => {
            const p = proposed();
            if (!p.length) return toast('Nothing would change', 'err');
            if (!E.valid(dateIn.value)) return toast('Pick a valid date', 'err');
            APP.mutate(`Bulk seat change ${sgn(+pctIn.value)}% across ${p.length} roles`, st => {
              p.forEach(x => E.setSeats(st, x.r.family, x.r.role, x.next, dateIn.value));
            });
            UI.closeModal();
            toast(`${p.length} roles re-established from ${E.longDate(dateIn.value)}`, 'ok');
          }
        }, 'Apply to all listed roles'),
        el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'))),
      { size: 'wide' });
  }

  /* ---------- import / export ------------------------------------------------ */
  function pasteSeats() {
    const ta = el('textarea', {
      rows: 10, style: { width: '100%', fontFamily: 'Consolas,monospace', fontSize: '12px' },
      placeholder: 'Paste rows from Excel. First row must be headers.\n\nRecognised headers: Family, Blueprint role, Seats, Effective from, Owner, Note'
    });
    const preview = el('div', { class: 'small muted', style: { marginTop: '10px' } });

    const parse = () => {
      const rows = UI.parseDelimited(ta.value);
      if (rows.length < 2) return null;
      const norm = h => String(h).toLowerCase().replace(/[^a-z]/g, '');
      const head = rows[0].map(norm);
      const idx = keys => { for (const k of keys) { const i = head.indexOf(norm(k)); if (i >= 0) return i; } return -1; };
      const map = {
        family: idx(['family', 'jobfamily']), role: idx(['blueprintrole', 'role']),
        seats: idx(['seats', 'seatcount', 'establishment', 'headcount', 'hc', 'fte']),
        from: idx(['effectivefrom', 'from', 'effective']),
        owner: idx(['owner']), note: idx(['note', 'comment'])
      };
      if (map.seats < 0) return null;
      return { rows: rows.slice(1), map };
    };

    ta.addEventListener('input', () => {
      const r = parse();
      preview.textContent = !r ? 'Paste a header row (must include Seats) and at least one data row.'
        : `${r.rows.length} rows detected. Matched: ${Object.entries(r.map).filter(([, v]) => v >= 0).map(([k]) => k).join(', ')}`;
    });

    modal('Paste a seat plan', el('div', {},
      el('p', { class: 'sub' }, 'Copy the establishment straight out of Excel. Existing roles are matched on family + role and their seat count is updated; new roles are created.'),
      ta, preview,
      el('div', { class: 'row', style: { marginTop: '14px' } },
        el('button', {
          class: 'btn primary', onclick: () => {
            const r = parse();
            if (!r) return toast('Nothing to import — a Seats column is required', 'err');
            let added = 0, updated = 0;
            APP.mutate('Paste seat plan', st => {
              const before = new Set(st.blueprint.map(b => E.roleKey(b.family, b.role)));
              r.rows.forEach(row => {
                const g = k => r.map[k] >= 0 ? String(row[r.map[k]] ?? '').trim() : '';
                const fam = g('family'), role = g('role');
                if (!fam && !role) return;
                const seats = Math.max(0, Math.round(parseFloat(String(g('seats')).replace(',', '.')) || 0));
                const from = E.valid(g('from')) ? g('from') : '';
                const rec = E.setSeats(st, fam, role, seats, from);
                if (g('owner')) rec.owner = g('owner');
                if (g('note')) rec.note = g('note');
                before.has(E.roleKey(fam, role)) ? updated++ : added++;
              });
            });
            UI.closeModal();
            toast(`Seat plan imported: ${added} new, ${updated} updated`, 'ok');
          }
        }, 'Import'),
        el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'))),
      { size: 'wide' });
  }

  /** Turns the people you already have into a starting establishment. */
  function seedFromPeople() {
    const counts = new Map();
    APP.state.people.forEach(p => {
      const k = E.roleKey(p.family, p.blueprintRole);
      if (!p.family && !p.blueprintRole) return;
      counts.set(k, (counts.get(k) || 0) + (+p.fte || 1));
    });
    if (!counts.size) return toast('There are no people to derive roles from', 'err');
    confirmDialog('Build the establishment from your people?',
      `${counts.size} roles will be created with seats set to the number of people currently in them. You can adjust every number afterwards.`,
      () => {
        APP.mutate('Seeded blueprint from people', st => {
          counts.forEach((n, k) => {
            const { family, role } = E.splitKey(k);
            E.setSeats(st, family, role === 'N/A' ? '' : role, Math.round(n), '');
          });
        });
        toast(`${counts.size} roles established`, 'ok');
      });
  }

  function exportSeats(rs) {
    STORE.download(`UHM_seats_by_role_${APP.date}.csv`, UI.toCSV(rs.rows, [
      { label: 'Family', value: r => r.family },
      { label: 'Blueprint role', value: r => r.role },
      { label: 'Seats', value: r => r.seats },
      { label: 'Filled', value: r => r.filled },
      { label: 'Lost to leave', value: r => r.leaveDrag },
      { label: 'Deployable', value: r => r.effective },
      { label: 'Vacant seats', value: r => r.vacantSeats },
      { label: 'In pipeline', value: r => r.pipeline },
      { label: 'Open seats', value: r => r.openSeats },
      { label: 'Gap vs seats', value: r => r.gapEffective },
      { label: 'Status', value: r => r.status.label },
      { label: 'Why', value: r => why(r) },
      { label: 'Effective from', value: r => r.effectiveFrom },
      { label: 'Owner', value: r => r.owner },
      { label: 'Note', value: r => r.note }
    ]), 'text/csv');
    toast('Exported', 'ok');
  }

  return { render, openRole, editRole, pasteSeats, seedFromPeople };
})();
