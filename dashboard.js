// Wait for the gate (access.js): signed in AND on the invite list. It never
// resolves for anyone else — they're being signed out and sent back to the
// login page — so nothing below this line runs for them.
(async () => {
  const { account } = await BBAccess.ready;

  // Personalize the brand-header user chip.
  const name = account.name || account.username || "user";
  document.getElementById("user-name").textContent = name;
  document.getElementById("user-avatar").textContent = name.charAt(0).toUpperCase();
})();

document.getElementById("logout").addEventListener("click", () => {
  BBAuth.signOut();
});

// ---------- Settings menu ----------
// The theme itself is applied by an inline script in <head>, before anything
// is painted; this only handles switching it and remembering the choice.

const THEME_KEY = "battag_theme";

function setTheme(dark) {
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  try {
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  } catch (e) {
    console.error("Could not save the theme:", e);
  }
  // Chart.js bakes its colors in at construction, so the charts have to be
  // rebuilt against the new palette rather than just restyled.
  renderCharts(loadOpps());
  refreshActiveView();
}

{
  const btn = document.getElementById("settings-toggle");
  const menu = document.getElementById("settings-menu");
  const toggle = document.getElementById("dark-toggle");

  if (btn && menu && toggle) {
    toggle.checked =
      document.documentElement.getAttribute("data-theme") === "dark";
    toggle.addEventListener("change", () => setTheme(toggle.checked));

    const close = () => {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      btn.setAttribute("aria-expanded", String(!menu.hidden));
    });
    menu.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menu.hidden) close();
    });
  }
}

// ---------- Opportunity storage (Supabase) ----------
// Each bid is one row: { id, created_at, data: <bid object> }. We keep an
// in-memory cache so render()/distinctPrev() can stay synchronous; the cache
// is refreshed from Supabase on load and after every write.

let oppsCache = [];
let estimatorChart = null;

// Every pricing quote, loaded alongside the bids.
let quotesCache = [];

// opportunity id (as text) -> price of its most recent proposal quote. Drives
// the Project Value column; see oppValue().
const proposalPrices = new Map();

// ---------- Company names ----------
// Companies are typed by hand in the quote form, so "Turner", "turner " and
// "Turner  " are the same company. Everything that lists or groups companies
// goes through here so a name appears exactly once, spelled the way we first
// saw it.

const companyDisplay = new Map(); // canonical key -> display name

function companyKey(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function rememberCompany(name) {
  const key = companyKey(name);
  if (!key) return null;
  if (!companyDisplay.has(key)) companyDisplay.set(key, String(name).trim());
  return companyDisplay.get(key);
}

// The agreed spelling for a name we've seen before (else the name, tidied up).
function canonicalCompany(name) {
  const key = companyKey(name);
  if (!key) return null;
  return companyDisplay.get(key) || String(name).trim();
}

function knownCompanies() {
  return [...companyDisplay.values()].sort((a, b) => a.localeCompare(b));
}

function loadOpps() {
  return oppsCache;
}

// Maps form (camelCase) field keys <-> Supabase (snake_case) columns.
const COLUMN_MAP = {
  name: "name",
  bidDueDate: "bid_due_date",
  bidDueTime: "bid_due_time",
  division: "division",
  internalBidNumber: "internal_bid_number",
  projectManager: "project_manager",
  status: "status",
  leadEstimator: "lead_estimator",
  ownerCustomer: "owner_customer",
  cm: "cm",
  gc: "gc",
  architect: "architect",
  engineer: "engineer",
  localUnions: "local_unions",
  marketSegment: "market_segment",
  industry: "industry",
  bidType: "bid_type",
  deliveryMethod: "delivery_method",
  flags: "flags",
  description: "description",
  projectAddress: "project_address",
  city: "city",
  zipCode: "zip_code",
  state: "state",
  budgetedProjectValue: "budgeted_project_value",
  budgetedCost: "budgeted_cost",
  finalPrice: "final_price",
  budgetedLaborHours: "budgeted_labor_hours",
  budgetedSquareFootage: "budgeted_square_footage",
  estStartDate: "est_start_date",
  estEndDate: "est_end_date",
  docsReceivedDate: "docs_received_date",
};

// Date/time columns can't accept "" — send null instead.
const DATE_FIELDS = new Set([
  "bidDueDate", "bidDueTime", "estStartDate", "estEndDate", "docsReceivedDate",
]);

// Form object -> DB row (column-per-field).
function toRow(opp) {
  const row = {};
  for (const [jsKey, col] of Object.entries(COLUMN_MAP)) {
    let v = opp[jsKey];
    if (DATE_FIELDS.has(jsKey)) v = v || null;
    row[col] = v;
  }
  return row;
}

// DB row -> form object.
function fromRow(row) {
  const opp = { id: row.id, createdAt: row.created_at };
  for (const [jsKey, col] of Object.entries(COLUMN_MAP)) {
    opp[jsKey] = row[col];
  }
  return opp;
}

// Supabase caps a single select at 1,000 rows and gives no hint that it did —
// you just get 1,000 and no error. Every table read goes through here so a
// table larger than that can't silently come back short.
const PAGE_SIZE = 1000;

async function fetchAll(table, { select = "*", order, ascending = true } = {}) {
  const out = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = sb.from(table).select(select).range(from, from + PAGE_SIZE - 1);
    if (order) q = q.order(order, { ascending });
    const { data, error } = await q;
    if (error) {
      console.error(`${table} load error:`, error.message);
      return { rows: out, error };
    }
    out.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return { rows: out, error: null };
  }
}

async function fetchOpps() {
  const { rows, error } = await fetchAll(SUPABASE_TABLE, {
    order: "created_at",
    ascending: false,
  });
  if (error) return oppsCache;
  oppsCache = rows.map(fromRow);
  return oppsCache;
}

// Loads every quote, then derives the project-value lookup from it: the most
// recent proposal per bid, "most recent" being the latest date the price was
// sent on, falling back to when the quote was entered. Quotes with no price at
// all are ignored. Every company named on a quote is registered here too.
async function fetchQuotes() {
  const { rows, error } = await fetchAll(PRICING_TABLE, {
    select: "opportunity_id, company, type, price, price_sent_on, created_at",
  });
  if (error) return quotesCache;
  quotesCache = rows;

  const stamps = new Map(); // opp id -> stamp of the quote we kept
  proposalPrices.clear();
  for (const q of quotesCache) {
    rememberCompany(q.company);
    if (q.type !== "proposal") continue;
    if (q.price == null || q.price === "") continue;
    const key = String(q.opportunity_id);
    const stamp = q.price_sent_on || q.created_at || "";
    if (proposalPrices.has(key) && stamp <= stamps.get(key)) continue;
    proposalPrices.set(key, Number(q.price));
    stamps.set(key, stamp);
  }
  return quotesCache;
}

