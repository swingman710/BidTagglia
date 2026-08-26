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

  function bidEntries() {
    const entries = [];
    for (const o of loadOpps()) {
      if (!o.bidDueDate) continue;
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

  function renderCalendar() {
    const grid = $("cal-grid");
    if (!grid) return;
    if (!cursor) resetCursor();
    renderWeekdays();

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
