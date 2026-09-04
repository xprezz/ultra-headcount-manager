# Ultra Headcount Manager

An installable, local-first organization capacity planner. Model blueprint seats,
leave, garden leave, departures, hiring, ramp-up, spans of control, workload and
month-by-month capacity without sending planning data to an application backend.

## What users can do

- Start with an empty model and add people, roles and seats manually.
- Import a roster from CSV, TSV, XLS or XLSX with tolerant header matching and a
  review screen before applying changes.
- Populate from a Microsoft 365 leader and every reporting level below them.
- Merge later imports/syncs without losing leave, exit, notes or assignments.
- Build an initial seat blueprint from imported employees. Student workers,
  interns, contractors, vendors, apprentices and loaned-in workers provide
  supplementary capacity but do not consume seats.
- Install the app from Edge or Chrome and keep using it offline.
- Export JSON backups, CSV reports and a standalone board pack.

## Data and privacy

The app has no application server and no telemetry.

- **Primary persistence:** IndexedDB in the installed browser profile.
- **Optional persistence:** a user-selected JSON file, with optional rolling
  backups to a chosen folder.
- **Directory sync:** delegated Microsoft Graph calls made directly from the
  browser. MSAL manages session tokens; the app does not copy tokens into its
  headcount data or send them elsewhere.
- **Spreadsheet import:** parsed locally in the browser.

Clearing site data removes the IndexedDB copy. Use **Data & reports → Export JSON
backup** or connect a JSON data file for an additional copy.

## Install

Open the published HTTPS site in Edge or Chrome and select **Install app** when it
appears in the header. The browser may also expose installation in its address bar
or application menu.

The manifest, service worker and 192/512-pixel icons are included. The complete
runtime (including the Excel reader and MSAL) is bundled into `index.html`; after
the first load, the service worker keeps the shell available offline.

## Populate from CSV or Excel

Use **Import CSV / Excel** during setup or on the Roster/Data views. The first
worksheet is imported from XLS/XLSX.

Only a name column is required. Recognized headings include:

| Model field | Accepted examples |
|---|---|
| Name | Name, Full name, Employee, Display name |
| Email | Email, Mail, UPN, User principal name |
| Manager | Manager, Reports to, Manager name |
| Job title | Job title, Title, Position |
| Family | Family, Job family, Department, Business unit, Team |
| Role | Blueprint role, Role, Position role |
| Engagement | Engagement, Employment type, Employee type, Worker type |
| Other | Level, Track, FTE, Location, Skills, Start date |
| Timeline | Leave start/end/kind, Garden leave from, Last working day |

When Role is absent, Job title becomes the initial generic role. Choose **Merge**
to preserve existing planning events for matched people, or **Replace** to start a
new roster. Matching uses directory ID, then email, then name.

## Microsoft 365 directory setup

Directory sync needs a one-time Microsoft Entra application registration:

1. Register a **Single-page application**, single tenant.
2. Add the exact redirect URI:
   `https://chmors.github.io/ultra-headcount-manager/`
3. Add Microsoft Graph **delegated** permission `User.Read.All`.
4. Grant administrator consent.
5. Do **not** create a client secret. Browser SPAs use authorization code + PKCE.
6. Put the public Application (client) ID in `config.js`.

`User.Read.All` is the least-privileged practical delegated permission for the
fields used here (`department`, `jobTitle`, `officeLocation`, `employeeType`,
`accountEnabled`) across other users. The app does not request
`Directory.Read.All`.

Microsoft's tenant may require a Service/Asset Management reference when creating
the registration. Use the approved internal registration flow and its real
service metadata; do not invent a reference.

### How sync works

The app resolves `/me`, an object ID, or a UPN. If an email is not a UPN it falls
back to an exact `mail` lookup. It then walks `/users/{id}/directReports`
breadth-first, follows every `@odata.nextLink`, records each immediate manager,
and prevents cycles. All levels are selected by default with a 5,000-person safety
limit. Disabled accounts are excluded unless explicitly included.

Graph has no transitive direct-reports endpoint, so recursion is performed by the
app. Only `#microsoft.graph.user` records are imported; directory contacts are
ignored.

## Development

Requirements: Node.js 22+ and Microsoft Edge for browser tests.

```powershell
npm ci
npm run build
npm test
```

`npm run build` writes `index.html`. It inlines all runtime JavaScript and CSS but
keeps deployment configuration, manifest, service worker and icons as normal PWA
assets.

The public synthetic suite covers the calculation engine, PWA manifest/service
worker, dark theme, real XLSX parsing, generic CSV mapping, paged recursive Graph
traversal and IndexedDB persistence across a complete browser restart.

The original organization's larger regression fixture is deliberately excluded
from source control; real employee data must never be published with the app.

## Deployment

Push `main` to GitHub. `.github/workflows/pages.yml` runs `npm ci`, builds `dist/`,
uploads only the deployable PWA assets and publishes them with GitHub Pages.

For a fork, update:

1. The redirect URI in the Entra app registration.
2. `clientId` and `tenantId` in `config.js`.
3. The redirect URI shown in this README.

## Architecture

The application remains framework-free at runtime. `build.js` concatenates plain
global modules in dependency order:

`engine → store → ui → imports → directory sync → PWA → views → app`

Dates are `YYYY-MM-DD` strings compared lexicographically. An exit date is the
last working day; a leave end date is the return date. All edits flow through
`APP.mutate`, which journals, supports undo, and autosaves.

## License

MIT — see [LICENSE](LICENSE).
