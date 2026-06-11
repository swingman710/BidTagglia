// Login screen: "Sign in with Microsoft" (Entra org SSO via MSAL), plus a
// manual username/password fallback. The auth wiring lives in auth.js (BBAuth).

const signinBtn = document.getElementById("ms-signin");
const errorEl = document.getElementById("error");
const loginForm = document.getElementById("login-form");

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.add("show");
}

// If already signed in (either method), skip the login screen.
(async () => {
  if (BBAuth.getManualUser()) {
    window.location.href = "dashboard.html";
    return;
  }
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
  // Microsoft sign-in needs the Azure app/tenant IDs; the manual form does not.
  if (!BBAuth.configured()) signinBtn.disabled = true;
})();

// ---- Microsoft sign-in ----
signinBtn.addEventListener("click", async () => {
  errorEl.classList.remove("show");
  try {
    await BBAuth.signIn();
  } catch (e) {
    showError("Couldn't start sign-in. Please try again.");
    console.error(e);
  }
});

// ---- Manual sign-in (verified against Supabase) ----
const submitBtn = document.getElementById("submit-btn");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.classList.remove("show");

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  submitBtn.disabled = true;
  try {
    if (await BBAuth.manualSignIn(username, password)) {
      window.location.href = "dashboard.html";
      return;
    }
    showError("Incorrect username or password.");
  } catch (err) {
    showError("Couldn't sign in. Please try again.");
    console.error(err);
  } finally {
    submitBtn.disabled = false;
  }
});