async function refreshOpps() {
  await fetchQuotes();
  await fetchOpps();
  render();
  renderCharts(oppsCache);
  refreshActiveView(); // the Reports tab lists bids too
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

// "2:30 PM" / "14:30:00" -> "14:30" (24-hour).
function formatTime(value) {
  if (!value) return "";
  const d = new Date(`2000-01-01T${value}`);
  if (isNaN(d)) return value;
  return d.toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

// Combine the separate date + time fields for display.
function formatDueDateTime(dateVal, timeVal) {
  if (!dateVal && !timeVal) return "—";
  return [dateVal ? formatDate(dateVal) : "", formatTime(timeVal)]
    .filter(Boolean)
    .join(" ");
}

// Whole days from today until the due date. Negative = past due.
// Accepts plain dates or datetime values; only the date part matters.
function daysUntil(value) {
  if (!value) return null;
  const datePart = String(value).split("T")[0];
  const due = new Date(`${datePart}T00:00:00`);
  if (isNaN(due)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due - today) / 86400000);
}

// Project value = the most recent proposal price we sent, if there is one;
// otherwise the budgeted project value from the form.
function oppValue(o) {
  const quoted = proposalPrices.get(String(o.id));
  if (quoted != null) return quoted;
  return Number(o.budgetedProjectValue ?? o.value ?? 0) || 0;
}

// A countdown only means something while a bid is still being worked. For
// these statuses the cell is just greyed out.
const NO_COUNTDOWN_STATUSES = new Set([
  "Future Opportunity", "Lost", "No Bid", "On Hold (Bid)", "Won", "Cancelled",
]);

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
  "Future Opportunity", "Pending", "Bidding", "Budgeting", "On Hold (Bid)",
];
function isActive(o) {
  return ACTIVE_STATUSES.includes(o.status);
}

// Funnel segment colors per status.
const STATUS_COLORS = {
  "Future Opportunity": "#2563eb",
  "Pending": "#0891b2",
  "Bidding": "#7c3aed",
  "Budgeting": "#d97706",
  "On Hold (Bid)": "#64748b",
  "Won": "#16a34a",
  "Lost": "#dc2626",
  "No Bid": "#475569",
};

function distinctPrev(key) {
  const set = new Set();
  for (const o of loadOpps()) {
    const v = o[key];
    const items = Array.isArray(v) ? v : [v];
    for (const item of items) {
      const s = (item || "").trim();
      if (s) set.add(s);
    }
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

// How many rows the table draws at once. Filtering, sorting and the stat
// strip all still run over every matching bid.
const ROW_LIMIT = 1000;

function renderRowLimitNote(shown, total) {
  const note = document.getElementById("row-limit");
  if (!note) return;
  if (shown >= total) {
    note.hidden = true;
    return;
  }
  note.hidden = false;
  note.textContent =
    `Showing the first ${shown.toLocaleString()} of ${total.toLocaleString()} ` +
    "— sort or filter to bring what you need to the top.";
}

// ---------- Hiding statuses ----------
// Decided bids pile up — Lost, No Bid and Cancelled are most of the history
// and almost never what you opened the dashboard to look at — so they start
// hidden. The choice is remembered per browser.

const DEFAULT_HIDDEN = ["Lost", "No Bid", "Cancelled"];
const HIDDEN_KEY = "battag_hidden_statuses";

function loadHidden() {
  try {
    const saved = localStorage.getItem(HIDDEN_KEY);
    if (saved) return new Set(JSON.parse(saved));
  } catch (e) {
    // Storage disabled or holding something unparseable — fall back to the
    // default rather than failing to render the table at all.
    console.error("Could not read hidden statuses:", e);
  }
  return new Set(DEFAULT_HIDDEN);
}

const hiddenStatuses = loadHidden();

function saveHidden() {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenStatuses]));
  } catch (e) {
    console.error("Could not save hidden statuses:", e);
  }
}

// Every status the data actually uses, plus the standard list, so a status
// nobody has used yet can still be un-hidden ahead of time.
function allStatuses() {
  const set = new Set(FIELD_LISTS.opportunityStatus);
  for (const o of loadOpps()) set.add(o.status || "Unspecified");
  return [...set];
}

function renderStatusMenu() {
  const menu = document.getElementById("status-menu");
  if (!menu) return;
  menu.innerHTML = "";

  const counts = new Map();
  for (const o of loadOpps()) {
    const s = o.status || "Unspecified";
    counts.set(s, (counts.get(s) || 0) + 1);
  }

  const head = document.createElement("div");
  head.className = "status-menu-head";
  const shown = [...counts].reduce(
    (n, [s, c]) => (hiddenStatuses.has(s) ? n : n + c),
    0
  );
  head.innerHTML =
    "<span>Show statuses</span>" +
    `<span class="shown-count">${shown.toLocaleString()} of ` +
    `${loadOpps().length.toLocaleString()} bids</span>`;
  menu.appendChild(head);

  // Busiest statuses first — the ones worth hiding are the ones with the most
  // behind them.
  const statuses = allStatuses().sort(
    (a, b) => (counts.get(b) || 0) - (counts.get(a) || 0) || a.localeCompare(b)
  );

  for (const status of statuses) {
    const row = document.createElement("label");
    row.className = "status-opt";
    const on = !hiddenStatuses.has(status);
    row.classList.toggle("is-off", !on);

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = on;
    cb.addEventListener("change", () => {
      if (cb.checked) hiddenStatuses.delete(status);
      else hiddenStatuses.add(status);
      saveHidden();
      renderStatusMenu(); // refresh the counts and dimming
      updateStatusButton();
      render();
    });

    const pill = document.createElement("span");
    pill.className = `status ${statusClass(status)}`;
    pill.textContent = status;

    const n = document.createElement("span");
    n.className = "opt-count";
    n.textContent = (counts.get(status) || 0).toLocaleString();

    row.append(cb, pill, n);
    menu.appendChild(row);
  }

  const actions = document.createElement("div");
  actions.className = "status-menu-actions";
  for (const [label, fn] of [
    ["Show all", () => hiddenStatuses.clear()],
    ["Hide decided", () => DEFAULT_HIDDEN.forEach((s) => hiddenStatuses.add(s))],
  ]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-ghost sm";
    b.textContent = label;
    b.addEventListener("click", () => {
      fn();
      saveHidden();
      renderStatusMenu();
      updateStatusButton();
      render();
    });
    actions.appendChild(b);
  }
  menu.appendChild(actions);
}

function updateStatusButton() {
  const btn = document.getElementById("status-toggle");
  if (!btn) return;
  const n = hiddenStatuses.size;
  btn.textContent = n ? `Hide status (${n})` : "Hide status";
  btn.classList.toggle("has-hidden", n > 0);
}

