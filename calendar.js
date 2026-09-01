// ===========================================================================
//  Calendar tab — a month grid in one of two modes:
//    Activities    — scheduled activities (activities.js)
//    Bid due dates — every opportunity's bid due date (dashboard.js)
//
//  Clicking an entry opens the thing behind it: the activity's editor on the
//  Activities tab, or the bid's detail view.
//
//  Dates are handled as plain "YYYY-MM-DD" strings throughout. Both sources
//  store dates that way, and building Date objects out of them only invites
//  the usual UTC-shifts-your-day-by-one bug.
// ===========================================================================

(() => {
  const $ = (id) => document.getElementById(id);

  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = [
    "January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December",
  ];

  let mode = "activities";
  let cursor = null; // { year, month } — the month on screen, 0-indexed month

  // Filters over what the grid draws. Each mode keeps its own: activities are
  // narrowed by type and by who they're against, bid due dates by division.
  // Empty means no filter, not "show nothing". These are the calendar's own —
  // the Opportunities table keeps a separate division choice, since the two
  // views get looked at for different reasons.
  let acType = "";
  let acContact = "";
  const bidDivisions = new Set();

  function todayKey() {
    const now = new Date();
    return dateKey(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function dateKey(year, month, day) {
    return (
      `${year}-${String(month + 1).padStart(2, "0")}-` +
      String(day).padStart(2, "0")
    );
  }

  function resetCursor() {
    const now = new Date();
    cursor = { year: now.getFullYear(), month: now.getMonth() };
  }

  function shiftMonth(delta) {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    cursor = { year: d.getFullYear(), month: d.getMonth() };
    renderCalendar();
  }

  // ---------- What goes on the grid ----------
  // Each entry: { key, label, sub, className, open }. `key` is the day it
  // lands on; `open` is what clicking it does.

  function activityEntries() {
    const list = window.BBActivities ? BBActivities.list() : [];
    const entries = [];
    for (const a of list) {
      if (!a.scheduled_date) continue;
      if (acType && (a.type || "") !== acType) continue;
      if (acContact && String(a.contact_id || "") !== acContact) continue;
      entries.push({
        key: String(a.scheduled_date).split("T")[0],
        label: a.title,
        sub: a.type || "",
        className: "cal-entry activity",
        open: () => {
          showView("activities");
          BBActivities.openEditor(a);
        },
      });
    }
    return entries;
  }

  const divisionOf = (o) => o.division || "Unspecified";

  function bidEntries() {
    const entries = [];
    for (const o of loadOpps()) {
      if (!o.bidDueDate) continue;
      if (bidDivisions.size && !bidDivisions.has(divisionOf(o))) continue;
      entries.push({
        key: String(o.bidDueDate).split("T")[0],
        label: o.name || `Opportunity ${o.id}`,
        sub: [formatTime(o.bidDueTime), o.status].filter(Boolean).join(" · "),
        className: `cal-entry bid ${statusClass(o.status)}`,
        open: () => openDetail(o),
      });
    }
    return entries;
  }

  function entriesByDay() {
    const entries = mode === "bids" ? bidEntries() : activityEntries();
    const byDay = new Map();
    for (const e of entries) {
      if (!byDay.has(e.key)) byDay.set(e.key, []);
      byDay.get(e.key).push(e);
    }
    return byDay;
  }

  // ---------- Rendering ----------

  function renderWeekdays() {
    const el = $("cal-weekdays");
    if (el.childElementCount) return;
    for (const day of WEEKDAYS) {
      const cell = document.createElement("div");
      cell.className = "cal-weekday";
      cell.textContent = day;
      el.appendChild(cell);
    }
  }

  function renderCell(year, month, day, byDay, inMonth) {
    const key = dateKey(year, month, day);
    const cell = document.createElement("div");
    cell.className = "cal-day" + (inMonth ? "" : " is-outside");
    if (key === todayKey()) cell.classList.add("is-today");

    const num = document.createElement("div");
    num.className = "cal-daynum";
    num.textContent = day;
    cell.appendChild(num);

    for (const entry of byDay.get(key) || []) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = entry.className;
      btn.textContent = entry.label;
      btn.title = entry.sub ? `${entry.label} — ${entry.sub}` : entry.label;
      btn.addEventListener("click", entry.open);
      cell.appendChild(btn);
    }
    return cell;
  }

  // ---------- Filter bar ----------
  // Swapped out with the mode: activities filter by type and contact, bid due
  // dates by division. Counts describe the month on screen, since that is
  // what the grid is about to draw.

  function inMonth(dateStr) {
    if (!cursor || !dateStr) return false;
    const [y, m] = String(dateStr).split("T")[0].split("-");
    return Number(y) === cursor.year && Number(m) === cursor.month + 1;
  }

  function labelOnly(el, text) {
    const tag = document.createElement("span");
    tag.className = "filter-bar-label";
    tag.textContent = text;
    el.appendChild(tag);
  }

  // One <select> over a list of [value, label, count] rows.
  function renderSelect(host, { label, anyLabel, options, value, onPick }) {
    labelOnly(host, label);
    const sel = document.createElement("select");
    sel.classList.toggle("is-on", !!value);
    const any = document.createElement("option");
    any.value = "";
    any.textContent = anyLabel;
    sel.appendChild(any);
    for (const [val, text, n] of options) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = n === null ? text : `${text} (${n})`;
      sel.appendChild(opt);
    }
    // A value that no longer appears in the list would silently reset the
    // select to "All" while the filter stayed on — keep it listed instead.
    if (value && !options.some(([val]) => val === value)) {
      const orphan = document.createElement("option");
      orphan.value = value;
      orphan.textContent = value;
      sel.appendChild(orphan);
    }
    sel.value = value;
    sel.addEventListener("change", () => onPick(sel.value));
    host.appendChild(sel);
  }

  function activityFilters(host) {
    const list = window.BBActivities ? BBActivities.list() : [];

    const typeCounts = new Map();
    const contactCounts = new Map();
    for (const a of list) {
      if (!a.scheduled_date) continue;
      if (!inMonth(a.scheduled_date)) continue;
      if (a.type) typeCounts.set(a.type, (typeCounts.get(a.type) || 0) + 1);
      if (a.contact_id != null) {
        const k = String(a.contact_id);
        contactCounts.set(k, (contactCounts.get(k) || 0) + 1);
      }
    }

    // Every type and contact any activity uses, so a filter can be set for a
    // month other than the one on screen. Counts are for this month.
    const types = new Set();
    const contacts = new Set();
    for (const a of list) {
      if (!a.scheduled_date) continue;
      if (a.type) types.add(a.type);
      if (a.contact_id != null) contacts.add(String(a.contact_id));
    }

    // Nothing recorded to filter on yet — an empty pair of dropdowns is just
    // furniture.
    if (!types.size && !contacts.size) return;

    renderSelect(host, {
      label: "Type",
      anyLabel: "All types",
      value: acType,
      options: [...types]
        .sort((a, b) => a.localeCompare(b))
        .map((t) => [t, t, typeCounts.get(t) || 0]),
      onPick: (v) => {
        acType = v;
        renderCalendar();
      },
    });

    const nameFor = (id) => {
      const c = window.BBContacts ? BBContacts.byId(id) : null;
      return c ? BBActivities.labelFor(c) : `Contact ${id}`;
    };
    renderSelect(host, {
      label: "Contact",
      anyLabel: "All contacts",
      value: acContact,
      options: [...contacts]
        .map((id) => [id, nameFor(id), contactCounts.get(id) || 0])
        .sort((a, b) => a[1].localeCompare(b[1])),
      onPick: (v) => {
        acContact = v;
        renderCalendar();
      },
    });

    if (acType || acContact) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "btn-ghost sm filter-bar-clear";
      clear.textContent = "Clear filters";
      clear.addEventListener("click", () => {
        acType = "";
        acContact = "";
        renderCalendar();
      });
      host.appendChild(clear);
    }
  }

  function bidFilters(host) {
    const counts = new Map();
    const all = new Set();
    for (const o of loadOpps()) {
      if (!o.bidDueDate) continue;
      const d = divisionOf(o);
      all.add(d);
      if (inMonth(o.bidDueDate)) counts.set(d, (counts.get(d) || 0) + 1);
    }
    renderDivisionPills(host, {
      label: "Division",
      all: divisionOrder(all),
      counts,
      selected: bidDivisions,
      onPick: (division) => {
        const next = pickDivision(bidDivisions, divisionOrder(all), division);
        bidDivisions.clear();
        for (const d of next) bidDivisions.add(d);
        renderCalendar();
      },
    });
  }

  function renderFilters() {
    const host = $("cal-filters");
    if (!host) return;
    host.innerHTML = "";
    host.hidden = false;
    if (mode === "bids") bidFilters(host);
    else activityFilters(host);
    // Nothing to choose between: renderDivisionPills may have hidden it, and
    // an activities bar always has its two selects.
    if (!host.childElementCount) host.hidden = true;
  }

  function renderCalendar() {
    const grid = $("cal-grid");
    if (!grid) return;
    if (!cursor) resetCursor();
    renderWeekdays();
    renderFilters();

    const { year, month } = cursor;
    $("cal-title").textContent = `${MONTHS[month]} ${year}`;
    $("cal-month-hint").textContent =
      mode === "bids" ? "Bid due dates" : "Scheduled activities";

    const byDay = entriesByDay();
    grid.innerHTML = "";

    // Lead in with the tail of the previous month so the first row starts on
    // the right weekday, and pad the last row out the same way.
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();

    for (let i = firstWeekday - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, daysInPrev - i);
      grid.appendChild(
        renderCell(d.getFullYear(), d.getMonth(), d.getDate(), byDay, false)
      );
    }
    for (let day = 1; day <= daysInMonth; day++) {
      grid.appendChild(renderCell(year, month, day, byDay, true));
    }
    const filled = firstWeekday + daysInMonth;
    const trailing = (7 - (filled % 7)) % 7;
    for (let i = 1; i <= trailing; i++) {
      const d = new Date(year, month + 1, i);
      grid.appendChild(
        renderCell(d.getFullYear(), d.getMonth(), d.getDate(), byDay, false)
      );
    }
  }

  // Opening the tab: make sure the data behind the current mode is loaded.
  async function openCalendar() {
    if (!cursor) resetCursor();
    if (mode === "activities" && window.BBActivities) {
      await BBActivities.fetchActivities();
      // The contact filter names people, so it needs them loaded even when
      // the Contacts tab has never been opened.
      if (window.BBContacts && !BBContacts.list().length) {
        await BBContacts.fetchContacts();
      }
    }
    renderCalendar();
  }

  function setMode(next) {
    if (mode === next) return;
    mode = next;
    for (const btn of document.querySelectorAll(".cal-mode")) {
      btn.classList.toggle("is-active", btn.dataset.mode === mode);
    }
    openCalendar();
  }

  // ---------- Boot ----------

  for (const btn of document.querySelectorAll(".cal-mode")) {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  }
  $("cal-prev")?.addEventListener("click", () => shiftMonth(-1));
  $("cal-next")?.addEventListener("click", () => shiftMonth(1));
  $("cal-today")?.addEventListener("click", () => {
    resetCursor();
    renderCalendar();
  });

  onViewOpen("calendar", openCalendar);

  window.BBCalendar = { renderCalendar, setMode };
})();
