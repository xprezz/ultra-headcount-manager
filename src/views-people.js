/* ============================================================================
   CUHM 2.0 — People: the editable roster grid and the person drawer with the
   event timeline editor.
   ========================================================================== */
const VIEW_PEOPLE = (() => {
  'use strict';
  const { el, frag, nf, sgn, section, statePill, table, modal, toast, confirmDialog, APP } = UI;
  const E = ENGINE;

  let sortKey = 'name', sortDir = 1;
  const selected = new Set();

  /* ---------- roster ------------------------------------------------------- */
  function supplementaryNote(s, ev) {
    const n = ev.totals.headsSupplementary;
    const base = 'Edit any cell directly. Everything autosaves. Ctrl+Z undoes.';
    if (!n) return base + ' Set Engagement to Student worker or Contractor for anyone who works for you without consuming a blueprint seat.';
    return `${base} ${n} of these (${ev.totals.supplementaryEffective} FTE) are student workers or contractors — they deliver capacity but consume no blueprint seat, so they never close a gap.`;
  }
  function render() {
    const s = APP.state;
    const ev = APP.ev();
    const wrap = el('div', {});

    const people = s.people.filter(p => APP.matches(p));
    const rows = people.map(p => {
      const r = ev.byId.get(p.id) || {};
      return { p, r };
    });
    rows.sort((a, b) => {
      const get = x => {
        switch (sortKey) {
          case 'state': return x.r.state || '';
          case 'effective': return x.r.effective ?? 0;
          case 'onRoll': return x.r.onRoll ?? 0;
          default: return String(x.p[sortKey] ?? '').toLowerCase();
        }
      };
      const A = get(a), B = get(b);
      return (A < B ? -1 : A > B ? 1 : 0) * sortDir;
    });

    const th = (label, key, num) => el('th', {
      class: num ? 'num' : '', style: { cursor: 'pointer' },
      onclick: () => { if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = 1; } APP.render(); }
    }, label, sortKey === key ? (sortDir > 0 ? ' ▲' : ' ▼') : '');

    const families = APP.families(), roles = APP.roles(), names = APP.peopleNames(), levels = APP.levels();

    const editCell = (p, field, opts) => {
      const commit = v => {
        APP.mutate(`Edit ${p.name || 'person'} · ${field}`, st => {
          const t = st.people.find(x => x.id === p.id);
          if (!t) return false;
          t[field] = opts && opts.number ? (parseFloat(v) || 0) : v;
        }, { silent: true });
        APP.renderStatusOnly && APP.renderStatusOnly();
      };
      if (opts && opts.options) {
        const sel = el('select', { onchange: e => { commit(e.target.value); APP.render(); } },
          el('option', { value: '' }, '—'),
          opts.options.map(o => el('option', { value: o, selected: (p[field] || '') === o }, o)));
        if (opts.allowFree && p[field] && !opts.options.includes(p[field])) {
          sel.appendChild(el('option', { value: p[field], selected: true }, p[field]));
        }
        return el('td', { class: 'ed' }, sel);
      }
      return el('td', { class: 'ed' }, el('input', {
        type: opts && opts.number ? 'number' : 'text',
        step: opts && opts.number ? '0.1' : null,
        value: p[field] ?? '',
        onchange: e => commit(e.target.value)
      }));
    };

    const tbl = el('table', { class: 'grid-tbl' },
      el('thead', {}, el('tr', {},
        el('th', { style: { width: '28px' } },
          el('input', {
            type: 'checkbox', checked: selected.size > 0 && selected.size === rows.length,
            onchange: e => { selected.clear(); if (e.target.checked) rows.forEach(r => selected.add(r.p.id)); APP.render(); }
          })),
        th('Name', 'name'), th('State', 'state'),
        th('Level', 'level'), th('Job title', 'jobTitle'),
        th('Family', 'family'), th('Blueprint role', 'blueprintRole'),
        th('Manager', 'manager'), th('Engagement', 'employmentType'), th('FTE', 'fte', true),
        th('On-roll', 'onRoll', true), th('Effective', 'effective', true),
        el('th', {}, 'Timeline'), el('th', {}, ''))),
      el('tbody', {}, rows.map(({ p, r }) => {
        const tr = el('tr', {
          class: (r.state === E.STATES.DEPARTED ? 'dim ' : '') + (r.countsHeadcount === false ? 'nohc ' : '') + (selected.has(p.id) ? 'sel' : ''),
          title: r.countsHeadcount === false ? `\ — delivers capacity but consumes no blueprint seat` : null
        },
          el('td', {}, el('input', {
            type: 'checkbox', checked: selected.has(p.id),
            onchange: e => { e.target.checked ? selected.add(p.id) : selected.delete(p.id); APP.render(); }
          })));
        tr.appendChild(editCell(p, 'name'));
        tr.appendChild(el('td', {}, statePill(r.state || 'Active'),
          r.reason && r.state !== E.STATES.ACTIVE ? el('div', { class: 'tiny muted' }, r.reason) : null));
        tr.appendChild(editCell(p, 'level', { options: levels, allowFree: true }));
        tr.appendChild(editCell(p, 'jobTitle'));
        tr.appendChild(editCell(p, 'family', { options: families, allowFree: true }));
        tr.appendChild(editCell(p, 'blueprintRole', { options: roles, allowFree: true }));
        tr.appendChild(editCell(p, 'manager', { options: names, allowFree: true }));
        tr.appendChild(editCell(p, 'employmentType', { options: E.EMPLOYMENT_TYPES }));
        tr.appendChild(editCell(p, 'fte', { number: true }));
        tr.appendChild(el('td', { class: 'num mono' }, nf(r.onRoll ?? 0)));
        tr.appendChild(el('td', { class: 'num mono' },
          el('b', { style: { color: (r.effective ?? 0) === 0 ? 'var(--cp-danger)' : '' } }, nf(r.effective ?? 0))));
        tr.appendChild(el('td', {}, (p.events || []).length
          ? (p.events || []).map(e => el('span', {
            class: `pill ${e.type === 'exit' ? 'p-notice' : e.type === 'leave' ? 'p-leave' : e.type === 'hire' ? 'p-active' : 'p-low'}`,
            style: { marginRight: '3px' }, title: `${e.type} ${e.date}${e.endDate ? ' → ' + e.endDate : ''}`
          }, `${e.type === 'exit' ? 'exit' : e.type === 'leave' ? (e.kind || 'leave') : e.type} ${String(e.date).slice(2, 7)}`))
          : el('span', { class: 'tiny muted' }, '—')));
        tr.appendChild(el('td', {}, el('button', { class: 'btn sm', onclick: () => openPerson(p.id) }, 'Open')));
        return tr;
      })));

    const bulkBar = selected.size ? el('div', {
      class: 'row', style: { marginBottom: '10px', padding: '9px 12px', background: 'var(--cp-link-soft)', borderRadius: '11px' }
    },
      el('b', {}, `${selected.size} selected`),
      el('button', { class: 'btn sm', onclick: () => bulkEdit('manager', 'Manager', APP.peopleNames()) }, 'Set manager'),
      el('button', { class: 'btn sm', onclick: () => bulkEdit('family', 'Family', APP.families()) }, 'Set family'),
      el('button', { class: 'btn sm', onclick: () => bulkEdit('blueprintRole', 'Blueprint role', APP.roles()) }, 'Set role'),
      el('button', { class: 'btn sm', onclick: () => bulkEdit('level', 'Level', APP.levels()) }, 'Set level'),
      el('button', { class: 'btn sm', onclick: () => bulkEdit('employmentType', 'Engagement', E.EMPLOYMENT_TYPES) }, 'Set engagement'),
      el('button', { class: 'btn sm', onclick: bulkLeave }, 'Add leave'),
      el('button', { class: 'btn sm danger', onclick: bulkDelete }, 'Delete'),
      el('button', { class: 'btn sm right', onclick: () => { selected.clear(); APP.render(); } }, 'Clear selection')) : null;

    wrap.appendChild(section(`Roster · ${people.length} of ${s.people.length} people`,
      supplementaryNote(s, ev),
      UI.filterBar(),
      bulkBar,
      el('div', { class: 'row', style: { marginBottom: '10px' } },
        el('button', { class: 'btn primary', onclick: addPerson }, '+ Add person'),
        el('button', { class: 'btn', onclick: IMPORTS.openRosterImport }, 'Import CSV / Excel'),
        el('button', { class: 'btn', onclick: pasteImport }, 'Paste rows'),
        el('button', { class: 'btn', onclick: exportCsv }, '⭳ Export CSV'),
        el('div', { class: 'right small muted' }, `Evaluated at ${E.longDate(APP.date)}`)),
      el('div', { class: 'tbl-wrap' }, tbl)));

    return wrap;
  }

  /* ---------- person drawer ------------------------------------------------ */
  function openPerson(id) {
    const p = APP.personById(id);
    if (!p) return;
    const rerender = () => { UI.closeModal(); openPerson(id); APP.render(); };
    const r = E.evaluatePerson(p, APP.date, {
      applyRamp: APP.state.settings.applyRamp, rampProfile: APP.state.settings.rampProfile
    });

    const fld = (label, field, opts = {}) => el('label', { class: 'field' }, label,
      opts.options
        ? el('select', { onchange: e => set(field, e.target.value) },
          el('option', { value: '' }, '—'),
          [...new Set(opts.options.concat(p[field] ? [p[field]] : []))].filter(Boolean).sort()
            .map(o => el('option', { value: o, selected: (p[field] || '') === o }, o)))
        : el('input', {
          type: opts.type || 'text', step: opts.type === 'number' ? '0.1' : null,
          value: p[field] ?? '', onchange: e => set(field, opts.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)
        }));

    const set = (field, v) => APP.mutate(`Edit ${p.name} · ${field}`, st => {
      const t = st.people.find(x => x.id === id); if (!t) return false; t[field] = v;
    });

    /* --- timeline editor --- */
    const evList = el('div', {});
    const events = (p.events || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!events.length) evList.appendChild(el('div', { class: 'small muted', style: { padding: '8px 0' } },
      'No events. This person is treated as continuously active. Add leave, an exit or a start date below.'));

    events.forEach(e => {
      const upd = (k, v) => APP.mutate(`Edit ${p.name} timeline`, st => {
        const t = st.people.find(x => x.id === id); const ee = t.events.find(x => x.id === e.id);
        if (!ee) return false; ee[k] = v;
      }, { silent: true });
      const row = el('div', {
        class: 'row', style: {
          padding: '8px', border: '1px solid var(--cp-border)', borderRadius: '9px',
          marginBottom: '6px', background: 'var(--cp-surface-soft)'
        }
      },
        el('select', { onchange: ev2 => { upd('type', ev2.target.value); rerender(); } },
          E.EVENT_TYPES.map(t => el('option', { value: t, selected: e.type === t },
            { hire: 'Started', leave: 'Leave', exit: 'Exit', fte_change: 'FTE change', transfer: 'Transfer', role_change: 'Role change' }[t] || t))),
        el('input', { type: 'date', value: e.date || '', onchange: ev2 => { upd('date', ev2.target.value); rerender(); } }),
        e.type === 'leave' ? frag(
          el('span', { class: 'tiny muted' }, 'until'),
          el('input', { type: 'date', value: e.endDate || '', onchange: ev2 => { upd('endDate', ev2.target.value); rerender(); } }),
          el('select', { onchange: ev2 => { upd('kind', ev2.target.value); rerender(); } },
            E.LEAVE_KINDS.map(k => el('option', { value: k, selected: (e.kind || 'Other') === k }, k)))) : null,
        e.type === 'fte_change' ? el('input', {
          type: 'number', step: '0.1', style: { width: '80px' }, value: e.fte ?? 1,
          onchange: ev2 => { upd('fte', parseFloat(ev2.target.value) || 0); rerender(); }
        }) : null,
        e.type === 'exit' ? frag(
          el('span', { class: 'tiny muted' }, 'notice from'),
          el('input', { type: 'date', value: e.noticeFrom || '', onchange: ev2 => { upd('noticeFrom', ev2.target.value); rerender(); } }),
          el('span', { class: 'tiny muted' }, 'garden leave from'),
          el('input', {
            type: 'date', value: e.gardenFrom || '', title: 'From this date they are paid but out of the rota — zero effective capacity.',
            onchange: ev2 => { upd('gardenFrom', ev2.target.value); rerender(); }
          }),
          el('button', {
            class: 'btn sm', title: 'Set garden leave to start one month before the exit date',
            onclick: () => { upd('gardenFrom', E.addMonths(e.date, -1)); rerender(); }
          }, '−1m')) : null,
        el('input', { type: 'text', placeholder: 'Note', style: { flex: '1', minWidth: '90px' }, value: e.note || '', onchange: ev2 => upd('note', ev2.target.value) }),
        el('button', {
          class: 'btn sm danger', onclick: () => {
            APP.mutate(`Remove timeline event for ${p.name}`, st => {
              const t = st.people.find(x => x.id === id); t.events = t.events.filter(x => x.id !== e.id);
            }); rerender();
          }
        }, '✕'));
      evList.appendChild(row);
    });

    const addEvent = type => {
      APP.mutate(`Add ${type} event for ${p.name}`, st => {
        const t = st.people.find(x => x.id === id);
        t.events = t.events || [];
        const base = { id: E.uid('ev'), type, date: APP.date };
        if (type === 'leave') { base.kind = 'Parental'; base.endDate = E.addMonths(APP.date, 6); }
        if (type === 'fte_change') base.fte = t.fte;
        t.events.push(base);
      });
      rerender();
    };

    /* --- skills --- */
    const skillBox = el('div', {},
      (p.skills || []).map(sk => el('span', { class: 'tag' }, sk, el('b', {
        onclick: () => { APP.mutate(`Remove skill from ${p.name}`, st => { const t = st.people.find(x => x.id === id); t.skills = t.skills.filter(x => x !== sk); }); rerender(); }
      }, '✕'))),
      el('input', {
        type: 'text', placeholder: 'Add a skill and press Enter', style: { marginTop: '6px', width: '100%' },
        onkeydown: e2 => {
          if (e2.key !== 'Enter' || !e2.target.value.trim()) return;
          const v = e2.target.value.trim();
          APP.mutate(`Add skill to ${p.name}`, st => { const t = st.people.find(x => x.id === id); t.skills = [...new Set((t.skills || []).concat(v))]; });
          rerender();
        }
      }));

    /* --- accounts --- */
    const assigned = (APP.state.assignments || []).filter(a => a.personId === id);
    const accBox = el('div', {},
      assigned.length ? assigned.map(a => {
        const acc = APP.state.accounts.find(x => x.id === a.accountId);
        return el('span', { class: 'tag' }, acc ? acc.name : a.accountId, ` (${a.weight || 1})`,
          el('b', { onclick: () => { APP.mutate(`Unassign account from ${p.name}`, st => { st.assignments = st.assignments.filter(x => !(x.personId === id && x.accountId === a.accountId)); }); rerender(); } }, '✕'));
      }) : el('span', { class: 'tiny muted' }, 'No accounts assigned.'),
      APP.state.accounts.length ? el('select', {
        style: { marginTop: '6px' }, onchange: e2 => {
          if (!e2.target.value) return;
          APP.mutate(`Assign account to ${p.name}`, st => { st.assignments.push({ personId: id, accountId: e2.target.value, weight: 1 }); });
          rerender();
        }
      }, el('option', { value: '' }, '+ Assign an account…'),
        APP.state.accounts.filter(a => !assigned.some(x => x.accountId === a.id))
          .map(a => el('option', { value: a.id }, a.name)))
        : el('div', { class: 'tiny muted', style: { marginTop: '6px' } }, 'No accounts defined yet — add them on the Workload view.'));

    const body = el('div', {},
      el('div', { class: 'row', style: { marginBottom: '12px' } },
        statePill(r.state),
        el('span', { class: 'small muted' }, r.reason),
        el('span', { class: 'right small' }, `At ${E.longDate(APP.date)}: `,
          el('b', {}, `${nf(r.onRoll)} on-roll`), ' · ',
          el('b', { style: { color: r.effective === 0 ? 'var(--cp-danger)' : 'var(--cp-success)' } }, `${nf(r.effective)} effective`))),
      el('div', { class: 'grid g3' },
        fld('Name', 'name'), fld('Email', 'email', { type: 'text' }),
        fld('Job title', 'jobTitle'), fld('Level', 'level', { options: APP.levels() }),
        fld('Track', 'track', { options: ['IC', 'Manager'] }),
        fld('Job family', 'family', { options: APP.families() }),
        fld('Blueprint role', 'blueprintRole', { options: APP.roles() }),
        fld('Manager', 'manager', { options: APP.peopleNames().filter(n => n !== p.name) }),
        fld('FTE', 'fte', { type: 'number' }),
        fld('Engagement', 'employmentType', { options: E.EMPLOYMENT_TYPES }),
        fld('Location', 'location'),
        fld('Scenario', 'scenario', { options: APP.state.scenarios.map(x => x.id) })),
      el('h3', { style: { marginTop: '18px' } }, 'Timeline'),
      el('div', { class: 'sub' }, 'Multiple leaves, phased returns and a later exit are all supported. This is what the old single-status model could not do.'),
      evList,
      el('div', { class: 'row', style: { marginTop: '8px' } },
        el('button', { class: 'btn sm', onclick: () => addEvent('leave') }, '+ Leave'),
        el('button', { class: 'btn sm', onclick: () => addEvent('exit') }, '+ Exit'),
        el('button', { class: 'btn sm', onclick: () => addEvent('hire') }, '+ Start date'),
        el('button', { class: 'btn sm', onclick: () => addEvent('fte_change') }, '+ FTE change')),
      el('div', { class: 'grid g2', style: { marginTop: '18px' } },
        el('div', {}, el('h3', {}, 'Skills'), el('div', { class: 'sub' }, 'Used by the bus-factor detector.'), skillBox),
        el('div', {}, el('h3', {}, 'Accounts'), el('div', { class: 'sub' }, 'Drives orphaned-customer analysis.'), accBox)),
      el('label', { class: 'field', style: { marginTop: '16px' } }, 'Notes',
        el('textarea', { rows: 3, value: p.notes || '', onchange: e2 => set('notes', e2.target.value) }, p.notes || '')),
      el('div', { class: 'row', style: { marginTop: '16px' } },
        (p.events || []).some(e => e.type === 'exit')
          ? el('button', {
            class: 'btn primary', onclick: () => {
              const ex = p.events.find(e => e.type === 'exit');
              UI.closeModal();
              VIEW_PIPELINE.newRequisition({
                targetFamily: p.family, targetRole: p.blueprintRole, targetLevel: p.level,
                backfillFor: p.id, pcnId: `BACKFILL-${(p.name || '').split(' ')[0]}`,
                expectedStartDate: E.addDays(ex.date, APP.state.settings.timeToHireDays || 90)
              });
            }
          }, '+ Raise a backfill requisition') : null,
        el('button', {
          class: 'btn danger right', onclick: () => confirmDialog('Delete person',
            `Remove ${p.name} from the model entirely? Use an exit event instead if they are simply leaving.`, () => {
              APP.mutate(`Delete ${p.name}`, st => {
                st.people = st.people.filter(x => x.id !== id);
                st.assignments = st.assignments.filter(a => a.personId !== id);
              });
              UI.closeModal();
            }, 'Delete permanently')
        }, 'Delete person')));

    modal(p.name || 'Person', body, { sub: `${p.family || '—'} · ${p.blueprintRole || 'N/A'}`, size: 'wide' });
  }

  /* ---------- actions ------------------------------------------------------ */
  function addPerson() {
    const id = E.uid('person');
    APP.mutate('Add person', st => {
      st.people.push(E.normalisePerson({ id, name: 'New person', fte: 1, scenario: APP.scenario }));
    });
    openPerson(id);
  }

  function bulkEdit(field, label, options) {
    const sel = el('select', {}, el('option', { value: '' }, '—'), options.map(o => el('option', { value: o }, o)));
    const free = el('input', { type: 'text', placeholder: 'or type a new value' });
    modal(`Set ${label} for ${selected.size} people`, el('div', {},
      el('div', { class: 'row' }, sel, free),
      el('div', { class: 'row', style: { marginTop: '14px' } },
        el('button', {
          class: 'btn primary', onclick: () => {
            const v = free.value.trim() || sel.value;
            APP.mutate(`Bulk set ${field} for ${selected.size} people`, st => {
              st.people.forEach(p => { if (selected.has(p.id)) p[field] = v; });
            });
            UI.closeModal();
            toast(`${label} set for ${selected.size} people`, 'ok');
          }
        }, 'Apply'),
        el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'))), { size: 'narrow' });
  }

  function bulkLeave() {
    const from = el('input', { type: 'date', value: APP.date });
    const to = el('input', { type: 'date', value: E.addMonths(APP.date, 6) });
    const kind = el('select', {}, E.LEAVE_KINDS.map(k => el('option', { value: k }, k)));
    modal(`Add leave to ${selected.size} people`, el('div', {},
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'From', from),
        el('label', { class: 'field' }, 'Until', to),
        el('label', { class: 'field' }, 'Kind', kind)),
      el('div', { class: 'row', style: { marginTop: '14px' } },
        el('button', {
          class: 'btn primary', onclick: () => {
            APP.mutate(`Add leave to ${selected.size} people`, st => {
              st.people.forEach(p => {
                if (!selected.has(p.id)) return;
                p.events = p.events || [];
                p.events.push({ id: E.uid('ev'), type: 'leave', date: from.value, endDate: to.value, kind: kind.value });
              });
            });
            UI.closeModal(); toast('Leave added', 'ok');
          }
        }, 'Add leave'),
        el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'))), { size: 'narrow' });
  }

  function bulkDelete() {
    confirmDialog('Delete people', `Permanently remove ${selected.size} people from the model?`, () => {
      APP.mutate(`Delete ${selected.size} people`, st => {
        st.people = st.people.filter(p => !selected.has(p.id));
        st.assignments = st.assignments.filter(a => !selected.has(a.personId));
      });
      selected.clear();
    }, 'Delete them');
  }

  /* ---------- import / export ---------------------------------------------- */
  const CSV_COLS = [
    { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' },
    { key: 'manager', label: 'Manager' }, { key: 'jobTitle', label: 'Job title' },
    { key: 'level', label: 'Level' }, { key: 'family', label: 'Family' },
    { key: 'blueprintRole', label: 'Blueprint role' }, { key: 'fte', label: 'FTE' },
    { key: 'location', label: 'Location' }
  ];

  function exportCsv() {
    const ev = APP.ev();
    const cols = CSV_COLS.concat([
      { label: 'State', value: p => (ev.byId.get(p.id) || {}).state },
      { label: 'Detail', value: p => (ev.byId.get(p.id) || {}).reason },
      { label: 'On-roll FTE', value: p => (ev.byId.get(p.id) || {}).onRoll },
      { label: 'Effective FTE', value: p => (ev.byId.get(p.id) || {}).effective },
      { label: 'Skills', value: p => (p.skills || []).join('; ') },
      { label: 'Timeline', value: p => (p.events || []).map(e => `${e.type}:${e.date}${e.endDate ? '→' + e.endDate : ''}`).join('; ') }
    ]);
    STORE.download(`UHM_roster_${APP.date}.csv`, UI.toCSV(APP.state.people.filter(p => APP.matches(p)), cols), 'text/csv');
    toast('Roster exported', 'ok');
  }

  /** Paste from Excel. Needed because the source workbook is MIP-encrypted. */
  function pasteImport() {
    const ta = el('textarea', {
      rows: 10, style: { width: '100%', fontFamily: 'Consolas,monospace', fontSize: '12px' },
      placeholder: 'Paste rows straight from Excel. First row must be headers.\n\nRecognised headers: Name, Email, Manager, Job title, Level, Track, Family, Blueprint role, FTE, Location, Skills, Leave start, Leave end, Leave kind, Last date, Start date'
    });
    const preview = el('div', { class: 'small muted', style: { marginTop: '10px' } });

    const parseRows = () => {
      const rows = UI.parseDelimited(ta.value);
      if (rows.length < 2) return null;
      const norm = h => String(h).toLowerCase().replace(/[^a-z]/g, '');
      const head = rows[0].map(norm);
      const idx = keys => { for (const k of keys) { const i = head.indexOf(norm(k)); if (i >= 0) return i; } return -1; };
      const map = {
        name: idx(['name', 'fullname', 'employee']), email: idx(['email', 'alias']),
        manager: idx(['manager', 'reportsto']), jobTitle: idx(['jobtitle', 'title']),
        level: idx(['level', 'careerstage', 'grade']), track: idx(['track']),
        family: idx(['family', 'jobfamily']), blueprintRole: idx(['blueprintrole', 'role']),
        fte: idx(['fte']), location: idx(['location', 'office']), skills: idx(['skills']),
        leaveStart: idx(['leavestart', 'leavestartdate']), leaveEnd: idx(['leaveend', 'expectedreturn', 'expectedreturndate', 'returndate']),
        leaveKind: idx(['leavekind', 'leavetype']), lastDate: idx(['lastdate', 'leavingdate', 'exitdate']),
        startDate: idx(['startdate', 'hiredate'])
      };
      return { rows: rows.slice(1), map };
    };

    ta.addEventListener('input', () => {
      const r = parseRows();
      preview.textContent = r ? `${r.rows.length} rows detected. Matched columns: ${Object.entries(r.map).filter(([, v]) => v >= 0).map(([k]) => k).join(', ')}` : 'Paste at least a header row and one data row.';
    });

    modal('Paste import', el('div', {},
      el('p', { class: 'sub' }, 'Copy a block of cells out of Excel (including the header row) and paste it here. Existing people are matched by name and updated; new names are added.'),
      ta, preview,
      el('div', { class: 'row', style: { marginTop: '14px' } },
        el('button', {
          class: 'btn primary', onclick: () => {
            const r = parseRows();
            if (!r) return toast('Nothing to import', 'err');
            let added = 0, updated = 0;
            APP.mutate('Paste import', st => {
              r.rows.forEach(row => {
                const g = k => r.map[k] >= 0 ? String(row[r.map[k]] ?? '').trim() : '';
                const name = g('name');
                if (!name) return;
                let p = st.people.find(x => x.name.toLowerCase() === name.toLowerCase());
                if (!p) { p = E.normalisePerson({ name }); st.people.push(p); added++; } else updated++;
                ['email', 'manager', 'jobTitle', 'level', 'track', 'family', 'blueprintRole', 'location']
                  .forEach(k => { const v = g(k); if (v) p[k] = v; });
                const fte = g('fte'); if (fte) p.fte = parseFloat(fte.replace(',', '.')) || 1;
                const sk = g('skills'); if (sk) p.skills = sk.split(/[;,|]/).map(x => x.trim()).filter(Boolean);
                p.events = p.events || [];
                const dnorm = v => {
                  if (!v) return '';
                  if (E.valid(v)) return v.slice(0, 10);
                  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
                  return m ? `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}` : '';
                };
                const ls = dnorm(g('leaveStart')), le = dnorm(g('leaveEnd')), ld = dnorm(g('lastDate')), sd = dnorm(g('startDate'));
                if (ls) { p.events = p.events.filter(e => e.type !== 'leave'); p.events.push({ id: E.uid('ev'), type: 'leave', date: ls, endDate: le, kind: g('leaveKind') || 'Other' }); }
                if (ld) { p.events = p.events.filter(e => e.type !== 'exit'); p.events.push({ id: E.uid('ev'), type: 'exit', date: ld }); }
                if (sd) { p.events = p.events.filter(e => e.type !== 'hire'); p.events.push({ id: E.uid('ev'), type: 'hire', date: sd }); }
              });
            });
            UI.closeModal();
            toast(`Imported: ${added} added, ${updated} updated`, 'ok');
          }
        }, 'Import'),
        el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'))), { size: 'wide' });
  }

  return { render, openPerson, addPerson, pasteImport, exportCsv };
})();
