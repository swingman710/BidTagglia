// ===========================================================================
//  Microsoft Entra (Azure AD) sign-in via MSAL — org-only SSO. This is the
//  only way into the app; the username/password fallback was removed when the
//  Users tab became an invite list (see users.js).
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

  // Everyone with an address on this domain should be able to sign in. It is
  // not an allow-list (tenant guests still work) — it's used to explain
  // failures and to make sure a battag.com account is never turned away.
  orgDomain: "battag.com",

  // Scopes requested at sign-in. User.Read is enough to identify the user;
  // SharePoint data scopes (e.g. Sites.ReadWrite.All) get added later when the
  // data layer moves off Supabase.
  scopes: ["User.Read"],
};

// ---------------------------------------------------------------------------

(function () {
  let pca = null; // MSAL PublicClientApplication (lazy singleton)
  let readyPromise = null;
  let lastError = null; // why the last sign-in attempt failed, if it did

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

      // A rejected redirect is how Entra reports "this account can't sign in"
      // (wrong tenant, app assignment required, ...). Swallowing it silently
      // drops the user back on the login page with no idea why, so keep it.
      try {
        const resp = await app.handleRedirectPromise();
        if (resp && resp.account) app.setActiveAccount(resp.account);
      } catch (e) {
        lastError = e;
        console.error("Microsoft sign-in failed:", e);
      }

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
    lastError = null;
    // Always offer the account picker: without it, anyone whose browser is
    // already signed in to a different Microsoft account gets bounced by the
    // tenant check with no chance to pick their battag.com account.
    await app.loginRedirect({
      scopes: AUTH_CONFIG.scopes,
      prompt: "select_account",
    });
  }

  // True for addresses on the org domain — these must always be let through.
  function isOrgAccount(email) {
    return String(email || "").toLowerCase().endsWith(`@${AUTH_CONFIG.orgDomain}`);
  }

  // Why the last Microsoft sign-in failed: { code, message, help }. null if it
  // didn't fail. `help` is a plain-English fix for the codes we know about.
  function getLastError() {
    if (!lastError) return null;
    const code = lastError.errorCode || "";
    const message = lastError.errorMessage || lastError.message || String(lastError);
    const domain = AUTH_CONFIG.orgDomain;

    let help = "";
    if (/AADSTS50020|user_account_not_in_tenant/i.test(code + message)) {
      help =
        `That Microsoft account isn't part of the ${domain} organization. ` +
        `Sign in with your ${domain} address.`;
    } else if (/AADSTS50105|AADSTS50177/i.test(message)) {
      help =
        "Your account hasn't been given access to this app yet. Ask an admin " +
        "to assign you to it in Entra (Enterprise applications -> Users and groups).";
    } else if (/AADSTS65001|consent/i.test(message)) {
      help = "This app still needs admin consent in Entra before you can sign in.";
    } else if (/AADSTS50011|redirect_uri/i.test(message)) {
      help =
        "This site's address isn't registered as a redirect URI on the Entra " +
        "app registration.";
    }
    return { code, message, help };
  }

  function clearLastError() {
    lastError = null;
  }

  async function signOut() {
    const app = await ready();
    if (app.getActiveAccount()) {
      await app.logoutRedirect();
    } else {
      window.location.href = "index.html";
    }
  }

  async function getAccount() {
    const app = await ready();
    return app.getActiveAccount();
  }

  // For gated pages: bounce to the login screen if not signed in. Returns a
  // normalized identity ({ name, email, source }), or null if redirecting.
  // Being signed in is not the same as being allowed in — users.js checks the
  // address against the invite list on top of this.
  async function requireAuth() {
    const account = await getAccount();
    if (account) {
      return {
        name: account.name || account.username || "user",
        email: (account.username || "").toLowerCase() || null,
        source: "microsoft",
      };
    }

    window.location.href = "index.html";
    return null;
  }

  window.BBAuth = {
    configured,
    ready,
    signIn,
    signOut,
    getAccount,
    requireAuth,
    isOrgAccount,
    getLastError,
    clearLastError,
    orgDomain: AUTH_CONFIG.orgDomain,
  };
})();
