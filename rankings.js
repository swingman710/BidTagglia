// ===========================================================================
//  Bid rankings.
//
//  "Request ranking" on a bid asks a chosen set of users — always including
//  the person asking — to score it. Each of them gets a request on the Ranking
//  tab, answers every criterion from 1 (very unfavorable) to 4 (very
//  favorable), and the bid then shows the average of the scores given so far
//  as a number in a ring, red through yellow to green.
//
//  The scoring is the company's bid/no-bid matrix: each criterion carries a
//  weight out of 100, and each answer earns a fixed share of that weight — see
//  RANKING_LEVELS. A bid answered "very favorable" across the board scores
//  100; "very unfavorable" across the board scores 25.
//
//  Stored in public.bid_rankings, one row per person asked about one bid; see
//  supabase_rankings.sql.
// ===========================================================================

// Weights add up to 100.
const RANKING_CRITERIA = [
  { key: "enterprise_workload", label: "Enterprise Workload", weight: 15 },
  { key: "cm_gc_relationship", label: "CM/GC Relationship", weight: 10 },
  { key: "owner_relationship", label: "Owner Relationship", weight: 8 },
  { key: "competition", label: "Competition", weight: 8 },
  { key: "location", label: "Location", weight: 4 },
  { key: "market_fit", label: "Market Fit", weight: 9 },
  { key: "future_workload", label: "Future Workload Potential", weight: 4 },
  { key: "estimator_capacity", label: "Estimator Capacity", weight: 6 },
  { key: "precon_capacity", label: "Precon Capacity", weight: 6 },
  { key: "pm_foreman_capacity", label: "PM/Foreman Capacity", weight: 10 },
  { key: "local_workforce", label: "Local Workforce Availability", weight: 20 },
];

// The share of a criterion's weight each answer earns. Not evenly spaced, on
// purpose: the matrix treats 2 as most of the way to acceptable and saves the
// big penalty for 1.
const RANKING_LEVELS = [
  { level: 1, label: "Very Unfavorable", share: 0.25 },
  { level: 2, label: "Unfavorable", share: 0.7 },
  { level: 3, label: "Favorable", share: 0.93 },
  { level: 4, label: "Very Favorable", share: 1 },
];

// Weighted total out of 100, or null until every criterion is answered.
function rankingScore(scores) {
  if (!scores) return null;
  let total = 0;
  for (const c of RANKING_CRITERIA) {
    const level = RANKING_LEVELS.find((l) => l.level === scores[c.key]);
    if (!level) return null;
    total += c.weight * level.share;
  }
  return Math.round(total * 100) / 100;
}

// Ring colour for a score. Hue is pinned to what the answers mean rather than
// spread evenly over 25-100: all 2s (70) is still reddish, halfway between all
// 2s and all 3s is yellow, and all 3s (93) is properly green. An even spread
// would paint an "unfavorable" bid yellow-green.
const RANK_HUE_STOPS = [
  [25, 0],
  [70, 22],
  [81.5, 50],
  [93, 115],
  [100, 135],
];

function rankHue(score) {
  const stops = RANK_HUE_STOPS;
  if (score <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [s1, h1] = stops[i];
    if (score <= s1) {
      const [s0, h0] = stops[i - 1];
      return h0 + ((score - s0) / (s1 - s0)) * (h1 - h0);
    }
  }
  return stops[stops.length - 1][1];
}