// ---------- Sorting ----------
// Click a column heading to sort by it; click again to reverse. Each column
// sorts by the value behind the cell rather than the text in it, so money
// sorts numerically and dates chronologically.

const SORT_KEYS = {
  name: (o) => (o.name || "").toLowerCase(),
  division: (o) => (o.division || "").toLowerCase(),
  bidDue: (o) => o.bidDueDate || "",
  days: (o) => daysUntil(o.bidDueDate),
  value: oppValue,
  leadEstimator: (o) => (o.leadEstimator || "").toLowerCase(),
  status: (o) => (o.status || "").toLowerCase(),
};

// Default: soonest due first, which is what the countdown column is for.
let sortBy = "bidDue";
let sortDir = 1; // 1 ascending, -1 descending

function sortOpps(list) {
  const key = SORT_KEYS[sortBy];
  if (!key) return list;
  return [...list].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    // Bids with nothing in the sorted column collect at the bottom either
    // way — a blank is not "smaller", it's just missing.
    const xEmpty = x === null || x === undefined || x === "";
    const yEmpty = y === null || y === undefined || y === "";
    if (xEmpty || yEmpty) return xEmpty && yEmpty ? 0 : xEmpty ? 1 : -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * sortDir;
    return String(x).localeCompare(String(y)) * sortDir;
  });
}

function setSort(key) {
  if (sortBy === key) sortDir = -sortDir;
  else {
    sortBy = key;
    // Text reads best A-Z; numbers and dates are usually wanted biggest or
    // soonest first, so start those the other way round.
    sortDir = key === "value" || key === "days" ? -1 : 1;
  }
  markSortedHeader();
  render();
}

function markSortedHeader() {
  for (const th of document.querySelectorAll(".bids thead th[data-sort]")) {
    const active = th.dataset.sort === sortBy;
    th.classList.toggle("is-sorted", active);
    th.classList.toggle("desc", active && sortDir === -1);
    th.setAttribute(
      "aria-sort",
      active ? (sortDir === 1 ? "ascending" : "descending") : "none"
    );
  }
}

function render() {
  const opps = loadOpps();
  const query = search.value.trim().toLowerCase();

  const visible = sortOpps(
    opps.filter((o) => {
      const status = o.status || "Unspecified";
      // Clicking a funnel segment is an explicit "show me these", so it wins
      // over the hide list — otherwise picking Lost from the funnel while Lost
      // is hidden would return nothing and look broken.
      if (statusFilter.size) {
        if (!statusFilter.has(status)) return false;
      } else if (hiddenStatuses.has(status)) {
        return false;
      }
      if (!query) return true;
      return [o.name, o.division, o.leadEstimator, o.ownerCustomer].some((f) =>
        (f || "").toLowerCase().includes(query)
      );
    })
  );

  // The stat strip describes every bid that matched, not just the page of
  // them the table draws — otherwise the totals would change meaning the
  // moment a filter pushed the count over the row limit.
  renderStats(visible);
  count.textContent = visible.length;

  rows.innerHTML = "";

  if (visible.length === 0) {
    empty.style.display = "block";
    empty.textContent =
      opps.length === 0
        ? "No opportunities yet — add one above."
        : "No opportunities match your search.";
    renderRowLimitNote(0, 0);
    return;
  }
  empty.style.display = "none";

  // Drawing every row of a few thousand bids costs a visible pause, and
  // nobody scrolls past the first few hundred. Sorting and filtering still
  // run over all of them, so the cap only decides what is drawn.
  const shown = visible.slice(0, ROW_LIMIT);
  renderRowLimitNote(shown.length, visible.length);

  for (const opp of shown) {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = opp.name || "—";
    // The column truncates, so keep the full name reachable on hover.
    if (opp.name) nameTd.title = opp.name;

    const divTd = document.createElement("td");
    divTd.textContent = opp.division || "—";

    const dueTd = document.createElement("td");
    dueTd.textContent = formatDueDateTime(opp.bidDueDate, opp.bidDueTime);

    const daysTd = document.createElement("td");
    if (NO_COUNTDOWN_STATUSES.has(opp.status)) {
      daysTd.className = "days-na"; // greyed out — the due date is next door
    } else {
      const days = daysUntil(opp.bidDueDate);
      if (days === null) {
        daysTd.textContent = "—";
      } else {
        daysTd.textContent = days;
        daysTd.className =
          days >= 10 ? "days-ok" : days >= 1 ? "days-soon" : "days-overdue";
      }
    }

    const valueTd = document.createElement("td");
    valueTd.className = "col-value";
    valueTd.textContent = currency.format(oppValue(opp));

    const pmTd = document.createElement("td");
    pmTd.className = "col-pm";
    pmTd.textContent = opp.leadEstimator || "—";
    if (opp.leadEstimator) pmTd.title = opp.leadEstimator;

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

    tr.append(nameTd, divTd, dueTd, daysTd, valueTd, pmTd, statusTd);
    tr.className = "bid-row";
    tr.addEventListener("click", () => openDetail(opp));
    rows.appendChild(tr);
  }
}

// ---------- Top-level views (nav tabs) ----------
// Each .nav-tab has data-view="x" and shows the matching #view-x section.
// Other scripts register work to run when their view is opened.

const VIEW_HOOKS = {};

function onViewOpen(view, fn) {
  VIEW_HOOKS[view] = fn;
}

function showView(view) {
  for (const tab of document.querySelectorAll(".nav-tab")) {
    tab.classList.toggle("active", tab.dataset.view === view);
  }
  for (const section of document.querySelectorAll("main .view")) {
    section.hidden = section.id !== `view-${view}`;
  }
  // Every hook loads data. None of them run for someone the invite list turned
  // away, even if they've forced the hidden page back into view — the tabs
  // then show nothing, because nothing was ever fetched.
  if (VIEW_HOOKS[view] && BBAccess.granted) VIEW_HOOKS[view]();
}

// Re-run whichever view is open (after the data behind it changed).
function refreshActiveView() {
  const tab = document.querySelector(".nav-tab.active");
  const hook = tab && VIEW_HOOKS[tab.dataset.view];
  if (hook) hook();
}

for (const tab of document.querySelectorAll(".nav-tab")) {
  tab.addEventListener("click", () => showView(tab.dataset.view));
}

// ---------- Charts ----------

// Chart.js defaults to near-black text and light grid lines, both of which
// disappear on a dark ground. Read the current theme's tokens instead so the
// charts follow it. Called before every chart is built.
function applyChartTheme() {
  if (typeof Chart === "undefined") return;
  const css = getComputedStyle(document.documentElement);
  Chart.defaults.color = css.getPropertyValue("--muted").trim();
  Chart.defaults.borderColor = css.getPropertyValue("--grid").trim();
  Chart.defaults.font.family = css.getPropertyValue("--sans").trim();
}

