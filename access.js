// ===========================================================================
//  The gate. Nothing on the dashboard loads, renders or fetches until this
//  says the person signing in is on the invite list (public.app_members).
//
//  This file must load BEFORE dashboard.js and every other view script, and
//  they must all wait on BBAccess.ready rather than booting themselves. An
//  overlay drawn on top of a dashboard that already fetched the data is not a
//  lockout — the data is already in the browser and the overlay is one
//  devtools click from gone.
//
//  Turned away = signed out of Microsoft and sent back to the login page with
//  the reason, so there is no half-open session sitting on the bid data.
//
//  FAIL CLOSED: if the directory can't be read at all, nobody gets in except
//  ADMIN_EMAIL — otherwise a Supabase outage would open the app to the whole
//  tenant. The admin is exempt so an outage can never lock out the one
//  account that can fix the list.
//
//  SCOPE — read this before trusting it with anything truly sensitive: this
//  gate governs the UI. The Supabase anon key ships in the page and the RLS
//  policies allow anon full access, so someone who knows the project URL can
//  still query the tables directly. Closing that means moving to Supabase Auth
//  with RLS scoped to the signed-in user.
// ===========================================================================

const ADMIN_EMAIL = "trossi@battag.com";

const MEMBER_ROLES = ["Admin", "Admin Super User", "Super User", "User", "Test"];

const MEMBERS_DIR_TABLE = "app_members";

// Why the login page is about to be shown again, handed over the redirect.
const DENIED_KEY = "battag_denied_reason";

(() => {
  // The key we store a person under: their sign-in address, lower-cased.
  function identityOf(account) {
    if (!account) return null;
    return String(account.email || account.name || "").trim().toLowerCase() || null;
  }

  function isAdminIdentity(identity) {
    return !!identity && identity === ADMIN_EMAIL;
  }

  // Look someone up on the invite list and stamp their visit. Returns
  // { ok, member, reason } — reason is "not-invited" | "blocked" | "unreachable".
  async function checkIn(account) {
    const identity = identityOf(account);
    if (!identity || typeof sb === "undefined") {
      return { ok: false, member: null, reason: "unreachable" };
    }

    const { data: existing, error } = await sb
      .from(MEMBERS_DIR_TABLE)
      .select("*")
      .eq("identity", identity)
      .maybeSingle();

    if (error) {
      console.error("Directory lookup failed:", error.message);
      return { ok: false, member: null, reason: "unreachable" };
    }

    if (!existing) return { ok: false, member: null, reason: "not-invited" };
    if (existing.blocked === true) {
      return { ok: false, member: existing, reason: "blocked" };
    }

    const patch = { last_active_at: new Date().toISOString() };
    if (!existing.first_seen_at) patch.first_seen_at = patch.last_active_at;
    if (account.name && account.name !== existing.name) patch.name = account.name;
    if (account.email && account.email !== existing.email) patch.email = account.email;

    const { data: updated, error: updErr } = await sb
      .from(MEMBERS_DIR_TABLE)
      .update(patch)
      .eq("id", existing.id)
      .select()
      .maybeSingle();
    if (updErr) {
      console.error("Could not stamp last active:", updErr.message);
      return { ok: true, member: existing };
    }
    return { ok: true, member: updated || existing };
  }

  // Sign out of Microsoft and go back to the login page carrying the reason.
  // Returns a promise that never resolves: callers await the gate, and a
  // rejected sign-in must not fall through into the app while the redirect is
  // still in flight.
  function lockOut(reason) {
    try {
      sessionStorage.setItem(DENIED_KEY, reason);
    } catch (e) {
      // Private mode with storage disabled — the redirect still matters more
      // than the explanation.
      console.error("Could not record the sign-in reason:", e);
    }
    // If the Microsoft sign-out can't even start, still get off this page —
    // a blank dashboard that never explains itself is the worst outcome.
    Promise.resolve()
      .then(() => BBAuth.signOut())
      .catch((e) => {
        console.error("Sign-out failed during lockout:", e);
        window.location.href = "index.html";
      });

    return new Promise(() => {});
  }

  // Reveal the page, which the inline gate style in dashboard.html hides.
  function unlockPage() {
    document.documentElement.classList.remove("gate-pending");
  }

  const ready = (async () => {
    const account = await BBAuth.requireAuth();
    if (!account) return new Promise(() => {}); // bouncing to index.html

    const identity = identityOf(account);
    const admin = isAdminIdentity(identity);
    const result = await checkIn(account);

    // The admin is never turned away by their own list: a deleted row or an
    // unreachable directory must not lock out the account that fixes it.
    if (!result.ok && !admin) return lockOut(result.reason);

    unlockPage();
    Object.assign(BBAccess, {
      granted: true,
      account,
      identity,
      member: result.member,
      isAdmin: admin,
    });
    return BBAccess;
  })();

  window.BBAccess = {
    ready,
    // Stays false for anyone the list turned away. showView() checks it before
    // running a tab's hook, so un-hiding the body by hand still gets you empty
    // tables rather than a fetch.
    granted: false,
    account: null,
    identity: null,
    member: null,
    isAdmin: false,
    checkIn,
    identityOf,
    TABLE: MEMBERS_DIR_TABLE,
  };
})();
