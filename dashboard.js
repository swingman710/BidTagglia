// Bounce back to login if not signed in.
const currentUser = sessionStorage.getItem("battag_user");
if (!currentUser) {
  window.location.href = "index.html";
}

// Personalize the brand-header user chip.
document.getElementById("user-name").textContent = currentUser || "user";
document.getElementById("user-avatar").textContent = (currentUser || "?")
  .charAt(0)
  .toUpperCase();

document.getElementById("logout").addEventListener("click", () => {
  sessionStorage.removeItem("battag_user");
  sessionStorage.removeItem("battag_admin");
  window.location.href = "index.html";
});

// ---------- Opportunity storage (Supabase) ----------
// Each bid is one row: { id, created_at, data: <bid object> }. We keep an
// in-memory cache so render()/distinctPrev() can stay synchronous; the cache
// is refreshed from Supabase on load and after every write.

let oppsCache = [];
let estimatorChart = null;

function loadOpps() {
  return oppsCache;
}

async function fetchOpps() {
  const { data, error } = await sb
    .from(SUPABASE_TABLE)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Supabase load error:", error.message);
    return oppsCache;
  }
  oppsCache = (data || []).map((row) => ({
    ...row.data,
    id: row.id,
    createdAt: row.created_at,
  }));
  return oppsCache;
}

async function refreshOpps() {
  await fetchOpps();
  render();
  renderCharts(oppsCache);
}

// ---------- Static option sets ----------

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
  const d = new Date(`${value}T12:00:00`);
  if (isNaN(d)) return value;
  return d.toLocaleDateString();
}

function oppValue(o) {
  return Number(o.budgetedProjectValue ?? o.value ?? 0) || 0;
}

// Map an opportunity status to a pill color class.
function statusClass(status) {
  const v = (status || "").toLowerCase();
  if (v.includes("won")) return "won";
  if (v.includes("lost") || v.includes("no bid")) return "lost";
  if (v.includes("hold")) return "hold";
  return "open";
}

// "Active" = still in play (excludes Won / Lost / No Bid).
const ACTIVE_STATUSES = [
  "Opportunity", "Pending", "Pursuing", "Budgeting", "On Hold (Bid)",
];
function isActive(o) {
  return ACTIVE_STATUSES.includes(o.status);
}

// Funnel segment colors per status.
const STATUS_COLORS = {
  "Opportunity": "#2563eb",
  "Pending": "#0891b2",
  "Pursuing": "#7c3aed",
  "Budgeting": "#d97706",
  "On Hold (Bid)": "#64748b",
  "Won": "#16a34a",
  "Lost": "#dc2626",
  "No Bid": "#475569",
};

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

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function renderStats(opps) {
  const values = opps.map(oppValue);
  const total = values.reduce((sum, v) => sum + v, 0);
  const top = values.reduce((max, v) => Math.max(max, v), 0);
  const med = median(values);

  document.getElementById("stat-count").textContent = opps.length;
  document.getElementById("stat-total").textContent = currency.format(total);
  document.getElementById("stat-avg").textContent = currency.format(med);
  document.getElementById("stat-top").textContent = currency.format(top);
}

function render() {
  const opps = loadOpps();

  renderStats(opps);
  count.textContent = opps.length;

  const query = search.value.trim().toLowerCase();
  const visible = query
    ? opps.filter((o) =>
        [o.name, o.division, o.projectManager, o.ownerCustomer].some((f) =>
          (f || "").toLowerCase().includes(query)
        )
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
    pmTd.className = "col-pm";
    pmTd.textContent = opp.projectManager || "—";

    const statusTd = document.createElement("td");
    statusTd.className = "col-status";
    if (opp.status) {
      const pill = document.createElement("span");
      pill.className = `status ${statusClass(opp.status)}`;
      pill.textContent = opp.status;
      statusTd.appendChild(pill);
    } else {
      statusTd.textContent = "—";
    }

    tr.append(nameTd, divTd, dueTd, valueTd, pmTd, statusTd);
    rows.appendChild(tr);
  }
}