function renderCharts(opps) {
  renderFunnel(opps);
  applyChartTheme();
  if (typeof Chart !== "undefined") renderEstimatorChart(opps);
}

// Statuses picked by clicking funnel segments. Empty = show everything.
const statusFilter = new Set();

function toggleStatusFilter(status) {
  if (statusFilter.has(status)) statusFilter.delete(status);
  else statusFilter.add(status);
  renderFunnel(loadOpps());
  render();
}

function clearStatusFilter() {
  statusFilter.clear();
  renderFunnel(loadOpps());
  render();
}

// The "showing X, Y · Clear" line under the funnel.
function renderFunnelFilter() {
  const bar = document.getElementById("funnel-filter");
  if (!bar) return;
  bar.hidden = statusFilter.size === 0;
  if (bar.hidden) {
    bar.innerHTML = "";
    return;
  }
  bar.innerHTML = "";
  const label = document.createElement("span");
  label.textContent = `Showing ${[...statusFilter].join(", ")}`;
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "funnel-clear";
  clear.textContent = "Clear";
  clear.addEventListener("click", clearStatusFilter);
  bar.append(label, clear);
}

// Bid pipeline funnel: one segment per status, sized by total project value.
// Always drawn from every bid — the segments are the filter control, so they
// can't disappear when you pick one. Selected segments are outlined and the
// rest dim.
function renderFunnel(opps) {
  const el = document.getElementById("funnel");
  if (!el) return;
  renderFunnelFilter();

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

  const filtering = statusFilter.size > 0;

  let polys = "";
  let labels = "";
  segs.forEach((seg, i) => {
    const topW = widthPct(seg.value);
    const botW = i < n - 1 ? widthPct(segs[i + 1].value) : topW;
    const y0 = i * segH + gap / 2;
    const y1 = (i + 1) * segH - gap / 2;
    const color = STATUS_COLORS[seg.status] || "#94a3b8";
    const picked = statusFilter.has(seg.status);
    const cls =
      "funnel-seg" + (picked ? " is-picked" : filtering ? " is-dim" : "");
    const verb = picked ? "Remove" : "Filter by";
    polys +=
      `<polygon class="${cls}" data-status="${escAttr(seg.status)}" ` +
      `points="${(100 - topW) / 2},${y0} ${(100 + topW) / 2},${y0} ` +
      `${(100 + botW) / 2},${y1} ${(100 - botW) / 2},${y1}" fill="${color}">` +
      `<title>${escAttr(seg.status)}: ${currency.format(seg.value)} — click to ` +
      `${verb.toLowerCase()}</title></polygon>`;
    const top = ((i + 0.5) / n) * 100;
    labels +=
      `<div class="funnel-label${picked ? " is-picked" : filtering ? " is-dim" : ""}" ` +
      `style="top:${top}%">${escAttr(seg.status)} · ${currency.format(seg.value)}</div>`;
  });

  el.innerHTML =
    `<svg viewBox="0 0 100 100" preserveAspectRatio="none">${polys}</svg>` +
    `<div class="funnel-labels">${labels}</div>`;

  for (const poly of el.querySelectorAll(".funnel-seg")) {
    poly.addEventListener("click", () => toggleStatusFilter(poly.dataset.status));
  }
}

