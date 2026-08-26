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
    const { data, error } = await sb.from(TABLE).select("*");
    if (error) {
      console.error("Company load error:", error.message);
      return saved;
    }
    saved = new Map();
    for (const row of data || []) {
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
      alert("Could not save company: " + error.message);
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

  // ---------- List ----------

  async function renderCompanies() {
    const tbody = $("company-rows");
    if (!tbody) return;
    await fetchCompanies();

    const names = knownCompanies();
    const counts = bidCounts();

    $("company-count").textContent = names.length;
    $("company-empty").style.display = names.length ? "none" : "block";
    tbody.innerHTML = "";

    for (const name of names) {
      const key = companyKey(name);
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
      bidsTd.textContent = (counts.get(key) || new Set()).size;
      tr.appendChild(bidsTd);

      tr.addEventListener("click", () => openCompany(name));
      tbody.appendChild(tr);
    }
  }

  // ---------- Detail modal ----------

  function fillOptions(select, options, value) {
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

  function openCompany(name) {
    const row = saved.get(companyKey(name)) || {};
    editingName = name;

    $("company-title").textContent = name;
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
    const ok = await saveCompany(editingName, {
      type: $("c-type").value || null,
      industry: $("c-industry").value || null,
      phone: $("c-phone").value.trim() || null,
      website: $("c-website").value.trim() || null,
      notes: $("c-notes").value.trim() || null,
    });
    if (!ok) return;
    closeCompany();
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

  onViewOpen("companies", renderCompanies);

  // Load once at start-up so saved-but-never-quoted companies show up in the
  // quote form's suggestions too — but only once the gate in access.js has
  // confirmed this person is allowed to see company data at all.
  BBAccess.ready.then(fetchCompanies);

  window.BBCompanies = { fetchCompanies, renderCompanies, saveCompany };
})();
