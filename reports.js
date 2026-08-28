// ===========================================================================
//  Reports view — win/loss analytics over saved opportunities.
//
//  Pick values for any number of variables (lead estimator, company bid to,
//  division, …). A bid is counted when it matches EVERY variable that has a
//  selection (values inside one variable are OR'd). The results show won vs
//  lost totals for that slice, plus a breakdown by any single variable.
//
//  Relies on globals from dashboard.js: loadOpps, currency, formatDueDateTime,
//  statusClass, buildMultiCombo, openDetail.
// ===========================================================================

(() => {
  // ---------- Variables you can filter / group by ----------
  // get(o) returns every value the bid holds for that variable (multi-value
  // fields such as CM/GC return more than one).

  const asList = (v) => (Array.isArray(v) ? v : [v]);
  const clean = (list) =>
    list.map((v) => String(v ?? "").trim()).filter(Boolean);

  const DIMS = [
    { key: "leadEstimator", label: "Lead Estimator", get: (o) => [o.leadEstimator] },
    {
      // Who we actually priced: the Company on each quote in the Pricing tab.
      key: "company",
      label: "Company Bid To",
      multi: true,
      get: (o) => quoteCompanies.get(String(o.id)) || [],
    },
    { key: "cm", label: "CM", multi: true, get: (o) => asList(o.cm) },
    { key: "gc", label: "GC", multi: true, get: (o) => asList(o.gc) },
    { key: "ownerCustomer", label: "Owner / Customer", get: (o) => [o.ownerCustomer] },
    { key: "projectManager", label: "Project Manager", get: (o) => [o.projectManager] },
    { key: "division", label: "Division", get: (o) => [o.division] },
    { key: "industry", label: "Industry", get: (o) => [o.industry] },
    { key: "marketSegment", label: "Market Segment", get: (o) => [o.marketSegment] },
    { key: "bidType", label: "Bid Type", get: (o) => [o.bidType] },
    { key: "deliveryMethod", label: "Delivery Method", get: (o) => [o.deliveryMethod] },
    { key: "state", label: "State", get: (o) => [o.state] },
    { key: "localUnions", label: "Local Union", multi: true, get: (o) => asList(o.localUnions) },
    { key: "architect", label: "Architect", get: (o) => [o.architect] },
    { key: "engineer", label: "Engineer", get: (o) => [o.engineer] },
  ];

  const dimValues = (dim, o) => clean(dim.get(o));

  const NO_BID_STATUSES = ["No Bid", "Cancelled"];
  const isWon = (o) => o.status === "Won";
  const isLost = (o) => o.status === "Lost";
  const isNoBid = (o) => NO_BID_STATUSES.includes(o.status);

  // Won jobs are worth what we actually sold them for; fall back to budget.
  function repAmount(o) {
    return Number(o.finalPrice) || Number(o.budgetedProjectValue) || 0;
  }

  function pct(part, whole) {
    if (!whole) return "—";
    return `${Math.round((part / whole) * 1000) / 10}%`;
  }

  // ---------- Filter state ----------

  // opportunity id (as text) -> companies quoted on the Pricing tab. Names run
  // through canonicalCompany() so a company shows up once, however it was
  // typed on each quote.
  const quoteCompanies = new Map();

  function loadQuoteCompanies() {
    quoteCompanies.clear();
    for (const q of quotesCache) {
      const company = canonicalCompany(q.company);
      if (!company) continue;
      const key = String(q.opportunity_id);
      const list = quoteCompanies.get(key) || [];
      if (!list.includes(company)) list.push(company);
      quoteCompanies.set(key, list);
    }
  }

  const selections = {}; // dim key -> [values]
  let groupBy = "leadEstimator";
  let repChart = null;
  let built = false;
  let optionsSig = null;

  const $ = (id) => document.getElementById(id);

  // Every value present in the data for a variable, plus anything currently
  // selected (so a filter never drops its own selection off the list).
  function optionsFor(dim) {
    const set = new Set(selections[dim.key] || []);
    for (const o of loadOpps()) for (const v of dimValues(dim, o)) set.add(v);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  // ---------- Filter UI ----------

  function buildFilters() {
    const wrap = $("rep-filters");
    wrap.innerHTML = "";

    for (const dim of DIMS) {
      const field = document.createElement("div");
      field.className = "rep-field";

      const label = document.createElement("label");
      label.textContent = dim.label;

      const box = document.createElement("div");
      box.className = "multicombo";
      box.id = `rep-mc-${dim.key}`;

      field.append(label, box);
      wrap.appendChild(field);

      buildMultiCombo(box, optionsFor(dim), selections[dim.key] || [], (vals) => {
        selections[dim.key] = vals;
        runReport();
      });
    }
  }

  function buildGroupBy() {
    const sel = $("rep-groupby");
    sel.innerHTML = "";
    for (const dim of DIMS) {
      const opt = document.createElement("option");
      opt.value = dim.key;
      opt.textContent = dim.label;
      sel.appendChild(opt);
    }
    sel.value = groupBy;
  }

  // ---------- Filtering ----------

  function matches(o) {
    for (const dim of DIMS) {
      const want = selections[dim.key] || [];
      if (!want.length) continue;
      const have = dimValues(dim, o);
      if (!want.some((w) => have.includes(w))) return false;
    }
    const from = $("rep-from").value;
    const to = $("rep-to").value;
    const due = o.bidDueDate ? String(o.bidDueDate).split("T")[0] : "";
    if (from && (!due || due < from)) return false;
    if (to && (!due || due > to)) return false;
    return true;
  }

  // ---------- Rendering ----------

  function runReport() {
    const all = loadOpps();
    const hits = all.filter(matches);

    const won = hits.filter(isWon);
    const lost = hits.filter(isLost);
    const decided = won.length + lost.length;
    const wonValue = won.reduce((s, o) => s + repAmount(o), 0);
    const lostValue = lost.reduce((s, o) => s + repAmount(o), 0);

    $("rep-decided").textContent = decided;
    $("rep-won").textContent = won.length;
    $("rep-lost").textContent = lost.length;
    $("rep-rate").textContent = pct(won.length, decided);
    $("rep-won-value").textContent = currency.format(wonValue);
    $("rep-lost-value").textContent = currency.format(lostValue);
    $("rep-rate-value").textContent = pct(wonValue, wonValue + lostValue);
    $("rep-nobid").textContent = hits.filter(isNoBid).length;

    renderBreakdown(hits);
    renderMatches(hits);
  }

  // ---------- Breakdown sorting ----------
  // Click a column to sort the table. Win rate sorts on the underlying
  // fraction, not the "62.5%" string, so 100% doesn't land between 10% and 20%.

  const GROUP_KEYS = {
    name: (g) => g.name.toLowerCase(),
    bids: (g) => g.bids,
    won: (g) => g.won,
    lost: (g) => g.lost,
    rate: (g) => (g.bids ? g.won / g.bids : -1),
    wonValue: (g) => g.wonValue,
    lostValue: (g) => g.lostValue,
  };

  let groupSort = "bids";
  let groupDir = -1; // busiest first, which is the useful default here

  function sortGroups(list) {
    const key = GROUP_KEYS[groupSort] || GROUP_KEYS.bids;
    return list.sort((a, b) => {
      const x = key(a);
      const y = key(b);
      const cmp =
        typeof x === "number" ? x - y : String(x).localeCompare(String(y));
      // Ties keep a stable, readable order rather than whatever the grouping
      // happened to produce.
      return cmp * groupDir || a.name.localeCompare(b.name);
    });
  }

  function setGroupSort(key) {
    if (groupSort === key) groupDir = -groupDir;
    else {
      groupSort = key;
      groupDir = key === "name" ? 1 : -1; // names A-Z, everything else biggest first
    }
    runReport();
  }

  function markBreakdownHeader() {
    for (const th of document.querySelectorAll(".rep-table thead th[data-sort]")) {
      const active = th.dataset.sort === groupSort;
      th.classList.toggle("is-sorted", active);
      th.classList.toggle("desc", active && groupDir === -1);
      th.setAttribute(
        "aria-sort",
        active ? (groupDir === 1 ? "ascending" : "descending") : "none"
      );
    }
  }

  // One row per value of the grouping variable. Bids with several values for
  // that variable (CM/GC, local unions) count once under each of them.
  function renderBreakdown(hits) {
    const dim = DIMS.find((d) => d.key === groupBy) || DIMS[0];
    $("rep-group-label").textContent = dim.label;
    $("rep-group-th").textContent = dim.label;

    const groups = new Map();
    const bucket = (name) => {
      if (!groups.has(name)) {
        groups.set(name, { name, bids: 0, won: 0, lost: 0, wonValue: 0, lostValue: 0 });
      }
      return groups.get(name);
    };

    for (const o of hits) {
      if (!isWon(o) && !isLost(o)) continue;
      const names = dimValues(dim, o);
      for (const name of names.length ? names : ["(none)"]) {
        const g = bucket(name);
        g.bids++;
        if (isWon(o)) {
          g.won++;
          g.wonValue += repAmount(o);
        } else {
          g.lost++;
          g.lostValue += repAmount(o);
        }
      }
    }

    const rows = sortGroups([...groups.values()]);

    const tbody = $("rep-breakdown");
    tbody.innerHTML = "";
    $("rep-group-count").textContent = rows.length;
    $("rep-group-empty").style.display = rows.length ? "none" : "block";
    markBreakdownHeader();

    for (const g of rows) {
      const tr = document.createElement("tr");
      const cells = [
        [g.name, ""],
        [g.bids, "num"],
        [g.won, "num good"],
        [g.lost, "num bad"],
        [pct(g.won, g.bids), "num strong"],
        [currency.format(g.wonValue), "num"],
        [currency.format(g.lostValue), "num"],
      ];
      for (const [text, cls] of cells) {
        const td = document.createElement("td");
        td.textContent = text;
        if (cls) td.className = cls;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    renderChart(rows);
  }

  function renderChart(rows) {
    const canvas = $("repChart");
    const emptyEl = $("rep-chart-empty");
    if (!canvas || typeof Chart === "undefined") return;

    if (repChart) {
      repChart.destroy();
      repChart = null;
    }
    if (!rows.length) {
      canvas.style.display = "none";
      emptyEl.hidden = false;
      return;
    }
    canvas.style.display = "";
    emptyEl.hidden = true;

    // The chart always shows the twelve busiest groups, whatever order the
    // table is sorted in — otherwise sorting a column would quietly change
    // which twelve are charted.
    const top = [...rows]
      .sort((a, b) => b.bids - a.bids || a.name.localeCompare(b.name))
      .slice(0, 12);
    repChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: top.map((g) => g.name),
        datasets: [
          { label: "Won", data: top.map((g) => g.won), backgroundColor: "#16a34a" },
          { label: "Lost", data: top.map((g) => g.lost), backgroundColor: "#dc2626" },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              afterBody: (items) => {
                const g = top[items[0].dataIndex];
                return `Win rate: ${pct(g.won, g.bids)}`;
              },
            },
          },
        },
        scales: {
          x: { stacked: true, ticks: { maxRotation: 60, minRotation: 30, font: { size: 10 } } },
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  }

  function renderMatches(hits) {
    const tbody = $("rep-rows");
    tbody.innerHTML = "";
    $("rep-match-count").textContent = hits.length;
    $("rep-empty").style.display = hits.length ? "none" : "block";

    const companyDim = DIMS.find((d) => d.key === "company");

    for (const o of hits) {
      const tr = document.createElement("tr");
      tr.className = "bid-row";

      const cells = [
        [o.name || "—", ""],
        [formatDueDateTime(o.bidDueDate, o.bidDueTime), ""],
        [o.leadEstimator || "—", ""],
        [dimValues(companyDim, o).join(", ") || "—", ""],
        [currency.format(repAmount(o)), "col-value"],
      ];
      for (const [text, cls] of cells) {
        const td = document.createElement("td");
        td.textContent = text;
        if (cls) td.className = cls;
        tr.appendChild(td);
      }

      const statusTd = document.createElement("td");
      statusTd.className = "col-status";
      if (o.status) {
        const pill = document.createElement("span");
        pill.className = `status ${statusClass(o.status)}`;
        pill.textContent = o.status;
        statusTd.appendChild(pill);
      } else {
        statusTd.textContent = "—";
      }
      tr.appendChild(statusTd);

      tr.addEventListener("click", () => openDetail(o));
      tbody.appendChild(tr);
    }
  }

  function resetFilters() {
    for (const key of Object.keys(selections)) delete selections[key];
    $("rep-from").value = "";
    $("rep-to").value = "";
    buildFilters();
    runReport();
  }

  // Options come from saved bids: rebuild the filter row only when the set of
  // available values actually changed (a bid was added or edited).
  function openReports() {
    if (!built) {
      buildGroupBy();
      built = true;
    }
    loadQuoteCompanies();
    const sig = DIMS.map((d) => optionsFor(d).join("|")).join("##");
    if (sig !== optionsSig) {
      optionsSig = sig;
      buildFilters();
    }
    runReport();
  }

  onViewOpen("reports", openReports);

  $("rep-groupby").addEventListener("change", (e) => {
    groupBy = e.target.value;
    runReport();
  });
  $("rep-from").addEventListener("change", runReport);
  $("rep-to").addEventListener("change", runReport);
  $("rep-reset").addEventListener("click", resetFilters);

  for (const th of document.querySelectorAll(".rep-table thead th[data-sort]")) {
    th.tabIndex = 0;
    th.addEventListener("click", () => setGroupSort(th.dataset.sort));
    th.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setGroupSort(th.dataset.sort);
      }
    });
  }
})();
