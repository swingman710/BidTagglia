// ===========================================================================
//  Microsoft Entra (Azure AD) sign-in via MSAL — org-only SSO.
//
//  Uses a TENANT-SPECIFIC authority so only members of your tenant can sign
//  in. Every page that needs auth loads msal-browser + this file, then calls
//  BBAuth.* (see the bottom of this file).
//
//  HOW TO TURN ON: fill in clientId + tenantId below, register the redirect
//  URI (window.location.origin + "/index.html") as a *SPA* redirect URI on the
//  Azure app registration, and serve the app over https (Vercel) — not file://.
// ===========================================================================

const AUTH_CONFIG = {
  // Azure app registration (type: Single-page application)
  clientId: "4a089262-8a27-4948-94bb-ddff0d3ba9ef",
  tenantId: "c5f603e0-e05f-4662-8438-38b1980edf73", // tenant GUID -> org-only sign-in

  // Scopes requested at sign-in. User.Read is enough to identify the user;
  // SharePoint data scopes (e.g. Sites.ReadWrite.All) get added later when the
  // data layer moves off Supabase.
  scopes: ["User.Read"],
};

// ---------------------------------------------------------------------------

(function () {
  let pca = null; // MSAL PublicClientApplication (lazy singleton)
  let readyPromise = null;

  function configured() {
    return (
      !AUTH_CONFIG.clientId.startsWith("<") && !AUTH_CONFIG.tenantId.startsWith("<")
    );
  }

  function authority() {
    return `https://login.microsoftonline.com/${AUTH_CONFIG.tenantId}`;
  }

  // The page MSAL returns to after sign-in. Must be registered as a SPA
  // redirect URI in Azure. We land on the site root (e.g. https://battag.bid/),
  // which serves the login page (index.html) and processes the response.
  function redirectUri() {
    return window.location.origin + "/";
  }

  function getMsal() {
    if (pca) return pca;
    if (typeof msal === "undefined") {
      throw new Error("MSAL library not loaded (check the script tag).");
    }
    pca = new msal.PublicClientApplication({
      auth: {
        clientId: AUTH_CONFIG.clientId,
        authority: authority(),
        redirectUri: redirectUri(),
        postLogoutRedirectUri: redirectUri(),
      },
      cache: { cacheLocation: "localStorage" },
    });
    return pca;
  }

  // Initialize MSAL and process any pending redirect response. Safe to call on
  // every page; runs at most once. Resolves to the MSAL app instance.
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      const app = getMsal();
      await app.initialize();
      const resp = await app.handleRedirectPromise();
      if (resp && resp.account) app.setActiveAccount(resp.account);
      if (!app.getActiveAccount()) {
        const all = app.getAllAccounts();
        if (all.length) app.setActiveAccount(all[0]);
      }
      return app;
    })();
    return readyPromise;
  }

  async function signIn() {
    const app = await ready();
    await app.loginRedirect({ scopes: AUTH_CONFIG.scopes });
  }

  async function signOut() {
    const app = await ready();
    await app.logoutRedirect();
  }

  async function getAccount() {
    const app = await ready();
    return app.getActiveAccount();
  }

  // For gated pages: bounce to the login screen if not signed in.
  // Returns the account, or null if a redirect was triggered.
  async function requireAuth() {
    const account = await getAccount();
    if (!account) {
      window.location.href = "index.html";
      return null;
    }
    return account;
  }

  window.BBAuth = {
    configured,
    ready,
    signIn,
    signOut,
    getAccount,
    requireAuth,
  };
})();