// ---------- Charts ----------

function renderCharts(opps) {
  renderFunnel(opps);
  if (typeof Chart !== "undefined") renderEstimatorChart(opps);
}

// Bid pipeline funnel: one segment per status, sized by total project value.
function renderFunnel(opps) {
  const el = document.getElementById("funnel");
  if (!el) return;

  const totals = {};
  for (const o of opps) {
    const v = oppValue(o);
    if (v <= 0) continue;
    const s = o.status || "Unspecified";
    totals[s] = (totals[s] || 0) + v;
  }

  const segs = Object.entries(totals)
    .map(([status, value]) => ({ status, value }))
    .sort((a, b) => b.value - a.value);

  if (!segs.length) {
    el.innerHTML = '<div class="chart-empty">No pipeline data yet.</div>';
    return;
  }

  const n = segs.length;
  const max = segs[0].value;
  const minW = 16; // smallest segment width (%)
  const gap = 1.4;
  const segH = 100 / n;
  const widthPct = (v) => minW + (100 - minW) * (v / max);

  let polys = "";
  let labels = "";
  segs.forEach((seg, i) => {
    const topW = widthPct(seg.value);
    const botW = i < n - 1 ? widthPct(segs[i + 1].value) : topW;
    const y0 = i * segH + gap / 2;
    const y1 = (i + 1) * segH - gap / 2;
    const color = STATUS_COLORS[seg.status] || "#94a3b8";
    polys +=
      `<polygon points="${(100 - topW) / 2},${y0} ${(100 + topW) / 2},${y0} ` +
      `${(100 + botW) / 2},${y1} ${(100 - botW) / 2},${y1}" fill="${color}">` +
      `<title>${seg.status}: ${currency.format(seg.value)}</title></polygon>`;
    const top = ((i + 0.5) / n) * 100;
    labels +=
      `<div class="funnel-label" style="top:${top}%">` +
      `${seg.status} · ${currency.format(seg.value)}</div>`;
  });

  el.innerHTML =
    `<svg viewBox="0 0 100 100" preserveAspectRatio="none">${polys}</svg>` +
    `<div class="funnel-labels">${labels}</div>`;
}

// Line chart: # of active opportunities per lead estimator.
function renderEstimatorChart(opps) {
  const canvas = document.getElementById("estimatorChart");
  if (!canvas) return;
  const body = canvas.parentElement;

  const counts = {};
  for (const o of opps) {
    if (!isActive(o)) continue;
    const e = (o.leadEstimator || "").trim();
    if (!e) continue;
    counts[e] = (counts[e] || 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const labels = entries.map((e) => e[0]);
  const data = entries.map((e) => e[1]);

  let emptyEl = body.querySelector(".chart-empty");
  if (estimatorChart) estimatorChart.destroy();

  if (!labels.length) {
    canvas.style.display = "none";
    if (!emptyEl) {
      emptyEl = document.createElement("div");
      emptyEl.className = "chart-empty";
      emptyEl.textContent = "No active bids yet.";
      body.appendChild(emptyEl);
    }
    return;
  }
  canvas.style.display = "";
  if (emptyEl) emptyEl.remove();

  estimatorChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Active opportunities",
          data,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37,99,235,0.12)",
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointBackgroundColor: "#2563eb",
          pointHoverRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0, stepSize: 1 },
          title: { display: true, text: "# of active opportunities" },
        },
        x: {
          title: { display: true, text: "Lead estimator" },
          ticks: { maxRotation: 60, minRotation: 30, autoSkip: false, font: { size: 10 } },
        },
      },
    },
  });
}

// ---------- Form field builders ----------

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

