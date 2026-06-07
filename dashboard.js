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
// Placeholder persistence using localStorage. Replace load/save (and addOpp)
// with the SharePoint API later and the rest of the UI stays the same.

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

// ---------- Static option sets ----------

// Division is a fixed pick list (not admin-managed).
const DIVISIONS = ["BAI", "BEI", "BAX", "BIT", "BEI-PHI", "BEI-", "BPS"];

const STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
  "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
  "Washington", "West Virginia", "Wisconsin", "Wyoming",
];

// Admin-managed single-value comboboxes: [admin list name, datalist element id].
const ADMIN_COMBOS = [
  ["Project Manager", "dl-pm"],
  ["Lead Estimator", "dl-lead-estimator"],
  ["Bid Category", "dl-bid-category"],
  ["Bid Type", "dl-bid-type"],
  ["Contract Type", "dl-contract-type"],
  ["Delivery Method", "dl-delivery-method"],
];

// Admin-managed multi-select fields: [admin list name, checkgroup element id].
const ADMIN_MULTIS = [
  ["Local Unions", "cg-local-unions"],
  ["Market Segment", "cg-market-segment"],
  ["Industry", "cg-industry"],
];

// Comboboxes that auto-populate from values used on previous opps:
// [opp field key, datalist element id].
const PREV_COMBOS = [
  ["ownerCustomer", "dl-owner"],
  ["cm", "dl-cm"],
  ["architect", "dl-architect"],
  ["engineer", "dl-engineer"],
];

// ---------- Helpers ----------

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatDate(value) {
  if (!value) return "—";
  // Stored as yyyy-mm-dd; anchor to local noon to avoid TZ off-by-one.
  const d = new Date(`${value}T12:00:00`);
  if (isNaN(d)) return value;
  return d.toLocaleDateString();
}

// Primary headline value for stats/table (new field, with legacy fallback).
function oppValue(o) {
  return Number(o.budgetedProjectValue ?? o.value ?? 0) || 0;
}

// Distinct, non-empty previous values for a field (for auto-populate comboboxes).
function distinctPrev(key) {
  const set = new Set();
  for (const o of loadOpps()) {
    const v = (o[key] || "").trim();
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ---------- Rendering ----------

const rows = document.getElementById("bid-rows");
const empty = document.getElementById("empty");
const count = document.getElementById("count");
const search = document.getElementById("search");

function renderStats(opps) {
  const total = opps.reduce((sum, o) => sum + oppValue(o), 0);
  const top = opps.reduce((max, o) => Math.max(max, oppValue(o)), 0);
  const avg = opps.length ? total / opps.length : 0;

  document.getElementById("stat-count").textContent = opps.length;
  document.getElementById("stat-total").textContent = currency.format(total);
  document.getElementById("stat-avg").textContent = currency.format(avg);
  document.getElementById("stat-top").textContent = currency.format(top);
}

function render() {
  const opps = loadOpps();

  renderStats(opps);
  count.textContent = opps.length;

  const query = search.value.trim().toLowerCase();
  const visible = query
    ? opps.filter((o) =>
        [o.name, o.division, o.projectManager, o.ownerCustomer]
          .some((f) => (f || "").toLowerCase().includes(query))
      )
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
    nameTd.textContent = opp.name || "—";

    const divTd = document.createElement("td");
    divTd.textContent = opp.division || "—";

    const dueTd = document.createElement("td");
    dueTd.textContent = formatDate(opp.bidDueDate);

    const valueTd = document.createElement("td");
    valueTd.className = "col-value";
    valueTd.textContent = currency.format(oppValue(opp));

    const pmTd = document.createElement("td");
    pmTd.textContent = opp.projectManager || "—";

    const actionTd = document.createElement("td");
    actionTd.className = "col-actions";
    const del = document.createElement("button");
    del.className = "btn-delete";
    del.textContent = "Delete";
    del.addEventListener("click", () => deleteOpp(opp.id));
    actionTd.appendChild(del);

    tr.append(nameTd, divTd, dueTd, valueTd, pmTd, actionTd);
    rows.appendChild(tr);
  }
}

// ---------- Modal ----------

const modal = document.getElementById("modal");
const oppForm = document.getElementById("opp-form");

function fillDatalist(id, options) {
  const dl = document.getElementById(id);
  dl.innerHTML = "";
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    dl.appendChild(o);
  }
}

