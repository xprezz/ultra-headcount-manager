# Ultra Headcount Manager for Windows

A real, local-first Windows organization capacity planner. Model blueprint seats,
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
- Install from a normal Windows setup executable with Start-menu integration and
  a clean uninstaller.
- Export JSON backups, CSV reports and a standalone board pack.

## Data and privacy

The Windows app has no application server and no telemetry.

- **Primary persistence:** atomic JSON storage in
  `%LOCALAPPDATA%\Ultra Headcount Manager`, with a recovery copy and up to 20
  rolling backups.
- **Directory sync:** delegated Microsoft Graph calls made by the trusted Windows
  host. MSAL.NET uses the Windows account broker; access tokens never enter the
  application UI or headcount data.
- **Spreadsheet import:** parsed locally in the application.

The previous browser/PWA build remains available as a fallback, but it is no longer
the primary distribution.

## Install

Download the setup executable matching the PC from
[GitHub Releases](https://github.com/xprezz/ultra-headcount-manager/releases):

- `win-x64` for standard Intel/AMD Windows PCs.
- `win-arm64` for Windows on ARM.

The installer is self-contained: users do not need .NET, Node.js, a browser
extension, or administrator rights. Microsoft Edge WebView2 is part of supported
Windows 10/11 installations.

Unsigned community builds can trigger a Windows SmartScreen warning. Production
internal distribution should sign the setup files and preferably publish them
through Intune Company Portal.

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

## Microsoft 365 directory setup for the publisher

End users never enter a client ID or tenant ID. Directory sync needs one centrally
managed Microsoft Entra application registration:

1. Register a **Mobile and desktop application**, single tenant.
2. Enable public-client flows and add the broker redirect URI
   `ms-appx-web://Microsoft.AAD.BrokerPlugin/<CLIENT_ID>`.
3. Add Microsoft Graph **delegated** permission `User.Read.All`.
4. Grant administrator consent.
5. Do **not** create a client secret.
6. Store the public client ID as the `UHM_ENTRA_CLIENT_ID` repository secret. The
   release workflow embeds it into `desktopsettings.json`.

`User.Read.All` is the least-privileged practical delegated permission for the
fields used here (`department`, `jobTitle`, `officeLocation`, `employeeType`,
`accountEnabled`) across other users. The app does not request
`Directory.Read.All`.

Microsoft's tenant requires a real Service/Asset Management reference when
creating the registration. Use the approved internal registration flow and its
real service metadata; do not invent a reference. Until the publisher supplies
that approved client ID, CSV, Excel, JSON and manual setup remain fully available
and the app gives a friendly unavailable message for Microsoft 365 import.

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

Requirements: Node.js 22+, .NET 8 SDK, Inno Setup 6 and Microsoft Edge WebView2.

```powershell
npm ci
npm run build
npm test
npm run build:desktop
```

`npm run build` writes the fallback web app. `npm run build:desktop` builds
self-contained x64 and ARM64 executables and packages normal Windows setup files
under `artifacts/installers`.

The public synthetic suite covers the calculation engine, PWA manifest/service
worker, dark theme, real XLSX parsing, generic CSV mapping, paged recursive Graph
traversal and IndexedDB persistence across a complete browser restart.

The original organization's larger regression fixture is deliberately excluded
from source control; real employee data must never be published with the app.

## Deployment

Tag a release as `desktop-v1.1.0` (or dispatch the desktop workflow manually).
`.github/workflows/desktop-release.yml` tests the app, builds x64 and ARM64
installers, and attaches tagged builds to a GitHub Release. The optional
`UHM_ENTRA_CLIENT_ID` secret enables one-click Microsoft 365 import.

`.github/workflows/pages.yml` continues to publish the fallback browser build.

## Architecture

The planning UI remains framework-free. `build.js` concatenates plain global
modules in dependency order:

`engine → desktop bridge → store → ui → imports → directory sync → PWA → views → app`

The Windows host is WPF/.NET 8 with WebView2. A narrow JSON bridge exposes only
state storage, application metadata, and Microsoft 365 import. The renderer has
no direct filesystem or token access.

Dates are `YYYY-MM-DD` strings compared lexicographically. An exit date is the
last working day; a leave end date is the return date. All edits flow through
`APP.mutate`, which journals, supports undo, and autosaves.

## License

MIT — see [LICENSE](LICENSE).
