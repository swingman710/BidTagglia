// Login screen: "Sign in with Microsoft" (Entra org SSO via MSAL).
// The actual MSAL wiring lives in auth.js (window.BBAuth).

const signinBtn = document.getElementById("ms-signin");
const errorEl = document.getElementById("error");

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.add("show");
}

(async () => {
  if (!BBAuth.configured()) {
    signinBtn.disabled = true;
    showError("Sign-in isn't configured yet (missing Azure app/tenant IDs).");
    return;
  }
  try {
    // Processes the redirect response if we just came back from Microsoft,
    // and surfaces an existing session. Either way, head into the app.
    const account = await BBAuth.getAccount();
    if (account) window.location.href = "dashboard.html";
  } catch (e) {
    showError("Sign-in failed. Please try again.");
    console.error(e);
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
