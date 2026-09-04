/* ============================================================================
   CUHM 2.0 — Data: quality panel, snapshots & diff, change journal,
   import/export, settings, and the board pack.
   ========================================================================== */
const VIEW_DATA = (() => {
  'use strict';
  const { el, esc, nf, sgn, section, table, modal, toast, confirmDialog, APP } = UI;
  const E = ENGINE;

  function render() {
    const wrap = el('div', {});
    wrap.appendChild(qualityCard());
    wrap.appendChild(snapshotCard());
    wrap.appendChild(journalCard());
    wrap.appendChild(ioCard());
    wrap.appendChild(settingsCard());
    return wrap;
  }

  /* ---------- data quality --------------------------------------------------- */
  function qualityCard() {
    const issues = E.dataQuality(APP.state);
    const bySev = { high: [], medium: [], low: [] };
    issues.forEach(i => bySev[i.severity].push(i));
    const grouped = new Map();
    issues.forEach(i => {
      if (!grouped.has(i.message)) grouped.set(i.message, { message: i.message, severity: i.severity, fix: i.fix, people: [] });
      grouped.get(i.message).people.push(i);
    });
    const rows = [...grouped.values()];

    return section('Data quality',
      'A model is only as trustworthy as its worst record. Fix the high-severity items before you present any of these numbers.',
      el('div', { class: 'grid g3', style: { marginBottom: '14px' } },
        UI.kpi('High', String(bySev.high.length), 'Distorts the numbers', bySev.high.length ? 'red' : 'green'),
        UI.kpi('Medium', String(bySev.medium.length), 'Weakens the analysis', bySev.medium.length ? 'amber' : 'green'),
        UI.kpi('Low', String(bySev.low.length), 'Nice to have', 'blue')),
      rows.length ? table([
        {
          label: 'Severity', render: r => el('span', { class: `pill p-${r.severity}` },
            r.severity === 'high' ? 'High' : r.severity === 'medium' ? 'Medium' : 'Low')
        },
        { label: 'Issue', render: r => el('b', {}, r.message) },
        { label: 'Count', num: true, render: r => r.people.length },
        {
          label: 'Who', render: r => el('span', { class: 'tiny muted' },
            r.people.slice(0, 6).map(p => p.person).join(', ') + (r.people.length > 6 ? ` +${r.people.length - 6} more` : ''))
        },
        {
          label: '', render: r => el('button', {
            class: 'btn sm', onclick: e => { e.stopPropagation(); listIssue(r); }
          }, 'Fix')
        }
      ], rows) : UI.emptyBox('No data quality issues. That is rarer than you think — well done.'));
  }

  function listIssue(r) {
    modal(r.message, el('div', {},
      el('p', { class: 'sub' }, `${r.people.length} affected. Click a name to open and fix it.`),
      el('div', {}, r.people.map(p => el('div', {
        class: 'row', style: { padding: '6px 0', borderBottom: '1px solid var(--cp-border)', cursor: 'pointer' },
        onclick: () => { UI.closeModal(); if (p.id && APP.personById(p.id)) VIEW_PEOPLE.openPerson(p.id); else APP.go('pipeline'); }
      }, el('b', {}, p.person), el('span', { class: 'right tiny muted' }, 'Open →'))))), { size: 'wide' });
  }

  /* ---------- snapshots ------------------------------------------------------ */
  function snapshotCard() {
    const snaps = APP.state.snapshots || [];
    return section('Snapshots and diff',
      'Freeze the plan as it stands, then diff against it later. This is what makes your numbers defensible in a review rather than merely current.',
      el('div', { class: 'row', style: { marginBottom: '10px' } },
        el('button', { class: 'btn primary', onclick: takeSnapshot }, '📸 Take snapshot')),
      snaps.length ? table([
        { label: 'Name', render: s => el('b', {}, s.name) },
        { label: 'Taken', render: s => E.longDate(s.takenAt.slice(0, 10)) },
        { label: 'People', num: true, render: s => (s.data.people || []).length },
        { label: 'Seats', num: true, render: s => (s.data.blueprint || []).reduce((a, b) => a + (+b.seats || 0), 0) },
        { label: '', render: s => el('div', { class: 'row' },
          el('button', { class: 'btn sm', onclick: e => { e.stopPropagation(); showDiff(s); } }, 'Diff vs now'),
          el('button', { class: 'btn sm', onclick: e => { e.stopPropagation(); restore(s); } }, 'Restore'),
          el('button', { class: 'btn sm danger', onclick: e => {
            e.stopPropagation();
            confirmDialog('Delete snapshot', `Delete "${s.name}"?`, () => APP.mutate('Delete snapshot', st => {
              st.snapshots = st.snapshots.filter(x => x.id !== s.id);
            }));
          } }, '✕')) }
      ], snaps.slice().reverse())
        : UI.emptyBox('No snapshots yet. Take one now so you have a baseline to compare against.', '📸 Take snapshot', takeSnapshot));
  }

  function takeSnapshot() {
    const input = el('input', { type: 'text', value: `Plan as at ${E.longDate(E.today())}`, style: { width: '100%' } });
    modal('Take snapshot', el('div', {},
      el('p', { class: 'sub' }, 'Stores a full copy of the model inside your data file. Snapshots are never modified by later edits.'),
      input,
      el('div', { class: 'row', style: { marginTop: '14px' } },
        el('button', {
          class: 'btn primary', onclick: () => {
            APP.mutate('Take snapshot', st => {
              const copy = JSON.parse(JSON.stringify(st));
              delete copy.snapshots; delete copy.journal;
              st.snapshots = st.snapshots || [];
              st.snapshots.push({ id: E.uid('snap'), name: input.value.trim() || 'Snapshot', takenAt: new Date().toISOString(), data: copy });
            });
            UI.closeModal(); toast('Snapshot taken', 'ok');
          }
        }, 'Take snapshot'),
        el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'))), { size: 'narrow' });
  }

  function showDiff(s) {
    const d = E.diffStates(s.data, APP.state);
    const kinds = { added: 'Added', removed: 'Removed', changed: 'Changed', blueprint: 'Blueprint' };
    modal(`Changes since "${s.name}"`, el('div', {},
      el('p', { class: 'sub' }, `${d.length} change${d.length === 1 ? '' : 's'} since ${E.longDate(s.takenAt.slice(0, 10))}.`),
      d.length ? table([
        { label: 'Type', render: r => el('span', { class: `pill p-${r.kind === 'removed' ? 'high' : r.kind === 'added' ? 'active' : 'low'}` }, kinds[r.kind]) },
        { label: 'Who / what', render: r => el('b', {}, r.name) },
        { label: 'Change', render: r => el('span', { class: 'small' }, r.detail) }
      ], d) : UI.emptyBox('Nothing has changed since this snapshot.'),
      el('div', { class: 'row', style: { marginTop: '14px' } },
        el('button', {
          class: 'btn', onclick: () => {
            STORE.download(`UHM_diff_${s.name.replace(/\W+/g, '_')}.csv`,
              UI.toCSV(d, [{ label: 'Type', value: r => kinds[r.kind] }, { label: 'Who', value: r => r.name }, { label: 'Change', value: r => r.detail }]), 'text/csv');
          }
        }, '⭳ Export CSV'))), { size: 'wide' });
  }

  function restore(s) {
    confirmDialog('Restore snapshot', `Replace the current model with "${s.name}"? Your current state stays in the undo stack.`, () => {
      APP.mutate(`Restore snapshot "${s.name}"`, st => {
        const keepSnaps = st.snapshots, keepJournal = st.journal;
        Object.keys(st).forEach(k => { if (k !== 'snapshots' && k !== 'journal') delete st[k]; });
        Object.assign(st, JSON.parse(JSON.stringify(s.data)));
        st.snapshots = keepSnaps; st.journal = keepJournal;
      });
      toast('Snapshot restored', 'ok');
    });
  }

  /* ---------- journal --------------------------------------------------------- */
  function journalCard() {
    const j = (APP.state.journal || []).slice();
    return section(`Change journal · ${j.length}`,
      'Every edit, newest first, so you can always explain how a number moved.',
      j.length ? table([
        { label: 'When', render: r => new Date(r.ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) },
        { label: 'Change', render: r => el('b', {}, r.action) }
      ], j.slice(0, 200)) : UI.emptyBox('No changes recorded yet.'),
      j.length > 200 ? el('p', { class: 'tiny muted' }, `Showing the 200 most recent of ${j.length}.`) : null,
      j.length ? el('div', { class: 'row', style: { marginTop: '10px' } },
        el('button', {
          class: 'btn sm', onclick: () => confirmDialog('Clear journal', 'Remove all journal entries? This does not change any data.',
            () => APP.mutate('Clear journal', st => { st.journal = []; }))
        }, 'Clear journal')) : null);
  }

  /* ---------- import / export -------------------------------------------------- */
  function ioCard() {
    return section('Import, export and reporting',
      'Everything lives in one plain JSON file you can read, diff and back up outside this app.',
      el('div', { class: 'row' },
        el('button', { class: 'btn primary big', onclick: boardPack }, '📄 Build board pack'),
        el('button', {
          class: 'btn', onclick: () => STORE.download(`UHM_backup_${E.today()}.json`, JSON.stringify(APP.state, null, 2), 'application/json')
        }, '⭳ Export JSON backup'),
        el('button', { class: 'btn', onclick: importJson }, 'Import JSON'),
        el('button', { class: 'btn', onclick: IMPORTS.openRosterImport }, 'Import roster CSV / Excel'),
        el('button', { class: 'btn', onclick: DIRECTORY_SYNC.open }, 'Sync Microsoft 365 org'),
        el('button', { class: 'btn', onclick: exportRosterCsv }, '⭳ Export roster CSV'),
        el('button', { class: 'btn', onclick: exportRibbonCsv }, '⭳ Export capacity ribbon CSV')),
      el('p', { class: 'small muted', style: { marginTop: '10px' } },
        'Importing replaces the whole model. Take a snapshot first if you want a way back.'));
  }

  function importJson() {
    STORE.uploadJson().then(raw => {
      const next = E.migrate(raw);
      confirmDialog('Import data', `Replace the current model with ${next.people.length} people from this file?`, () => {
        APP.mutate('Import JSON', st => {
          Object.keys(st).forEach(k => delete st[k]);
          Object.assign(st, next);
        });
        toast(`Imported ${next.people.length} people`, 'ok');
      });
    }).catch(err => toast('Could not read that file: ' + err.message, 'err'));
  }

  function exportRosterCsv() {
    const ev = APP.ev();
    STORE.download(`UHM_roster_${APP.date}.csv`, UI.toCSV(ev.perPerson, [
      { label: 'Name', value: r => r.name },
      { label: 'Job title', value: r => r.person.jobTitle || '' },
      { label: 'Manager', value: r => r.manager || '' },
      { label: 'Family', value: r => r.family || '' },
      { label: 'Blueprint role', value: r => r.role || '' },
      { label: 'Level', value: r => r.level || '' },
      { label: 'Location', value: r => r.person.location || '' },
      { label: `State at ${APP.date}`, value: r => r.state },
      { label: 'On-roll FTE', value: r => r.onRoll },
      { label: 'Effective FTE', value: r => r.effective },
      { label: 'Reason', value: r => r.reason || '' }
    ]), 'text/csv');
  }

  function exportRibbonCsv() {
    const rb = E.ribbon(APP.state, APP.scenario, APP.fy);
    const cols = [{ label: 'Role', value: r => r.key }, { label: 'Seats', value: r => r.cells[0].seats }];
    rb.cols.forEach((c, i) => cols.push({ label: c.label, value: r => r.cells[i].effective }));
    STORE.download(`UHM_ribbon_FY${APP.fy}.csv`, UI.toCSV(rb.rows, cols), 'text/csv');
  }

  /* ---------- settings ---------------------------------------------------------- */
  function settingsCard() {
    const s = APP.state.settings;
    const num = (label, key, min, max, step, note) => el('label', { class: 'field' }, label,
      el('input', {
        type: 'number', min, max, step, value: s[key],
        onchange: e => APP.setSetting(key, parseFloat(e.target.value))
      }),
      note ? el('span', { class: 'tiny muted' }, note) : null);
    const check = (label, key, note, invert) => el('label', { class: 'chk' },
      el('input', {
        type: 'checkbox', checked: invert ? s[key] === false : !!s[key],
        onchange: e => APP.setSetting(key, invert ? !e.target.checked : e.target.checked)
      }),
      el('span', {}, el('b', {}, label), note ? el('span', { class: 'tiny muted' }, note) : null));

    return section('Settings',
      'The assumptions behind every number in this app.',
      el('div', { class: 'grid g3' },
        el('label', { class: 'field' }, 'Fiscal year',
          el('select', { onchange: e => APP.setSetting('fy', parseInt(e.target.value, 10)) },
            [25, 26, 27, 28, 29].map(f => el('option', { value: f, selected: s.fy === f }, `FY${f} (Jul ${1999 + f} – Jun ${2000 + f})`)))),
        num('Assumed annual attrition %', 'attritionRate', 0, 40, 1, 'Used by the stress test'),
        num('Time to hire (months)', 'timeToHire', 0, 18, 0.5, 'Default lag when you create a backfill'),
        num('Minimum span of control', 'spanMin', 1, 20, 1),
        num('Maximum span of control', 'spanMax', 1, 30, 1),
        el('label', { class: 'field' }, 'Ramp curve (comma separated FTE by month)',
          el('input', {
            value: (s.rampProfile || E.DEFAULT_RAMP).join(', '),
            onchange: e => {
              const v = e.target.value.split(',').map(x => parseFloat(x.trim())).filter(x => !isNaN(x));
              APP.setSetting('rampProfile', v.length ? v : E.DEFAULT_RAMP);
            }
          }),
          el('span', { class: 'tiny muted' }, 'A new hire is not 1.0 FTE on day one'))),
      el('div', { class: 'grid g2', style: { marginTop: '14px' } },
        check('Apply ramp curves to new hires', 'applyRamp', ' — off means hires count fully from day one', true),
        check('Include the hiring pipeline in capacity', 'includePipeline', ' — off simulates a hiring freeze', true),
        check('Weight requisitions by hiring-stage probability', 'probabilityWeighting', ' — a screening req counts less than an offer accepted'),
        check('Backfill leave', 'leaveBackfills', ' — treat people on leave as covered by temporary cover')));
  }

  /* ---------- board pack ---------------------------------------------------------- */
  /** Self-contained HTML briefing in Control Tower styling, with the narrative
      sentences already written. Prints cleanly to PDF. */
  function boardPack() {
    const st = APP.state;
    const date = APP.date;
    const ev = APP.ev();
    const t = ev.totals;
    const rb = E.ribbon(st, APP.scenario, APP.fy);
    const wf = E.waterfall(st, date, APP.scenario);
    const risks = E.riskRadar(st, APP.scenario, APP.fy);
    const bus = E.busFactor(st, date, APP.scenario);
    const worst = rb.totalsRow.reduce((a, b) => b.gapEffective < a.gapEffective ? b : a);

    const unavailable = ev.perPerson.filter(r =>
      r.state === E.STATES.ON_LEAVE || r.state === E.STATES.ON_NOTICE || r.state === E.STATES.GARDEN ||
      r.state === E.STATES.RAMPING || r.state === E.STATES.DEPARTED);

    const row = (l, v, c) => `<tr><td>${esc(l)}</td><td class="num" style="color:${c || 'inherit'}"><b>${esc(v)}</b></td></tr>`;
    const bar = (label, value, max, colour) =>
      `<div class="brow"><span class="bl">${esc(label)}</span><span class="bt"><i style="width:${Math.max((value / Math.max(max, 1)) * 100, 0)}%;background:${colour}"></i></span><span class="bv">${nf(value)}</span></div>`;

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<script>(()=>{const param=new URLSearchParams(window.location.search).get("scoutTheme");const theme=param||(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",theme)})();<\/script>
<title>Headcount board pack — ${esc(E.longDate(date))}</title>
<style>
:root{color-scheme:light;--cp-bg:#f7f4ef;--cp-bg-elevated:#fcfbf8;--cp-surface:#ffffff;--cp-surface-soft:#f5f5f5;--cp-border:#dedede;--cp-border-strong:#919191;--cp-text:#242424;--cp-text-muted:#5c5c5c;--cp-text-soft:#6f6f6f;--cp-accent:#b11f4b;--cp-accent-hover:#9a1a41;--cp-accent-soft:rgba(177,31,75,.08);--cp-accent-fg:#ffffff;--cp-success:#16a34a;--cp-danger:#dc2626;--cp-warning:#f59e0b;--cp-link:#0078d4;--cp-shadow:0 18px 48px rgba(0,0,0,.12);--cp-overlay:rgba(255,255,255,.8);--cp-panel:rgba(255,255,255,.86);--cp-panel-strong:rgba(255,255,255,.96);--cp-sheen:rgba(255,255,255,.55);--cp-highlight:rgba(177,31,75,.12)}
html[data-theme="dark"]{color-scheme:dark;--cp-bg:#3d3b3a;--cp-bg-elevated:#343231;--cp-surface:#292929;--cp-surface-soft:#2e2e2e;--cp-border:#474747;--cp-border-strong:#5f5f5f;--cp-text:#dedede;--cp-text-muted:#919191;--cp-text-soft:#b0b0b0;--cp-accent:#fd8ea1;--cp-accent-hover:#fb7b91;--cp-accent-soft:rgba(253,142,161,.14);--cp-accent-fg:#1a1a1a;--cp-success:#4ade80;--cp-danger:#f87171;--cp-warning:#fbbf24;--cp-link:#4da6ff;--cp-shadow:0 18px 48px rgba(0,0,0,.32);--cp-overlay:rgba(41,41,41,.88);--cp-panel:rgba(41,41,41,.72);--cp-panel-strong:rgba(41,41,41,.96);--cp-sheen:rgba(255,255,255,.04);--cp-highlight:rgba(253,142,161,.12)}
*{box-sizing:border-box}
body{margin:0;background:var(--cp-bg);color:var(--cp-text);font:15px/1.55 "Segoe UI",Aptos,Calibri,-apple-system,BlinkMacSystemFont,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:26px 20px 60px}
.hero{background:var(--cp-accent);color:var(--cp-accent-fg);border-radius:16px;padding:26px 28px;margin-bottom:20px}
.hero h1{margin:0 0 6px;font-size:26px;letter-spacing:-.4px}
.hero p{margin:0;opacity:.9;font-size:14px}
.card{background:var(--cp-surface);border:1px solid var(--cp-border);border-radius:16px;padding:20px 22px;margin-bottom:16px}
.card h2{margin:0 0 4px;font-size:17px}
.card .sub{margin:0 0 14px;color:var(--cp-text-muted);font-size:13px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
.kpi{background:var(--cp-surface);border:1px solid var(--cp-border);border-radius:16px;padding:15px 16px}
.kpi .l{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--cp-text-muted)}
.kpi .v{font-size:28px;font-weight:700;letter-spacing:-1px;margin:3px 0}
.kpi .n{font-size:12px;color:var(--cp-text-muted)}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--cp-border)}
th{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--cp-text-muted)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.band{display:flex;height:34px;border-radius:10px;overflow:hidden;margin:10px 0 6px;font-size:12px;font-weight:600;color:var(--cp-accent-fg)}
.band .a{background:var(--cp-accent);display:flex;align-items:center;justify-content:center}
.band .b{background:var(--cp-warning);display:flex;align-items:center;justify-content:center}
.brow{display:flex;align-items:center;gap:10px;margin:5px 0;font-size:13px}
.bl{width:230px;flex:none;color:var(--cp-text)}
.bt{flex:1;height:12px;background:var(--cp-surface-soft);border-radius:6px;overflow:hidden}
.bt i{display:block;height:100%}
.bv{width:52px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.find{border-left:4px solid var(--cp-danger);background:var(--cp-surface-soft);border-radius:0 10px 10px 0;padding:11px 14px;margin:9px 0}
.find.m{border-color:var(--cp-warning)}
.find h4{margin:0 0 3px;font-size:14px}
.find p{margin:0;font-size:13px;color:var(--cp-text)}
.narr{background:var(--cp-accent-soft);border:1px solid var(--cp-accent);border-radius:10px;padding:14px 16px;font-size:14.5px;line-height:1.65}
.foot{text-align:center;color:var(--cp-text-muted);font-size:12px;margin-top:24px}
@media print{body{background:var(--cp-surface)}.card,.kpi{box-shadow:none;break-inside:avoid}.hero{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="wrap">

<div class="hero">
  <h1>Organization headcount position</h1>
  <p>Position at <b>${esc(E.longDate(date))}</b> · FY${APP.fy} blueprint · scenario ${esc(APP.scenario)} · generated ${esc(E.longDate(E.today()))}</p>
</div>

<div class="kpis">
  <div class="kpi"><div class="l">Blueprint seats</div><div class="v">${t.seats}</div><div class="n">Approved establishment</div></div>
  <div class="kpi"><div class="l">On-roll</div><div class="v">${nf(t.onRoll)}</div><div class="n">${sgn(t.gapOnRoll)} vs blueprint</div></div>
  <div class="kpi"><div class="l">Effective capacity</div><div class="v" style="color:${t.gapEffective < 0 ? 'var(--cp-danger)' : 'var(--cp-success)'}">${nf(t.effective)}</div><div class="n">${sgn(t.gapEffective)} vs blueprint</div></div>
  <div class="kpi"><div class="l">Lost to leave</div><div class="v" style="color:var(--cp-warning)">${nf(t.leaveDrag)}</div><div class="n">${t.onLeave} people on leave</div></div>
</div>

<div class="card">
  <h2>The headline</h2>
  <p class="sub">Written from the model, not by hand.</p>
  <div class="narr">
    At <b>${esc(E.longDate(date))}</b> we hold <b>${nf(t.onRoll)}</b> people on roll against <b>${t.seats}</b> blueprint seats,
    but only <b>${nf(t.effective)}</b> of that is real delivery capacity — a shortfall of <b>${nf(Math.abs(t.gapEffective))} FTE</b>.
    The difference is <b>${nf(t.leaveDrag)} FTE</b> sitting in seats we cannot deploy:
    ${t.onLeave} on leave${t.onNotice ? `, plus ${t.onNotice} working notice` : ''}${t.ramping ? `, and ${t.ramping} still ramping` : ''}.
    Across FY${APP.fy} the deepest point is <b>${esc(worst.label)}</b> at <b>${nf(worst.effective)} FTE</b> against ${worst.seats} seats
    (${sgn(worst.gapEffective)}).
  </div>
  <div class="band">
    <div class="a" style="flex:${Math.max(t.effective, 0.01)}">Effective ${nf(t.effective)}</div>
    ${t.leaveDrag > 0 ? `<div class="b" style="flex:${t.leaveDrag}">Lost to leave ${nf(t.leaveDrag)}</div>` : ''}
  </div>
</div>

<div class="card">
  <h2>How we got here</h2>
  <p class="sub">From the start of FY${APP.fy} to ${esc(E.longDate(date))}.</p>
  <table><tbody>
    ${wf.steps.map(s => {
      const plain = s.kind === 'base' || s.kind === 'subtotal' || s.kind === 'total' || s.kind === 'gap';
      const colour = s.kind === 'gap' ? (s.value < 0 ? 'var(--cp-danger)' : 'var(--cp-success)')
        : plain ? 'var(--cp-text)' : s.value < 0 ? 'var(--cp-danger)' : s.value > 0 ? 'var(--cp-success)' : 'var(--cp-text-muted)';
      return row(s.label, plain && s.kind !== 'gap' ? nf(s.value) : s.kind === 'gap' ? sgn(s.value) : sgn(s.value), colour);
    }).join('')}
  </tbody></table>
</div>

<div class="card">
  <h2>Capacity across FY${APP.fy}</h2>
  <p class="sub">Effective FTE at the end of each month against ${t.seats} blueprint seats.</p>
  ${rb.totalsRow.map(m => bar(m.label, m.effective, Math.max(t.seats, ...rb.totalsRow.map(x => x.effective)),
    m.gapEffective < -1.5 ? 'var(--cp-danger)' : m.gapEffective < -0.001 ? 'var(--cp-warning)' : 'var(--cp-success)')).join('')}
</div>

${risks.length ? `<div class="card">
  <h2>Risk radar</h2>
  <p class="sub">Automatically detected — ordered by severity.</p>
  ${risks.slice(0, 10).map(r => `<div class="find ${r.severity >= 1.5 ? '' : 'm'}"><h4>${esc(r.headline)}</h4><p>${esc(r.detail)}</p></div>`).join('')}
</div>` : ''}

${bus.length ? `<div class="card">
  <h2>Single points of failure</h2>
  <p class="sub">Covered by exactly one person today.</p>
  <table><thead><tr><th>What</th><th>Type</th><th>Sole cover</th><th>Why it matters</th></tr></thead><tbody>
  ${bus.slice(0, 12).map(b => `<tr><td><b>${esc(b.label)}</b></td><td>${esc(b.kind)}</td><td>${esc(b.holder)}</td><td>${esc(b.note)}</td></tr>`).join('')}
  </tbody></table>
</div>` : ''}

<div class="card">
  <h2>Who is not fully available at ${esc(E.longDate(date))}</h2>
  <table><thead><tr><th>Name</th><th>Role</th><th>State</th><th class="num">On-roll</th><th class="num">Effective</th><th>Why</th></tr></thead><tbody>
  ${unavailable.map(r => `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.role || '—')}</td><td>${esc(r.state)}</td><td class="num">${nf(r.onRoll)}</td><td class="num">${nf(r.effective)}</td><td>${esc(r.reason || '')}</td></tr>`).join('')}
  </tbody></table>
</div>

<div class="card">
  <h2>Decisions required</h2>
  <ul>
    ${t.gapEffective < 0 ? `<li>Close a <b>${nf(Math.abs(t.gapEffective))} FTE</b> effective shortfall — approve backfills or accept reduced coverage.</li>` : ''}
    ${worst.gapEffective < t.gapEffective ? `<li>Plan now for <b>${esc(worst.label)}</b>, where the shortfall deepens to <b>${nf(Math.abs(worst.gapEffective))} FTE</b>.</li>` : ''}
    ${bus.length ? `<li>Address <b>${bus.length}</b> single point${bus.length === 1 ? '' : 's'} of failure.</li>` : ''}
    ${t.onNotice ? `<li>Confirm transition plans for <b>${t.onNotice}</b> person${t.onNotice === 1 ? '' : 's'} working notice.</li>` : ''}
    <li>Confirm the FY${APP.fy} blueprint of <b>${t.seats}</b> seats remains the agreed establishment.</li>
  </ul>
</div>

<div class="foot">Ultra Headcount Manager · generated ${new Date().toLocaleString('en-GB')} · figures computed from the live model</div>
</div></body></html>`;

    STORE.download(`Headcount_board_pack_${date}.html`, html, 'text/html');
    toast('Board pack downloaded — open it and print to PDF', 'ok');
  }

  return { render, boardPack, takeSnapshot };
})();
