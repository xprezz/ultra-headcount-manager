/* ============================================================================
   CUHM 2.0 — Workload: customer coverage, orphaned accounts, reassignment
   suggestions, and the seniority pyramid.
   ========================================================================== */
const VIEW_WORKLOAD = (() => {
  'use strict';
  const { el, frag, nf, sgn, section, table, modal, toast, statePill, confirmDialog, APP } = UI;
  const E = ENGINE;

  function render() {
    const s = APP.state;
    const wrap = el('div', {});
    const cov = E.accountCoverage(s, APP.date, APP.scenario);
    const loaded = cov.load.filter(l => l.weight > 0);

    /* --- headline --------------------------------------------------------- */
    wrap.appendChild(el('div', { class: 'grid g4', style: { marginBottom: '14px' } },
      UI.kpi('Accounts', String(s.accounts.length), 'In the model', 'blue'),
      UI.kpi('Orphaned now', String(cov.orphaned.length),
        cov.orphaned.length ? 'Nobody available is covering these' : 'All accounts have a live owner',
        cov.orphaned.length ? 'red' : 'green'),
      UI.kpi('At risk', String(cov.atRisk.length), 'Lost an owner but still partly covered',
        cov.atRisk.length ? 'amber' : 'green'),
      UI.kpi('Heaviest load', loaded.length ? loaded[0].person.name.split(' ')[0] : '—',
        loaded.length ? `${loaded[0].weight} weighted accounts on ${nf(loaded[0].person.effective)} FTE` : 'No assignments yet',
        'purple')));

    /* --- orphaned + reassignment ------------------------------------------ */
    if (cov.orphaned.length || cov.atRisk.length) {
      const box = el('div', {});
      cov.orphaned.concat(cov.atRisk).forEach(a => {
        const lostNames = a.lost.map(o => `${o.person.name} (${o.person.reason})`).join('; ');
        const suggestions = suggest(a, cov, s);
        box.appendChild(el('div', { class: `find sev-${a.orphaned ? 'high' : 'medium'}` },
          el('h4', {}, `${a.account.name}${a.account.tier ? ' · ' + a.account.tier : ''} — ${a.orphaned ? 'no available owner' : 'owner unavailable'}`),
          el('p', {}, lostNames ? `Lost: ${lostNames}.` : 'No owner assigned.',
            a.covered.length ? ` Still covered by ${a.covered.map(o => o.person.name).join(', ')}.` : ''),
          suggestions.length ? el('div', { class: 'acts' },
            el('span', { class: 'tiny muted', style: { alignSelf: 'center' } }, 'Suggested cover:'),
            suggestions.map(sg => el('button', {
              class: 'btn sm', title: `${sg.reason}`,
              onclick: () => {
                APP.mutate(`Assign ${a.account.name} to ${sg.person.name}`, st => {
                  st.assignments.push({ personId: sg.person.id, accountId: a.account.id, weight: 1 });
                });
                toast(`${a.account.name} assigned to ${sg.person.name}`, 'ok');
              }
            }, `${sg.person.name} (${sg.reason})`)))
            : el('p', { class: 'tiny muted' }, 'No obvious cover — everyone in this family is already at or above average load.')));
      });
      wrap.appendChild(section('Orphaned and at-risk customers',
        `Who actually absorbs the work at ${E.longDate(APP.date)}. Suggestions rank by spare capacity, matching family and comparable level.`, box));
    }

    /* --- load per person -------------------------------------------------- */
    if (loaded.length) {
      const avg = loaded.reduce((a, b) => a + b.loadPerFte, 0) / loaded.length;
      wrap.appendChild(section('Load per head',
        `Weighted accounts carried per effective FTE. Average is ${nf(avg, 1)}. Anyone well above it is absorbing someone else's work.`,
        table([
          { label: 'Person', render: l => el('b', {}, l.person.name) },
          { label: 'State', render: l => statePill(l.person.state) },
          { label: 'Family', render: l => l.person.family || '—' },
          { label: 'Accounts', num: true, key: 'accounts' },
          { label: 'Weighted', num: true, key: 'weight' },
          { label: 'Effective FTE', num: true, render: l => nf(l.person.effective) },
          {
            label: 'Load per FTE', num: true, render: l => el('b', {
              style: { color: l.loadPerFte > avg * 1.35 ? 'var(--cp-danger)' : l.loadPerFte > avg * 1.15 ? 'var(--cp-warning)' : '' }
            }, nf(l.loadPerFte, 1))
          },
          {
            label: '', render: l => {
              const p = Math.min((l.loadPerFte / (avg * 2)) * 100, 100);
              return el('div', { class: 'bar-mini' }, el('i', {
                style: { width: `${p}%`, background: l.loadPerFte > avg * 1.35 ? 'var(--cp-danger)' : 'var(--cp-accent)' }
              }));
            }
          }
        ], loaded, { onRow: l => VIEW_PEOPLE.openPerson(l.person.id) })));
    }

    /* --- account register -------------------------------------------------- */
    wrap.appendChild(section(`Customer register · ${s.accounts.length}`,
      'Add the customers you cover so departures and leave show you exactly which relationships are exposed.',
      el('div', { class: 'row', style: { marginBottom: '10px' } },
        el('button', { class: 'btn primary', onclick: addAccount }, '+ Add customer'),
        el('button', { class: 'btn', onclick: pasteAccounts }, '📋 Paste import'),
        s.accounts.length ? el('button', {
          class: 'btn', onclick: () => STORE.download(`UHM_accounts_${APP.date}.csv`,
            UI.toCSV(cov.accounts, [
              { label: 'Account', value: a => a.account.name },
              { label: 'Segment', value: a => a.account.segment || '' },
              { label: 'Tier', value: a => a.account.tier || '' },
              { label: 'Owners', value: a => a.owners.map(o => o.person.name).join('; ') },
              { label: 'Available owners', value: a => a.covered.map(o => o.person.name).join('; ') },
              { label: 'Status', value: a => a.orphaned ? 'Orphaned' : a.atRisk ? 'At risk' : 'Covered' }
            ]), 'text/csv')
        }, '⭳ Export CSV') : null),
      s.accounts.length ? table([
        { label: 'Customer', render: a => el('b', {}, a.account.name) },
        { label: 'Segment', render: a => a.account.segment || '—' },
        { label: 'Tier', render: a => a.account.tier || '—' },
        { label: 'Owners', render: a => a.owners.length ? a.owners.map(o => el('span', { class: 'tag' }, o.person.name)) : el('span', { class: 'tiny muted' }, 'Unassigned') },
        {
          label: 'Status', render: a => a.orphaned ? el('span', { class: 'pill p-high' }, 'Orphaned')
            : a.atRisk ? el('span', { class: 'pill p-medium' }, 'At risk')
              : a.owners.length ? el('span', { class: 'pill p-active' }, 'Covered')
                : el('span', { class: 'pill p-low' }, 'Unassigned')
        },
        { label: '', render: a => el('button', { class: 'btn sm', onclick: () => editAccount(a.account.id) }, 'Edit') }
      ], cov.accounts) : UI.emptyBox('No customers yet. Add them to unlock orphaned-account and workload analysis.',
        '+ Add customer', addAccount)));

    /* --- seniority pyramid -------------------------------------------------- */
    wrap.appendChild(pyramidCard());

    return wrap;
  }

  /** Rank possible cover: same family, available, lowest current load, senior enough. */
  function suggest(a, cov, s) {
    const family = a.owners.length ? a.owners[0].person.family : null;
    const avg = cov.load.length ? cov.load.reduce((x, y) => x + y.loadPerFte, 0) / cov.load.length : 1;
    return cov.load
      .filter(l => l.person.effective > 0)
      .filter(l => !a.owners.some(o => o.person.id === l.person.id))
      .filter(l => !family || l.person.family === family)
      .sort((x, y) => x.loadPerFte - y.loadPerFte)
      .slice(0, 3)
      .map(l => ({
        person: l.person,
        reason: l.weight === 0 ? 'no accounts yet'
          : l.loadPerFte < avg ? `${nf(l.loadPerFte, 1)} load, below average` : `${nf(l.loadPerFte, 1)} load`
      }));
  }

  /* ---------- accounts ----------------------------------------------------- */
  function addAccount() {
    const id = E.uid('acc');
    APP.mutate('Add customer', st => {
      st.accounts.push({ id, name: 'New customer', segment: '', tier: '', requiredCoverage: 1, notes: '' });
    });
    editAccount(id);
  }

  function editAccount(id) {
    const a = APP.state.accounts.find(x => x.id === id);
    if (!a) return;
    const set = (k, v) => APP.mutate('Edit customer', st => {
      const t = st.accounts.find(x => x.id === id); if (!t) return false; t[k] = v;
    });
    const owners = APP.state.assignments.filter(x => x.accountId === id);
    const ev = APP.ev();

    const body = el('div', {},
      el('div', { class: 'grid g3' },
        el('label', { class: 'field' }, 'Customer name', el('input', { value: a.name, onchange: e => set('name', e.target.value) })),
        el('label', { class: 'field' }, 'Segment', el('input', { value: a.segment || '', onchange: e => set('segment', e.target.value) })),
        el('label', { class: 'field' }, 'Tier', el('input', { value: a.tier || '', onchange: e => set('tier', e.target.value) }))),
      el('h3', { style: { marginTop: '16px' } }, 'Owners'),
      el('div', {}, owners.length ? owners.map(o => {
        const r = ev.byId.get(o.personId);
        return el('div', { class: 'row', style: { padding: '5px 0' } },
          el('b', {}, r ? r.name : o.personId),
          r ? statePill(r.state) : null,
          el('label', { class: 'field' }, 'Weight', el('input', {
            type: 'number', step: '0.1', style: { width: '75px' }, value: o.weight || 1,
            onchange: e => APP.mutate('Change coverage weight', st => {
              const t = st.assignments.find(x => x.accountId === id && x.personId === o.personId);
              if (t) t.weight = parseFloat(e.target.value) || 1;
            })
          })),
          el('button', {
            class: 'btn sm danger right', onclick: () => {
              APP.mutate('Unassign owner', st => { st.assignments = st.assignments.filter(x => !(x.accountId === id && x.personId === o.personId)); });
              UI.closeModal(); editAccount(id);
            }
          }, '✕'));
      }) : el('div', { class: 'tiny muted' }, 'No owners assigned.')),
      el('select', {
        style: { marginTop: '9px' }, onchange: e => {
          if (!e.target.value) return;
          APP.mutate('Assign owner', st => { st.assignments.push({ personId: e.target.value, accountId: id, weight: 1 }); });
          UI.closeModal(); editAccount(id);
        }
      }, el('option', { value: '' }, '+ Add an owner…'),
        APP.state.people.filter(p => !owners.some(o => o.personId === p.id)).map(p => el('option', { value: p.id }, p.name))),
      el('div', { class: 'row', style: { marginTop: '16px' } },
        el('button', { class: 'btn primary', onclick: UI.closeModal }, 'Done'),
        el('button', {
          class: 'btn danger right', onclick: () => confirmDialog('Delete customer', `Remove ${a.name}?`, () => {
            APP.mutate('Delete customer', st => {
              st.accounts = st.accounts.filter(x => x.id !== id);
              st.assignments = st.assignments.filter(x => x.accountId !== id);
            });
            UI.closeModal();
          })
        }, 'Delete')));

    modal(a.name, body, { sub: 'Customer', size: '' });
  }

  function pasteAccounts() {
    const ta = el('textarea', {
      rows: 10, style: { width: '100%', fontFamily: 'Consolas,monospace', fontSize: '12px' },
      placeholder: 'Paste from Excel with headers.\n\nRecognised: Customer / Account, Segment, Tier, Owner (a person\'s name)'
    });
    modal('Paste customers', el('div', {},
      el('p', { class: 'sub' }, 'Existing customers are matched by name. An Owner column assigns that person automatically.'),
      ta,
      el('div', { class: 'row', style: { marginTop: '14px' } },
        el('button', {
          class: 'btn primary', onclick: () => {
            const rows = UI.parseDelimited(ta.value);
            if (rows.length < 2) return toast('Nothing to import', 'err');
            const norm = h => String(h).toLowerCase().replace(/[^a-z]/g, '');
            const head = rows[0].map(norm);
            const idx = keys => { for (const k of keys) { const i = head.indexOf(norm(k)); if (i >= 0) return i; } return -1; };
            const iName = idx(['customer', 'account', 'accountname', 'name']);
            const iSeg = idx(['segment']), iTier = idx(['tier']), iOwn = idx(['owner', 'csam', 'assignedto']);
            if (iName < 0) return toast('No customer/account column found', 'err');
            let added = 0;
            APP.mutate('Paste import customers', st => {
              rows.slice(1).forEach(row => {
                const name = String(row[iName] ?? '').trim();
                if (!name) return;
                let acc = st.accounts.find(x => x.name.toLowerCase() === name.toLowerCase());
                if (!acc) { acc = { id: E.uid('acc'), name, segment: '', tier: '', requiredCoverage: 1 }; st.accounts.push(acc); added++; }
                if (iSeg >= 0 && row[iSeg]) acc.segment = String(row[iSeg]).trim();
                if (iTier >= 0 && row[iTier]) acc.tier = String(row[iTier]).trim();
                if (iOwn >= 0 && row[iOwn]) {
                  const on = String(row[iOwn]).trim().toLowerCase();
                  const p = st.people.find(x => x.name.toLowerCase() === on);
                  if (p && !st.assignments.some(x => x.accountId === acc.id && x.personId === p.id)) {
                    st.assignments.push({ personId: p.id, accountId: acc.id, weight: 1 });
                  }
                }
              });
            });
            UI.closeModal(); toast(`${added} customers added`, 'ok');
          }
        }, 'Import'),
        el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'))), { size: 'wide' });
  }

  /* ---------- seniority ---------------------------------------------------- */
  function pyramidCard() {
    const s = APP.state;
    const ev = APP.ev();
    const levels = new Map();
    ev.perPerson.forEach(r => {
      if (r.state === E.STATES.DEPARTED || r.state === E.STATES.NOT_STARTED) return;
      const k = r.level || '(no level)';
      if (!levels.has(k)) levels.set(k, { level: k, onRoll: 0, effective: 0, people: [] });
      const b = levels.get(k);
      b.onRoll += r.onRoll; b.effective += r.effective; b.people.push(r);
    });
    const rows = [...levels.values()].sort((a, b) => String(b.level).localeCompare(String(a.level)));
    const max = Math.max(...rows.map(r => r.onRoll), 1);

    const missing = ev.perPerson.filter(r => !r.level && r.state !== E.STATES.DEPARTED).length;

    const pyr = el('div', { class: 'pyr' }, rows.map(r => el('div', { class: 'pyr-row' },
      el('div', { class: 'small', style: { fontWeight: '700' } }, r.level),
      el('div', { class: 'pyr-bar', title: r.people.map(p => p.name).join(', ') },
        el('i', { style: { width: `${(r.effective / max) * 100}%` } }),
        r.onRoll > r.effective ? el('i', {
          class: 'drag',
          style: { left: `${(r.effective / max) * 100}%`, width: `${((r.onRoll - r.effective) / max) * 100}%` }
        }) : null),
      el('div', { class: 'small mono rt' }, `${nf(r.effective)}/${nf(r.onRoll)}`))));

    /* seniority loss warnings */
    const warn = [];
    ev.perRole.forEach(v => {
      const humans = v.members.filter(m => !m.isPipeline);
      const leaving = humans.filter(m => m.state === E.STATES.ON_NOTICE || m.state === E.STATES.ON_LEAVE || m.state === E.STATES.GARDEN);
      if (!leaving.length) return;
      const rank = lv => { const n = parseInt(String(lv).replace(/\D/g, ''), 10); return isNaN(n) ? 0 : n; };
      const remaining = humans.filter(m => m.state === E.STATES.ACTIVE || m.state === E.STATES.RAMPING);
      leaving.forEach(m => {
        if (!rank(m.level)) return;
        if (!remaining.some(x => rank(x.level) >= rank(m.level))) {
          warn.push(`${v.key}: ${m.name} (level ${m.level}) is ${m.state === E.STATES.ON_LEAVE ? 'on leave' : 'leaving'} and no one remaining is at that level or above.`);
        }
      });
    });

    return section('Seniority mix at ' + E.longDate(APP.date),
      'Losing two people is bad. Losing your only senior is a different and worse problem — a raw FTE count hides that completely.',
      rows.length ? pyr : UI.emptyBox('No levels recorded yet. Add a level to people on the Roster to unlock this.'),
      missing ? el('p', { class: 'small muted', style: { marginTop: '10px' } },
        `${missing} people have no level set and are grouped under "(no level)".`) : null,
      warn.length ? el('div', { style: { marginTop: '14px' } },
        warn.map(w => el('div', { class: 'find sev-high' }, el('p', {}, w)))) : null,
      el('div', { class: 'legend' },
        el('span', {}, el('i', { style: { background: 'var(--cp-accent)' } }), 'Effective capacity'),
        el('span', {}, el('i', { style: { background: 'var(--cp-warning)' } }), 'Occupied but on leave')));
  }

  return { render, addAccount, editAccount };
})();