// Statuses are free text on the way in, so they can't go straight into markup.
function escAttr(value) {
  return String(value ?? "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
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
// onChange (optional) fires whenever the selection changes.
function buildMultiCombo(container, options, preselected, onChange) {
  container.innerHTML = "";
  const selected = new Set(Array.isArray(preselected) ? preselected : []);
  const changed = () => onChange && onChange([...selected]);

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
        changed();
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
        changed();
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

// Multi-select combobox with free entry: chips for chosen values, a text
// field that filters suggestions (previous entries) and lets you add any new
// value (click the "Add" row or press Enter). Selection on container._getSelected().
function buildMultiEntry(container, suggestions, preselected) {
  container.innerHTML = "";
  const selected = new Set(Array.isArray(preselected) ? preselected : []);
  const opts = Array.isArray(suggestions) ? suggestions : [];

  const control = document.createElement("div");
  control.className = "mc-control";
  const chips = document.createElement("span");
  chips.className = "mc-chips";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "mc-input";
  input.placeholder = "Select or add new…";
  input.autocomplete = "off";
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

  function add(value) {
    const v = value.trim();
    if (!v) return;
    selected.add(v);
    input.value = "";
    renderChips();
    renderPanel();
    input.focus();
  }

  function renderPanel() {
    const q = input.value.trim();
    const ql = q.toLowerCase();
    panel.innerHTML = "";

    // "Add new" row when the typed value isn't already an option/selection.
    const existing = new Set([...opts, ...selected].map((s) => s.toLowerCase()));
    if (q && !existing.has(ql)) {
      const addRow = document.createElement("div");
      addRow.className = "mc-option mc-add";
      addRow.textContent = `Add “${q}”`;
      addRow.addEventListener("mousedown", (e) => {
        e.preventDefault();
        add(q);
      });
      panel.appendChild(addRow);
    }

    for (const o of opts) {
      if (selected.has(o) || !o.toLowerCase().includes(ql)) continue;
      const row = document.createElement("div");
      row.className = "mc-option";
      row.textContent = o;
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        add(o);
      });
      panel.appendChild(row);
    }

    if (!panel.children.length) {
      const none = document.createElement("div");
      none.className = "mc-none";
      none.textContent = "Type to add…";
      panel.appendChild(none);
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
    if (e.key === "Enter") {
      e.preventDefault();
      add(input.value);
    } else if (e.key === "Escape") {
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

// Custom single-select time picker: a styled combobox with two columns —
// hours on the left, quarter-hour minutes on the right. The text input is
// free-form (any time can still be typed); clicking composes "HH:MM" (24h).
// Creates the #f-due-time input that readForm() reads.
function buildTimeCombo(container) {
  container.innerHTML = "";

  const control = document.createElement("div");
  control.className = "mc-control";
  const input = document.createElement("input");
  input.type = "text";
  input.id = "f-due-time";
  input.className = "mc-input";
  input.placeholder = "Select or type…";
  input.autocomplete = "off";
  control.appendChild(input);

  const panel = document.createElement("div");
  panel.className = "mc-panel tc-panel";
  panel.hidden = true;

  container.append(control, panel);

  let selH = null; // 0..23
  let selM = "00"; // "00" | "15" | "30" | "45"

  function parseInput() {
    const m = input.value.trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m) return;
    const h = Number(m[1]);
    if (h >= 0 && h <= 23) selH = h;
    if (["00", "15", "30", "45"].includes(m[2])) selM = m[2];
  }

  function compose() {
    if (selH == null) return;
    input.value = `${String(selH).padStart(2, "0")}:${selM}`;
  }

  function hourLabel(h) {
    return String(h).padStart(2, "0");
  }

  function renderPanel() {
    parseInput();
    panel.innerHTML = "";
    const cols = document.createElement("div");
    cols.className = "tc-cols";

    const hours = document.createElement("div");
    hours.className = "tc-col tc-hours";
    for (let h = 0; h < 24; h++) {
      const row = document.createElement("div");
      row.className = "tc-opt" + (selH === h ? " is-sel" : "");
      row.textContent = hourLabel(h);
      row.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep focus; avoid blur-close race
        selH = h;
        compose();
        renderPanel();
        input.focus();
      });
      hours.appendChild(row);
    }

    const mins = document.createElement("div");
    mins.className = "tc-col tc-mins";
    for (const mm of ["00", "15", "30", "45"]) {
      const row = document.createElement("div");
      row.className = "tc-opt" + (selM === mm ? " is-sel" : "");
      row.textContent = ":" + mm;
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selM = mm;
        if (selH == null) selH = 12; // default to noon if minute picked first
        compose();
        close();
        input.blur();
      });
      mins.appendChild(row);
    }

    cols.append(hours, mins);
    panel.appendChild(cols);
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
  input.addEventListener("focus", open);
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
}

// Statuses that require a reason written in the Description field.
const REASON_REQUIRED_STATUSES = ["No Bid", "Cancelled"];

function reasonRequired() {
  return REASON_REQUIRED_STATUSES.includes(val("f-status"));
}

// Show/hide the red "reason required" note under Description based on status.
function updateReasonMsg() {
  document.getElementById("reason-msg").hidden = !reasonRequired();
}

function buildForm(opp) {
  // Dropdowns
  fillSelect("f-division", FIELD_LISTS.division);
  fillSelect("f-status", FIELD_LISTS.opportunityStatus);
  fillSelect("f-bid-type", FIELD_LISTS.bidType);
  fillSelect("f-delivery-method", FIELD_LISTS.deliveryMethod);
  fillSelect("f-state", STATES);

  // Searchable comboboxes (single, select-or-add-new)
  fillDatalist("dl-pm", FIELD_LISTS.projectManager);
  fillDatalist("dl-lead-estimator", FIELD_LISTS.leadEstimator);
  fillDatalist("dl-industry", FIELD_LISTS.industry);
  fillDatalist("dl-market-segment", FIELD_LISTS.marketSegment);

  // Comboboxes that learn from previous entries
  for (const [key, id] of PREV_COMBOS) fillDatalist(id, distinctPrev(key));

  // Searchable multi-combobox (multi) — seeded from the opp when editing
  buildMultiCombo(
    document.getElementById("mc-local-unions"),
    FIELD_LISTS.localUnions,
    opp && opp.localUnions
  );

  // Multi-select free-entry comboboxes (chips + add new)
  buildMultiEntry(document.getElementById("mc-cm"), distinctPrev("cm"), opp && opp.cm);
  buildMultiEntry(document.getElementById("mc-gc"), distinctPrev("gc"), opp && opp.gc);

  // Custom time picker (hours | quarter-hour minutes)
  buildTimeCombo(document.getElementById("tc-due-time"));

  updateReasonMsg();
}

document.getElementById("f-status").addEventListener("change", updateReasonMsg);

// ---------- Modal ----------

// The opportunity currently being edited (null = creating a new one).
let editingId = null;

// Simple inputs/selects/datalists keyed by element id -> opp field.
const SIMPLE_FIELDS = {
  "f-name": "name",
  "f-due-date": "bidDueDate",
  "f-due-time": "bidDueTime",
  "f-division": "division",
  "f-internal-number": "internalBidNumber",
  "f-pm": "projectManager",
  "f-status": "status",
  "f-lead-estimator": "leadEstimator",
  "f-owner": "ownerCustomer",
  "f-architect": "architect",
  "f-engineer": "engineer",
  "f-market-segment": "marketSegment",
  "f-industry": "industry",
  "f-bid-type": "bidType",
  "f-delivery-method": "deliveryMethod",
  "f-description": "description",
  "f-address": "projectAddress",
  "f-city": "city",
  "f-zip": "zipCode",
  "f-state": "state",
  "f-proj-value": "budgetedProjectValue",
  "f-cost": "budgetedCost",
  "f-final-price": "finalPrice",
  "f-labor-hours": "budgetedLaborHours",
  "f-sqft": "budgetedSquareFootage",
  "f-start-date": "estStartDate",
  "f-end-date": "estEndDate",
  "f-docs-date": "docsReceivedDate",
};

// Fill the form fields from an existing opportunity (combos/time are seeded by
// buildForm; this handles the simple inputs and the requirement checkboxes).
function populateForm(opp) {
  for (const [id, key] of Object.entries(SIMPLE_FIELDS)) {
    const v = opp[key];
    document.getElementById(id).value = v == null ? "" : v;
  }
  const flags = Array.isArray(opp.flags) ? opp.flags : [];
  for (const cb of document.querySelectorAll("#cg-flags input")) {
    cb.checked = flags.includes(cb.value);
  }
  updateReasonMsg();
}

function openModal(opp) {
  oppForm.reset();
  editingId = opp && opp.id != null ? opp.id : null;
  buildForm(opp);
  if (opp) populateForm(opp);

  document.getElementById("modal-title").textContent = editingId
    ? "Edit Opportunity"
    : "New Opportunity";
  document.getElementById("modal-submit").textContent = editingId
    ? "Update opportunity"
    : "Save opportunity";
  // Deleting only makes sense for a bid that's already saved.
  document.getElementById("modal-delete").hidden = editingId == null;

  modal.hidden = false;
  document.getElementById("f-name").focus();
}

function closeModal() {
  modal.hidden = true;
}

document.getElementById("new-opp").addEventListener("click", () => openModal());
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal-cancel").addEventListener("click", closeModal);

document.getElementById("modal-delete").addEventListener("click", async () => {
  if (editingId == null) return;
  const label = val("f-name") || "this bid";
  if (!confirm(`Delete “${label}”? This also removes its pricing quotes and project team, and can't be undone.`)) {
    return;
  }
  const id = editingId;
  closeModal();
  await deleteOpp(id);
});
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

// ---------- Detail view ----------

const detailModal = document.getElementById("detail-modal");
let detailOpp = null;

function fmtMoney(v) {
  return v == null || v === "" ? "—" : currency.format(Number(v) || 0);
}
function fmtNum(v) {
  return v == null || v === "" ? "—" : Number(v).toLocaleString();
}
function fmtList(v) {
  return Array.isArray(v) && v.length ? v.join(", ") : "—";
}
function fmtText(v) {
  return v == null || String(v).trim() === "" ? "—" : String(v);
}

// Detail layout: sections of [label, value] rows derived from the opp.
function detailSections(o) {
  return [
    ["General", [
      ["Opportunity name", fmtText(o.name)],
      ["Bid due", formatDueDateTime(o.bidDueDate, o.bidDueTime)],
      ["Division", fmtText(o.division)],
      ["Project manager", fmtText(o.projectManager)],
      ["Lead estimator", fmtText(o.leadEstimator)],
      ["Opportunity status", fmtText(o.status)],
      ["Internal bid number", fmtText(o.internalBidNumber)],
    ]],
    ["Project Team", [
      ["Owner / customer", fmtText(o.ownerCustomer)],
      ["CM", fmtList(o.cm)],
      ["GC", fmtList(o.gc)],
      ["Architect", fmtText(o.architect)],
      ["Engineer", fmtText(o.engineer)],
      ["Local unions", fmtList(o.localUnions)],
    ]],
    ["Classification", [
      ["Market segment", fmtText(o.marketSegment)],
      ["Industry", fmtText(o.industry)],
      ["Bid type", fmtText(o.bidType)],
      ["Delivery method", fmtText(o.deliveryMethod)],
    ]],
    ["Requirements", [
      ["Requirements", fmtList(o.flags)],
      ["Description / Notes", fmtText(o.description)],
    ]],
    ["Location", [
      ["Project address", fmtText(o.projectAddress)],
      ["City", fmtText(o.city)],
      ["Zip code", fmtText(o.zipCode)],
      ["State", fmtText(o.state)],
    ]],
    ["Budget & Schedule", [
      ["Budgeted project value", fmtMoney(o.budgetedProjectValue)],
      ["Budgeted cost", fmtMoney(o.budgetedCost)],
      ["Final price", fmtMoney(o.finalPrice)],
      ["Estimated labor hours", fmtNum(o.budgetedLaborHours)],
      ["Estimated square footage", fmtNum(o.budgetedSquareFootage)],
      ["Estimated project start", formatDate(o.estStartDate)],
      ["Estimated project end", formatDate(o.estEndDate)],
      ["Documents received", formatDate(o.docsReceivedDate)],
    ]],
  ];
}

// ----- Opportunity tab (read-only fields + Edit) -----

function renderDetail(o) {
  document.getElementById("detail-title").textContent = o.name || "Opportunity";
  const pane = document.getElementById("pane-opportunity");
  pane.innerHTML = "";

  const bar = document.createElement("div");
  bar.className = "pane-actions";
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn-primary inline";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => {
    const opp = detailOpp;
    closeDetail();
    openModal(opp);
  });
  bar.appendChild(editBtn);
  pane.appendChild(bar);

  for (const [title, fields] of detailSections(o)) {
    const sec = document.createElement("section");
    sec.className = "detail-section";
    const h = document.createElement("h3");
    h.textContent = title;
    sec.appendChild(h);

    const grid = document.createElement("div");
    grid.className = "detail-grid";
    for (const [label, value] of fields) {
      const cell = document.createElement("div");
      cell.className = "detail-cell";
      const l = document.createElement("div");
      l.className = "detail-label";
      l.textContent = label;
      const v = document.createElement("div");
      v.className = "detail-value";
      v.textContent = value;
      cell.append(l, v);
      grid.appendChild(cell);
    }
    sec.appendChild(grid);
    pane.appendChild(sec);
  }
}

