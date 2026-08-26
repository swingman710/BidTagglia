// Login screen: "Sign in with Microsoft" (Entra org SSO via MSAL). The auth
// wiring lives in auth.js (BBAuth). Whether a signed-in person is actually let
// into the app is decided by the invite list on the Users tab (users.js).

const signinBtn = document.getElementById("ms-signin");
const errorEl = document.getElementById("error");

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.add("show");
}

// If already signed in, skip the login screen.
(async () => {
  try {
    // Also processes the redirect response if we just came back from Microsoft.
    const account = await BBAuth.getAccount();
    if (account) {
      window.location.href = "dashboard.html";
      return;
    }
  } catch (e) {
    console.error(e);
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
