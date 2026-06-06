// NOTE: Placeholder, client-side credential check for the layout prototype
// only. It is NOT secure — anyone can read these values in the browser.
// Replace with real server-side / SharePoint auth before launch.

const USER = {
  username: "trossi",
  password: "tre6616",
};

// To change the admin login, edit these two values.
const ADMIN = {
  username: "admin",
  password: "battag-admin",
};

const form = document.getElementById("login-form");
const error = document.getElementById("error");
const adminToggle = document.getElementById("admin-toggle");
const brandSub = document.getElementById("brand-sub");
const submitBtn = document.getElementById("submit-btn");
const foot = document.getElementById("foot");

// ---------- Toggle between user and admin sign-in ----------

let adminMode = false;

adminToggle.addEventListener("click", () => {
  adminMode = !adminMode;
  error.classList.remove("show");

  if (adminMode) {
    brandSub.textContent = "Administrator access";
    submitBtn.textContent = "Sign in as admin";
    foot.textContent = "Administrator sign-in";
    adminToggle.textContent = "← Back to user login";
  } else {
    brandSub.textContent = "Bid & opportunity tracker";
    submitBtn.textContent = "Sign in";
    foot.textContent = "Authorized users only";
    adminToggle.textContent = "Admin access →";
  }
});

// ---------- Sign in ----------

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  const account = adminMode ? ADMIN : USER;

  if (username === account.username && password === account.password) {
    error.classList.remove("show");
    sessionStorage.setItem("battag_user", username);

    if (adminMode) {
      sessionStorage.setItem("battag_admin", "1");
      window.location.href = "admin.html";
    } else {
      sessionStorage.removeItem("battag_admin");
      window.location.href = "dashboard.html";
    }
  } else {
    error.classList.add("show");
  }
});