function fillSelect(id, options) {
  const sel = document.getElementById(id);
  sel.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "—";
  sel.appendChild(blank);
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    sel.appendChild(o);
  }
}

function fillCheckgroup(id, options) {
  const cg = document.getElementById(id);
  cg.innerHTML = "";
  if (!options.length) {
    const hint = document.createElement("span");
    hint.className = "cg-hint";
    hint.textContent = "No options yet — add them on the admin page.";
    cg.appendChild(hint);
    return;
  }
  for (const opt of options) {
    const label = document.createElement("label");
    label.className = "check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = opt;
    const span = document.createElement("span");
    span.textContent = opt;
    label.append(cb, span);
    cg.appendChild(label);
  }
}

function buildForm() {
  const lists = loadLists();

  fillSelect("f-division", DIVISIONS);
  fillSelect("f-state", STATES);

  for (const [name, id] of ADMIN_COMBOS) fillDatalist(id, lists[name] || []);
  for (const [name, id] of ADMIN_MULTIS) fillCheckgroup(id, lists[name] || []);
  for (const [key, id] of PREV_COMBOS) fillDatalist(id, distinctPrev(key));
}

async function openModal() {
  oppForm.reset();
  // Refresh any SharePoint-backed dropdowns before building the form.
  if (window.BBSharePoint && window.BBSharePoint.enabled) {
    try {
      await window.BBSharePoint.sync();
    } catch (e) {
      console.warn("SharePoint sync failed:", e);
    }
  }
  buildForm();
  modal.hidden = false;
  document.getElementById("f-name").focus();
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

// ---------- Reading the form ----------

function val(id) {
  return document.getElementById(id).value.trim();
}

function numOrNull(id) {
  const raw = document.getElementById(id).value;
  if (raw === "") return null;
  const n = parseFloat(raw);
  return isNaN(n) ? null : n;
}

function checkedValues(cgId) {
  return [...document.getElementById(cgId).querySelectorAll("input:checked")].map(
    (cb) => cb.value
  );
}

// ---------- Actions ----------

function addOpp(opp) {
  const opps = loadOpps();
  opps.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...opp,
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

  const name = val("f-name");
  if (!name) {
    document.getElementById("f-name").focus();
    return;
  }

  addOpp({
    name,
    bidDueDate: val("f-due-date"),
    division: val("f-division"),
    internalBidNumber: val("f-internal-number"),
    projectManager: val("f-pm"),
    leadEstimator: val("f-lead-estimator"),

    ownerCustomer: val("f-owner"),
    cm: val("f-cm"),
    architect: val("f-architect"),
    engineer: val("f-engineer"),
    localUnions: checkedValues("cg-local-unions"),

    marketSegment: checkedValues("cg-market-segment"),
    industry: checkedValues("cg-industry"),
    bidCategory: val("f-bid-category"),
    bidType: val("f-bid-type"),
    contractType: val("f-contract-type"),
    deliveryMethod: val("f-delivery-method"),

    flags: checkedValues("cg-flags"),
    description: val("f-description"),

    projectAddress: val("f-address"),
    city: val("f-city"),
    zipCode: val("f-zip"),
    state: val("f-state"),

    budgetedProjectValue: numOrNull("f-proj-value"),
    budgetedCost: numOrNull("f-cost"),
    budgetedLaborHours: numOrNull("f-labor-hours"),
    budgetedSquareFootage: numOrNull("f-sqft"),
    estStartDate: val("f-start-date"),
    estEndDate: val("f-end-date"),
    docsReceivedDate: val("f-docs-date"),
  });

  closeModal();
});

search.addEventListener("input", render);

render();
