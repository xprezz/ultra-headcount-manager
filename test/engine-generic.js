/* Public engine regression suite — entirely synthetic organization data. */
const E = require('../src/engine.js');

let pass = 0, fail = 0;
const ok = (name, value, detail = '') => {
  if (value) { pass++; console.log(` ok   ${name}${detail ? `  ${detail}` : ''}`); }
  else { fail++; console.log(` FAIL ${name}  ->  ${detail}`); }
};
const eq = (name, actual, expected) => {
  const same = actual === expected;
  ok(name, same, same ? '' : `${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
};

const state = E.emptyState();
state.settings.fy = 27;
state.blueprint = [
  E.normaliseSeatRow({ family: 'Operations', role: 'Operations Manager', seats: 1 }),
  E.normaliseSeatRow({ family: 'Operations', role: 'Operations Analyst', seats: 3 }),
  E.normaliseSeatRow({ family: 'Engineering', role: 'Software Engineer', seats: 2 })
];
state.people = [
  E.normalisePerson({ name: 'Morgan Manager', family: 'Operations', blueprintRole: 'Operations Manager', jobTitle: 'Manager', events: [] }),
  E.normalisePerson({ name: 'Alex Analyst', manager: 'Morgan Manager', family: 'Operations', blueprintRole: 'Operations Analyst', events: [] }),
  E.normalisePerson({
    name: 'Riley Returning', manager: 'Morgan Manager', family: 'Operations', blueprintRole: 'Operations Analyst',
    events: [{ id: 'leave-1', type: 'leave', date: '2026-09-01', endDate: '2026-11-01', kind: 'Parental' }]
  }),
  E.normalisePerson({
    name: 'Taylor Transition', manager: 'Morgan Manager', family: 'Operations', blueprintRole: 'Operations Analyst',
    events: [{ id: 'exit-1', type: 'exit', noticeFrom: '2026-09-01', gardenFrom: '2026-10-01', date: '2026-10-31' }]
  }),
  E.normalisePerson({
    name: 'Sam Student', manager: 'Morgan Manager', family: 'Operations', blueprintRole: 'Operations Analyst',
    employmentType: 'Student worker', fte: 0.5, events: []
  }),
  E.normalisePerson({ name: 'Casey Coder', family: 'Engineering', blueprintRole: 'Software Engineer', events: [] })
];

eq('blank app is organization-neutral', E.emptyState().app, 'Ultra Headcount Manager');
eq('no role aliases are built in', Object.keys(E.ROLE_ALIASES).length, 0);
eq('an explicit role is preserved', E.roleFor('Any Family', 'Any Role'), 'Any Role');
eq('a missing role remains visible', E.roleFor('Any Family', ''), '');
eq('student workers do not consume seats', E.countsHeadcount(state.people[4]), false);

const beforeGarden = E.evaluatePerson(state.people[2], '2026-09-30', {});
eq('leave has zero capacity', beforeGarden.effective, 0);
eq('leave still holds the seat', beforeGarden.onRoll, 1);
const garden = E.evaluatePerson(state.people[3], '2026-10-15', {});
eq('garden leave is its own state', garden.state, E.STATES.GARDEN);
eq('garden leave has zero capacity', garden.effective, 0);
eq('garden leave still holds the seat', garden.onRoll, 1);
eq('departure starts after the last working day', E.evaluatePerson(state.people[3], '2026-11-01', {}).state, E.STATES.DEPARTED);

const oct = E.evaluate(state, '2026-10-15', 'Baseline');
eq('synthetic establishment totals six seats', oct.totals.seats, 6);
eq('five employee FTE are on roll', oct.totals.onRoll, 5);
eq('three employee FTE are deployable', oct.totals.effective, 3);
eq('one person is on leave', oct.totals.onLeave, 1);
eq('one person is on garden leave', oct.totals.onGarden, 1);
eq('supplementary capacity is separate', oct.totals.supplementary, 0.5);
eq('effective blueprint gap is three FTE', oct.totals.gapEffective, -3);

const flow = E.capacityFlow(state, '2026-10-15', 'Baseline');
const fromSeats = flow.links.filter(link => link.from === 'seats').reduce((sum, link) => sum + link.value, 0);
eq('Sankey balances exactly', fromSeats, flow.totals.seats);
ok('Sankey includes garden leave', flow.links.some(link => link.to === 'garden'));
ok('Sankey includes supplementary capacity', flow.links.some(link => link.from === 'supp'));

const opsOnly = record => record.family === 'Operations';
const scoped = E.evaluate(state, '2026-10-15', 'Baseline', { filter: opsOnly });
eq('family scope counts only its seats', scoped.totals.seats, 4);
eq('family scope excludes engineering people', scoped.perPerson.length, 5);
eq('ribbon has twelve fiscal months', E.ribbon(state, 'Baseline', 27).cols.length, 12);
ok('risk radar finds uncovered roles', E.riskRadar(state, 'Baseline', 27).length > 0);
ok('data quality runs on generic roles', Array.isArray(E.dataQuality(state)));

const roundTrip = E.migrate(JSON.parse(JSON.stringify(state)));
eq('round-trip preserves people', roundTrip.people.length, state.people.length);
eq('round-trip preserves the blueprint', roundTrip.blueprint.length, state.blueprint.length);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
