// ===========================================================================
//  Omissions report (on the Reports tab) — bids missing information.
//
//  Two kinds of gap, both defined in dashboard.js next to the form check that
//  enforces the first:
//
//    REQUIRED_FIELDS  — urgent. The form won't save a bid without them, so a
//                       bid missing one predates the rule or was imported.
//    EXPECTED_FIELDS  — the PM, the project team, bid type and method, city
//                       and address. Not required to save, but a bid without
//                       them is incomplete.
//
//  Clicking a bid opens it for editing, and saving it there is what clears it
//  off the list — the form won't save until the required fields are in.
// ===========================================================================

(() => {
  const $ = (id) => document.getElementById(id);

  let scope = "active"; // "active" | "all"
  let onlyMine = false;
  let fieldFilter = null; // a field key: only bids missing that field

  // Thousands of old bids are missing something; drawing them all is a pause
  // nobody needs. Counting still covers every one.
  const ROW_LIMIT = 500;

  function me() {
    return currentEstimatorName().toLowerCase();
  }

  function inScope(o) {
    if (scope === "active" && !isActive(o)) return false;
    if (onlyMine) {
      const mine = me();
      if (!mine || String(o.leadEstimator || "").trim().toLowerCase() !== mine) {
        return false;
      }
    }
    return true;
  }

  // Every in-scope bid missing anything, worst first: most urgent gaps, then
  // most gaps overall, then soonest due — a bid due next week with no state is
  // a bigger problem than one due next year.
  function findOmissions() {
    const bidTo = bidToIds();
    const out = [];
    for (const o of loadOpps()) {
      if (!inScope(o)) continue;
      const gaps = omissionsFor(o, bidTo);
      if (gaps.urgent.length || gaps.expected.length) out.push({ o, ...gaps });
    }
    out.sort(
      (a, b) =>
        b.urgent.length - a.urgent.length ||
        b.expected.length - a.expected.length ||
        dueKey(a.o).localeCompare(dueKey(b.o))
    );
    return out;
  }

  // No due date sorts last.
  function dueKey(o) {
    return String(o.bidDueDate || "9999");
  }

  // Active bids with a required field missing, whoever they belong to — the
  // count on the report's button.
  function renderBadge() {
    const badge = $("omissions-badge");
    if (!badge) return;
    const bidTo = bidToIds();
    let n = 0;
    for (const o of loadOpps()) {
      if (isActive(o) && omissionsFor(o, bidTo).urgent.length) n++;
    }
    badge.textContent = n > 999 ? "999+" : n;
    badge.hidden = n === 0;
  }

  function chip(label, urgent) {
    const c = document.createElement("span");
    c.className = `om-chip${urgent ? " urgent" : ""}`;
    c.textContent = label;
    return c;
  }

  // One button per field that anything in scope is missing, with how many.
  function renderFieldChips(list) {
    const host = $("om-fields");
    host.innerHTML = "";
    const counts = new Map();
    for (const r of list) {
      for (const f of [...r.urgent, ...r.expected]) {
        counts.set(f.key, (counts.get(f.key) || 0) + 1);
      }
    }
    // A filter on a field nothing is missing any more would show nothing.
    if (fieldFilter && !counts.has(fieldFilter)) fieldFilter = null;

    for (const [fields, urgent] of [
      [REQUIRED_FIELDS, true],
      [EXPECTED_FIELDS, false],
    ]) {
      for (const f of fields) {
        const n = counts.get(f.key);
        if (!n) continue;
        const b = document.createElement("button");
        b.type = "button";
        b.className =
          `om-field${urgent ? " urgent" : ""}` +
          (fieldFilter === f.key ? " is-active" : "");
        b.setAttribute("aria-pressed", String(fieldFilter === f.key));
        b.title =
          fieldFilter === f.key
            ? "Show every bid again"
            : `Show only bids missing ${f.label.toLowerCase()}`;
        const label = document.createElement("span");
        label.textContent = f.label;
        const count = document.createElement("span");
        count.className = "om-field-n";
        count.textContent = n.toLocaleString();
        b.append(label, count);
        b.addEventListener("click", () => {
          fieldFilter = fieldFilter === f.key ? null : f.key;
          render();
        });
        host.appendChild(b);
      }
    }
    host.hidden = !host.childElementCount;
  }

  function render() {
    const tbody = $("om-rows");
    if (!tbody) return;

    const all = findOmissions();
    renderFieldChips(all);
    const list = fieldFilter
      ? all.filter((r) =>
          [...r.urgent, ...r.expected].some((f) => f.key === fieldFilter)
        )
      : all;

    $("om-count").textContent = list.length.toLocaleString();
    tbody.innerHTML = "";
    $("om-empty").style.display = list.length ? "none" : "block";
    $("om-empty").textContent =
      scope === "active"
        ? "Every active bid has everything filled in."
        : "Every bid has everything filled in.";
    renderBadge();

    const shown = list.slice(0, ROW_LIMIT);
    const note = $("om-note");
    note.hidden = shown.length >= list.length;
    note.textContent =
      `Showing the worst ${shown.length.toLocaleString()} of ` +
      `${list.length.toLocaleString()} — pick a field above to narrow it down.`;

    for (const { o, urgent, expected } of shown) {
      const tr = document.createElement("tr");
      tr.className = `bid-row${urgent.length ? " om-is-urgent" : ""}`;
      tr.title = "Open this bid to fill it in";

      const nameTd = document.createElement("td");
      nameTd.className = "om-name";
      nameTd.textContent = o.name || "Untitled";

      const dueTd = document.createElement("td");
      dueTd.textContent = o.bidDueDate ? formatDate(o.bidDueDate) : "—";

      const estTd = document.createElement("td");
      estTd.textContent = o.leadEstimator || "—";

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

      const missTd = document.createElement("td");
      missTd.className = "om-missing";
      for (const f of urgent) missTd.appendChild(chip(f.label, true));
      for (const f of expected) missTd.appendChild(chip(f.label, false));

      tr.append(nameTd, dueTd, estTd, statusTd, missTd);
      tr.addEventListener("click", () => openModal(o));
      tbody.appendChild(tr);
    }
  }

  async function open() {
    if (scope === "all") await ensureHistory();
    render();
  }

  $("om-scope").addEventListener("change", (e) => {
    scope = e.target.value;
    open();
  });
  $("om-mine").addEventListener("change", (e) => {
    onlyMine = e.target.checked;
    render();
  });

  window.BBOmissions = { open, render, renderBadge };
})();
