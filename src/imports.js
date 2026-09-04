/* ============================================================================
   Ultra Headcount Manager — generic CSV / Excel roster import.
   ========================================================================== */
const IMPORTS = (() => {
  'use strict';
  const { el, modal, toast, confirmDialog, APP } = UI;
  const E = ENGINE;

  const FIELD_DEFS = [
    ['name', 'Name', ['name', 'full name', 'employee', 'display name']],
    ['email', 'Email', ['email', 'mail', 'email address', 'user principal name', 'upn']],
    ['manager', 'Manager', ['manager', 'reports to', 'manager name']],
    ['jobTitle', 'Job title', ['job title', 'title', 'position']],
    ['family', 'Family / department', ['family', 'job family', 'department', 'business unit', 'team']],
    ['blueprintRole', 'Role', ['blueprint role', 'role', 'position role']],
    ['level', 'Level', ['level', 'career stage', 'grade', 'band']],
    ['track', 'Track', ['track', 'career track']],
    ['fte', 'FTE', ['fte', 'full time equivalent', 'allocation']],
    ['employmentType', 'Engagement', ['engagement', 'employment type', 'employee type', 'worker type']],
    ['location', 'Location', ['location', 'office', 'office location', 'country']],
    ['skills', 'Skills', ['skills', 'expertise', 'capabilities']],
    ['startDate', 'Start date', ['start date', 'hire date', 'joining date']],
    ['leaveStart', 'Leave start', ['leave start', 'leave start date']],
    ['leaveEnd', 'Leave end', ['leave end', 'return date', 'expected return']],
    ['leaveKind', 'Leave kind', ['leave kind', 'leave type']],
    ['gardenFrom', 'Garden leave from', ['garden leave from', 'garden leave start']],
    ['lastDate', 'Last working day', ['last working day', 'last date', 'leaving date', 'exit date']]
  ];

  const norm = value => String(value == null ? '' : value).trim().toLowerCase().replace(/[^a-z0-9]/g, '');

  function mapHeaders(headers) {
    const found = {};
    FIELD_DEFS.forEach(([key, , aliases]) => {
      found[key] = headers.findIndex(h => aliases.some(a => norm(h) === norm(a)));
    });
    return found;
  }

  function dateValue(value) {
    if (!value) return '';
    if (value instanceof Date && !isNaN(value)) return E.iso(value);
    const text = String(value).trim();
    if (E.valid(text.slice(0, 10))) return text.slice(0, 10);
    const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    const parsed = new Date(text);
    return isNaN(parsed) ? '' : E.iso(parsed);
  }

  function engagement(value) {
    const text = String(value || '').trim();
    if (!text) return 'Employee';
    const exact = E.EMPLOYMENT_TYPES.find(x => norm(x) === norm(text));
    if (exact) return exact;
    if (/student/i.test(text)) return 'Student worker';
    if (/intern/i.test(text)) return 'Intern';
    if (/apprentice|trainee/i.test(text)) return 'Apprentice';
    if (/vendor/i.test(text)) return 'Vendor';
    if (/contract|external|consultant/i.test(text)) return 'Contractor';
    if (/loan|second/i.test(text)) return 'Loaned in';
    return 'Employee';
  }

  function rowsToPeople(rows) {
    if (!rows || rows.length < 2) throw new Error('The file must contain a header row and at least one person.');
    const headers = rows[0].map(x => String(x == null ? '' : x).trim());
    const map = mapHeaders(headers);
    if (map.name < 0) throw new Error('No Name or Display name column was found.');
    const people = [];
    const skipped = [];

    rows.slice(1).forEach((row, rowIndex) => {
      const get = key => map[key] >= 0 ? row[map[key]] : '';
      const name = String(get('name') || '').trim();
      if (!name) { skipped.push(rowIndex + 2); return; }
      const role = String(get('blueprintRole') || get('jobTitle') || '').trim();
      const family = String(get('family') || '').trim();
      const fteRaw = String(get('fte') || '1').replace(',', '.');
      const p = E.normalisePerson({
        name,
        email: String(get('email') || '').trim(),
        manager: String(get('manager') || '').trim(),
        jobTitle: String(get('jobTitle') || '').trim(),
        family,
        blueprintRole: role || 'Unassigned role',
        level: String(get('level') || '').trim(),
        track: String(get('track') || '').trim(),
        fte: Math.max(0, parseFloat(fteRaw) || 1),
        employmentType: engagement(get('employmentType')),
        location: String(get('location') || '').trim(),
        skills: String(get('skills') || '').split(/[;,|]/).map(x => x.trim()).filter(Boolean),
        events: []
      });

      const start = dateValue(get('startDate'));
      const leaveStart = dateValue(get('leaveStart'));
      const leaveEnd = dateValue(get('leaveEnd'));
      const lastDate = dateValue(get('lastDate'));
      const gardenFrom = dateValue(get('gardenFrom'));
      if (start) p.events.push({ id: E.uid('ev'), type: 'hire', date: start });
      if (leaveStart) p.events.push({
        id: E.uid('ev'), type: 'leave', date: leaveStart, endDate: leaveEnd,
        kind: String(get('leaveKind') || 'Other').trim()
      });
      if (lastDate) p.events.push({ id: E.uid('ev'), type: 'exit', date: lastDate, gardenFrom });
      people.push(p);
    });

    return {
      people,
      skipped,
      headers,
      matched: FIELD_DEFS.filter(([key]) => map[key] >= 0).map(([key, label]) => ({ key, label, source: headers[map[key]] }))
    };
  }

  async function readWorkbook(file) {
    if (!file) throw new Error('No file selected.');
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
      return UI.parseDelimited(await file.text());
    }
    if (ext !== 'xlsx' && ext !== 'xls') throw new Error('Choose a CSV, TSV, XLS or XLSX file.');
    if (!window.XLSX) throw new Error('The Excel reader did not load.');
    const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    if (!book.SheetNames.length) throw new Error('The workbook has no worksheets.');
    return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: '', raw: false });
  }

  function replaceBlueprintFromPeople(state) {
    const counts = new Map();
    state.people.filter(E.countsHeadcount).forEach(p => {
      const family = p.family || '';
      const role = p.blueprintRole && p.blueprintRole !== 'N/A' ? p.blueprintRole : (p.jobTitle || 'Unassigned role');
      const key = E.roleKey(family, role);
      counts.set(key, (counts.get(key) || 0) + (+p.fte || 1));
    });
    state.blueprint = [];
    counts.forEach((fte, key) => {
      const parts = E.splitKey(key);
      state.blueprint.push(E.normaliseSeatRow({
        family: parts.family, role: parts.role, seats: Math.ceil(fte), note: 'Derived from imported roster'
      }));
    });
  }

  function mergePeople(state, incoming, mode) {
    if (mode === 'replace') {
      state.people = incoming.map(E.normalisePerson);
      return { added: incoming.length, updated: 0 };
    }
    let added = 0, updated = 0;
    incoming.forEach(next => {
      const email = String(next.email || '').toLowerCase();
      let current = next.directoryId
        ? state.people.find(p => p.directoryId === next.directoryId)
        : null;
      if (!current) current = email ? state.people.find(p => String(p.email || '').toLowerCase() === email) : null;
      if (!current) current = state.people.find(p => p.name.toLowerCase() === next.name.toLowerCase());
      if (!current) { state.people.push(E.normalisePerson(next)); added++; return; }
      const keep = {
        id: current.id, events: current.events, accounts: current.accounts,
        notes: current.notes, annualCost: current.annualCost
      };
      Object.assign(current, next, keep);
      updated++;
    });
    return { added, updated };
  }

  function commit(result, mode, deriveBlueprint) {
    let summary;
    APP.ready = true;
    APP.mutate(`${mode === 'replace' ? 'Replaced' : 'Merged'} roster from file`, state => {
      summary = mergePeople(state, result.people, mode);
      if (deriveBlueprint) replaceBlueprintFromPeople(state);
    }, { backup: true });
    toast(`Imported ${summary.added} new and ${summary.updated} updated people`, 'ok');
    return summary;
  }

  function preview(result, filename) {
    const mode = el('select', {},
      el('option', { value: 'merge' }, 'Merge with my current roster'),
      el('option', { value: 'replace' }, 'Replace my current roster'));
    const derive = el('input', { type: 'checkbox', checked: !APP.state.blueprint.length });
    const sample = result.people.slice(0, 5);

    modal('Review roster import', el('div', {},
      el('p', { class: 'sub' }, `${filename} contains ${result.people.length} people. ${result.skipped.length ? `${result.skipped.length} blank-name rows will be skipped.` : ''}`),
      el('div', { class: 'import-matches' }, result.matched.map(m =>
        el('span', { class: 'pill p-low' }, `${m.source} → ${m.label}`))),
      UI.table([
        { label: 'Name', key: 'name' },
        { label: 'Email', key: 'email' },
        { label: 'Manager', key: 'manager' },
        { label: 'Family', key: 'family' },
        { label: 'Role', key: 'blueprintRole' },
        { label: 'FTE', key: 'fte', num: true }
      ], sample),
      el('label', { class: 'field', style: { marginTop: '12px' } }, 'Import behavior', mode),
      el('label', { class: 'checkline' }, derive, ' Build the initial seat blueprint from this roster'),
      el('p', { class: 'tiny muted' }, 'Merge keeps existing planning events, notes and assignments for matched people. Replace starts a new roster.'),
      el('div', { class: 'row', style: { marginTop: '14px' } },
        el('button', {
          class: 'btn primary', onclick: () => {
            const action = () => {
              commit(result, mode.value, derive.checked);
              UI.closeModal();
              APP.go('people');
            };
            if (mode.value === 'replace' && APP.state.people.length) {
              confirmDialog('Replace the roster?', 'This removes every current person and their planning events. Snapshots remain available.', action, 'Replace roster');
            } else action();
          }
        }, 'Import people'),
        el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'))), { size: 'wide' });
  }

  function openRosterImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try { preview(rowsToPeople(await readWorkbook(file)), file.name); }
      catch (error) { toast(`Could not import ${file.name}: ${error.message}`, 'err'); }
    };
    input.click();
  }

  return { FIELD_DEFS, mapHeaders, rowsToPeople, readWorkbook, mergePeople, replaceBlueprintFromPeople, openRosterImport };
})();

if (typeof module !== 'undefined') module.exports = IMPORTS;
