// ===========================================================================
//  SharePoint → form dropdowns (Microsoft Graph + MSAL)
//
//  Reads option values from SharePoint list columns and merges them into the
//  same store the form already uses (battag_lists), keyed by list name. The
//  rest of the form code is unchanged — it just sees more options.
//
//  Works only when the app is served over http(s) (not file://) and the Azure
//  values below are filled in. Until SP_CONFIG.enabled is true, this file does
//  nothing and the form keeps using the locally-managed lists.
//
//  HOW TO TURN ON: fill in clientId/tenantId/site/sources, set enabled:true,
//  and serve the app from the redirect-URI origin you registered in Azure.
// ===========================================================================

const SP_CONFIG = {
  enabled: false, // flip to true once the values below are filled in

  // Azure AD app registration (SPA)
  clientId: "<AZURE_APP_CLIENT_ID>",
  tenantId: "<TENANT_ID>", // your tenant GUID, or "common"

  // Delegated Graph scope to read SharePoint lists
  scopes: ["Sites.Read.All"],

  // SharePoint site as  <tenant>.sharepoint.com:/sites/<SiteName>
  site: "<tenant>.sharepoint.com:/sites/<SiteName>",

  // Map each form dropdown to a SharePoint list + the column holding the value.
  // listKey MUST match the dropdown name in lists.js (ADMIN_LISTS), e.g.
  // "Project Manager", "Lead Estimator", "Local Unions", ...
  sources: [
    { listKey: "Project Manager", list: "Project Managers", column: "Title" },
    // { listKey: "Lead Estimator", list: "Lead Estimators", column: "Title" },
    // { listKey: "Local Unions",   list: "Local Unions",    column: "Title" },
  ],
};

// ---------------------------------------------------------------------------

(function () {
  let pca = null; // MSAL PublicClientApplication (lazy)
  let lastSync = 0; // throttle: don't re-sync more than once a minute per session

  function authority() {
    return `https://login.microsoftonline.com/${SP_CONFIG.tenantId}`;
  }

  function getMsal() {
    if (pca) return pca;
    if (typeof msal === "undefined") {
      throw new Error("MSAL library not loaded (check the script tag).");
    }
    pca = new msal.PublicClientApplication({
      auth: {
        clientId: SP_CONFIG.clientId,
        authority: authority(),
        redirectUri: window.location.origin + window.location.pathname,
      },
      cache: { cacheLocation: "localStorage" },
    });
    return pca;
  }

  async function getToken() {
    const app = getMsal();
    await app.initialize();
    await app.handleRedirectPromise();

    let account = app.getActiveAccount() || app.getAllAccounts()[0];
    if (!account) {
      const login = await app.loginPopup({ scopes: SP_CONFIG.scopes });
      account = login.account;
      app.setActiveAccount(account);
    }
    try {
      const r = await app.acquireTokenSilent({ scopes: SP_CONFIG.scopes, account });
      return r.accessToken;
    } catch {
      const r = await app.acquireTokenPopup({ scopes: SP_CONFIG.scopes });
      return r.accessToken;
    }
  }

  async function graph(url, token) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`Graph ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  async function resolveSiteId(token) {
    const data = await graph(
      `https://graph.microsoft.com/v1.0/sites/${SP_CONFIG.site}`,
      token
    );
    return data.id;
  }

  async function resolveListId(siteId, listName, token) {
    const url =
      `https://graph.microsoft.com/v1.0/sites/${siteId}/lists` +
      `?$select=id,displayName&$filter=` +
      encodeURIComponent(`displayName eq '${listName.replace(/'/g, "''")}'`);
    const data = await graph(url, token);
    if (!data.value || !data.value.length) {
      throw new Error(`List not found: ${listName}`);
    }
    return data.value[0].id;
  }

  async function fetchColumnValues(siteId, listId, column, token) {
    let url =
      `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items` +
      `?$expand=${encodeURIComponent(`fields($select=${column})`)}&$top=2000`;
    const values = [];
    while (url) {
      const data = await graph(url, token);
      for (const item of data.value || []) {
        const v = item.fields && item.fields[column];
        if (v != null && String(v).trim()) values.push(String(v).trim());
      }
      url = data["@odata.nextLink"] || null;
    }
    // distinct + sorted
    return [...new Set(values)].sort((a, b) => a.localeCompare(b));
  }

  // Public: pull every configured list and merge into battag_lists.
  // Returns true if any list changed.
  async function sync() {
    if (!SP_CONFIG.enabled) return false;
    if (Date.now() - lastSync < 60000) return false; // throttle
    lastSync = Date.now();

    const token = await getToken();
    const siteId = await resolveSiteId(token);

    const lists = loadLists();
    let changed = false;

    for (const src of SP_CONFIG.sources) {
      try {
        const listId = await resolveListId(siteId, src.list, token);
        const values = await fetchColumnValues(siteId, listId, src.column, token);
        if (JSON.stringify(lists[src.listKey] || []) !== JSON.stringify(values)) {
          lists[src.listKey] = values;
          changed = true;
        }
      } catch (e) {
        console.warn(`SharePoint sync failed for "${src.listKey}":`, e.message);
      }
    }

    if (changed) saveLists(lists);
    return changed;
  }

  window.BBSharePoint = {
    get enabled() {
      return !!SP_CONFIG.enabled;
    },
    sync,
  };
})();
