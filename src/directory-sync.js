/* ============================================================================
   Ultra Headcount Manager — Microsoft Graph organization bootstrap.
   Uses delegated User.Read.All; tokens remain in MSAL's session cache.
   ========================================================================== */
const DIRECTORY_SYNC = (() => {
  'use strict';
  const { el, modal, toast, confirmDialog, APP } = UI;
  const E = ENGINE;
  const CONFIG_KEY = 'uhm:graph-config';
  const SCOPES = ['User.Read.All'];
  const SELECT = 'id,displayName,mail,userPrincipalName,jobTitle,department,officeLocation,employeeType,accountEnabled';
  let client = null;
  let clientKey = '';

  function readConfig() {
    const deployment = window.UHM_DIRECTORY_CONFIG || {};
    try {
      const local = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
      return Object.assign(
        { clientId: '', tenantId: 'organizations' },
        deployment,
        local.clientId ? local : {}
      );
    } catch { return Object.assign({ clientId: '', tenantId: 'organizations' }, deployment); }
  }

  function saveConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  function redirectUri() {
    const url = new URL('./', location.href);
    url.search = '';
    url.hash = '';
    return url.href;
  }

  async function msalClient(config) {
    if (!window.msal) throw new Error('Microsoft sign-in did not load.');
    const key = `${config.clientId}|${config.tenantId}`;
    if (client && clientKey === key) return client;
    client = new msal.PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId || 'organizations'}`,
        redirectUri: redirectUri(),
        postLogoutRedirectUri: redirectUri(),
        navigateToLoginRequestUrl: false
      },
      cache: { cacheLocation: 'sessionStorage' }
    });
    await client.initialize();
    clientKey = key;
    return client;
  }

  async function token(config) {
    const app = await msalClient(config);
    let account = app.getActiveAccount() || app.getAllAccounts()[0];
    if (!account) {
      const login = await app.loginPopup({ scopes: SCOPES, prompt: 'select_account' });
      account = login.account;
      app.setActiveAccount(account);
      return login.accessToken || (await app.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
    }
    try { return (await app.acquireTokenSilent({ scopes: SCOPES, account })).accessToken; }
    catch (error) {
      if (error instanceof msal.InteractionRequiredAuthError) {
        return (await app.acquireTokenPopup({ scopes: SCOPES, account })).accessToken;
      }
      throw error;
    }
  }

  async function graphGet(pathOrUrl, accessToken) {
    const url = /^https:\/\//i.test(pathOrUrl) ? pathOrUrl : `https://graph.microsoft.com/v1.0${pathOrUrl}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).error.message || ''; } catch { detail = await response.text(); }
      const error = new Error(detail || `Microsoft Graph returned ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async function paged(path, accessToken) {
    const items = [];
    let next = path;
    while (next) {
      const page = await graphGet(next, accessToken);
      items.push(...(page.value || []));
      next = page['@odata.nextLink'] || '';
    }
    return items;
  }

  function escapeOData(value) {
    return String(value).replace(/'/g, "''");
  }

  async function resolveLeader(value, accessToken) {
    const input = String(value || '').trim();
    if (!input || /^me$/i.test(input)) return graphGet(`/me?$select=${SELECT}`, accessToken);
    try { return await graphGet(`/users/${encodeURIComponent(input)}?$select=${SELECT}`, accessToken); }
    catch (error) {
      if (error.status !== 404) throw error;
      const filter = encodeURIComponent(`mail eq '${escapeOData(input)}'`);
      const matches = await paged(`/users?$filter=${filter}&$select=${SELECT}`, accessToken);
      if (matches.length !== 1) throw new Error(matches.length ? `More than one user has mail ${input}. Use their UPN instead.` : `No user found for ${input}.`);
      return matches[0];
    }
  }

  function mapEmploymentType(value) {
    const text = String(value || '');
    if (/student/i.test(text)) return 'Student worker';
    if (/intern/i.test(text)) return 'Intern';
    if (/apprentice|trainee/i.test(text)) return 'Apprentice';
    if (/vendor/i.test(text)) return 'Vendor';
    if (/contract|external|consultant/i.test(text)) return 'Contractor';
    return 'Employee';
  }

  function personFromGraph(user, manager) {
    return E.normalisePerson({
      directoryId: user.id,
      name: user.displayName || user.mail || user.userPrincipalName || 'Unnamed user',
      email: user.mail || user.userPrincipalName || '',
      manager: manager ? manager.displayName || '' : '',
      managerDirectoryId: manager ? manager.id : '',
      jobTitle: user.jobTitle || '',
      family: user.department || '',
      blueprintRole: user.jobTitle || 'Unassigned role',
      location: user.officeLocation || '',
      employmentType: mapEmploymentType(user.employeeType),
      directoryAccountEnabled: user.accountEnabled !== false,
      events: []
    });
  }

  async function fetchTreeWithToken(accessToken, leaderValue, options, progress) {
    if (location.protocol === 'file:') throw new Error('Directory sync requires the hosted HTTPS app. Open the GitHub Pages version.');
    const leader = await resolveLeader(leaderValue, accessToken);
    const output = [];
    const visited = new Set();
    const queue = [{ user: leader, manager: null, depth: 0 }];

    while (queue.length) {
      const item = queue.shift();
      if (!item.user || !item.user.id || visited.has(item.user.id)) continue;
      visited.add(item.user.id);
      if (options.includeInactive || item.user.accountEnabled !== false) output.push(personFromGraph(item.user, item.manager));
      progress({ people: output.length, queued: queue.length, current: item.user.displayName, depth: item.depth });
      if (item.depth >= options.maxDepth) continue;
      const reports = await paged(`/users/${encodeURIComponent(item.user.id)}/directReports?$select=${SELECT}`, accessToken);
      reports
        .filter(report => !report['@odata.type'] || report['@odata.type'] === '#microsoft.graph.user')
        .forEach(report => queue.push({ user: report, manager: item.user, depth: item.depth + 1 }));
      if (visited.size > 5000) throw new Error('The organization exceeded the 5,000-person safety limit.');
    }
    return { people: output, leader, visited: visited.size };
  }

  async function fetchTree(config, leaderValue, options, progress) {
    if (!config.clientId) throw new Error('Enter the Application (client) ID from the Entra app registration.');
    return fetchTreeWithToken(await token(config), leaderValue, options, progress);
  }

  function review(result, options) {
    const mode = el('select', {},
      el('option', { value: APP.state.people.length ? 'merge' : 'replace' }, APP.state.people.length ? 'Merge into my current roster' : 'Create a new roster'),
      APP.state.people.length ? el('option', { value: 'replace' }, 'Replace my current roster') : null);
    const derive = el('input', { type: 'checkbox', checked: !APP.state.blueprint.length });
    const disabled = result.people.filter(p => p.directoryAccountEnabled === false).length;

    modal('Review directory organization', el('div', {},
      el('p', { class: 'sub' }, `${result.people.length} people found from ${result.leader.displayName} through ${options.maxDepth === 99 ? 'all reporting levels' : `${options.maxDepth} reporting levels`}.`),
      disabled ? el('p', { class: 'callout warn' }, `${disabled} disabled accounts are included.`) : null,
      UI.table([
        { label: 'Name', key: 'name' },
        { label: 'Manager', key: 'manager' },
        { label: 'Department', key: 'family' },
        { label: 'Initial role', key: 'blueprintRole' },
        { label: 'Location', key: 'location' }
      ], result.people.slice(0, 10)),
      result.people.length > 10 ? el('p', { class: 'tiny muted' }, `Showing 10 of ${result.people.length}.`) : null,
      el('label', { class: 'field', style: { marginTop: '12px' } }, 'Sync behavior', mode),
      el('label', { class: 'checkline' }, derive, ' Build the initial seat blueprint from the directory roster'),
      el('p', { class: 'tiny muted' }, 'Merge matches people by directory ID, then email, then name. Existing leave, exit, notes and assignments are preserved.'),
      el('div', { class: 'row', style: { marginTop: '14px' } },
        el('button', {
          class: 'btn primary', onclick: () => {
            const apply = () => {
              APP.ready = true;
              let summary;
              APP.mutate('Synced organization from Microsoft 365', state => {
                summary = IMPORTS.mergePeople(state, result.people, mode.value);
                if (derive.checked) IMPORTS.replaceBlueprintFromPeople(state);
                state.directorySync = {
                  leaderId: result.leader.id,
                  leaderName: result.leader.displayName,
                  syncedAt: new Date().toISOString(),
                  people: result.people.length
                };
              }, { backup: true });
              UI.closeModal();
              APP.go('people');
              toast(`Directory sync: ${summary.added} new, ${summary.updated} updated`, 'ok');
            };
            if (mode.value === 'replace' && APP.state.people.length) {
              confirmDialog('Replace the roster?', 'This removes every current person and their planning events. Snapshots remain available.', apply, 'Replace roster');
            } else apply();
          }
        }, 'Use this organization'),
        el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'))), { size: 'wide' });
  }

  function open() {
    const saved = readConfig();
    const clientId = el('input', { type: 'text', value: saved.clientId, placeholder: 'Application (client) ID' });
    const tenantId = el('input', { type: 'text', value: saved.tenantId, placeholder: 'Tenant ID or organizations' });
    const leader = el('input', { type: 'text', value: 'Me', placeholder: 'Me, UPN or email' });
    const depth = el('input', { type: 'number', min: '1', max: '99', value: '99' });
    const inactive = el('input', { type: 'checkbox' });
    const progress = el('div', { class: 'small muted', style: { marginTop: '10px' } },
      'Nothing is read until you sign in.');
    const run = el('button', {
      class: 'btn primary', onclick: async () => {
        const config = { clientId: clientId.value.trim(), tenantId: tenantId.value.trim() || 'organizations' };
        saveConfig(config);
        run.disabled = true;
        progress.textContent = 'Signing in…';
        try {
          const result = await fetchTree(config, leader.value, {
            maxDepth: Math.min(99, Math.max(1, parseInt(depth.value, 10) || 99)),
            includeInactive: inactive.checked
          }, status => {
            progress.textContent = `Reading ${status.current} · ${status.people} people found · level ${status.depth}`;
          });
          UI.closeModal();
          review(result, { maxDepth: parseInt(depth.value, 10) || 99 });
        } catch (error) {
          console.error(error);
          const admin = error.status === 403 || /consent|privilege|permission/i.test(error.message);
          progress.textContent = admin
            ? `Access was denied. An Entra administrator must grant delegated User.Read.All to this app. ${error.message}`
            : error.message;
          run.disabled = false;
        }
      }
    }, 'Sign in and preview');

    modal('Populate from Microsoft 365', el('div', {},
      el('p', { class: 'sub' }, 'Read a leader and every reporting level beneath them. The app asks only for delegated User.Read.All; it never asks for Directory.Read.All and never stores your access token itself.'),
      el('div', { class: 'grid g2' },
        el('label', { class: 'field' }, 'Application (client) ID', clientId,
          el('span', { class: 'tiny muted' }, 'Public identifier from your Entra SPA registration.')),
        el('label', { class: 'field' }, 'Tenant ID', tenantId,
          el('span', { class: 'tiny muted' }, 'Use your tenant GUID for a single-tenant app.')),
        el('label', { class: 'field' }, 'Start from leader', leader,
          el('span', { class: 'tiny muted' }, 'Me, object ID, UPN, or mail address.')),
        el('label', { class: 'field' }, 'Reporting levels', depth,
          el('span', { class: 'tiny muted' }, '99 means every level, with a 5,000-person safety limit.'))),
      el('label', { class: 'checkline' }, inactive, ' Include disabled directory accounts'),
      el('details', { style: { marginTop: '12px' } },
        el('summary', {}, 'Entra administrator setup'),
        el('div', { class: 'small setup-steps' },
          el('p', {}, 'Register a Single-page application and add this exact redirect URI:'),
          el('code', {}, redirectUri()),
          el('p', {}, 'Add Microsoft Graph delegated permission User.Read.All and grant admin consent. Do not create or paste a client secret.'))),
      progress,
      el('div', { class: 'row', style: { marginTop: '14px' } },
        run,
        el('button', { class: 'btn', onclick: UI.closeModal }, 'Cancel'))), { size: 'wide' });
  }

  return {
    SCOPES, SELECT, readConfig, saveConfig, resolveLeader,
    fetchTree, fetchTreeWithToken, personFromGraph, open
  };
})();