// ----- Tabs -----

function switchTab(name) {
  for (const tab of document.querySelectorAll("#detail-tabs .detail-tab")) {
    tab.classList.toggle("is-active", tab.dataset.tab === name);
  }
  for (const id of ["opportunity", "pricing", "team"]) {
    document.getElementById(`pane-${id}`).hidden = id !== name;
  }
  document.getElementById("detail-body").dataset.tab = name;
  if (name === "pricing") renderPricing();
  else if (name === "team") renderTeam();
}

document.getElementById("detail-tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".detail-tab");
  if (tab) switchTab(tab.dataset.tab);
});

function openDetail(opp) {
  detailOpp = opp;
  renderDetail(opp);
  switchTab("opportunity");
  detailModal.hidden = false;
}

function closeDetail() {
  detailModal.hidden = true;
  detailOpp = null;
  // Adding or removing a proposal can change a bid's project value.
  if (pricingDirty) {
    pricingDirty = false;
    refreshOpps();
  } else {
    refreshActiveView(); // team/quote edits the open view may care about
  }
}

document.getElementById("detail-close").addEventListener("click", closeDetail);
document.getElementById("detail-cancel").addEventListener("click", closeDetail);
detailModal.addEventListener("click", (e) => {
  if (e.target === detailModal) closeDetail();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!detailModal.hidden) closeDetail();
  else if (!modal.hidden) closeModal();
});

// ---------- Pricing tab ----------

const PRICING_TABLE = "pricing_quotes";
const MEMBERS_TABLE = "project_members";

async function fetchPricing(oppId) {
  const { data, error } = await sb
    .from(PRICING_TABLE)
    .select("*")
    .eq("opportunity_id", String(oppId))
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Pricing load error:", error.message);
    return [];
  }
  return data || [];
}

// Set when a quote is added or removed, so closing the detail view knows to
// recompute project values.
let pricingDirty = false;

async function addPricing(row) {
  const { error } = await sb.from(PRICING_TABLE).insert(row);
  if (error) {
    alert("Could not save price: " + error.message);
    return;
  }
  pricingDirty = true;
}

async function updatePricingStatus(id, status) {
  const { error } = await sb.from(PRICING_TABLE).update({ status }).eq("id", id);
  if (error) {
    alert("Could not update status: " + error.message);
    return;
  }
  renderPricing();
}

async function updatePricing(id, patch) {
  const { error } = await sb.from(PRICING_TABLE).update(patch).eq("id", id);
  if (error) {
    alert("Could not save price: " + error.message);
    return false;
  }
  // The price or its sent-on date may have changed which quote counts as the
  // most recent proposal, so project values need recomputing.
  pricingDirty = true;
  return true;
}

async function deletePricing(id) {
  if (!confirm("Delete this price quote?")) return;
  const { error } = await sb.from(PRICING_TABLE).delete().eq("id", id);
  if (error) {
    alert("Could not delete price: " + error.message);
    return;
  }
  pricingDirty = true;
  renderPricing();
}

const QUOTE_STATUSES = ["Draft", "Sent", "Lost", "Withdrawn"];

// Where the add/edit quote form is mounted in the Pricing tab (set by
// renderPricing, read by each row's Edit button).
let quoteFormMount = null;

