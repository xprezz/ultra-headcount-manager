/* PWA, durable browser storage, spreadsheet import and Graph tree tests. */
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(__dirname, '.pwa-profile');
const PORT = 8792;
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(` ok   ${name}${detail ? `  ${detail}` : ''}`); }
  else { fail++; console.log(` FAIL ${name}  ->  ${detail}`); }
};

const mime = file => ({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png'
}[path.extname(file)] || 'application/octet-stream');

function server() {
  return http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(path.resolve(ROOT)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': mime(file), 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  }).listen(PORT, '127.0.0.1');
}

async function openContext() {
  return chromium.launchPersistentContext(PROFILE, {
    channel: 'msedge', headless: true, viewport: { width: 1400, height: 1000 },
    serviceWorkers: 'allow'
  });
}

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const srv = server();
  let context;
  try {
    context = await openContext();
    let page = context.pages()[0] || await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack || String(error)));
    await page.goto(`http://127.0.0.1:${PORT}/?scoutTheme=dark`);
    await page.waitForFunction(() => window.CUHM && window.CUHM.APP);

    ok('published app uses generic branding', await page.title() === 'Ultra Headcount Manager', await page.title());
    ok('query parameter selects dark theme',
      await page.evaluate(() => document.documentElement.dataset.theme) === 'dark');
    ok('required Clawpilot background token is active',
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(61, 59, 58)',
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
    ok('manifest is linked', await page.getAttribute('link[rel=manifest]', 'href') === './manifest.webmanifest');
    ok('service worker installs', await page.evaluate(async () => !!(await navigator.serviceWorker.ready).active));
    const manifest = await page.evaluate(() => fetch('./manifest.webmanifest').then(r => r.json()));
    ok('manifest is standalone and has install icons',
      manifest.display === 'standalone' && manifest.icons.some(icon => icon.sizes === '512x512'));

    const importResult = await page.evaluate(async () => {
      const rows = [
        ['Display Name', 'Mail', 'Reports To', 'Title', 'Department', 'Employee Type', 'FTE', 'Leave Start', 'Return Date'],
        ['Alex Analyst', 'alex@example.com', 'Morgan Manager', 'Data Analyst', 'Finance', 'Employee', '1', '', ''],
        ['Sam Student', 'sam@example.com', 'Morgan Manager', 'Assistant', 'Finance', 'Student', '0.5', '01/10/2026', '15/10/2026']
      ];
      const parsed = CUHM.IMPORTS.rowsToPeople(rows);

      const sheet = XLSX.utils.aoa_to_sheet(rows);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'Roster');
      const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
      const file = new File([bytes], 'roster.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const excelRows = await CUHM.IMPORTS.readWorkbook(file);

      const state = CUHM.ENGINE.emptyState();
      const summary = CUHM.IMPORTS.mergePeople(state, parsed.people, 'merge');
      CUHM.IMPORTS.replaceBlueprintFromPeople(state);
      return {
        parsed: parsed.people.map(p => ({
          name: p.name, family: p.family, role: p.blueprintRole,
          engagement: p.employmentType, fte: p.fte, events: p.events
        })),
        excelRows,
        summary,
        seats: state.blueprint.reduce((sum, row) => sum + row.seats, 0),
        roles: state.blueprint.map(row => row.role)
      };
    });
    ok('tolerant headers map a CSV-style roster', importResult.parsed.length === 2);
    ok('job title becomes the initial generic role',
      importResult.parsed[0].role === 'Data Analyst' && importResult.parsed[0].family === 'Finance');
    ok('student workers are classified as non-headcount',
      importResult.parsed[1].engagement === 'Student worker' && importResult.parsed[1].fte === 0.5);
    ok('leave dates import as timeline events',
      importResult.parsed[1].events[0].date === '2026-10-01' &&
      importResult.parsed[1].events[0].endDate === '2026-10-15');
    ok('real XLSX files parse in the browser', importResult.excelRows.length === 3);
    ok('derived blueprint excludes the student worker',
      importResult.seats === 1 && importResult.roles[0] === 'Data Analyst',
      JSON.stringify({ seats: importResult.seats, roles: importResult.roles }));

    const graph = await page.evaluate(async () => {
      const users = {
        leader: { '@odata.type': '#microsoft.graph.user', id: '1', displayName: 'Morgan Manager', mail: 'morgan@example.com', userPrincipalName: 'morgan@example.com', jobTitle: 'Director', department: 'Finance', officeLocation: 'London', employeeType: 'Employee', accountEnabled: true },
        alex: { '@odata.type': '#microsoft.graph.user', id: '2', displayName: 'Alex Analyst', mail: 'alex@example.com', jobTitle: 'Analyst', department: 'Finance', employeeType: 'Employee', accountEnabled: true },
        sam: { '@odata.type': '#microsoft.graph.user', id: '3', displayName: 'Sam Student', mail: 'sam@example.com', jobTitle: 'Assistant', department: 'Finance', employeeType: 'Student', accountEnabled: true },
        jo: { '@odata.type': '#microsoft.graph.user', id: '4', displayName: 'Jo Junior', mail: 'jo@example.com', jobTitle: 'Junior Analyst', department: 'Finance', employeeType: 'Employee', accountEnabled: true }
      };
      const original = window.fetch;
      window.fetch = async url => {
        const value = String(url);
        let body;
        if (value.includes('/me?')) body = users.leader;
        else if (value.includes('/users/1/directReports')) {
          body = { value: [users.alex], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/mock-next' };
        } else if (value.includes('/mock-next')) body = { value: [users.sam] };
        else if (value.includes('/users/2/directReports')) body = { value: [users.jo] };
        else body = { value: [] };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      try {
        const result = await CUHM.DIRECTORY_SYNC.fetchTreeWithToken('test-token', 'Me',
          { maxDepth: 99, includeInactive: false }, () => {});
        return result.people.map(person => ({
          name: person.name, manager: person.manager, family: person.family,
          role: person.blueprintRole, directoryId: person.directoryId
        }));
      } finally { window.fetch = original; }
    });
    ok('Graph sync follows paging and reporting levels', graph.length === 4, `${graph.length}`);
    ok('Graph sync records immediate managers',
      graph.find(p => p.name === 'Alex Analyst').manager === 'Morgan Manager' &&
      graph.find(p => p.name === 'Jo Junior').manager === 'Alex Analyst');
    ok('Graph department and title map to family and role',
      graph.find(p => p.name === 'Jo Junior').family === 'Finance' &&
      graph.find(p => p.name === 'Jo Junior').role === 'Junior Analyst');

    const durable = await page.evaluate(async () => {
      const state = CUHM.ENGINE.emptyState();
      state.people.push(CUHM.ENGINE.normalisePerson({
        name: 'Persistent Person', family: 'Operations', blueprintRole: 'Planner'
      }));
      CUHM.APP.state = state;
      CUHM.APP.ready = true;
      await CUHM.STORE.saveNow(state);
      return CUHM.STORE.getStatus();
    });
    ok('browser save reports durable IndexedDB mode',
      durable.mode === 'browser' && durable.dirty === false, JSON.stringify(durable));
    await context.close();

    context = await openContext();
    page = context.pages()[0] || await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => window.CUHM && window.CUHM.APP.ready);
    ok('state survives a complete installed-app restart',
      await page.evaluate(() => CUHM.APP.state.people.some(p => p.name === 'Persistent Person')));
    ok('no built-in CSU role aliases remain',
      await page.evaluate(() => Object.keys(CUHM.ENGINE.ROLE_ALIASES).length) === 0);
    ok('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    if (context) await context.close().catch(() => {});
    await new Promise(resolve => srv.close(resolve));
    fs.rmSync(PROFILE, { recursive: true, force: true });
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
