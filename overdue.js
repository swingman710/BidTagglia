// ===========================================================================
//  Overdue tab — bids whose due date has passed while they still read as live,
//  grouped by the estimator they belong to.
//
//  The point of the tab is not to list dates, it is to get the status put
//  right: a bid that has been sitting at Bidding for two years is not "late",
//  it is "nobody wrote down what happened". So every row carries the outcome
//  buttons with it, and acting on one takes the row off the list.
//
//  What counts as overdue is OVERDUE_STATUSES / isOverdueBid() in dashboard.js,
//  shared with the Overdue quick filter on the Opportunities tab so the two
//  can never disagree.
// ===========================================================================

(() => {
  const $ = (id) => document.getElementById(id);

  let onlyMine = false;
  // Estimators with a section open. Everyone starts collapsed except the
  // person signed in — a list of twenty expanded groups is a wall.
  const expanded = new Set();
  let expandedSeeded = false;

  const UNASSIGNED = "Unassigned";

  function estimatorOf(o) {
    return (o.leadEstimator || "").trim() || UNASSIGNED;
  }

  function me() {
    return ((BBAccess.account && BBAccess.account.name) || "").toLowerCase();
  }

  // Grouped and sorted: the estimator with the most overdue first, and each
  // group's bids oldest first — the worst offender at the top of both lists.
  function groups() {
    const mine = me();

    const byEstimator = new Map();
    for (const o of loadOpps()) {
      if (!isOverdueBid(o)) continue;
      const who = estimatorOf(o);
      // Former employees are NOT filtered out here, even though they are off
      // the dashboard graphs. Their overdue bids are the ones most likely to
      // be stale, and somebody still has to close or reassign them — dropping
      // the section would only hide the work.
      if (onlyMine && mine && who.toLowerCase() !== mine) continue;
      const list = byEstimator.get(who);
      if (list) list.push(o);
      else byEstimator.set(who, [o]);
    }

    for (const list of byEstimator.values()) {
      list.sort((a, b) =>
        String(a.bidDueDate || "").localeCompare(String(b.bidDueDate || ""))
      );
    }
    return [...byEstimator.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])
    );
  }

  // The count on the nav tab. Deliberately ignores the "only mine" tick — the
  // badge is about the whole backlog, not the current view of it.
  function totalOverdue() {
    let n = 0;
    for (const o of loadOpps()) if (isOverdueBid(o)) n++;
    return n;
  }

  function renderBadge() {
    const badge = $("overdue-badge");
    if (!badge) return;
    const n = totalOverdue();
    badge.textContent = n > 999 ? "999+" : n;
    badge.hidden = n === 0;
  }

  // ---------- Rendering ----------

  function renderBidRow(o) {
    const row = document.createElement("div");
    row.className = "od-bid";

    const open = document.createElement("button");
    open.type = "button";
    open.className = "od-open";
    const name = document.createElement("span");
    name.className = "od-name";
    name.textContent = o.name || "Untitled";
    name.title = o.name || "";
    const meta = document.createElement("span");
    meta.className = "od-meta";
    const late = Math.abs(daysUntil(o.bidDueDate));
    meta.textContent =
      [o.division, o.bidDueDate ? formatDate(o.bidDueDate) : null]
        .filter(Boolean)
        .join(" · ");
    const days = document.createElement("span");
    // Over a year late is a different kind of problem from a week late.
    days.className = `od-days${late >= 365 ? " bad" : ""}`;
    days.textContent = `${late.toLocaleString()} day${late === 1 ? "" : "s"} late`;
    const pill = document.createElement("span");
    pill.className = `status ${statusClass(o.status)}`;
    pill.textContent = o.status;
    open.append(name, meta, days, pill);
    open.addEventListener("click", () => openDetail(o));

    // The whole point of the tab: settle it without opening it.
    const actions = document.createElement("div");
    actions.className = "od-actions";
    for (const status of ["Won", "Lost", "No Bid", "On Hold (Bid)"]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `od-set ${statusClass(status)}`;
      b.textContent = status === "On Hold (Bid)" ? "On Hold" : status;
      b.title = `Move this bid to ${status}`;
      b.addEventListener("click", async () => {
        // No Bid and Cancelled need a reason written on the bid, which this
        // row has nowhere to take — send those through the bid itself.
        if (REASON_REQUIRED_STATUSES.includes(status)) {
          openDetail(o);
          toast(`${status} needs a reason — add one in the description.`);
          return;
        }
        await setOppStatus(o, status);
        renderOverdue();
      });
      actions.appendChild(b);
    }

    row.append(open, actions);
    return row;
  }

  function renderOverdue() {
    const body = $("overdue-body");
    if (!body) return;

    const list = groups();
    const shown = list.reduce((n, [, bids]) => n + bids.length, 0);

    // Everyone collapsed bar the person looking at it, the first time through.
    if (!expandedSeeded && list.length) {
      expandedSeeded = true;
      const mine = me();
      const own = list.find(([who]) => who.toLowerCase() === mine);
      if (own) expanded.add(own[0]);
      else if (list.length === 1) expanded.add(list[0][0]);
    }

    $("overdue-count").textContent = shown;
    $("overdue-empty").style.display = shown ? "none" : "block";
    $("overdue-empty").textContent = onlyMine
      ? "Nothing of yours is overdue."
      : "Nothing overdue — everything is up to date.";
    body.innerHTML = "";
    renderBadge();

    for (const [who, bids] of list) {
      const section = document.createElement("section");
      section.className = "od-group";

      const head = document.createElement("button");
      head.type = "button";
      head.className = "od-group-head";
      const isOpen = expanded.has(who);
      head.setAttribute("aria-expanded", String(isOpen));

      const caret = document.createElement("span");
      caret.className = `od-caret${isOpen ? " is-open" : ""}`;
      caret.textContent = "▸";
      const label = document.createElement("span");
      label.className = "od-who";
      label.textContent = who;
      const n = document.createElement("span");
      n.className = "od-n";
      n.textContent = `${bids.length} overdue`;

      // The oldest one in the group, so a collapsed row still says how bad it
      // is without being opened.
      const worst = Math.abs(daysUntil(bids[0].bidDueDate));
      const oldest = document.createElement("span");
      oldest.className = `od-oldest${worst >= 365 ? " bad" : ""}`;
      oldest.textContent = `oldest ${worst.toLocaleString()} days`;

      head.append(caret, label, n, oldest);
      head.addEventListener("click", () => {
        if (expanded.has(who)) expanded.delete(who);
        else expanded.add(who);
        renderOverdue();
      });
      section.appendChild(head);

      if (isOpen) {
        const wrap = document.createElement("div");
        wrap.className = "od-bids";
        for (const o of bids) wrap.appendChild(renderBidRow(o));
        section.appendChild(wrap);
      }
      body.appendChild(section);
    }
  }

  // ---------- Boot ----------

  $("overdue-mine")?.addEventListener("change", (e) => {
    onlyMine = e.target.checked;
    renderOverdue();
  });

  // Overdue is a question about the whole history, not the recent window.
  onViewOpen("overdue", async () => {
    await ensureHistory();
    renderOverdue();
  });

  // The badge has to be right before anyone opens the tab, so it is refreshed
  // whenever the bid list changes rather than only on view.
  BBAccess.ready.then(renderBadge);

  window.BBOverdue = { renderOverdue, renderBadge };
})();
