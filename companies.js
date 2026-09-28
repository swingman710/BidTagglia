// ===========================================================================
//  Companies tab — every company we've bid to, plus the details we keep on
//  them (type, industry, phone, website, notes).
//
//  The list is the union of company names on pricing quotes, names on the bids
//  themselves (CM/GC, owner, architect, engineer) and rows already saved here,
//  deduped through dashboard.js's company registry so a name shows up once
//  however it was typed. Table: public.companies (see supabase_companies.sql).
//
//  A company's name is editable. Because the name IS the link — quotes,
//  contacts and bids all store it as text, not as an id — renaming has to
//  carry every one of those references with it. renameCompany() does that, and
//  renaming onto a name already in use is a merge. See its comment.
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
  let query = "";
  // What the open company is referenced by. Worked out once when the modal
  // opens rather than on every keystroke in the name field — it is a scan of
  // every quote and every bid.
  let openRefs = null;

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

  // Type became multi-value. Rows written before that hold a plain string, so
  // read both shapes rather than needing a data migration.
  function typeList(row) {
    const v = row && row.type;
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === "string" && v.trim()) {
      return v.split(";").map((x) => x.trim()).filter(Boolean);
    }
    return [];
  }

  // Every bid each company touches, priced to or named on. Built in one pass
  // over the quotes and the bids — asking per company would be a scan of every
  // bid for each of 1,400 companies.
  function bidIndex() {
    const index = new Map(); // company key -> Set(opportunity id)
    const add = (key, oppId) => {
      if (!key) return;
      const bids = index.get(key);
      if (bids) bids.add(oppId);
      else index.set(key, new Set([oppId]));
    };
    for (const q of quotesCache) {
      add(companyKey(canonicalCompany(q.company)), String(q.opportunity_id));
    }
    for (const o of loadOpps()) {
      for (const key of companiesOnBid(o)) add(key, String(o.id));
    }
    return index;
  }

  // ---------- Renaming, merging and deleting ----------
  // The company name IS the link: quotes, contacts and the bids themselves all
  // store it as text rather than as an id. So renaming has to rewrite every
  // one of those references, or the old name simply reappears in the list the
  // next time it is read back.
  //
  // Renaming onto a name that already exists is therefore the same operation
  // as a merge, and is treated as one: both sets of references end up pointing
  // at the surviving name, and the leftover directory row is removed.

  // Postgrest puts the id list in the URL, so send it in chunks rather than
  // one request naming three thousand rows.
  const ID_CHUNK = 200;

  async function updateByIds(table, ids, patch) {
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const { error } = await sb
        .from(table)
        .update(patch)
        .in("id", ids.slice(i, i + ID_CHUNK));
      if (error) {
        toastError(`Could not update ${table}: ${error.message}`);
        return false;
      }
    }
    return true;
  }

  const sameCompany = (value, key) => companyKey(canonicalCompany(value)) === key;

  // What a rename is about to touch, so the person can be told before it runs.
  function referencesTo(key) {
    const quotes = quotesCache.filter((q) => sameCompany(q.company, key));
    const contacts = (window.BBContacts ? BBContacts.list() : []).filter((c) =>
      sameCompany(c.company, key)
    );
    const bids = loadOpps().filter((o) => companiesOnBid(o).has(key));
    return { quotes, contacts, bids, total: quotes.length + contacts.length + bids.length };
  }

  async function renameCompany(oldName, newName) {
    // Every reference has to be visible to be rewritten, and the older years
    // arrive in the background.
    await ensureHistory();

    const oldKey = companyKey(oldName);
    const newKey = companyKey(newName);
    if (!oldKey || !newKey) return false;

    const refs = referencesTo(oldKey);
    const merging = newKey !== oldKey && saved.has(newKey);

    if (refs.quotes.length) {
      const ids = refs.quotes.map((q) => q.id);
      if (!(await updateByIds(PRICING_TABLE, ids, { company: newName })) ) return false;
    }

    if (refs.contacts.length) {
      const ids = refs.contacts.map((c) => c.id);
      if (!(await updateByIds("contacts", ids, { company: newName }))) return false;
    }

    // The three single-value columns can go a field at a time. cm is a text[]
    // and every row's array is different, so those go one by one — but only
    // the handful of bids that actually name this company.
    for (const [field, column] of [
      ["ownerCustomer", "owner_customer"],
      ["architect", "architect"],
      ["engineer", "engineer"],
    ]) {
      const ids = refs.bids
        .filter((o) => sameCompany(o[field], oldKey))
        .map((o) => o.id);
      if (ids.length && !(await updateByIds(SUPABASE_TABLE, ids, { [column]: newName }))) {
        return false;
      }
    }

    for (const o of refs.bids) {
      if (!Array.isArray(o.cm) || !o.cm.some((x) => sameCompany(x, oldKey))) continue;
      // Replace this company wherever it appears, then drop any duplicate the
      // merge just created — a bid naming both companies must not end up
      // naming the survivor twice.
      const next = [];
      for (const entry of o.cm) {
        const value = sameCompany(entry, oldKey) ? newName : entry;
        if (!next.some((x) => companyKey(x) === companyKey(value))) next.push(value);
      }
      const { error } = await sb
        .from(SUPABASE_TABLE)
        .update({ cm: next })
        .eq("id", o.id);
      if (error) {
        toastError("Could not update a bid: " + error.message);
        return false;
      }
    }

    // Finally the directory row itself.
    const oldRow = saved.get(oldKey);
    if (merging) {
      // The surviving row keeps its own details; the old one goes.
      if (oldRow) {
        const { error } = await sb.from(TABLE).delete().eq("id", oldRow.id);
        if (error) {
          toastError("Could not merge the companies: " + error.message);
          return false;
        }
      }
    } else if (oldRow) {
      const { error } = await sb
        .from(TABLE)
        .update({ name: newName, updated_at: new Date().toISOString() })
        .eq("id", oldRow.id);
      if (error) {
        toastError("Could not rename the company: " + error.message);
        return false;
      }
    }

    // companyDisplay still holds the old spelling, and the caches still hold
    // the old text, so everything has to be read back.
    await refreshOpps();
    await fetchCompanies();
    if (window.BBContacts) await BBContacts.fetchContacts();
    return { merging, refs };
  }

  // Removes the saved details. Anything still naming the company keeps naming
  // it, so the name stays in the list — say so rather than appear to fail.
  async function deleteCompany(name) {
    const key = companyKey(name);
    const row = saved.get(key);
    const refs = openRefs || referencesTo(key);

    const used = refs.total
      ? `\n\n${canonicalCompany(name)} is still named on ${refs.bids.length} bid(s), ` +
        `${refs.quotes.length} quote(s) and ${refs.contacts.length} contact(s). ` +
        "Those are not touched, so the name will stay in the list — only the " +
        "type, industry, phone, website and notes are removed.\n\n" +
        "To get rid of the name itself, rename it onto the company it " +
        "duplicates instead, which merges the two."
      : "";

    if (!confirm(`Delete ${canonicalCompany(name)}?${used}`)) return;

    if (row) {
      const { error } = await sb.from(TABLE).delete().eq("id", row.id);
      if (error) {
        toastError("Could not delete the company: " + error.message);
        return;
      }
    }
    closeCompany();
    toastOk(`Deleted ${canonicalCompany(name)}`);
    await fetchCompanies();
    await renderCompanies();
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

    const counts = bidIndex();
    const rows = knownCompanies().map((name) => {
      const key = companyKey(name);
      const row = saved.get(key) || {};
      return {
        name,
        key,
        type: typeList(row).join(", "),
        industry: row.industry || "",
        phone: row.phone || "",
        website: row.website || "",
        bids: (counts.get(key) || new Set()).size,
      };
    });
    const shown = query
      ? rows.filter((r) =>
          [r.name, r.type, r.industry, r.phone, r.website]
            .join(" ")
            .toLowerCase()
            .includes(query)
        )
      : rows;
    sortRows(shown);
    markHeader();

    $("company-count").textContent = shown.length;
    $("company-empty").style.display = shown.length ? "none" : "block";
    $("company-empty").textContent = query
      ? "No companies match your search."
      : "No companies yet — add one above.";
    tbody.innerHTML = "";

    for (const entry of shown) {
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
        [entry.type || "—", ""],
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
    // Every bid they're attached to: priced to, or named on the bid as the
    // CM/GC, owner, architect or engineer.
    const bids = bidsForCompany(name);
    if (!bids.length) return;

    // Won/lost for THEM, which is not the same as the bid's own status: when
    // one proposal is marked Won, the companies on the other proposals lost
    // it, while the CM, owner and the rest won it alongside us.
    const won = bids.filter((o) => outcomeForCompany(o, key) === "Won");
    const lost = bids.filter((o) => outcomeForCompany(o, key) === "Lost");
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

  // Warns before a rename lands: what it will carry with it, and whether the
  // typed name is really a merge into a company that already exists.
  function updateNameNote() {
    const note = $("c-name-note");
    const input = $("c-name");
    if (!note || !input || !editingName) return;

    const typed = input.value.trim();
    const oldKey = companyKey(editingName);
    const newKey = companyKey(typed);
    if (!typed || newKey === oldKey) {
      note.hidden = true;
      return;
    }

    const refs = openRefs || referencesTo(oldKey);
    const merging = knownCompanies().some((n) => companyKey(n) === newKey);
    const carries = refs.total
      ? ` ${refs.total} record${refs.total === 1 ? "" : "s"} will be repointed ` +
        `(${refs.bids.length} bid, ${refs.quotes.length} quote, ` +
        `${refs.contacts.length} contact).`
      : "";

    note.textContent = merging
      ? `${canonicalCompany(typed)} already exists — saving will MERGE the two.${carries}`
      : `Renaming ${editingName} to ${typed}.${carries}`;
    note.className = `field-note${merging ? " warn" : ""}`;
    note.hidden = false;
  }

  function openCompany(name) {
    const row = saved.get(companyKey(name)) || {};
    editingName = name;

    openRefs = referencesTo(companyKey(name));
    $("company-title").textContent = name;
    $("c-name").value = name;
    $("c-name-note").hidden = true;
    // Every other company, so renaming onto one of them is a pick rather than
    // a retype — which is what makes the merge discoverable.
    fillDatalist(
      "dl-company-names",
      knownCompanies().filter((n) => companyKey(n) !== companyKey(name))
    );
    renderCompanyRecord(name);
    // Every type seen in the data, so an imported value that isn't on the
    // standard list is still selectable rather than silently dropped.
    const allTypes = new Set(COMPANY_TYPES);
    for (const r of saved.values()) for (const t of typeList(r)) allTypes.add(t);
    buildMultiCombo(
      $("mc-c-type"),
      [...allTypes].sort((a, b) => a.localeCompare(b)),
      typeList(row)
    );
    fillOptions($("c-industry"), COMPANY_INDUSTRIES, row.industry);
    $("c-phone").value = row.phone || "";
    $("c-website").value = row.website || "";
    $("c-notes").value = row.notes || "";

    $("company-modal").hidden = false;
  }

  function closeCompany() {
    $("company-modal").hidden = true;
    editingName = null;
    openRefs = null;
  }

  async function saveOpenCompany() {
    if (!editingName) return;
    const editing = editingName; // closeCompany() clears it before the toast
    const typed = $("c-name").value.trim();

    if (!typed) {
      toastError("A company needs a name.");
      $("c-name").focus();
      return;
    }

    const renaming = companyKey(typed) !== companyKey(editing);
    const merging =
      renaming && knownCompanies().some((n) => companyKey(n) === companyKey(typed));

    if (merging &&
        !confirm(
          `${canonicalCompany(typed)} already exists.\n\n` +
          `Saving will merge ${editing} into it: every bid, quote and contact ` +
          `naming ${editing} will name ${canonicalCompany(typed)} instead, and ` +
          `${editing} will stop existing.\n\nThis cannot be undone.`
        )) {
      return;
    }

    // Details are written under the name that will survive.
    const target = renaming ? typed : editing;
    const details = {
      type: $("mc-c-type")._getSelected(),
      industry: $("c-industry").value || null,
      phone: $("c-phone").value.trim() || null,
      website: $("c-website").value.trim() || null,
      notes: $("c-notes").value.trim() || null,
    };

    const save = $("company-save");
    save.disabled = true;
    save.textContent = renaming ? "Renaming…" : "Saving…";
    try {
      if (renaming) {
        const result = await renameCompany(editing, typed);
        if (!result) return;
        // The merge target may not have had a row of its own yet.
        rememberCompany(typed);
        if (!(await saveCompany(target, details))) return;
        closeCompany();
        toastOk(
          result.merging
            ? `Merged ${editing} into ${canonicalCompany(typed)}`
            : `Renamed ${editing} to ${canonicalCompany(typed)}`
        );
      } else {
        if (!(await saveCompany(target, details))) return;
        closeCompany();
        toastOk(`Saved ${editing}`);
      }
    } finally {
      save.disabled = false;
      save.textContent = "Save company";
    }
    await renderCompanies();
  }

  // ---------- Wiring ----------

  $("company-close").addEventListener("click", closeCompany);
  $("company-cancel").addEventListener("click", closeCompany);
  $("company-save").addEventListener("click", saveOpenCompany);
  $("company-delete").addEventListener("click", () => {
    if (editingName) deleteCompany(editingName);
  });
  $("c-name").addEventListener("input", updateNameNote);
  // Enter in the name field would otherwise do nothing at all.
  $("c-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveOpenCompany();
    }
  });
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

  // Companies used to appear only by pricing a bid to one. Adding a prospect
  // before you've bid to them is a reasonable thing to want.
  $("new-company")?.addEventListener("click", () => {
    const name = (prompt("Company name") || "").trim();
    if (!name) return;
    if (saved.has(companyKey(name)) || knownCompanies().some(
      (n) => companyKey(n) === companyKey(name)
    )) {
      toastError(`${canonicalCompany(name)} is already listed.`);
      return;
    }
    rememberCompany(name);
    openCompany(canonicalCompany(name));
  });

  const cSearch = $("company-search");
  if (cSearch) {
    let timer = null;
    cSearch.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        query = cSearch.value.trim().toLowerCase();
        renderCompanies();
      }, 120);
    });
  }

  onViewOpen("companies", renderCompanies);

  // Load once at start-up so saved-but-never-quoted companies show up in the
  // quote form's suggestions too — but only once the gate in access.js has
  // confirmed this person is allowed to see company data at all.
  BBAccess.ready.then(fetchCompanies);

  window.BBCompanies = { fetchCompanies, renderCompanies, saveCompany };
})();
