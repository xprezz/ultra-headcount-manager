/* ============================================================================
   CUHM 2.0 — Calculation engine
   Schema v3, v2 migration, and the pure evaluate() date function.
   No dependencies. Dates are 'YYYY-MM-DD' strings compared lexicographically
   to avoid every timezone bug known to man.
   ========================================================================== */
const ENGINE = (() => {
  'use strict';

  const SCHEMA_VERSION = 3;

  /* ---------- date helpers ------------------------------------------------ */
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s).trim());
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const valid = s => !!/^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim());
  const today = () => iso(new Date());
  const addMonths = (s, n) => { const d = parse(s); if (!d) return null; d.setMonth(d.getMonth() + n); return iso(d); };
  const addDays = (s, n) => { const d = parse(s); if (!d) return null; d.setDate(d.getDate() + n); return iso(d); };
  const monthStart = s => `${String(s).slice(0, 7)}-01`;
  const monthEnd = s => { const d = parse(monthStart(s)); d.setMonth(d.getMonth() + 1); d.setDate(0); return iso(d); };
  /** Whole months from a→b (floor). Used for hire ramp position. */
  const monthsBetween = (a, b) => {
    const x = parse(a), y = parse(b);
    if (!x || !y) return 0;
    let m = (y.getFullYear() - x.getFullYear()) * 12 + (y.getMonth() - x.getMonth());
    if (y.getDate() < x.getDate()) m -= 1;
    return m;
  };
  const daysBetween = (a, b) => {
    const x = parse(a), y = parse(b);
    if (!x || !y) return 0;
    return Math.round((y - x) / 86400000);
  };
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = s => `${MONTH_NAMES[+String(s).slice(5, 7) - 1]} ${String(s).slice(2, 4)}`;
  const longDate = s => {
    const d = parse(s);
    if (!d) return '—';
    return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  };

  /** Microsoft fiscal year: FY27 runs 1 Jul 2026 → 30 Jun 2027. */
  const fyStart = fy => `${2000 + fy - 1}-07-01`;
  const fyEnd = fy => `${2000 + fy}-06-30`;
  const fyOf = dateStr => {
    const d = parse(dateStr);
    if (!d) return 27;
    const y = d.getFullYear(), m = d.getMonth();
    return (m >= 6 ? y + 1 : y) - 2000;
  };
  /** The 12 month-start dates of a fiscal year. */
  const fyMonths = fy => {
    const out = [];
    let cur = fyStart(fy);
    for (let i = 0; i < 12; i++) { out.push(cur); cur = addMonths(cur, 1); }
    return out;
  };

  /* ---------- constants --------------------------------------------------- */
  const EVENT_TYPES = ['hire', 'leave', 'exit', 'fte_change', 'transfer', 'role_change'];
  const LEAVE_KINDS = ['Parental', 'Sick', 'Sabbatical', 'Study', 'Other'];
  /** How a person is engaged. Only some of these consume a blueprint seat. */
  const EMPLOYMENT_TYPES = ['Employee', 'Student worker', 'Intern', 'Apprentice', 'Contractor', 'Vendor', 'Loaned in'];
  /** Engagements that deliver work but sit outside the establishment. */
  const NON_HEADCOUNT_TYPES = ['Student worker', 'Intern', 'Apprentice', 'Contractor', 'Vendor', 'Loaned in'];
  /** Does this person occupy a blueprint seat? An explicit flag always wins, so
      an unusual arrangement can be recorded without inventing a new type. */
  function countsHeadcount(p) {
    if (!p) return true;
    if (typeof p.countsHeadcount === 'boolean') return p.countsHeadcount;
    return NON_HEADCOUNT_TYPES.indexOf(p.employmentType || 'Employee') === -1;
  }
  const HIRING_STAGES = ['Not started', 'Approved', 'Posted', 'Screening', 'Interviewing', 'Offer out', 'Offer accepted', 'Cancelled'];
  /** Probability defaults by hiring stage — used when weighting the pipeline. */
  const STAGE_PROBABILITY = {
    'Not started': 10, 'Approved': 25, 'Posted': 40, 'Screening': 50,
    'Interviewing': 65, 'Offer out': 80, 'Offer accepted': 95, 'Cancelled': 0
  };
  /** A new hire is not 1.0 FTE on day one. Fraction of full productivity by
      whole months since start; the final value applies from then on. */
  const DEFAULT_RAMP = [0, 0.3, 0.6, 1];

  const STATES = {
    NOT_STARTED: 'NotYetStarted',
    ACTIVE: 'Active',
    RAMPING: 'Ramping',
    ON_LEAVE: 'OnLeave',
    GARDEN: 'GardenLeave',
    ON_NOTICE: 'OnNotice',
    DEPARTED: 'Departed'
  };

  const uid = (p = 'id') => `${p}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;

  /* ---------- schema ------------------------------------------------------ */
  function emptyState() {
    return {
      app: 'Ultra Headcount Manager',
      version: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      people: [],
      blueprint: [],
      requisitions: [],
      accounts: [],
      assignments: [],
      scenarios: [{ id: 'Baseline', name: 'Baseline' }],
      snapshots: [],
      journal: [],
      settings: {
        fy: 27,
        selectedDate: today(),
        selectedScenario: 'Baseline',
        basis: 'fte',
        leaveBackfills: false,
        applyRamp: true,
        probabilityWeighting: false,
        includePipeline: true,
        attritionRate: 8,
        precision: 1,
        spanMin: 4,
        spanMax: 10,
        rampProfile: DEFAULT_RAMP.slice(),
        timeToHireDays: 90,
        currency: 'DKK'
      }
    };
  }

  /* Role names are intentionally organization-agnostic. Imported directory
     records use job title as their initial role; users can rename or regroup
     roles later without hidden product-specific aliases. */
  const ROLE_ALIASES = {};

  const blankRole = r => !r || !String(r).trim() || String(r).trim().toUpperCase() === 'N/A';

  /** The role to use for a record: what it already has, or the family default. */
  function roleFor(family, role) {
    if (!blankRole(role)) return String(role).trim();
    const k = String(family || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return ROLE_ALIASES[k] || (role || '');
  }

  function normalisePerson(p) {
    const out = Object.assign({
      id: uid('person'), name: '', email: '', manager: '', jobTitle: '',
      family: '', blueprintRole: 'N/A', fte: 1, location: '',
      level: '', track: '', startDate: '', employmentType: 'Employee',
      events: [], accounts: [], skills: [],
      scenario: 'Baseline', confidence: 100, notes: '', annualCost: ''
    }, p);
    out.blueprintRole = roleFor(out.family, out.blueprintRole) || 'N/A';
    if (!out.employmentType) out.employmentType = 'Employee';
    /* countsHeadcount is derived from employmentType at read time. Only keep it
       on the record when it was set deliberately, otherwise a stored value would
       silently override every later change of engagement type. */
    if (typeof out.countsHeadcount !== 'boolean') delete out.countsHeadcount;
    return out;
  }

  function normaliseSeatRow(b) {
    const out = Object.assign({
      id: uid('bp'), family: '', role: '', seats: 0,
      effectiveFrom: '', note: '', owner: ''
    }, b, { seats: Math.max(0, +(b && b.seats) || 0) });
    out.role = roleFor(out.family, out.role);
    return out;
  }

  /* ---------- migration --------------------------------------------------- */
  /** Converts a v1/v2 backup (single `status` + loose date fields) into the v3
      event-timeline model. Every legacy record maps cleanly. */
  function migrate(raw) {
    if (!raw || typeof raw !== 'object') return emptyState();
    if (raw.version === SCHEMA_VERSION && Array.isArray(raw.people) && raw.people.some(p => p.events)) {
      const s = Object.assign(emptyState(), raw);
      s.settings = Object.assign(emptyState().settings, raw.settings || {});
      s.people = (raw.people || []).map(normalisePerson);
      s.blueprint = (raw.blueprint || []).map(normaliseSeatRow);
      return s;
    }

    const out = emptyState();
    out.blueprint = (raw.blueprint || []).map(normaliseSeatRow);
    out.accounts = raw.accounts || [];
    out.assignments = raw.assignments || [];
    out.settings = Object.assign(out.settings, raw.settings || {});
    out.settings.fy = raw.settings && raw.settings.fy ? raw.settings.fy
      : fyOf(raw.settings && raw.settings.selectedDate ? raw.settings.selectedDate : today());

    const scenarios = new Set(['Baseline']);

    out.people = (raw.people || []).map(p => {
      const person = normalisePerson({
        id: p.id || uid('person'),
        name: p.name || '', email: p.email || '', manager: p.manager || '',
        jobTitle: p.jobTitle || '', family: p.family || '',
        blueprintRole: p.blueprintRole || 'N/A',
        fte: typeof p.fte === 'number' ? p.fte : parseFloat(p.fte) || 1,
        location: p.location || '', level: p.level || '', track: p.track || '',
        startDate: p.startDate || '',
        employmentType: p.employmentType || 'Employee',
        countsHeadcount: typeof p.countsHeadcount === 'boolean' ? p.countsHeadcount : undefined,
        scenario: p.scenario || 'Baseline',
        confidence: typeof p.confidence === 'number' ? p.confidence : 100,
        notes: p.notes || '', annualCost: p.annualCost || '',
        accounts: p.accounts || [], skills: p.skills || [], events: []
      });
      scenarios.add(person.scenario);

      if (valid(p.startDate)) {
        person.events.push({ id: uid('ev'), type: 'hire', date: p.startDate, fte: person.fte, note: 'Migrated start date' });
      }
      const status = String(p.status || 'Active');
      if (status === 'Leaving' && valid(p.lastDate)) {
        person.events.push({ id: uid('ev'), type: 'exit', date: p.lastDate, note: 'Migrated from status "Leaving"' });
      }
      if (/leave/i.test(status) && valid(p.leaveStartDate)) {
        person.events.push({
          id: uid('ev'), type: 'leave', date: p.leaveStartDate,
          endDate: valid(p.expectedReturnDate) ? p.expectedReturnDate : '',
          kind: /parental/i.test(status) ? 'Parental' : /sick/i.test(status) ? 'Sick' : 'Other',
          note: `Migrated from status "${status}"`
        });
      }
      return person;
    });

    // Legacy PCN records become requisitions.
    out.requisitions = (raw.pcns || []).map(q => ({
      id: q.id || uid('req'), pcnId: q.pcnId || q.id || '',
      targetFamily: q.family || '', targetRole: roleFor(q.family, q.role || q.blueprintRole || ''),
      targetLevel: q.level || '',
      hiringStage: q.hiringStage || 'Not started',
      expectedStartDate: q.expectedStartDate || q.startDate || '',
      probability: typeof q.probability === 'number' ? q.probability : null,
      backfillFor: q.backfillFor || '', fte: q.fte || 1,
      scenario: q.scenario || 'Baseline', notes: q.notes || ''
    }));

    out.scenarios = [...scenarios].map(n => ({ id: n, name: n }));
    if (!out.scenarios.some(s => s.id === out.settings.selectedScenario)) {
      out.settings.selectedScenario = 'Baseline';
    }
    return out;
  }

  /* ---------- ramp -------------------------------------------------------- */
  function rampFactor(startDate, atDate, profile) {
    const prof = (profile && profile.length) ? profile : DEFAULT_RAMP;
    if (!valid(startDate)) return 1;
    const m = monthsBetween(startDate, atDate);
    if (m < 0) return 0;
    return m >= prof.length ? prof[prof.length - 1] : prof[m];
  }

  /* ---------- per-person evaluation --------------------------------------- */
  /**
   * Resolve one person's position at a date.
   * Returns { state, onRoll, effective, reason, ... } where onRoll counts a
   * person on leave as still occupying their seat and effective counts them
   * as zero capacity. The gap between the two is the point of this app.
   */
  function evaluatePerson(person, date, opts = {}) {
    const events = (person.events || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const baseFteRaw = typeof person.fte === 'number' ? person.fte : parseFloat(person.fte) || 0;

    const hire = events.find(e => e.type === 'hire' && valid(e.date));
    const exit = events.filter(e => e.type === 'exit' && valid(e.date))
      .sort((a, b) => a.date.localeCompare(b.date))[0];

    const res = {
      id: person.id, name: person.name, person,
      family: person.family, role: person.blueprintRole,
      manager: person.manager, level: person.level,
      state: STATES.ACTIVE, onRoll: 0, effective: 0,
      reason: 'Active', leave: null, exit: exit || null, hire: hire || null,
      ramp: 1, isPipeline: false,
      countsHeadcount: countsHeadcount(person),
      employmentType: person.employmentType || 'Employee',
      garden: null
    };

    // Not yet started.
    const startDate = hire ? hire.date : (valid(person.startDate) ? person.startDate : null);
    if (startDate && date < startDate) {
      res.state = STATES.NOT_STARTED;
      res.reason = `Starts ${longDate(startDate)}`;
      return res;
    }

    // Departed. `exit.date` is the last working day, so they are gone the day after.
    if (exit && date > exit.date) {
      res.state = STATES.DEPARTED;
      res.reason = `Left ${longDate(exit.date)}`;
      return res;
    }

    // Effective-dated FTE changes.
    let fte = baseFteRaw;
    events.filter(e => e.type === 'fte_change' && valid(e.date) && e.date <= date)
      .forEach(e => { if (typeof e.fte === 'number') fte = e.fte; });

    res.onRoll = fte;
    res.effective = fte;

    // Ramp for recent starters.
    if (opts.applyRamp !== false && startDate) {
      const f = rampFactor(startDate, date, opts.rampProfile);
      if (f < 1) {
        res.ramp = f;
        res.effective = +(fte * f).toFixed(4);
        res.state = STATES.RAMPING;
        res.reason = `Ramping (${Math.round(f * 100)}% since ${longDate(startDate)})`;
      }
    }

    // On leave — occupies the seat, delivers nothing.
    const leave = events.find(e => e.type === 'leave' && valid(e.date) && e.date <= date &&
      (!valid(e.endDate) || date < e.endDate));
    if (leave) {
      res.state = STATES.ON_LEAVE;
      res.leave = leave;
      res.effective = 0;
      res.reason = valid(leave.endDate)
        ? `${leave.kind || 'Leave'} until ${longDate(leave.endDate)}`
        : `${leave.kind || 'Leave'} from ${longDate(leave.date)} (open-ended)`;
      return res;
    }

    // Serving notice — still counts both ways, but must be visible.
    if (exit && date <= exit.date) {
      /* Garden leave: still on the payroll and still occupying the seat, but
         out of the working rota. Capacity-wise this is identical to leave, and
         it usually starts weeks before the exit date nobody has flagged yet. */
      if (valid(exit.gardenFrom) && date >= exit.gardenFrom) {
        res.state = STATES.GARDEN;
        res.garden = { from: exit.gardenFrom, until: exit.date };
        res.effective = 0;
        res.reason = `Garden leave since ${longDate(exit.gardenFrom)} · exits ${longDate(exit.date)}`;
        return res;
      }
      res.state = STATES.ON_NOTICE;
      res.reason = `Leaving ${longDate(exit.date)} (${daysBetween(date, exit.date)} days)`;
    }
    return res;
  }

  /** Pipeline requisitions evaluated as prospective capacity. */
  function evaluateRequisition(req, date, opts = {}) {
    const prob = typeof req.probability === 'number' && req.probability !== null
      ? req.probability
      : (STAGE_PROBABILITY[req.hiringStage] ?? 0);
    const fte = typeof req.fte === 'number' ? req.fte : parseFloat(req.fte) || 1;
    const res = {
      id: req.id, name: req.pcnId ? `${req.pcnId} (open)` : 'Open requisition',
      req, family: req.targetFamily, role: req.targetRole, level: req.targetLevel,
      manager: '', isPipeline: true, probability: prob,
      state: STATES.NOT_STARTED, onRoll: 0, effective: 0, ramp: 0,
      reason: `${req.hiringStage || 'Not started'} · ${prob}%`
    };
    if (req.hiringStage === 'Cancelled') return res;
    if (!valid(req.expectedStartDate) || date < req.expectedStartDate) {
      res.reason = valid(req.expectedStartDate)
        ? `${req.hiringStage || 'Open'} · starts ${longDate(req.expectedStartDate)} · ${prob}%`
        : `${req.hiringStage || 'Open'} · no start date · ${prob}%`;
      return res;
    }
    const weight = opts.probabilityWeighting ? prob / 100 : 1;
    const f = opts.applyRamp !== false ? rampFactor(req.expectedStartDate, date, opts.rampProfile) : 1;
    res.state = f < 1 ? STATES.RAMPING : STATES.ACTIVE;
    res.ramp = f;
    res.onRoll = +(fte * weight).toFixed(4);
    res.effective = +(fte * weight * f).toFixed(4);
    res.reason = `Landed ${longDate(req.expectedStartDate)} · ${Math.round(f * 100)}% ramped`;
    return res;
  }

  /* ---------- blueprint seats -------------------------------------------- */
  const roleKey = (family, role) => `${family || '—'} ⟩ ${role || 'N/A'}`;

  /** Splits a roleKey back into its parts. */
  function splitKey(key) {
    const i = String(key).indexOf(' ⟩ ');
    return i < 0 ? { family: key, role: '' }
      : { family: key.slice(0, i), role: key.slice(i + 3) };
  }

  function seatsAt(state, date) {
    const map = new Map();
    (state.blueprint || []).forEach(b => {
      if (b.effectiveFrom && valid(b.effectiveFrom) && date < b.effectiveFrom) return;
      const k = roleKey(b.family, b.role);
      const prev = map.get(k);
      // Later effective-dated rows supersede earlier ones for the same role.
      if (!prev || String(b.effectiveFrom || '') >= String(prev.effectiveFrom || '')) {
        map.set(k, {
          key: k, family: b.family, role: b.role, seats: +b.seats || 0,
          effectiveFrom: b.effectiveFrom || '', note: b.note || '', owner: b.owner || ''
        });
      }
    });
    return map;
  }

  /* ---------- seat establishment (the editable blueprint) ----------------- */

  /**
   * Every seat change ever recorded for one role, oldest first. This is what
   * makes "we cut two seats in January" auditable rather than a rumour.
   */
  function seatHistory(state, key) {
    return (state.blueprint || [])
      .filter(b => roleKey(b.family, b.role) === key)
      .slice()
      .sort((a, b) => String(a.effectiveFrom || '').localeCompare(String(b.effectiveFrom || '')));
  }

  /**
   * Sets the seat count for a role from a date onwards.
   * Mutates `state` — always call inside APP.mutate so it lands in the journal.
   * Passing the same effectiveFrom twice edits that row rather than stacking a
   * duplicate, so re-typing a number never silently doubles the establishment.
   */
  function setSeats(state, family, role, seats, effectiveFrom) {
    state.blueprint = state.blueprint || [];
    const from = effectiveFrom && valid(effectiveFrom) ? effectiveFrom : '';
    role = roleFor(family, role);
    const k = roleKey(family, role);
    const existing = state.blueprint.find(b =>
      roleKey(b.family, b.role) === k && String(b.effectiveFrom || '') === from);
    if (existing) { existing.seats = Math.max(0, +seats || 0); return existing; }
    const row = {
      id: uid('bp'), family: family || '', role: role || '',
      seats: Math.max(0, +seats || 0), effectiveFrom: from, note: '', owner: ''
    };
    state.blueprint.push(row);
    return row;
  }

  /** Drops one dated seat row. Removing the last row retires the role. */
  function removeSeatRow(state, id) {
    state.blueprint = (state.blueprint || []).filter(b => b.id !== id);
  }

  /** Renames a role everywhere at once — blueprint, people and requisitions. */
  function renameRole(state, oldFamily, oldRole, newFamily, newRole) {
    const k = roleKey(oldFamily, oldRole);
    let touched = 0;
    (state.blueprint || []).forEach(b => {
      if (roleKey(b.family, b.role) === k) { b.family = newFamily; b.role = newRole; touched++; }
    });
    (state.people || []).forEach(p => {
      if (roleKey(p.family, p.blueprintRole) === k) { p.family = newFamily; p.blueprintRole = newRole; touched++; }
    });
    (state.requisitions || []).forEach(r => {
      if (roleKey(r.targetFamily, r.targetRole) === k) { r.targetFamily = newFamily; r.targetRole = newRole; touched++; }
    });
    return touched;
  }

  /* ---------- per-role status -------------------------------------------- */
  /**
   * How a single role is doing, as a label a human can act on.
   * Deliberately separates "the seat is filled" from "the seat is producing",
   * because that difference is the entire reason this application exists.
   */
  const ROLE_STATUS = {
    FULL: { id: 'full', label: 'Fully staffed', tone: 'green', rank: 6 },
    OVER: { id: 'over', label: 'Over establishment', tone: 'blue', rank: 5 },
    LEAVE_HIT: { id: 'leavehit', label: 'Filled but not deployable', tone: 'leave', rank: 3 },
    WATCH: { id: 'watch', label: 'Slightly short', tone: 'amber', rank: 4 },
    SHORT: { id: 'short', label: 'Short', tone: 'amber', rank: 2 },
    CRITICAL: { id: 'critical', label: 'Critically short', tone: 'red', rank: 1 },
    VACANT: { id: 'vacant', label: 'Vacant', tone: 'red', rank: 0 },
    UNBUDGETED: { id: 'unbudgeted', label: 'No seats allocated', tone: 'purple', rank: 3 },
    DORMANT: { id: 'dormant', label: 'Dormant', tone: 'grey', rank: 9 }
  };

  function classifyRole(r) {
    if (r.seats <= 0) return r.onRoll > 0 ? ROLE_STATUS.UNBUDGETED : ROLE_STATUS.DORMANT;
    if (r.onRoll <= 0) return ROLE_STATUS.VACANT;
    if (r.effective + 1e-6 >= r.seats) return r.onRoll > r.seats + 1e-6 ? ROLE_STATUS.OVER : ROLE_STATUS.FULL;
    // Seats are occupied but the capacity is not there — leave, notice or ramp.
    if (r.onRoll + 1e-6 >= r.seats) return ROLE_STATUS.LEAVE_HIT;
    const cover = r.effective / r.seats;
    if (cover >= 0.9) return ROLE_STATUS.WATCH;
    if (cover >= 0.7) return ROLE_STATUS.SHORT;
    return ROLE_STATUS.CRITICAL;
  }

  /**
   * The per-role status table. One row per role in the blueprint *or* in use by
   * a person, so nobody can hide in a role you forgot to establish.
   * Pass a ribbon() result as `rb` to get the 12-month trend without paying for
   * twelve more evaluations.
   */
  function roleStatus(state, date, scenario, rb) {
    const ev = evaluate(state, date, scenario);
    const reqs = (state.requisitions || []).filter(r =>
      r.hiringStage !== 'Cancelled' && (!r.scenario || r.scenario === 'Baseline' || r.scenario === (scenario || 'Baseline')));

    const rows = [];
    ev.perRole.forEach((v, k) => {
      const meta = ev.seats.get(k) || {};
      const people = v.members.filter(m => !m.isPipeline);
      const pipes = v.members.filter(m => m.isPipeline);
      const filled = +people.reduce((s, m) => s + m.onRoll, 0).toFixed(3);
      const pipeline = +pipes.reduce((s, m) => s + m.onRoll, 0).toFixed(3);

      const row = {
        key: k, family: v.family, role: v.role,
        seats: v.seats,
        filled, pipeline,
        heads: people.filter(m => m.onRoll > 0).length,
        onRoll: v.onRoll, effective: v.effective, leaveDrag: v.leaveDrag,
        gapOnRoll: v.gapOnRoll, gapEffective: v.gapEffective,
        // Seats with nobody in them at all — what you would actually recruit into.
        vacantSeats: +Math.max(0, v.seats - filled).toFixed(3),
        // Vacancies not already being recruited for.
        openSeats: +Math.max(0, v.seats - filled - pipeline).toFixed(3),
        overfill: +Math.max(0, filled - v.seats).toFixed(3),
        coverage: v.seats > 0 ? +(v.effective / v.seats).toFixed(4) : null,
        effectiveFrom: meta.effectiveFrom || '',
        owner: meta.owner || '', note: meta.note || '',
        inBlueprint: ev.seats.has(k),
        members: people, pipelineMembers: pipes,
        requisitions: reqs.filter(r => roleKey(r.targetFamily, r.targetRole) === k),
        onLeave: people.filter(m => m.state === STATES.ON_LEAVE),
        onNotice: people.filter(m => m.state === STATES.ON_NOTICE),
        ramping: people.filter(m => m.state === STATES.RAMPING)
      };
      row.status = classifyRole(row);
      rows.push(row);
    });

    if (rb) {
      const byKey = new Map(rb.rows.map(r => [r.key, r]));
      rows.forEach(r => {
        const t = byKey.get(r.key);
        if (!t) return;
        r.trend = t.cells.map(c => c.effective);
        r.trendSeats = t.cells.map(c => c.seats);
        r.monthsShort = t.cells.filter(c => c.gapEffective < -0.001).length;
        r.worst = t.worst;
        const breach = t.cells.find(c => c.gapEffective < -0.001);
        r.firstBreach = breach ? breach.label : '';
        r.firstBreachSample = breach ? breach.sample : '';
      });
    }

    rows.sort((a, b) => (a.status.rank - b.status.rank)
      || (a.gapEffective - b.gapEffective)
      || a.key.localeCompare(b.key));

    const sum = f => +rows.reduce((s, r) => s + (f(r) || 0), 0).toFixed(3);
    return {
      date, rows, ev,
      totals: {
        roles: rows.length,
        seats: sum(r => r.seats),
        filled: sum(r => r.filled),
        pipeline: sum(r => r.pipeline),
        effective: sum(r => r.effective),
        vacantSeats: sum(r => r.vacantSeats),
        openSeats: sum(r => r.openSeats),
        overfill: sum(r => r.overfill),
        leaveDrag: sum(r => r.leaveDrag),
        atRisk: rows.filter(r => r.status.rank <= 3).length,
        unbudgeted: rows.filter(r => r.status === ROLE_STATUS.UNBUDGETED).length
      }
    };
  }


  /* ---------- full evaluation -------------------------------------------- */
  /**
   * The single source of truth. Every view in the app renders this.
   */
  function evaluate(state, date, scenario, overrides = {}) {
    const st = state.settings || {};
    const opts = Object.assign({
      applyRamp: st.applyRamp !== false,
      rampProfile: st.rampProfile || DEFAULT_RAMP,
      probabilityWeighting: !!st.probabilityWeighting,
      includePipeline: st.includePipeline !== false,
      leaveBackfills: !!st.leaveBackfills
    }, overrides);
    const scen = scenario || st.selectedScenario || 'Baseline';
    const keep = typeof overrides.filter === 'function' ? overrides.filter : null;
    const inSeatScope = (family, role) => !keep || keep({ family, blueprintRole: role, role });

    const people = (state.people || [])
      .filter(p => !p.scenario || p.scenario === 'Baseline' || p.scenario === scen)
      .filter(p => !keep || keep(p));
    const perPerson = people.map(p => evaluatePerson(p, date, opts));

    let pipeline = [];
    if (opts.includePipeline) {
      const reqs = (state.requisitions || [])
        .filter(r => !r.scenario || r.scenario === 'Baseline' || r.scenario === scen)
        .filter(r => !keep || keep({
          family: r.targetFamily, blueprintRole: r.targetRole, role: r.targetRole,
          level: r.targetLevel, manager: r.hiringManager || '', name: r.pcnId || ''
        }));
      pipeline = reqs.map(r => evaluateRequisition(r, date, opts));
    }

    const all = perPerson.concat(pipeline);
    /* Student workers, interns and contractors do real work but sit outside the
       establishment, so they must never close a blueprint gap. They are counted
       separately as supplementary capacity. */
    const counted = all.filter(r => (r.onRoll > 0 || r.effective > 0) && r.countsHeadcount !== false);
    const supplementary = all.filter(r => r.countsHeadcount === false && (r.onRoll > 0 || r.effective > 0));

    /* --- roll-up by blueprint role --- */
    const seats = seatsAt(state, date);
    const perRole = new Map();
    seats.forEach((v, k) => {
      if (!inSeatScope(v.family, v.role)) return;
      perRole.set(k, {
        key: k, family: v.family, role: v.role, seats: v.seats,
        onRoll: 0, effective: 0, pipeline: 0, supplementary: 0, members: [], extras: []
      });
    });
    supplementary.forEach(r => {
      const k = roleKey(r.family, r.role);
      const bucket = perRole.get(k);
      if (!bucket) return;
      bucket.supplementary = +(bucket.supplementary + r.effective).toFixed(3);
      bucket.extras.push(r);
    });
    counted.forEach(r => {
      const k = roleKey(r.family, r.role);
      if (!perRole.has(k)) {
        perRole.set(k, { key: k, family: r.family, role: r.role, seats: 0, onRoll: 0, effective: 0, pipeline: 0, supplementary: 0, members: [], extras: [] });
      }
      const bucket = perRole.get(k);
      if (r.isPipeline) bucket.pipeline += r.onRoll;
      bucket.onRoll += r.onRoll;
      bucket.effective += r.effective;
      bucket.members.push(r);
    });
    perRole.forEach(v => {
      v.onRoll = +v.onRoll.toFixed(3);
      v.effective = +v.effective.toFixed(3);
      v.pipeline = +v.pipeline.toFixed(3);
      v.gapOnRoll = +(v.onRoll - v.seats).toFixed(3);
      v.gapEffective = +(v.effective - v.seats).toFixed(3);
      v.leaveDrag = +(v.onRoll - v.effective).toFixed(3);
    });

    /* --- roll-up by manager, family, level --- */
    const group = (keyFn) => {
      const m = new Map();
      counted.forEach(r => {
        const k = keyFn(r) || '—';
        if (!m.has(k)) m.set(k, { key: k, onRoll: 0, effective: 0, members: [] });
        const b = m.get(k);
        b.onRoll += r.onRoll; b.effective += r.effective; b.members.push(r);
      });
      m.forEach(v => {
        v.onRoll = +v.onRoll.toFixed(3);
        v.effective = +v.effective.toFixed(3);
        v.leaveDrag = +(v.onRoll - v.effective).toFixed(3);
      });
      return m;
    };

    /* --- totals --- */
    let totalSeats = 0;
    seats.forEach(v => { if (inSeatScope(v.family, v.role)) totalSeats += v.seats; });
    const fteOf = rows => +rows.reduce((s, r) => s + r.onRoll, 0).toFixed(3);
    const totals = {
      seats: totalSeats,
      onRoll: +counted.reduce((s, r) => s + r.onRoll, 0).toFixed(3),
      effective: +counted.reduce((s, r) => s + r.effective, 0).toFixed(3),
      pipeline: +pipeline.reduce((s, r) => s + r.onRoll, 0).toFixed(3),
      headsOnRoll: perPerson.filter(r => r.onRoll > 0 && r.countsHeadcount !== false).length,
      onLeave: perPerson.filter(r => r.state === STATES.ON_LEAVE).length,
      onLeaveFte: fteOf(perPerson.filter(r => r.state === STATES.ON_LEAVE)),
      onGarden: perPerson.filter(r => r.state === STATES.GARDEN).length,
      onGardenFte: fteOf(perPerson.filter(r => r.state === STATES.GARDEN)),
      onNotice: perPerson.filter(r => r.state === STATES.ON_NOTICE).length,
      ramping: perPerson.filter(r => r.state === STATES.RAMPING).length,
      departed: perPerson.filter(r => r.state === STATES.DEPARTED).length,
      notStarted: perPerson.filter(r => r.state === STATES.NOT_STARTED).length,
      /* supplementary = real delivery capacity that costs you no seat */
      supplementary: fteOf(supplementary),
      supplementaryEffective: +supplementary.reduce((s, r) => s + r.effective, 0).toFixed(3),
      headsSupplementary: supplementary.filter(r => r.onRoll > 0).length
    };
    totals.leaveDrag = +(totals.onRoll - totals.effective).toFixed(3);
    totals.gapOnRoll = +(totals.onRoll - totals.seats).toFixed(3);
    totals.gapEffective = +(totals.effective - totals.seats).toFixed(3);

    return {
      date, scenario: scen, opts, filtered: !!keep,
      perPerson, pipeline, all, supplementary,
      byId: new Map(perPerson.map(r => [r.id, r])),
      perRole, seats,
      perManager: group(r => r.manager),
      perFamily: group(r => r.family),
      perLevel: group(r => r.level),
      totals
    };
  }

  /* ---------- waterfall --------------------------------------------------- */
  /** Explains a date's effective number as a sequence of plain-language steps. */
  function waterfall(state, date, scenario, filter) {
    const fy = (state.settings && state.settings.fy) || 27;
    const from = fyStart(fy);
    const inScope = p => !filter || filter(p);
    const ev = evaluate(state, date, scenario, { filter });
    const evStart = evaluate(state, from, scenario, { filter });

    const hc = r => r.countsHeadcount !== false;
    const rows = evStart.perPerson.filter(r => inScope(r.person) && hc(r));
    const openingActive = rows.filter(r => r.state !== STATES.DEPARTED && r.state !== STATES.NOT_STARTED)
      .reduce((s, r) => s + r.onRoll, 0);

    const now = ev.perPerson.filter(r => inScope(r.person) && hc(r));
    const leavers = now.filter(r => r.state === STATES.DEPARTED);
    const onLeave = now.filter(r => r.state === STATES.ON_LEAVE);
    const onGarden = now.filter(r => r.state === STATES.GARDEN);
    const started = now.filter(r => r.state !== STATES.DEPARTED && r.state !== STATES.NOT_STARTED &&
      r.hire && r.hire.date > from);
    const rampLoss = now.filter(r => r.state === STATES.RAMPING)
      .reduce((s, r) => s + (r.onRoll - r.effective), 0);
    const extras = ev.perPerson.filter(r => inScope(r.person) && !hc(r) && r.effective > 0);
    const pipe = ev.pipeline.filter(r => !filter || filter(r.req || {}));

    let seatTotal = 0;
    ev.seats.forEach(v => { if (!filter || filter({ family: v.family, blueprintRole: v.role })) seatTotal += v.seats; });

    const onRollNow = +(now.filter(r => r.onRoll > 0).reduce((s, r) => s + r.onRoll, 0)
      + pipe.reduce((s, r) => s + r.onRoll, 0)).toFixed(2);
    const effectiveNow = +(now.reduce((s, r) => s + r.effective, 0)
      + pipe.reduce((s, r) => s + r.effective, 0)).toFixed(2);

    const steps = [
      { label: `Blueprint seats`, value: seatTotal, kind: 'base' },
      { label: `On roll at FY start`, value: +openingActive.toFixed(2), kind: 'base' },
      { label: `Leavers departed`, value: -+leavers.reduce((s, r) => s + (r.person.fte || 1), 0).toFixed(2), kind: 'neg', detail: leavers.map(r => `${r.name} (${longDate(r.exit.date)})`) },
      { label: `New starters`, value: +started.reduce((s, r) => s + r.onRoll, 0).toFixed(2), kind: 'pos', detail: started.map(r => r.name) },
      { label: `Pipeline hires landed`, value: +pipe.reduce((s, r) => s + r.onRoll, 0).toFixed(2), kind: 'pos', detail: pipe.filter(r => r.onRoll > 0).map(r => r.name) },
      { label: `On roll now`, value: onRollNow, kind: 'subtotal' },
      { label: `On leave (seat filled, zero capacity)`, value: -+onLeave.reduce((s, r) => s + r.onRoll, 0).toFixed(2), kind: 'neg', detail: onLeave.map(r => `${r.name} — ${r.reason}`) },
      { label: `Garden leave (paid, out of the rota)`, value: -+onGarden.reduce((s, r) => s + r.onRoll, 0).toFixed(2), kind: 'neg', detail: onGarden.map(r => `${r.name} — ${r.reason}`) },
      { label: `Ramp shortfall on recent hires`, value: -+rampLoss.toFixed(2), kind: 'neg' },
      { label: `Effective capacity`, value: effectiveNow, kind: 'total' },
      { label: `Gap vs blueprint`, value: +(effectiveNow - seatTotal).toFixed(2), kind: 'gap' },
      { label: `Supplementary (no seat consumed)`, value: +extras.reduce((s, r) => s + r.effective, 0).toFixed(2), kind: 'pos', detail: extras.map(r => `${r.name} — ${r.employmentType}`) }
    ];
    const suppFte = +extras.reduce((s, r) => s + r.effective, 0).toFixed(2);
    if (!suppFte) steps.pop();     // no student workers — don't show an empty row
    const gardenIdx = steps.findIndex(s => /^Garden leave/.test(s.label));
    if (gardenIdx >= 0 && !steps[gardenIdx].value) steps.splice(gardenIdx, 1);
    return { steps, ev, seatTotal, onRollNow, effectiveNow, supplementary: suppFte };
  }

  /* ---------- capacity flow (Sankey) --------------------------------------
     Follows every allocated seat through to what it is actually producing.
     The three branches always add back to the establishment, so the chart can
     be read as an accounting identity rather than an illustration:

       seats = producing + lost to leave + lost to ramp-up + empty seats
  */
  function capacityFlow(state, date, scenario, filter) {
    const ev = evaluate(state, date, scenario, { filter });
    const rows = ev.perPerson.filter(r => r.countsHeadcount !== false);
    const extras = ev.perPerson.filter(r => r.countsHeadcount === false);

    let seats = 0;
    ev.seats.forEach(v => {
      if (!filter || filter({ family: v.family, blueprintRole: v.role, role: v.role })) seats += v.seats;
    });

    const r2 = n => +(+n || 0).toFixed(2);
    const onRoll = r2(rows.reduce((s, r) => s + r.onRoll, 0));
    const effective = r2(rows.reduce((s, r) => s + r.effective, 0));
    const headsOnRoll = rows.filter(r => r.onRoll > 0).length;

    const leaveRows = rows.filter(r => r.state === STATES.ON_LEAVE);
    const gardenRows = rows.filter(r => r.state === STATES.GARDEN);
    const rampRows = rows.filter(r => r.state === STATES.RAMPING);
    const noticeRows = rows.filter(r => r.state === STATES.ON_NOTICE);

    const leaveLoss = r2(leaveRows.reduce((s, r) => s + (r.onRoll - r.effective), 0));
    const gardenLoss = r2(gardenRows.reduce((s, r) => s + (r.onRoll - r.effective), 0));
    const rampLoss = r2(rampRows.reduce((s, r) => s + (r.onRoll - r.effective), 0));
    const noticeFte = r2(noticeRows.reduce((s, r) => s + r.effective, 0));
    const suppFte = r2(extras.reduce((s, r) => s + r.effective, 0));
    const secure = r2(effective + suppFte - noticeFte);

    const emptySeats = r2(Math.max(0, seats - onRoll));
    const overfill = r2(Math.max(0, onRoll - seats));
    const pipelineFte = r2((ev.pipeline || [])
      .filter(p => !filter || filter(p.req || {}))
      .reduce((s, p) => s + p.onRoll, 0));
    const covered = r2(Math.min(emptySeats, pipelineFte));
    const noReq = r2(Math.max(0, emptySeats - covered));

    /* leave split by kind, so "3 FTE down" says *why* */
    const byKind = new Map();
    leaveRows.forEach(r => {
      const k = (r.leave && r.leave.kind) || 'Other';
      const lost = r.onRoll - r.effective;
      byKind.set(k, r2((byKind.get(k) || 0) + lost));
    });

    const LEAVE_TONE = {
      Parental: 'var(--cp-accent)', Sick: 'var(--cp-danger)', Sabbatical: 'var(--cp-link)',
      Study: 'var(--cp-text-muted)', Other: 'var(--cp-warning)'
    };

    const nodes = [
      { id: 'seats', label: 'Blueprint seats', color: 'var(--cp-text)' },
      { id: 'producing', label: 'Producing', color: 'var(--cp-success)' },
      { id: 'leave', label: 'Lost to leave', color: 'var(--cp-warning)' },
      { id: 'garden', label: 'Garden leave', color: 'var(--cp-warning)' },
      { id: 'ramp', label: 'Lost to ramp-up', color: 'var(--cp-accent)' },
      { id: 'empty', label: 'Empty seats', color: 'var(--cp-danger)' },
      { id: 'secure', label: 'Secure capacity', color: 'var(--cp-success)' },
      { id: 'notice', label: 'Working notice', color: 'var(--cp-warning)' },
      { id: 'covered', label: 'Requisition raised', color: 'var(--cp-link)' },
      { id: 'noreq', label: 'Nobody recruiting', color: 'var(--cp-danger)' }
    ];
    [...byKind.keys()].forEach(k => nodes.push({
      id: 'leave:' + k, label: k + ' leave', color: LEAVE_TONE[k] || 'var(--cp-warning)'
    }));

    /* When more people sit in a family than it has seats, the surplus is shown
       as its own source. That keeps the seats node equal to the establishment
       instead of silently inflating it. */
    const fromExtra = r2(Math.min(overfill, effective));
    const fromSeats = r2(effective - fromExtra);
    if (fromExtra > 0) nodes.push({ id: 'extra', label: 'Over establishment', color: 'var(--cp-accent)' });
    /* Student workers and contractors deliver real capacity without consuming a
       seat, so they enter as their own source rather than out of the seat pool. */
    if (suppFte > 0) nodes.push({ id: 'supp', label: 'Student workers & contractors', color: 'var(--cp-link)' });

    const links = [
      { from: 'seats', to: 'producing', value: fromSeats },
      { from: 'extra', to: 'producing', value: fromExtra },
      { from: 'supp', to: 'producing', value: suppFte },
      { from: 'seats', to: 'leave', value: leaveLoss },
      { from: 'seats', to: 'garden', value: gardenLoss },
      { from: 'seats', to: 'ramp', value: rampLoss },
      { from: 'seats', to: 'empty', value: emptySeats },
      { from: 'producing', to: 'secure', value: secure },
      { from: 'producing', to: 'notice', value: noticeFte },
      { from: 'empty', to: 'covered', value: covered },
      { from: 'empty', to: 'noreq', value: noReq }
    ];
    byKind.forEach((v, k) => links.push({ from: 'leave', to: 'leave:' + k, value: v }));
    const liveLinks = links.filter(l => l.value > 0);

    const pct = (n, d) => (d > 0 ? +((n / d) * 100).toFixed(1) : 0);

    return {
      nodes: nodes.filter(n => liveLinks.some(l => l.from === n.id || l.to === n.id)),
      links: liveLinks, ev,
      totals: {
        seats, onRoll, effective, headsOnRoll, emptySeats, overfill,
        leaveLoss, gardenLoss, rampLoss, noticeFte, secure, pipelineFte, covered, noReq,
        supplementary: suppFte, headsSupplementary: extras.filter(r => r.onRoll > 0).length,
        headsOnLeave: leaveRows.length, headsOnNotice: noticeRows.length,
        headsOnGarden: gardenRows.length,
        headsRamping: rampRows.length,
        byKind: [...byKind.entries()].map(([kind, fte]) => ({ kind, fte })),
        /* the percentages */
        pctLeaveOfSeats: pct(leaveLoss, seats),
        pctLeaveOfOnRoll: pct(leaveLoss, onRoll),
        pctHeadsOnLeave: pct(leaveRows.length, headsOnRoll),
        pctGardenOfSeats: pct(gardenLoss, seats),
        pctAwayOfSeats: pct(leaveLoss + gardenLoss, seats),
        pctUnavailable: pct(leaveLoss + gardenLoss + rampLoss, seats),
        pctSeatsProducing: pct(effective, seats),
        pctSeatsEmpty: pct(emptySeats, seats)
      }
    };
  }

  /* ---------- 12-month capacity ribbon ------------------------------------ */
  function ribbon(state, scenario, fy, filter) {
    const F = fy || (state.settings && state.settings.fy) || 27;
    const months = fyMonths(F);
    // Sample the last day of each month — the position you actually report on.
    const cols = months.map(m => ({ month: m, label: monthLabel(m), sample: monthEnd(m) }));
    const evals = cols.map(c => evaluate(state, c.sample, scenario, { filter }));

    const keys = new Map();
    evals.forEach(e => e.perRole.forEach((v, k) => { if (!keys.has(k)) keys.set(k, { key: k, family: v.family, role: v.role }); }));

    const rows = [...keys.values()].map(meta => {
      const cells = evals.map((e, i) => {
        const v = e.perRole.get(meta.key) || { seats: 0, onRoll: 0, effective: 0, leaveDrag: 0, members: [] };
        return {
          month: cols[i].month, label: cols[i].label, sample: cols[i].sample,
          seats: v.seats, onRoll: v.onRoll, effective: v.effective,
          gapEffective: +((v.effective || 0) - (v.seats || 0)).toFixed(2),
          gapOnRoll: +((v.onRoll || 0) - (v.seats || 0)).toFixed(2),
          leaveDrag: v.leaveDrag || 0, members: v.members || []
        };
      });
      const worst = cells.reduce((a, b) => (b.gapEffective < a.gapEffective ? b : a), cells[0]);
      return Object.assign({}, meta, { cells, worst });
    }).sort((a, b) => a.key.localeCompare(b.key));

    const totalsRow = cols.map((c, i) => ({
      month: c.month, label: c.label, sample: c.sample,
      seats: evals[i].totals.seats, onRoll: evals[i].totals.onRoll,
      effective: evals[i].totals.effective,
      gapEffective: evals[i].totals.gapEffective,
      gapOnRoll: evals[i].totals.gapOnRoll,
      leaveDrag: evals[i].totals.leaveDrag
    }));

    return { cols, rows, evals, totalsRow, fy: F };
  }

  /* ---------- trough finder / risk radar ---------------------------------- */
  /** Scans the year and writes your bad news as sentences so you don't have to
      go looking for it. */
  function riskRadar(state, scenario, fy, filter) {
    const rb = ribbon(state, scenario, fy, filter);
    const risks = [];

    rb.rows.forEach(row => {
      const bad = row.cells.filter(c => c.gapEffective < -0.001);
      if (!bad.length) return;
      const worst = row.worst;
      // Longest consecutive run of shortfall.
      let run = 0, best = 0, runStart = null, bestStart = null;
      row.cells.forEach(c => {
        if (c.gapEffective < -0.001) { if (!run) runStart = c; run++; if (run > best) { best = run; bestStart = runStart; } }
        else run = 0;
      });
      const drivers = new Set();
      (worst.members || []).forEach(m => {
        if (m.state === STATES.GARDEN) drivers.add(`${m.name} on garden leave`);
        if (m.state === STATES.ON_LEAVE) drivers.add(`${m.name} on ${(m.leave && m.leave.kind) || 'leave'}`);
      });
      // Anyone who left this role before the worst month is also a driver.
      (state.people || []).forEach(p => {
        if (roleKey(p.family, p.blueprintRole) !== row.key) return;
        const ex = (p.events || []).find(e => e.type === 'exit' && valid(e.date));
        if (ex && ex.date <= worst.sample) drivers.add(`${p.name} left ${longDate(ex.date)}`);
      });
      const hasBackfill = (state.requisitions || []).some(r =>
        roleKey(r.targetFamily, r.targetRole) === row.key && r.hiringStage !== 'Cancelled');

      risks.push({
        type: 'gap', key: row.key, family: row.family, role: row.role,
        severity: Math.abs(worst.gapEffective),
        months: best, worstMonth: worst.label, worstSample: worst.sample,
        gap: worst.gapEffective, seats: worst.seats, effective: worst.effective,
        drivers: [...drivers], hasBackfill,
        headline: `${row.role || 'N/A'} (${row.family}) runs ${Math.abs(worst.gapEffective).toFixed(1)} FTE short of its ${worst.seats} blueprint seats in ${worst.label}`,
        detail: `${best} month${best === 1 ? '' : 's'} below blueprint. ${drivers.size ? 'Driven by ' + [...drivers].join('; ') + '.' : ''} ${hasBackfill ? 'A requisition exists.' : 'No requisition raised.'}`
      });
    });

    risks.sort((a, b) => (b.severity * b.months) - (a.severity * a.months));
    return risks;
  }

  /* ---------- bus factor / single point of failure ------------------------ */
  function busFactor(state, date, scenario, filter) {
    const ev = evaluate(state, date, scenario, { filter });
    const out = [];

    // Roles held by exactly one person.
    ev.perRole.forEach(v => {
      const humans = v.members.filter(m => !m.isPipeline && m.onRoll > 0);
      if (humans.length === 1 && v.seats > 0) {
        const only = humans[0];
        const atRisk = only.state === STATES.ON_LEAVE || only.state === STATES.ON_NOTICE || only.state === STATES.GARDEN;
        out.push({
          kind: 'role', label: v.key, holder: only.name,
          risk: atRisk ? 'high' : 'medium',
          note: atRisk ? `Sole holder and currently ${only.reason}` : 'Sole holder of this role'
        });
      }
    });

    // Skills held by exactly one active person.
    const skillMap = new Map();
    ev.perPerson.forEach(r => {
      if (r.state === STATES.DEPARTED || r.state === STATES.NOT_STARTED) return;
      (r.person.skills || []).forEach(s => {
        if (!skillMap.has(s)) skillMap.set(s, []);
        skillMap.get(s).push(r);
      });
    });
    skillMap.forEach((holders, skill) => {
      if (holders.length === 1) {
        const only = holders[0];
        const atRisk = only.state === STATES.ON_LEAVE || only.state === STATES.ON_NOTICE || only.state === STATES.GARDEN;
        out.push({
          kind: 'skill', label: skill, holder: only.name,
          risk: atRisk ? 'high' : 'medium',
          note: atRisk ? `Only holder and currently ${only.reason}` : 'Only holder of this skill'
        });
      }
    });

    // Seniority: role about to lose its only senior.
    const seniorRank = lv => {
      const n = parseInt(String(lv).replace(/\D/g, ''), 10);
      return isNaN(n) ? 0 : n;
    };
    ev.perRole.forEach(v => {
      const humans = v.members.filter(m => !m.isPipeline);
      if (humans.length < 2) return;
      const ranked = humans.filter(h => seniorRank(h.level) > 0);
      if (!ranked.length) return;
      const top = Math.max(...ranked.map(h => seniorRank(h.level)));
      const tops = ranked.filter(h => seniorRank(h.level) === top);
      if (tops.length === 1 && (tops[0].state === STATES.ON_NOTICE || tops[0].state === STATES.ON_LEAVE)) {
        out.push({
          kind: 'seniority', label: v.key, holder: tops[0].name, risk: 'high',
          note: `Only person at level ${tops[0].level} in this role and currently ${tops[0].reason}`
        });
      }
    });

    const order = { high: 0, medium: 1, low: 2 };
    return out.sort((a, b) => order[a.risk] - order[b.risk] || a.label.localeCompare(b.label));
  }

  /* ---------- orphaned accounts ------------------------------------------- */
  function accountCoverage(state, date, scenario) {
    const ev = evaluate(state, date, scenario);
    const byPerson = new Map();
    (state.assignments || []).forEach(a => {
      if (!byPerson.has(a.personId)) byPerson.set(a.personId, []);
      byPerson.get(a.personId).push(a);
    });

    const accounts = (state.accounts || []).map(acc => {
      const owners = (state.assignments || []).filter(a => a.accountId === acc.id).map(a => {
        const r = ev.byId.get(a.personId);
        return { assignment: a, person: r, weight: a.weight || 1 };
      }).filter(o => o.person);
      const covered = owners.filter(o => o.person.effective > 0);
      const lost = owners.filter(o => o.person.state === STATES.DEPARTED || o.person.state === STATES.ON_LEAVE);
      return {
        account: acc, owners, covered, lost,
        coverage: covered.reduce((s, o) => s + o.weight, 0),
        required: acc.requiredCoverage || 1,
        orphaned: covered.length === 0 && owners.length > 0,
        atRisk: covered.length > 0 && lost.length > 0
      };
    });

    // Load per person: total assignment weight they carry, effective-adjusted.
    const load = ev.perPerson.filter(r => r.effective > 0).map(r => {
      const items = byPerson.get(r.id) || [];
      const weight = items.reduce((s, a) => s + (a.weight || 1), 0);
      return { person: r, accounts: items.length, weight, loadPerFte: r.effective ? +(weight / r.effective).toFixed(2) : Infinity };
    }).sort((a, b) => b.loadPerFte - a.loadPerFte);

    return { accounts, load, ev, orphaned: accounts.filter(a => a.orphaned), atRisk: accounts.filter(a => a.atRisk) };
  }

  /* ---------- attrition stress test --------------------------------------- */
  /** Deterministic band rather than a real Monte Carlo — same intuition,
      reproducible numbers, and no random noise in a leadership pack. */
  function attritionBand(state, scenario, fy, ratePct) {
    const rate = (typeof ratePct === 'number' ? ratePct : (state.settings.attritionRate || 8)) / 100;
    const rb = ribbon(state, scenario, fy);
    return rb.totalsRow.map((t, i) => {
      const monthsElapsed = i + 1;
      const expectedLoss = t.effective * rate * (monthsElapsed / 12);
      return {
        label: t.label, month: t.month, seats: t.seats,
        p50: +(t.effective - expectedLoss).toFixed(2),
        p80: +(t.effective - expectedLoss * 1.8).toFixed(2),
        plan: t.effective
      };
    });
  }

  /* ---------- span of control --------------------------------------------- */
  function spans(state, date, scenario, filter) {
    const ev = evaluate(state, date, scenario, { filter });
    const managers = new Map();
    ev.perPerson.forEach(r => {
      if (r.state === STATES.DEPARTED || r.state === STATES.NOT_STARTED) return;
      const m = r.manager || '—';
      if (!managers.has(m)) managers.set(m, { manager: m, reports: [], effective: 0, onRoll: 0 });
      const b = managers.get(m);
      b.reports.push(r); b.effective += r.effective; b.onRoll += r.onRoll;
    });
    const min = state.settings.spanMin || 4, max = state.settings.spanMax || 10;
    return [...managers.values()].map(m => {
      m.span = m.reports.length;
      m.effective = +m.effective.toFixed(2);
      m.onRoll = +m.onRoll.toFixed(2);
      m.leaveDrag = +(m.onRoll - m.effective).toFixed(2);
      m.flag = m.span > max ? 'wide' : m.span < min ? 'narrow' : 'ok';
      return m;
    }).sort((a, b) => b.span - a.span);
  }

  /* ---------- data quality ------------------------------------------------ */
  function dataQuality(state) {
    const issues = [];
    const names = new Set((state.people || []).map(p => p.name));
    const seatKeys = new Set((state.blueprint || []).map(b => roleKey(b.family, b.role)));

    (state.people || []).forEach(p => {
      const add = (sev, msg, fix) => issues.push({ severity: sev, person: p.name, id: p.id, message: msg, fix });
      if (!p.name) add('high', 'Person has no name');
      if (!p.family) add('high', 'No job family — excluded from blueprint roll-up', 'family');
      if (!p.blueprintRole || p.blueprintRole === 'N/A') add('medium', 'No blueprint role assigned', 'blueprintRole');
      if (p.manager && !names.has(p.manager)) add('high', `Manager "${p.manager}" is not a person in this model`, 'manager');
      if (!p.manager && p.name) add('low', 'No manager — will sit at the top of the org chart', 'manager');
      if (!(+p.fte > 0)) add('high', 'FTE is zero or missing', 'fte');
      if (!p.level) add('low', 'No level set — excluded from seniority analysis', 'level');
      (p.events || []).forEach(e => {
        if (!valid(e.date)) add('high', `${e.type} event has an invalid date`, 'events');
        if (e.type === 'leave' && !valid(e.endDate)) add('medium', 'Leave has no expected return date — assumed open-ended', 'events');
        if (e.type === 'leave' && valid(e.endDate) && e.endDate < e.date) add('high', 'Leave ends before it starts', 'events');
      });
      const exits = (p.events || []).filter(e => e.type === 'exit');
      if (exits.length > 1) add('medium', 'More than one exit event — the earliest is used', 'events');
    });

    (state.requisitions || []).forEach(r => {
      if (!valid(r.expectedStartDate)) {
        issues.push({ severity: 'medium', person: r.pcnId || 'Requisition', id: r.id, message: 'Requisition has no expected start date — contributes no capacity', fix: 'expectedStartDate' });
      }
      if (!r.targetRole) issues.push({ severity: 'medium', person: r.pcnId || 'Requisition', id: r.id, message: 'Requisition has no target role', fix: 'targetRole' });
    });

    /* Seat establishment problems — these distort every gap in the app. */
    const seen = new Map();
    (state.blueprint || []).forEach(b => {
      const k = roleKey(b.family, b.role);
      const stamp = k + '@' + (b.effectiveFrom || '');
      const add = (sev, msg, fix) => issues.push({ severity: sev, person: k, id: b.id, message: msg, fix, isSeat: true });
      if (!b.family) add('high', 'Seat row has no job family — it can never match a person', 'family');
      if (b.effectiveFrom && !valid(b.effectiveFrom)) add('high', 'Seat change has an invalid effective date', 'effectiveFrom');
      if (seen.has(stamp)) add('medium', 'Duplicate seat row for the same role and date — only one is used', 'seats');
      seen.set(stamp, true);
    });
    // Roles carrying people but no established seats: real work, no budget line.
    const peopleKeys = new Map();
    (state.people || []).forEach(p => {
      if (!p.family && !p.blueprintRole) return;
      const k = roleKey(p.family, p.blueprintRole);
      peopleKeys.set(k, (peopleKeys.get(k) || 0) + 1);
    });
    peopleKeys.forEach((n, k) => {
      if (!seatKeys.has(k)) {
        issues.push({
          severity: 'medium', person: k, id: k, isSeat: true,
          message: `${n} ${n === 1 ? 'person sits' : 'people sit'} in this role but it has no seats allocated`,
          fix: 'seats'
        });
      }
    });

    const order = { high: 0, medium: 1, low: 2 };
    return issues.sort((a, b) => order[a.severity] - order[b.severity]);
  }

  /* ---------- diff / snapshots -------------------------------------------- */
  function diffStates(a, b) {
    const out = [];
    const ai = new Map((a.people || []).map(p => [p.id, p]));
    const bi = new Map((b.people || []).map(p => [p.id, p]));
    const fields = ['name', 'manager', 'family', 'blueprintRole', 'fte', 'level', 'jobTitle', 'location'];

    bi.forEach((p, id) => {
      if (!ai.has(id)) { out.push({ kind: 'added', name: p.name, detail: 'Added to the model' }); return; }
      const q = ai.get(id);
      fields.forEach(f => {
        if (String(q[f] ?? '') !== String(p[f] ?? '')) {
          out.push({ kind: 'changed', name: p.name, detail: `${f}: "${q[f] ?? ''}" → "${p[f] ?? ''}"` });
        }
      });
      const es = x => (x.events || []).map(e => `${e.type}:${e.date}${e.endDate ? '→' + e.endDate : ''}`).sort().join(', ');
      if (es(q) !== es(p)) out.push({ kind: 'changed', name: p.name, detail: `timeline: [${es(q)}] → [${es(p)}]` });
    });
    ai.forEach((p, id) => { if (!bi.has(id)) out.push({ kind: 'removed', name: p.name, detail: 'Removed from the model' }); });

    const bpKeys = new Set();
    const bpMap = st => {
      const m = new Map();
      (st.blueprint || []).forEach(x => {
        const k = roleKey(x.family, x.role) + (x.effectiveFrom ? ` (from ${x.effectiveFrom})` : '');
        m.set(k, (m.get(k) || 0) + (+x.seats || 0));
        bpKeys.add(k);
      });
      return m;
    };
    const bpA = bpMap(a), bpB = bpMap(b);
    bpKeys.forEach(k => {
      const x = bpA.get(k), y = bpB.get(k);
      if (x === y) return;
      out.push({
        kind: 'blueprint', name: k,
        detail: y === undefined ? `seat row removed (was ${x})`
          : x === undefined ? `seat row added (${y})`
            : `seats: ${x} → ${y}`
      });
    });
    return out;
  }

  return {
    SCHEMA_VERSION, EVENT_TYPES, LEAVE_KINDS, HIRING_STAGES, STAGE_PROBABILITY,
    EMPLOYMENT_TYPES, NON_HEADCOUNT_TYPES, countsHeadcount,
    DEFAULT_RAMP, STATES, MONTH_NAMES, ROLE_STATUS,
    uid, iso, parse, valid, today, addMonths, addDays, monthStart, monthEnd,
    monthsBetween, daysBetween, monthLabel, longDate,
    fyStart, fyEnd, fyOf, fyMonths, roleKey, splitKey, roleFor, ROLE_ALIASES,
    emptyState, normalisePerson, normaliseSeatRow, migrate, rampFactor,
    evaluatePerson, evaluateRequisition, seatsAt, evaluate,
    seatHistory, setSeats, removeSeatRow, renameRole, classifyRole, roleStatus,
    waterfall, capacityFlow, ribbon, riskRadar, busFactor, accountCoverage,
    attritionBand, spans, dataQuality, diffStates
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ENGINE;
