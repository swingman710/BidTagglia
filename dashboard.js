// Bounce back to login if not signed in.
const currentUser = sessionStorage.getItem("battag_user");
if (!currentUser) {
  window.location.href = "index.html";
}

// Personalize the sidebar user card.
document.getElementById("user-name").textContent = currentUser || "user";
document.getElementById("user-avatar").textContent = (currentUser || "?")
  .charAt(0)
  .toUpperCase();

document.getElementById("logout").addEventListener("click", () => {
  sessionStorage.removeItem("battag_user");
  sessionStorage.removeItem("battag_admin");
  window.location.href = "index.html";
});

// ---------- Opportunity storage ----------
// Placeholder persistence using localStorage. Replace load/save with the
// SharePoint API later and the rest of the UI stays the same.

const STORAGE_KEY = "battag_opportunities";

function loadOpps() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveOpps(opps) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(opps));
}

// ---------- Helpers ----------

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Map a Status value to a pill color class (best-effort by keyword).
function statusClass(value) {
  const v = (value || "").toLowerCase();
  if (/(won|win|signed|closed|award)/.test(v)) return "won";
  if (/(lost|lose|declined|rejected|dead)/.test(v)) return "lost";
  return "open";
}

// ---------- Rendering ----------

const rows = document.getElementById("bid-rows");
const empty = document.getElementById("empty");
const count = document.getElementById("count");
const search = document.getElementById("search");
const headRow = document.getElementById("table-head-row");

function renderStats(opps) {
  const total = opps.reduce((sum, o) => sum + o.value, 0);
  const top = opps.reduce((max, o) => Math.max(max, o.value), 0);
  const avg = opps.length ? total / opps.length : 0;

  document.getElementById("stat-count").textContent = opps.length;
  document.getElementById("stat-total").textContent = currency.format(total);
  document.getElementById("stat-avg").textContent = currency.format(avg);
  document.getElementById("stat-top").textContent = currency.format(top);
}

function renderHeader(listNames) {
  // Rebuild header: Opportunity | Value | <each list> | actions
  headRow.innerHTML = "";

  const nameTh = document.createElement("th");
  nameTh.textContent = "Opportunity";

  const valueTh = document.createElement("th");
  valueTh.className = "col-value";
  valueTh.textContent = "Value";

  headRow.append(nameTh, valueTh);

  for (const name of listNames) {
    const th = document.createElement("th");
    th.textContent = name;
    headRow.appendChild(th);
  }

  const actionsTh = document.createElement("th");
  actionsTh.className = "col-actions";
  headRow.appendChild(actionsTh);
}

function render() {
  const opps = loadOpps();
  const lists = loadLists();
  const listNames = Object.keys(lists);

  renderStats(opps);
  renderHeader(listNames);
  count.textContent = opps.length;

  const query = search.value.trim().toLowerCase();
  const visible = query
    ? opps.filter((o) => o.name.toLowerCase().includes(query))
    : opps;

  rows.innerHTML = "";

  if (visible.length === 0) {
    empty.style.display = "block";
    empty.textContent =
      opps.length === 0
        ? "No opportunities yet — add one above."
        : "No opportunities match your search.";
    return;
  }
  empty.style.display = "none";

  for (const opp of visible) {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = opp.name;

    const valueTd = document.createElement("td");
    valueTd.className = "col-value";
    valueTd.textContent = currency.format(opp.value);

    tr.append(nameTd, valueTd);

    for (const name of listNames) {
      const td = document.createElement("td");
      const value = (opp.fields && opp.fields[name]) || "";
      if (!value) {
        td.textContent = "—";
      } else if (name.toLowerCase() === "status") {
        const pill = document.createElement("span");
        pill.className = `status ${statusClass(value)}`;
        pill.textContent = value;
        td.appendChild(pill);
      } else {
        td.textContent = value;
      }
      tr.appendChild(td);
    }

    const actionTd = document.createElement("td");
    actionTd.className = "col-actions";
    const del = document.createElement("button");
    del.className = "btn-delete";
    del.textContent = "Delete";
    del.addEventListener("click", () => deleteOpp(opp.id));
    actionTd.appendChild(del);
    tr.appendChild(actionTd);

    rows.appendChild(tr);
  }
}

// ---------- Modal ----------

const modal = document.getElementById("modal");
const dynamicFields = document.getElementById("dynamic-fields");
const oppForm = document.getElementById("opp-form");

function buildDynamicFields() {
  const lists = loadLists();
  dynamicFields.innerHTML = "";

  for (const [name, options] of Object.entries(lists)) {
    const field = document.createElement("div");
    field.className = "field";

    const label = document.createElement("label");
    const id = `opp-field-${name}`;
    label.setAttribute("for", id);
    label.textContent = name;

    const select = document.createElement("select");
    select.id = id;
    select.dataset.listName = name;

    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "—";
    select.appendChild(blank);

    for (const opt of options) {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      select.appendChild(o);
    }

    field.append(label, select);
    dynamicFields.appendChild(field);
  }
}

function openModal() {
  buildDynamicFields();
  oppForm.reset();
  modal.hidden = false;
  document.getElementById("opp-name").focus();
}

function closeModal() {
  modal.hidden = true;
}

document.getElementById("new-opp").addEventListener("click", openModal);
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal-cancel").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) closeModal();
});

// ---------- Actions ----------

function addOpp(name, value, fields) {
  const opps = loadOpps();
  opps.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    value,
    fields,
  });
  saveOpps(opps);
  render();
}

function deleteOpp(id) {
  saveOpps(loadOpps().filter((o) => o.id !== id));
  render();
}

oppForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const name = document.getElementById("opp-name").value.trim();
  const value = parseFloat(document.getElementById("opp-value").value);
  if (!name || isNaN(value)) return;

  const fields = {};
  dynamicFields.querySelectorAll("select").forEach((sel) => {
    if (sel.value) fields[sel.dataset.listName] = sel.value;
  });

  addOpp(name, value, fields);
  closeModal();
});

search.addEventListener("input", render);

render();