(() => {
  const $ = (id) => document.getElementById(id);

  let rows = [];
  let loaded = false;
  // The migration hasn't been run: say so instead of failing on every click.
  let tableMissing = false;
  let people = []; // app_members rows that are real, unblocked accounts

  // Answers being filled in on the Ranking tab, by row id, so a re-render
  // (another request arriving, the tab being reopened) doesn't wipe them.
  const drafts = new Map();
  // Submitted rankings reopened with "Change".
  const editing = new Set();

  const MISSING_TABLE_MSG =
    "Rankings aren't set up in the database yet — run supabase_rankings.sql " +
    "in the Supabase SQL editor.";

  function me() {
    return BBAccess.identity;
  }

  function myName() {
    return (
      (BBAccess.member && BBAccess.member.name) ||
      (BBAccess.account && BBAccess.account.name) ||
      me()
    );
  }

  function personName(identity) {
    if (identity === me()) return myName();
    const p = people.find((m) => m.identity === identity);
    return (p && (p.name || p.email)) || identity || "Someone";
  }

  // ---------- Data ----------

  async function fetchRankings() {
    const { rows: data, error } = await fetchAll(RANKINGS_TABLE, { order: "id" });
    if (error) {
      tableMissing = isMissingTable(error);
      return rows;
    }
    tableMissing = false;
    rows = data;
    loaded = true;
    return rows;
  }

  async function fetchPeople() {
    const members = await BBUsers.fetchMembers();
    people = members.filter((m) => m.source !== "estimator" && !m.blocked);
    return people;
  }

  function rowsFor(oppId) {
    const id = String(oppId);
    return rows.filter((r) => r.opportunity_id === id);
  }

  function summaryFor(oppId) {
    const asked = rowsFor(oppId);
    const done = asked.filter((r) => r.submitted_at && r.score != null);
    const avg = done.length
      ? done.reduce((n, r) => n + Number(r.score), 0) / done.length
      : null;
    return { asked, done, avg };
  }

  function mine() {
    return rows.filter((r) => r.identity === me());
  }

  // ---------- The ring ----------

  const RING_R = 15.5;
  const RING_C = 2 * Math.PI * RING_R;

  // `summary` from summaryFor(). The arc is the score out of 100, so the ring
  // says how high it is at a glance as well as by colour.
  function buildRing(summary, { small = false } = {}) {
    const ring = document.createElement("span");
    ring.className = `rank-ring${small ? " sm" : ""}`;
    const pending = summary.avg == null;
    if (pending) ring.classList.add("is-pending");
    else ring.style.setProperty("--rank-hue", rankHue(summary.avg).toFixed(1));

    const frac = pending ? 0 : summary.avg / 100;
    ring.innerHTML =
      `<svg viewBox="0 0 36 36" aria-hidden="true">` +
      `<circle class="rank-track" cx="18" cy="18" r="${RING_R}" />` +
      `<circle class="rank-arc" cx="18" cy="18" r="${RING_R}" ` +
      `stroke-dasharray="${(frac * RING_C).toFixed(2)} ${RING_C.toFixed(2)}" />` +
      `</svg>`;
    const num = document.createElement("span");
    num.className = "rank-num";
    num.textContent = pending ? "–" : Math.round(summary.avg);
    ring.appendChild(num);

    const lines = summary.asked.map((r) =>
      r.submitted_at && r.score != null
        ? `${personName(r.identity)}: ${Number(r.score).toFixed(1)}`
        : `${personName(r.identity)}: waiting`
    );
    ring.title =
      (pending
        ? "Not ranked yet"
        : `Ranking ${summary.avg.toFixed(1)} out of 100`) +
      (lines.length ? "\n\n" + lines.join("\n") : "");
    ring.setAttribute("role", "img");
    ring.setAttribute(
      "aria-label",
      pending ? "Not ranked yet" : `Ranking ${Math.round(summary.avg)} out of 100`
    );
    return ring;
  }

  function respondedText(summary) {
    const n = summary.asked.length;
    if (summary.done.length === n) {
      return n === 1 ? "1 ranking" : `All ${n} responded`;
    }
    return `${summary.done.length} of ${n} responded`;
  }

  // ---------- On the bid ----------

  // Fills the left end of the bid's Edit/Print bar: the ring when anyone has
  // been asked, and the Request ranking button.
  function paintDetailSummary(o, host) {
    host.innerHTML = "";
    const summary = summaryFor(o.id);
    if (!summary.asked.length) return;
    host.appendChild(buildRing(summary));
    const text = document.createElement("span");
    text.className = "rank-caption";
    const label = document.createElement("strong");
    label.textContent = "Ranking";
    const sub = document.createElement("span");
    sub.textContent = respondedText(summary);
    text.append(label, sub);
    host.appendChild(text);
  }

  function decorateDetail(o, bar) {
    const host = document.createElement("div");
    host.className = "rank-summary";
    bar.prepend(host);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-ghost sm";
    btn.textContent = "Request ranking";
    btn.addEventListener("click", () => openRequest(o, () => paintDetailSummary(o, host)));
    bar.appendChild(btn);

    paintDetailSummary(o, host);
    // Someone may have submitted since the list was last read.
    fetchRankings().then(() => {
      if (host.isConnected) paintDetailSummary(o, host);
      renderBadge();
    });
  }

  // ---------- Request modal ----------

  const reqModal = $("rank-modal");
  let reqOpp = null;
  let reqDone = null; // repaints whatever opened the modal
  let reqPicked = new Set();

  function closeRequest() {
    reqModal.hidden = true;
    reqOpp = null;
    reqDone = null;
  }

  function renderPeopleList() {
    const list = $("rank-people");
    const q = $("rank-search").value.trim().toLowerCase();
    list.innerHTML = "";

    const already = new Map(rowsFor(reqOpp.id).map((r) => [r.identity, r]));
    const everyone = [...people];
    // The admin can be let in without a row on the list (see access.js), and
    // the requester always ranks their own request.
    if (!everyone.some((p) => p.identity === me())) {
      everyone.push({ identity: me(), name: myName(), email: me() });
    }
    everyone.sort((a, b) =>
      (b.identity === me()) - (a.identity === me()) ||
      String(a.name || a.email).localeCompare(String(b.name || b.email))
    );

    let shown = 0;
    for (const p of everyone) {
      const name = p.name || p.email || p.identity;
      if (q && !`${name} ${p.email || ""}`.toLowerCase().includes(q)) continue;
      shown++;

      const self = p.identity === me();
      const prior = already.get(p.identity);
      const row = document.createElement("label");
      row.className = "export-opt rank-person";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = self || !!prior || reqPicked.has(p.identity);
      box.disabled = self || !!prior;
      box.addEventListener("change", () => {
        if (box.checked) reqPicked.add(p.identity);
        else reqPicked.delete(p.identity);
        updateRequestButton();
      });
      const text = document.createElement("span");
      text.textContent = name;
      const small = document.createElement("small");
      small.textContent = self
        ? prior && prior.submitted_at
          ? `You — ranked it ${Number(prior.score).toFixed(1)}`
          : "You — whoever asks always ranks it too"
        : prior
          ? prior.submitted_at
            ? `Already ranked it: ${Number(prior.score).toFixed(1)}`
            : "Already asked — waiting on them"
          : p.email || "";
      text.appendChild(small);
      row.append(box, text);
      list.appendChild(row);
    }
    if (!shown) {
      const none = document.createElement("p");
      none.className = "export-note";
      none.textContent = "Nobody matches that.";
      list.appendChild(none);
    }
  }

  function updateRequestButton() {
    const askedMe = rowsFor(reqOpp.id).some((r) => r.identity === me());
    const n = reqPicked.size + (askedMe ? 0 : 1);
    const go = $("rank-go");
    go.disabled = n === 0;
    go.textContent = n
      ? `Send to ${n} ${n === 1 ? "person" : "people"}`
      : "Pick someone to ask";
  }

  async function openRequest(o, onDone) {
    if (!loaded) await fetchRankings();
    if (!loaded) {
      toastError(tableMissing ? MISSING_TABLE_MSG : "Could not load rankings.");
      return;
    }
    await fetchPeople();
    reqOpp = o;
    reqDone = onDone;
    reqPicked = new Set();
    $("rank-modal-bid").textContent = o.name || "this bid";
    $("rank-search").value = "";
    renderPeopleList();
    updateRequestButton();
    reqModal.hidden = false;
    $("rank-search").focus();
  }

  async function sendRequest() {
    const o = reqOpp;
    const already = new Set(rowsFor(o.id).map((r) => r.identity));
    const targets = new Set(reqPicked);
    targets.add(me());
    const now = new Date().toISOString();
    const insert = [...targets]
      .filter((id) => !already.has(id))
      .map((identity) => ({
        opportunity_id: String(o.id),
        identity,
        name: personName(identity),
        requested_by: me(),
        requested_at: now,
      }));
    if (!insert.length) return closeRequest();

    $("rank-go").disabled = true;
    // Someone else may have asked the same person in the meantime; that's
    // the same request, so let the unique key drop the duplicate quietly.
    const { error } = await sb
      .from(RANKINGS_TABLE)
      .upsert(insert, { onConflict: "opportunity_id,identity", ignoreDuplicates: true });
    if (error) {
      $("rank-go").disabled = false;
      toastError(
        isMissingTable(error)
          ? MISSING_TABLE_MSG
          : "Could not send the ranking request: " + error.message
      );
      return;
    }

    await fetchRankings();
    const done = reqDone;
    closeRequest();
    if (done) done();
    renderBadge();
    const others = insert.filter((r) => r.identity !== me()).length;
    toastOk(
      others
        ? `Asked ${others} ${others === 1 ? "person" : "people"} to rank this bid` +
          (insert.some((r) => r.identity === me()) ? " — yours is on the Ranking tab" : "")
        : "Added to your Ranking tab"
    );
  }

  $("rank-close").addEventListener("click", closeRequest);
  $("rank-cancel").addEventListener("click", closeRequest);
  $("rank-go").addEventListener("click", sendRequest);
  $("rank-search").addEventListener("input", renderPeopleList);
  reqModal.addEventListener("click", (e) => {
    if (e.target === reqModal) closeRequest();
  });
  // Capture phase, ahead of dashboard.js's own Escape handler, which would
  // otherwise close the bid sitting underneath this.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && !reqModal.hidden) {
        e.stopImmediatePropagation();
        closeRequest();
      }
    },
    true
  );

  // ---------- Ranking tab ----------

  function renderBadge() {
    const badge = $("ranking-badge");
    if (!badge) return;
    const n = mine().filter((r) => !r.submitted_at).length;
    badge.textContent = n > 99 ? "99+" : n;
    badge.hidden = n === 0;
  }

  function oppIndex() {
    const map = new Map();
    for (const o of loadOpps()) map.set(String(o.id), o);
    return map;
  }

  function shortDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (isNaN(d)) return "";
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }

  async function submitRanking(row) {
    const answers = drafts.get(row.id) || {};
    const score = rankingScore(answers);
    if (score == null) return;
    const scores = {};
    for (const c of RANKING_CRITERIA) scores[c.key] = answers[c.key];

    const { error } = await sb
      .from(RANKINGS_TABLE)
      .update({ scores, score, submitted_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      toastError("Could not save your ranking: " + error.message);
      return;
    }
    drafts.delete(row.id);
    editing.delete(row.id);
    toastOk(`Ranked ${score.toFixed(1)} out of 100`);
    await fetchRankings();
    renderBadge();
    renderRanking();
  }

  function buildScoreForm(row) {
    if (!drafts.has(row.id)) drafts.set(row.id, { ...(row.scores || {}) });
    const answers = drafts.get(row.id);

    const form = document.createElement("div");
    form.className = "rk-form";

    const grid = document.createElement("div");
    grid.className = "rk-grid";
    const head = document.createElement("div");
    head.className = "rk-row rk-row-head";
    head.innerHTML = `<span class="rk-crit">Criteria</span><span class="rk-weight">Weight</span>`;
    for (const l of RANKING_LEVELS) {
      const h = document.createElement("span");
      h.className = "rk-level-head";
      h.textContent = `${l.level} · ${l.label}`;
      head.appendChild(h);
    }
    grid.appendChild(head);

    const footScore = document.createElement("span");
    const footLeft = document.createElement("span");
    const submit = document.createElement("button");

    const refreshFoot = () => {
      const score = rankingScore(answers);
      const left = RANKING_CRITERIA.filter((c) => !answers[c.key]).length;
      footScore.textContent =
        score == null ? "—" : score.toFixed(1);
      footScore.className = `rk-total${score == null ? " is-empty" : ""}`;
      if (score != null) footScore.style.setProperty("--rank-hue", rankHue(score).toFixed(1));
      footLeft.textContent = left
        ? `${left} still to answer`
        : "All answered";
      submit.disabled = score == null;
    };

    for (const c of RANKING_CRITERIA) {
      const line = document.createElement("div");
      line.className = "rk-row";
      const label = document.createElement("span");
      label.className = "rk-crit";
      label.textContent = c.label;
      const weight = document.createElement("span");
      weight.className = "rk-weight";
      weight.textContent = `${c.weight}%`;
      line.append(label, weight);

      const picks = [];
      for (const l of RANKING_LEVELS) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `rk-pick lv${l.level}`;
        b.textContent = l.level;
        const pts = Math.round(c.weight * l.share * 100) / 100;
        b.title = `${l.label} — ${pts} of ${c.weight} points`;
        b.setAttribute("aria-label", `${c.label}: ${l.label}`);
        b.setAttribute("aria-pressed", String(answers[c.key] === l.level));
        b.addEventListener("click", () => {
          answers[c.key] = l.level;
          for (const p of picks) {
            p.setAttribute("aria-pressed", String(p === b));
          }
          refreshFoot();
        });
        picks.push(b);
        line.appendChild(b);
      }
      grid.appendChild(line);
    }
    form.appendChild(grid);

    const foot = document.createElement("div");
    foot.className = "rk-foot";
    const scoreWrap = document.createElement("span");
    scoreWrap.className = "rk-score";
    scoreWrap.append("Score ", footScore, " / 100");
    footLeft.className = "rk-left";
    foot.append(scoreWrap, footLeft);

    if (row.submitted_at) {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn-ghost sm";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => {
        drafts.delete(row.id);
        editing.delete(row.id);
        renderRanking();
      });
      foot.appendChild(cancel);
    }
    submit.type = "button";
    submit.className = "btn-primary inline";
    submit.textContent = row.submitted_at ? "Save ranking" : "Submit ranking";
    submit.addEventListener("click", () => submitRanking(row));
    foot.appendChild(submit);
    form.appendChild(foot);

    refreshFoot();
    return form;
  }

  function buildCard(row, opps) {
    const o = opps.get(row.opportunity_id);
    const card = document.createElement("article");
    card.className = `rk-card${row.submitted_at ? " is-done" : ""}`;

    const head = document.createElement("div");
    head.className = "rk-head";

    const open = document.createElement("button");
    open.type = "button";
    open.className = "rk-open";
    const name = document.createElement("span");
    name.className = "rk-name";
    name.textContent = o ? o.name || "Untitled" : "Bid no longer in the tracker";
    const meta = document.createElement("span");
    meta.className = "rk-meta";
    meta.textContent = [
      o && o.division,
      o && o.bidDueDate ? `due ${formatDate(o.bidDueDate)}` : null,
      row.requested_by === me()
        ? `you asked ${shortDate(row.requested_at)}`
        : `asked by ${personName(row.requested_by)} ${shortDate(row.requested_at)}`,
    ]
      .filter(Boolean)
      .join(" · ");
    open.append(name, meta);
    if (o) open.addEventListener("click", () => openDetail(o));
    else open.disabled = true;
    head.appendChild(open);

    if (row.submitted_at && !editing.has(row.id)) {
      const yours = document.createElement("span");
      yours.className = "rk-yours";
      yours.textContent = `You gave it ${Number(row.score).toFixed(1)}`;
      const change = document.createElement("button");
      change.type = "button";
      change.className = "btn-ghost sm";
      change.textContent = "Change";
      change.addEventListener("click", () => {
        editing.add(row.id);
        renderRanking();
      });
      head.append(yours, change);
    }

    const summary = summaryFor(row.opportunity_id);
    const overall = document.createElement("span");
    overall.className = "rk-overall";
    const cap = document.createElement("span");
    cap.className = "rk-overall-cap";
    cap.textContent = respondedText(summary);
    overall.append(cap, buildRing(summary, { small: true }));
    head.appendChild(overall);

    card.appendChild(head);
    if (!row.submitted_at || editing.has(row.id)) card.appendChild(buildScoreForm(row));
    return card;
  }

  function renderRanking() {
    const body = $("ranking-body");
    if (!body) return;
    body.innerHTML = "";
    const empty = $("ranking-empty");

    if (tableMissing) {
      $("ranking-count").textContent = 0;
      empty.style.display = "block";
      empty.textContent = MISSING_TABLE_MSG;
      return;
    }

    const opps = oppIndex();
    const list = mine();
    const waiting = list
      .filter((r) => !r.submitted_at)
      .sort((a, b) => String(a.requested_at).localeCompare(String(b.requested_at)));
    const done = list
      .filter((r) => r.submitted_at)
      .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));

    $("ranking-count").textContent = waiting.length;
    empty.style.display = list.length ? "none" : "block";
    empty.textContent =
      "No ranking requests. Open a bid and use Request ranking to start one.";

    for (const [title, group] of [
      ["Waiting on you", waiting],
      ["Ranked", done],
    ]) {
      if (!group.length) continue;
      const h = document.createElement("h3");
      h.className = "rk-section";
      h.textContent = `${title} (${group.length})`;
      body.appendChild(h);
      for (const r of group) body.appendChild(buildCard(r, opps));
    }
  }

  // ---------- Boot ----------

  onViewOpen("ranking", async () => {
    // A request can be for a bid from any year.
    await Promise.all([fetchRankings(), fetchPeople(), ensureHistory()]);
    renderBadge();
    renderRanking();
  });

  BBAccess.ready.then(async () => {
    await fetchRankings();
    renderBadge();
  });

  // Requests arrive from other people; pick them up when someone comes back
  // to the tab rather than only on a reload.
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden || !BBAccess.granted) return;
    await fetchRankings();
    renderBadge();
    const tab = document.querySelector(".nav-tab.active");
    if (tab && tab.dataset.view === "ranking") renderRanking();
  });

  window.BBRankings = { decorateDetail, summaryFor, buildRing, fetchRankings };
})();
