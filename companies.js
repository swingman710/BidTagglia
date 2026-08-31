// ===========================================================================
//  Companies tab — every company we've bid to, plus the details we keep on
//  them (type, industry, phone, website, notes).
//
//  The list is the union of company names on pricing quotes and rows already
//  saved here, deduped through dashboard.js's company registry so a name shows
//  up once however it was typed on each quote. Table: public.companies (see
//  supabase_companies.sql).
// ===========================================================================

const COMPANY_TYPES = [
  "Architect", "Construction Manager", "Development", "Distributor",
  "Electrician", "Engineer", "Integrator", "Manufacturers Rep",
  "Mechanical Contractor", "Owner", "Project Management", "Subcontractor",
  "Union", "WBE", "Internal", "Security Contractor",
];

const COMPANY_INDUSTRIES = [
  "Data Center", "Education", "Gaming", "Healthcare", "Manufacturing",
  "Oil & Gas", "Power Generation",
];

(() => {
  const TABLE = "companies";
  const $ = (id) => document.getElementById(id);

  let saved = new Map(); // company key -> row in public.companies
  let editingName = null;

  // ---------- Data ----------

  async function fetchCompanies() {
    const { rows, error } = await fetchAll(TABLE);
    if (error) return saved;
    saved = new Map();
    for (const row of rows) {
      rememberCompany(row.name);
      saved.set(companyKey(row.name), row);
    }
    return saved;
  }

  async function saveCompany(name, details) {
    const existing = saved.get(companyKey(name));
    const patch = { ...details, updated_at: new Date().toISOString() };

    const { error } = existing
      ? await sb.from(TABLE).update(patch).eq("id", existing.id)
      : await sb.from(TABLE).insert({ name, ...patch });

    if (error) {
      toastError("Could not save company: " + error.message);
      return false;
    }
    return true;
  }

  // How many bids we've priced to each company.
  function bidCounts() {
    const counts = new Map();
    for (const q of quotesCache) {
      const name = canonicalCompany(q.company);
      if (!name) continue;
      const key = companyKey(name);
      const bids = counts.get(key) || new Set();
      bids.add(String(q.opportunity_id));
      counts.set(key, bids);
    }
    return counts;
  }

  // ---------- Sorting ----------
  // Same interaction as the other tables: click a heading, click again to
  // reverse. Bids sorts numerically; blanks collect at the bottom either way.

  let sortBy = "name";
  let sortDir = 1;

  function sortRows(rows) {
    return rows.sort((a, b) => {
      const x = a[sortBy];
      const y = b[sortBy];
      const xEmpty = x === null || x === undefined || x === "";
      const yEmpty = y === null || y === undefined || y === "";
      if (xEmpty || yEmpty) return xEmpty && yEmpty ? 0 : xEmpty ? 1 : -1;
      const cmp =
        typeof x === "number" ? x - y : String(x).localeCompare(String(y));
      return cmp * sortDir || a.name.localeCompare(b.name);
    });
  }

  function setSort(key) {
    if (sortBy === key) sortDir = -sortDir;
    else {
      sortBy = key;
      sortDir = key === "bids" ? -1 : 1; // most-bid-to first; names A-Z
    }
    renderCompanies();
  }

  function markHeader() {
    for (const th of document.querySelectorAll(".company-table thead th[data-sort]")) {
      const active = th.dataset.sort === sortBy;
      th.classList.toggle("is-sorted", active);
      th.classList.toggle("desc", active && sortDir === -1);
      th.setAttribute(
        "aria-sort",
        active ? (sortDir === 1 ? "ascending" : "descending") : "none"
      );
    }
  }

  // ---------- List ----------

  async function renderCompanies() {
    const tbody = $("company-rows");
    if (!tbody) return;
    await fetchCompanies();

    const counts = bidCounts();
    const rows = knownCompanies().map((name) => {
      const key = companyKey(name);
      const row = saved.get(key) || {};
      return {
        name,
        key,
        type: row.type || "",
        industry: row.industry || "",
        phone: row.phone || "",
        website: row.website || "",
        bids: (counts.get(key) || new Set()).size,
      };
    });
    sortRows(rows);
    markHeader();

    $("company-count").textContent = rows.length;
    $("company-empty").style.display = rows.length ? "none" : "block";
    tbody.innerHTML = "";

    for (const entry of rows) {
      const { name, key } = entry;
      const row = saved.get(key) || {};
      const tr = document.createElement("tr");
      tr.className = "bid-row";

      const site = document.createElement("td");
      if (row.website) {
        const a = document.createElement("a");
        a.href = /^https?:\/\//i.test(row.website) ? row.website : `https://${row.website}`;
        a.textContent = row.website;
        a.target = "_blank";
        a.rel = "noopener";
        a.addEventListener("click", (e) => e.stopPropagation());
        site.appendChild(a);
      } else {
        site.textContent = "—";
      }

      const cells = [
        [name, ""],
        [row.type || "—", ""],
        [row.industry || "—", ""],
        [row.phone || "—", ""],
      ];
      for (const [text, cls] of cells) {
        const td = document.createElement("td");
        td.textContent = text;
        if (cls) td.className = cls;
        tr.appendChild(td);
      }
      tr.appendChild(site);

      const bidsTd = document.createElement("td");
      bidsTd.className = "num";
      bidsTd.textContent = entry.bids;
      tr.appendChild(bidsTd);

      tr.addEventListener("click", () => openCompany(name));
      tbody.appendChild(tr);
    }
  }

  // ---------- Detail modal ----------

  function fillOptions(select, options, value) {
    // Alphabetical, however the source list happens to be ordered — the type
    // list ends with Internal and Security Contractor out of place.
    options = [...options].sort((a, b) => a.localeCompare(b));
    select.innerHTML = "";
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
    select.value = options.includes(value) ? value : "";
  }

  // ---------- Track record with this company ----------
  // The same win/loss picture the Reports tab can produce, but on the company
  // itself — which is where you are when the question comes up.

  function renderCompanyRecord(name) {
    const mount = $("company-record");
    if (!mount) return;
    mount.innerHTML = "";

    const key = companyKey(name);
    // Bids this company was priced on, found through their quotes.
    const oppIds = new Set(
      quotesCache
        .filter((q) => companyKey(canonicalCompany(q.company)) === key)
        .map((q) => String(q.opportunity_id))
    );
    const bids = loadOpps().filter((o) => oppIds.has(String(o.id)));
    if (!bids.length) return;

    const won = bids.filter((o) => o.status === "Won");
    const lost = bids.filter((o) => o.status === "Lost");
    const decided = won.length + lost.length;
    const value = (list) =>
      list.reduce(
        (s, o) => s + (Number(o.finalPrice) || Number(o.budgetedProjectValue) || 0),
        0
      );
    const rate = decided ? Math.round((won.length / decided) * 100) : null;

    const sec = document.createElement("section");
    sec.className = "company-record";

    const head = document.createElement("div");
    head.className = "company-record-head";
    head.innerHTML =
      `<h3>Track record</h3>` +
      (rate === null
        ? `<span class="crec-rate none">No decided bids yet</span>`
        : `<span class="crec-rate ${rate >= 50 ? "good" : rate >= 25 ? "mid" : "poor"}">` +
          `${rate}% win rate</span>`);
    sec.appendChild(head);

    // Counts and money are split into two rows: five equal cells would clip
    // the currency figures at the modal's width.
    const addStats = (cls, cells) => {
      const grid = document.createElement("div");
      grid.className = `crec-stats ${cls}`;
      for (const [label, val, tone] of cells) {
        const cell = document.createElement("div");
        cell.className = "crec-stat";
        cell.innerHTML = `<div class="k"></div><div class="v ${tone}"></div>`;
        cell.querySelector(".k").textContent = label;
        cell.querySelector(".v").textContent = val;
        grid.appendChild(cell);
      }
      sec.appendChild(grid);
    };

    addStats("counts", [
      ["Bids", bids.length, ""],
      ["Won", won.length, "good"],
      ["Lost", lost.length, "bad"],
    ]);
    addStats("values", [
      ["Value won", currency.format(value(won)), "good"],
      ["Value lost", currency.format(value(lost)), "bad"],
    ]);

    if (decided) {
      const bar = document.createElement("div");
      bar.className = "crec-bar";
      bar.innerHTML =
        `<span class="w" style="width:${(won.length / decided) * 100}%"></span>` +
        `<span class="l" style="width:${(lost.length / decided) * 100}%"></span>`;
      bar.title = `${won.length} won, ${lost.length} lost`;
      sec.appendChild(bar);
    }

    // The most recent bids, so the numbers have something behind them.
    const recent = [...bids]
      .sort((a, b) => String(b.bidDueDate || "").localeCompare(String(a.bidDueDate || "")))
      .slice(0, 6);

    const list = document.createElement("div");
    list.className = "crec-bids";
    for (const o of recent) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "crec-bid";
      const pill = `<span class="status ${statusClass(o.status)}">${o.status || "—"}</span>`;
      item.innerHTML =
        `<span class="crec-bid-name"></span>${pill}` +
        `<span class="crec-bid-date">${o.bidDueDate ? formatDate(o.bidDueDate) : "—"}</span>`;
      item.querySelector(".crec-bid-name").textContent = o.name || "Untitled";
      item.title = o.name || "";
      item.addEventListener("click", () => {
        closeCompany();
        openDetail(o);
      });
      list.appendChild(item);
    }
    if (bids.length > recent.length) {
      const more = document.createElement("div");
      more.className = "crec-more";
      more.textContent = `+ ${bids.length - recent.length} more`;
      list.appendChild(more);
    }
    sec.appendChild(list);

    mount.appendChild(sec);
  }

  function openCompany(name) {
    const row = saved.get(companyKey(name)) || {};
    editingName = name;

    $("company-title").textContent = name;
    renderCompanyRecord(name);
    fillOptions($("c-type"), COMPANY_TYPES, row.type);
    fillOptions($("c-industry"), COMPANY_INDUSTRIES, row.industry);
    $("c-phone").value = row.phone || "";
    $("c-website").value = row.website || "";
    $("c-notes").value = row.notes || "";

    $("company-modal").hidden = false;
    $("c-type").focus();
  }

  function closeCompany() {
    $("company-modal").hidden = true;
    editingName = null;
  }

  async function saveOpenCompany() {
    if (!editingName) return;
    const editing = editingName; // closeCompany() clears it before the toast
    const ok = await saveCompany(editingName, {
      type: $("c-type").value || null,
      industry: $("c-industry").value || null,
      phone: $("c-phone").value.trim() || null,
      website: $("c-website").value.trim() || null,
      notes: $("c-notes").value.trim() || null,
    });
    if (!ok) return;
    closeCompany();
    toastOk(`Saved ${editing}`);
    await renderCompanies();
  }

  // ---------- Wiring ----------

  $("company-close").addEventListener("click", closeCompany);
  $("company-cancel").addEventListener("click", closeCompany);
  $("company-save").addEventListener("click", saveOpenCompany);
  $("company-modal").addEventListener("click", (e) => {
    if (e.target === $("company-modal")) closeCompany();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("company-modal").hidden) closeCompany();
  });

  for (const th of document.querySelectorAll(".company-table thead th[data-sort]")) {
    th.tabIndex = 0;
    th.addEventListener("click", () => setSort(th.dataset.sort));
    th.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setSort(th.dataset.sort);
      }
    });
  }

  onViewOpen("companies", renderCompanies);

  // Load once at start-up so saved-but-never-quoted companies show up in the
  // quote form's suggestions too — but only once the gate in access.js has
  // confirmed this person is allowed to see company data at all.
  BBAccess.ready.then(fetchCompanies);

  window.BBCompanies = { fetchCompanies, renderCompanies, saveCompany };
})();
