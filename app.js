// Login screen: "Sign in with Microsoft" (Entra org SSO via MSAL). The auth
// wiring lives in auth.js (BBAuth). Signing in is only half of it — whether
// the account is actually let into the app is decided by the invite list, and
// anyone it turns away is signed back out and returned here (see access.js).

const signinBtn = document.getElementById("ms-signin");
const errorEl = document.getElementById("error");

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.add("show");
}

// Someone the invite list turned away was signed out and sent back here.
// access.js leaves the reason behind; show it once and clear it, so it
// doesn't reappear on an unrelated visit later in the session.
function takeDeniedReason() {
  try {
    const reason = sessionStorage.getItem("battag_denied_reason");
    if (reason) sessionStorage.removeItem("battag_denied_reason");
    return reason;
  } catch (e) {
    return null;
  }
}

const DENIED_MESSAGES = {
  "not-invited":
    "Your account hasn't been added to Battag Bid. Ask an administrator to " +
    "add your address before signing in again.",
  blocked:
    "Your access to Battag Bid has been turned off. Contact an administrator " +
    "if you think this is a mistake.",
  unreachable:
    "Battag Bid couldn't check whether you have access, so it didn't let you " +
    "in. Try again in a few minutes.",
};

// If already signed in, skip the login screen.
(async () => {
  const denied = takeDeniedReason();

  try {
    // Also processes the redirect response if we just came back from Microsoft.
    const account = await BBAuth.getAccount();

    // Not auto-forwarding after a lockout matters: if the Microsoft sign-out
    // left anything behind, sending them straight back to the dashboard would
    // bounce them here again, and again. Make them sign in deliberately.
    if (account && !denied) {
      window.location.href = "dashboard.html";
      return;
    }
  } catch (e) {
    console.error(e);
  }

  if (denied) {
    showError(DENIED_MESSAGES[denied] || DENIED_MESSAGES["not-invited"]);
    return;
  }

  // Landed back here without an account? Say why, instead of looking like
  // nothing happened.
  const failure = BBAuth.getLastError();
  if (failure) {
    showError(
      failure.help ||
        `Microsoft sign-in failed${failure.code ? ` (${failure.code})` : ""}. ` +
          failure.message
    );
  }
  if (!BBAuth.configured()) {
    signinBtn.disabled = true;
    showError("Microsoft sign-in isn't configured yet (missing Azure app IDs).");
  }
})();

signinBtn.addEventListener("click", async () => {
  errorEl.classList.remove("show");
  try {
    await BBAuth.signIn();
  } catch (e) {
    showError("Couldn't start sign-in. Please try again.");
    console.error(e);
  }
});