function renderQuoteRow(q) {
  const tr = document.createElement("tr");

  const company = document.createElement("td");
  company.className = "quote-company";
  company.textContent = q.company || "—";

  const type = document.createElement("td");
  type.textContent = q.type === "budgetary" ? "Budgetary" : "Proposal";

  const price = document.createElement("td");
  price.className = "num";
  price.textContent = fmtMoney(q.price);

  const sent = document.createElement("td");
  sent.textContent = q.price_sent_on ? formatDate(q.price_sent_on) : "—";

  const statusTd = document.createElement("td");
  const bar = document.createElement("div");
  bar.className = "statusbar";

  // Top: Lost / Withdrawn / Delete
  const actions = document.createElement("div");
  actions.className = "status-actions";
  for (const s of ["Lost", "Withdrawn"]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "status-btn" + (q.status === s ? " is-active" : "");
    b.textContent = s;
    b.addEventListener("click", () => updatePricingStatus(q.id, s));
    actions.appendChild(b);
  }
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "status-btn";
  edit.textContent = "Edit";
  edit.addEventListener("click", () => {
    if (!quoteFormMount) return;
    showQuoteForm(q.type, quoteFormMount, q);
    quoteFormMount.scrollIntoView({ block: "nearest" });
  });
  actions.appendChild(edit);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "status-btn danger";
  del.textContent = "Delete";
  del.addEventListener("click", () => deletePricing(q.id));
  actions.appendChild(del);

  // Bottom: Draft -> Sent chevrons
  const steps = document.createElement("div");
  steps.className = "status-steps";
  for (const s of ["Draft", "Sent"]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chev" + (q.status === s ? " is-active" : "");
    b.textContent = s;
    b.addEventListener("click", () => updatePricingStatus(q.id, s));
    steps.appendChild(b);
  }

  bar.append(actions, steps);
  statusTd.appendChild(bar);

  tr.append(company, type, price, sent, statusTd);
  if (q.notes) tr.title = q.notes;
  return tr;
}

function renderQuoteGroup(label, quotes) {
  const det = document.createElement("details");
  det.className = "quote-group";
  det.open = true;

  const sum = document.createElement("summary");
  sum.innerHTML = `<strong>${label}</strong> <span class="quote-count">(${quotes.length})</span>`;
  det.appendChild(sum);

  if (!quotes.length) {
    const none = document.createElement("div");
    none.className = "quote-none";
    none.textContent = "No prices yet.";
    det.appendChild(none);
    return det;
  }

  const table = document.createElement("table");
  table.className = "quote-table";
  const thead = document.createElement("thead");
  thead.innerHTML =
    "<tr><th>Company Name</th><th>Type of Price</th>" +
    "<th class='num'>Price</th><th>Price Sent On</th><th>Status</th></tr>";
  const tb = document.createElement("tbody");
  for (const q of quotes) tb.appendChild(renderQuoteRow(q));
  table.append(thead, tb);
  det.appendChild(table);
  return det;
}

// Add a price, or edit one: pass the existing quote as `quote` and the form
// opens prefilled and saves an update instead of an insert.
function showQuoteForm(type, mount, quote) {
  const labelText = type === "proposal" ? "Proposal" : "Budgetary";
  const editing = !!quote;
  mount.innerHTML = "";
  const card = document.createElement("div");
  card.className = "quote-form";
  card.innerHTML = `
    <h4>${editing ? "Edit" : "Add"} ${labelText} Price</h4>
    <div class="quote-grid">
      <label>Company
        <input type="text" data-f="company" list="dl-quote-company" autocomplete="off"
               placeholder="Search or add new…" />
      </label>
      <label>Price<input type="number" min="0" step="0.01" data-f="price" /></label>
      <label>Price sent on<input type="date" data-f="price_sent_on" /></label>
      <label class="full">Notes<textarea rows="3" data-f="notes"></textarea></label>
    </div>
    <div class="quote-form-actions">
      <button type="button" class="btn-ghost" data-act="cancel">Cancel</button>
      <button type="button" class="btn-primary" data-act="save">
        ${editing ? "Save changes" : "Save price"}
      </button>
    </div>`;
  mount.appendChild(card);
  fillDatalist("dl-quote-company", knownCompanies());

  const field = (f) => card.querySelector(`[data-f="${f}"]`);
  if (editing) {
    field("company").value = quote.company || "";
    field("price").value = quote.price ?? "";
    field("price_sent_on").value = quote.price_sent_on || "";
    field("notes").value = quote.notes || "";
  }

  card.querySelector('[data-act="cancel"]').addEventListener("click", () => {
    mount.innerHTML = "";
  });
  card.querySelector('[data-act="save"]').addEventListener("click", async () => {
    // Reuse the existing spelling when this company has been bid before.
    const company = canonicalCompany(field("company").value);
    if (!company) {
      field("company").focus();
      return;
    }
    rememberCompany(company);
    const priceRaw = field("price").value;
    const values = {
      company,
      price: priceRaw === "" ? null : Number(priceRaw),
      price_sent_on: field("price_sent_on").value || null,
      notes: field("notes").value.trim() || null,
    };

    if (editing) {
      if (!(await updatePricing(quote.id, values))) return;
    } else {
      await addPricing({
        opportunity_id: String(detailOpp.id),
        type,
        ...values,
        status: "Draft",
      });
    }
    mount.innerHTML = "";
    renderPricing();
  });
  field("company").focus();
}

async function renderPricing() {
  const pane = document.getElementById("pane-pricing");
  pane.innerHTML = "";
  if (!detailOpp) return;

  const bar = document.createElement("div");
  bar.className = "price-actions";
  const propBtn = document.createElement("button");
  propBtn.type = "button";
  propBtn.className = "price-btn";
  propBtn.textContent = "Add Proposal Price";
  const budBtn = document.createElement("button");
  budBtn.type = "button";
  budBtn.className = "price-btn";
  budBtn.textContent = "Add Budgetary Price";
  bar.append(propBtn, budBtn);
  pane.appendChild(bar);

  const mount = document.createElement("div");
  pane.appendChild(mount);
  // Row-level Edit buttons render below this, so they reach the form through
  // the shared mount rather than being threaded the element.
  quoteFormMount = mount;
  propBtn.addEventListener("click", () => showQuoteForm("proposal", mount));
  budBtn.addEventListener("click", () => showQuoteForm("budgetary", mount));

  const heading = document.createElement("div");
  heading.className = "pricing-report-label";
  heading.textContent = "Pricing Report";
  pane.appendChild(heading);

  const groups = document.createElement("div");
  pane.appendChild(groups);

  const quotes = await fetchPricing(detailOpp.id);
  groups.appendChild(
    renderQuoteGroup("Proposal", quotes.filter((q) => q.type === "proposal"))
  );
  groups.appendChild(
    renderQuoteGroup("Budgetary", quotes.filter((q) => q.type === "budgetary"))
  );
}

// ---------- Project Team tab ----------

const TEAM_ROLES = ["Estimator", "Sponsor", "Lead Estimator", "Project Manager"];