// Searchable multi-select combobox: a text field that filters a dropdown of
// checkbox options; checking adds it as a chip. Stores the selection on the
// container so readForm() can pull it via container._getSelected().
function buildMultiCombo(container, options) {
  container.innerHTML = "";
  const selected = new Set();

  const control = document.createElement("div");
  control.className = "mc-control";
  const chips = document.createElement("span");
  chips.className = "mc-chips";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "mc-input";
  input.placeholder = "Search…";
  control.append(chips, input);

  const panel = document.createElement("div");
  panel.className = "mc-panel";
  panel.hidden = true;

  container.append(control, panel);

  function renderChips() {
    chips.innerHTML = "";
    for (const v of selected) {
      const chip = document.createElement("span");
      chip.className = "mc-chip";
      chip.textContent = v;
      const x = document.createElement("button");
      x.type = "button";
      x.className = "mc-chip-x";
      x.textContent = "✕";
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        selected.delete(v);
        renderChips();
        if (!panel.hidden) renderPanel();
      });
      chip.appendChild(x);
      chips.appendChild(chip);
    }
  }

  function renderPanel() {
    const q = input.value.trim().toLowerCase();
    panel.innerHTML = "";
    const matches = options.filter((o) => o.toLowerCase().includes(q));
    if (!matches.length) {
      const none = document.createElement("div");
      none.className = "mc-none";
      none.textContent = "No matches";
      panel.appendChild(none);
      return;
    }
    for (const o of matches) {
      const row = document.createElement("label");
      row.className = "mc-option";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.has(o);
      cb.addEventListener("change", () => {
        if (cb.checked) selected.add(o);
        else selected.delete(o);
        renderChips();
      });
      const span = document.createElement("span");
      span.textContent = o;
      row.append(cb, span);
      panel.appendChild(row);
    }
  }

  function open() {
    panel.hidden = false;
    renderPanel();
  }
  function close() {
    panel.hidden = true;
  }

  control.addEventListener("click", () => {
    input.focus();
    open();
  });
  input.addEventListener("input", open);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
      input.blur();
    }
  });
  document.addEventListener("click", (e) => {
    if (!container.contains(e.target)) close();
  });

  container._getSelected = () => [...selected];
  renderChips();
}

function buildForm() {
  // Dropdowns
  fillSelect("f-division", FIELD_LISTS.division);
  fillSelect("f-status", FIELD_LISTS.opportunityStatus);
  fillSelect("f-bid-category", FIELD_LISTS.bidCategory);
  fillSelect("f-bid-type", FIELD_LISTS.bidType);
  fillSelect("f-contract-type", FIELD_LISTS.contractType);
  fillSelect("f-delivery-method", FIELD_LISTS.deliveryMethod);
  fillSelect("f-market-segment", FIELD_LISTS.marketSegment);
  fillSelect("f-state", STATES);

  // Searchable comboboxes (single)
  fillDatalist("dl-pm", FIELD_LISTS.projectManager);
  fillDatalist("dl-lead-estimator", FIELD_LISTS.leadEstimator);
  fillDatalist("dl-industry", FIELD_LISTS.industry);

  // Comboboxes that learn from previous entries
  for (const [key, id] of PREV_COMBOS) fillDatalist(id, distinctPrev(key));

  // Searchable multi-combobox (multi)
  buildMultiCombo(document.getElementById("mc-local-unions"), FIELD_LISTS.localUnions);
}

// ---------- Modal ----------

function openModal() {
  oppForm.reset();
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

async function addOpp(opp) {
  const { error } = await sb.from(SUPABASE_TABLE).insert({ data: opp });
  if (error) {
    alert("Could not save opportunity: " + error.message);
    return;
  }
  await refreshOpps();
}

async function deleteOpp(id) {
  const { error } = await sb.from(SUPABASE_TABLE).delete().eq("id", id);
  if (error) {
    alert("Could not delete opportunity: " + error.message);
    return;
  }
  await refreshOpps();
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
    status: val("f-status"),
    leadEstimator: val("f-lead-estimator"),

    ownerCustomer: val("f-owner"),
    cm: val("f-cm"),
    architect: val("f-architect"),
    engineer: val("f-engineer"),
    localUnions: document.getElementById("mc-local-unions")._getSelected(),

    marketSegment: val("f-market-segment"),
    industry: val("f-industry"),
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

refreshOpps();