async function fetchMembers(oppId) {
  const { data, error } = await sb
    .from(MEMBERS_TABLE)
    .select("*")
    .eq("opportunity_id", String(oppId))
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Members load error:", error.message);
    return [];
  }
  return data || [];
}

async function addMember(row) {
  const { error } = await sb.from(MEMBERS_TABLE).insert(row);
  if (error) alert("Could not add member: " + error.message);
}

async function deleteMember(id) {
  const { error } = await sb.from(MEMBERS_TABLE).delete().eq("id", id);
  if (error) {
    alert("Could not remove member: " + error.message);
    return;
  }
  renderTeam();
}

function renderMemberRow(m) {
  const row = document.createElement("div");
  row.className = "team-row";

  const name = document.createElement("span");
  name.className = "team-name";
  name.textContent = m.name;

  const role = document.createElement("span");
  role.className = "team-role";
  role.textContent = m.role || "—";

  const x = document.createElement("button");
  x.type = "button";
  x.className = "x";
  x.title = "Remove member";
  x.textContent = "✕";
  x.addEventListener("click", () => deleteMember(m.id));

  row.append(name, role, x);
  return row;
}

async function renderTeam() {
  const pane = document.getElementById("pane-team");
  pane.innerHTML = "";
  if (!detailOpp) return;

  const form = document.createElement("div");
  form.className = "team-add";
  form.innerHTML = `
    <div class="field">
      <label for="tm-name">Member</label>
      <input type="text" id="tm-name" list="dl-members" placeholder="Search or add…" autocomplete="off" />
      <datalist id="dl-members"></datalist>
    </div>
    <div class="field">
      <label for="tm-role">Role</label>
      <select id="tm-role"></select>
    </div>
    <button type="button" class="btn-primary inline" id="tm-add">Add member</button>`;
  pane.appendChild(form);

  const sel = form.querySelector("#tm-role");
  sel.appendChild(new Option("Select role…", ""));
  for (const r of TEAM_ROLES) sel.appendChild(new Option(r, r));

  const nameInput = form.querySelector("#tm-name");
  form.querySelector("#tm-add").addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    await addMember({
      opportunity_id: String(detailOpp.id),
      name,
      role: sel.value || null,
    });
    renderTeam();
  });

  const list = document.createElement("div");
  list.className = "team-list";
  pane.appendChild(list);

  const members = await fetchMembers(detailOpp.id);
  if (!members.length) {
    const none = document.createElement("div");
    none.className = "quote-none";
    none.textContent = "No team members yet.";
    list.appendChild(none);
  } else {
    for (const m of members) list.appendChild(renderMemberRow(m));
  }
}

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
  const { error } = await sb.from(SUPABASE_TABLE).insert(toRow(opp));
  if (error) {
    alert("Could not save opportunity: " + error.message);
    return;
  }
  await refreshOpps();
}

async function updateOpp(id, opp) {
  const { error } = await sb.from(SUPABASE_TABLE).update(toRow(opp)).eq("id", id);
  if (error) {
    alert("Could not update opportunity: " + error.message);
    return;
  }
  await refreshOpps();
}

// Removes the bid and its child rows (pricing quotes, project team), which
// have no FK cascade — they're keyed on the stringified opportunity id.
async function deleteOpp(id) {
  const oppId = String(id);
  for (const table of [PRICING_TABLE, MEMBERS_TABLE]) {
    const { error } = await sb.from(table).delete().eq("opportunity_id", oppId);
    if (error) {
      alert("Could not delete opportunity: " + error.message);
      return;
    }
  }

  const { error } = await sb.from(SUPABASE_TABLE).delete().eq("id", id);
  if (error) {
    alert("Could not delete opportunity: " + error.message);
    return;
  }
  await refreshOpps();
}

function readForm() {
  return {
    name: val("f-name"),
    bidDueDate: val("f-due-date"),
    bidDueTime: val("f-due-time"),
    division: val("f-division"),
    internalBidNumber: val("f-internal-number"),
    projectManager: val("f-pm"),
    status: val("f-status"),
    leadEstimator: val("f-lead-estimator"),

    ownerCustomer: val("f-owner"),
    cm: document.getElementById("mc-cm")._getSelected(),
    gc: document.getElementById("mc-gc")._getSelected(),
    architect: val("f-architect"),
    engineer: val("f-engineer"),
    localUnions: document.getElementById("mc-local-unions")._getSelected(),

    marketSegment: val("f-market-segment"),
    industry: val("f-industry"),
    bidType: val("f-bid-type"),
    deliveryMethod: val("f-delivery-method"),

    flags: checkedValues("cg-flags"),
    description: val("f-description"),

    projectAddress: val("f-address"),
    city: val("f-city"),
    zipCode: val("f-zip"),
    state: val("f-state"),

    budgetedProjectValue: numOrNull("f-proj-value"),
    budgetedCost: numOrNull("f-cost"),
    finalPrice: numOrNull("f-final-price"),
    budgetedLaborHours: numOrNull("f-labor-hours"),
    budgetedSquareFootage: numOrNull("f-sqft"),
    estStartDate: val("f-start-date"),
    estEndDate: val("f-end-date"),
    docsReceivedDate: val("f-docs-date"),
  };
}

oppForm.addEventListener("submit", (e) => {
  e.preventDefault();

  if (!val("f-name")) {
    document.getElementById("f-name").focus();
    return;
  }

  // No Bid / Cancelled require a reason in the description.
  if (reasonRequired() && !val("f-description")) {
    updateReasonMsg();
    document.getElementById("f-description").focus();
    return;
  }

  const opp = readForm();
  if (editingId != null) updateOpp(editingId, opp);
  else addOpp(opp);

  closeModal();
});

for (const th of document.querySelectorAll(".bids thead th[data-sort]")) {
  th.tabIndex = 0;
  th.addEventListener("click", () => setSort(th.dataset.sort));
  th.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSort(th.dataset.sort);
    }
  });
}
markSortedHeader();

// ---- Hide-status menu ----
{
  const btn = document.getElementById("status-toggle");
  const menu = document.getElementById("status-menu");
  if (btn && menu) {
    const close = () => {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu.hidden) {
        renderStatusMenu(); // rebuild so newly-seen statuses appear
        menu.hidden = false;
        btn.setAttribute("aria-expanded", "true");
      } else {
        close();
      }
    });
    menu.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menu.hidden) close();
    });
    updateStatusButton();
  }
}

// Re-rendering every row on every keystroke is fine at a few dozen bids and
// not at a few thousand, so wait for a pause in typing.
let searchTimer = null;
search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 150);
});

// The first and only unprompted read of bid data — held behind the gate so an
// uninvited account never pulls it into the browser at all.
BBAccess.ready.then(refreshOpps);
