// ===========================================================================
//  The admin-only Users tab: the UI for the invite list.
//
//  The list itself is public.app_members and the gate that enforces it lives
//  in access.js — this file only edits it. An admin adds someone's
//  @battag.com address here; anyone not on the list is signed out at the door
//  and never reaches the dashboard.
//
//  Only ADMIN_EMAIL sees this tab. Roles are stored and editable but not
//  enforced anywhere yet — that's deliberate, wire them up when the rules are
//  decided. See supabase_members.sql for the table.
//
//  The tab also lists every lead estimator who appears on a bid, seeded from
//  the bid history (source = 'estimator'). Those rows exist so that a former
//  employee — someone who never had a login, or whose login is long gone — can
//  still be kept off the dashboard graphs. They are always blocked and their
//  `identity` is "estimator:<name>", never an email, so nothing can sign in as
//  one: access.js looks people up by the address they signed in with, which
//  can never take that shape.
// ===========================================================================

(() => {
  const TABLE = MEMBERS_DIR_TABLE;
  const $ = (id) => document.getElementById(id);

  let members = [];
  let me = null; // this session's app_members row
  let seeded = false; // estimators pulled out of the bid history yet?
  // The estimator row the add-user form is currently turning into a real
  // account, if it is doing that rather than adding someone new.
  let convertingId = null;

  const ESTIMATOR_PREFIX = "estimator:";
  const isEstimatorRow = (m) => m.source === "estimator";

  // Lower-cased names to leave off the dashboard graphs — former employees,
  // mostly. Deliberately NOT applied to the reports, the Overdue tab or any
  // total: their bid history is real history and the win rates are made of it.
  // Read through BBUsers.hiddenFromCharts(); a plain Set of names because that
  // is what it has to match on — a bid records who the estimator was as text,
  // not as a user id.
  let chartHidden = new Set();

  function rebuildChartHidden() {
    chartHidden = new Set();
    for (const m of members) {
      if (!m.hidden_from_charts) continue;
      const name = (m.name || "").trim().toLowerCase();
      if (name) chartHidden.add(name);
    }
  }

  function formatStamp(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (isNaN(d)) return "—";
    return d.toLocaleString([], {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  // ---------- Data ----------

  async function fetchMembers() {
    const { rows, error } = await fetchAll(TABLE, { order: "invited_at" });
    if (error) return members;
    members = rows;
    rebuildChartHidden();
    return members;
  }

  async function setHiddenFromCharts(id, hidden) {
    const { error } = await sb
      .from(TABLE)
      .update({ hidden_from_charts: hidden })
      .eq("id", id);
    if (error) {
      toastError(
        error.message.includes("hidden_from_charts")
          ? "The database is missing the hidden_from_charts column — run " +
            "supabase_2026_09_upgrades.sql in the Supabase SQL editor."
          : "Could not change this: " + error.message
      );
      return;
    }
    await renderUsers();
    renderCharts(loadOpps());
  }

  // Every lead estimator who appears on a bid, added to the list once so they
  // can be hidden from the reports without needing a login. Idempotent: rows
  // that already exist, under either an estimator row or a real account with
  // the same name, are skipped.
  async function seedEstimators() {
    if (seeded) return 0;
    seeded = true;
    await ensureHistory();

    const known = new Set();
    for (const m of members) {
      const name = (m.name || "").trim().toLowerCase();
      if (name) known.add(name);
      known.add(String(m.identity || "").toLowerCase());
    }

    const found = new Map(); // lower-cased -> the spelling to store
    for (const o of loadOpps()) {
      const name = (o.leadEstimator || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (known.has(key) || known.has(ESTIMATOR_PREFIX + key)) continue;
      if (!found.has(key)) found.set(key, name);
    }
    if (!found.size) return 0;

    const rows = [...found].map(([key, name]) => ({
      identity: ESTIMATOR_PREFIX + key,
      name,
      email: null,
      source: "estimator",
      role: "User",
      // Not a login. Blocked as well as unreachable, so that stays true even
      // if someone later edits the identity by hand.
      blocked: true,
      invited_by: me ? me.identity : null,
      first_seen_at: null,
      last_active_at: null,
    }));

    const { error } = await sb.from(TABLE).insert(rows);
    if (error) {
      // Silence here is the worst outcome: the tab looks like it simply has no
      // estimators in it, and the reason (almost always the migration not
      // having been run) is buried in the console. Say it, and allow a retry.
      seeded = false;
      const missingMigration =
        error.message.includes("app_members_source_check") ||
        error.message.includes("source");
      toastError(
        missingMigration
          ? "Could not add the estimators: the database doesn't allow " +
            "source = 'estimator' yet. Run supabase_2026_09_upgrades.sql in " +
            "the Supabase SQL editor, then reopen this tab."
          : "Could not add estimators from the bid history: " + error.message
      );
      return 0;
    }
    return rows.length;
  }

  async function setRole(id, role) {
    const { error } = await sb.from(TABLE).update({ role }).eq("id", id);
    if (error) console.error("Could not change role:", error.message);
    await renderUsers();
  }

  async function setBlocked(id, blocked) {
    const { error } = await sb.from(TABLE).update({ blocked }).eq("id", id);
    if (error) console.error("Could not change access:", error.message);
    await renderUsers();
  }

  async function removeMember(member) {
    const who = member.name || member.identity;
    const why = isEstimatorRow(member)
      ? `Remove ${who} from this list? Their bids are untouched, but they will ` +
        "be added back the next time this tab reads the bid history."
      : `Remove ${who}? They won't be able to sign in again.`;
    if (!confirm(why)) return;
    const { error } = await sb.from(TABLE).delete().eq("id", member.id);
    if (error) {
      toastError("Could not remove user: " + error.message);
      return;
    }
    toastOk(`Removed ${who}`);
    await renderUsers();
  }

  async function addMember({ email, name, role }) {
    const identity = email.trim().toLowerCase();
    const { error } = await sb.from(TABLE).insert({
      identity,
      email: identity,
      name: name.trim() || null,
      role,
      invited_by: me ? me.identity : null,
      first_seen_at: null,
      last_active_at: null,
    });
    if (error) {
      // 23505 = unique violation on `identity`.
      toastError(
        error.code === "23505"
          ? `${identity} is already on the list.`
          : "Could not add user: " + error.message
      );
      return false;
    }
    return true;
  }

  // Turns an estimator row — a name off the bids, with no way in — into a real
  // account, in place. Everything else about the row is kept: the same id, the
  // same name, the same "On graphs" setting, and the bids that already name
  // them are untouched because those match on the name.
  //
  // Done as an update rather than an insert on purpose. Adding a second row
  // would leave the estimator row behind as a duplicate of the same person,
  // and the next seed would treat the pair as normal.
  async function activateMember(id, { email, name, role }) {
    const identity = email.trim().toLowerCase();
    const { error } = await sb
      .from(TABLE)
      .update({
        identity,
        email: identity,
        name: name.trim() || null,
        role,
        source: "manual",
        // An estimator row is blocked because it was never a login. It is one
        // now.
        blocked: false,
        invited_at: new Date().toISOString(),
        invited_by: me ? me.identity : null,
      })
      .eq("id", id);

    if (error) {
      // 23505 = unique violation on `identity`: this person already has an
      // account, and what is left over is the estimator row itself.
      if (error.code === "23505") {
        const member = members.find((m) => m.id === id);
        const who = (member && member.name) || "This estimator";
        if (
          confirm(
            `${identity} is already on the list.\n\n` +
            `${who} therefore already has a login. Remove the leftover ` +
            "entry from the bid history?"
          )
        ) {
          const { error: err } = await sb.from(TABLE).delete().eq("id", id);
          if (err) toastError("Could not remove it: " + err.message);
          else toastOk(`Removed the duplicate entry for ${who}`);
          return true;
        }
        return false;
      }
      toastError("Could not activate this person: " + error.message);
      return false;
    }
    return true;
  }

  // ---------- Add-user form ----------

  function addFormFields() {
    return {
      email: $("nu-email"),
      name: $("nu-name"),
      role: $("nu-role"),
      error: $("nu-error"),
    };
  }

  // `member` present = turning that estimator row into a real account rather
  // than adding somebody new.
  function showAddForm(show, member) {
    const form = $("new-user-form");
    if (!form) return;
    form.hidden = !show;
    const f = addFormFields();
    convertingId = show && member ? member.id : null;

    if (!show) return;

    const who = member ? member.name || "this estimator" : null;
    $("nu-form-title").textContent = member ? `Give ${who} a login` : "Add user";
    const hint = $("nu-hint");
    hint.hidden = !member;
    if (member) {
      hint.textContent =
        `${who} already has bids in the system. Adding their address turns ` +
        "this into a real account — their bid history, and whether they " +
        "appear on the graphs, are unchanged.";
    }
    $("nu-save").textContent = member ? "Activate" : "Add user";

    f.email.value = member ? member.email || "" : "";
    f.name.value = member ? member.name || "" : "";
    f.role.value = member && MEMBER_ROLES.includes(member.role) ? member.role : "User";
    f.error.hidden = true;
    f.email.focus();
  }

  async function submitAddForm() {
    const f = addFormFields();
    const email = f.email.value.trim().toLowerCase();

    const fail = (msg) => {
      f.error.textContent = msg;
      f.error.hidden = false;
      f.email.focus();
    };

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      fail("Enter a full email address.");
      return;
    }
    // Anyone outside the org can't get past the tenant check at sign-in, so
    // adding them here would only look like it worked.
    if (!BBAuth.isOrgAccount(email)) {
      fail(`Only @${BBAuth.orgDomain} addresses can sign in.`);
      return;
    }

    const payload = { email, name: f.name.value, role: f.role.value };
    const ok = convertingId
      ? await activateMember(convertingId, payload)
      : await addMember(payload);

    if (ok) {
      toastOk(`${email} can now sign in`);
      showAddForm(false);
      await renderUsers();
    }
  }

  function buildAddForm() {
    const roleSel = $("nu-role");
    if (roleSel && !roleSel.options.length) {
      for (const role of MEMBER_ROLES) {
        const opt = document.createElement("option");
        opt.value = role;
        opt.textContent = role;
        roleSel.appendChild(opt);
      }
      roleSel.value = "User";
    }
    $("new-user")?.addEventListener("click", () => showAddForm(true));
    $("nu-cancel")?.addEventListener("click", () => showAddForm(false));
    $("nu-save")?.addEventListener("click", submitAddForm);
    $("nu-email")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitAddForm();
    });
  }

  // The form is above the table, and the row that was clicked may be well down
  // it — without this the button looks like it did nothing.
  function scrollToForm() {
    $("new-user-form")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // ---------- Users table ----------

  async function renderUsers() {
    const tbody = $("user-rows");
    if (!tbody) return;
    await fetchMembers();

    $("user-count").textContent = members.length;
    $("user-empty").style.display = members.length ? "none" : "block";
    tbody.innerHTML = "";

    // Real accounts first, then the estimators picked up from the history —
    // the list is about who can sign in before it is about who bids.
    const ordered = [...members].sort(
      (a, b) =>
        isEstimatorRow(a) - isEstimatorRow(b) ||
        String(a.name || a.identity).localeCompare(String(b.name || b.identity))
    );

    for (const m of ordered) {
      const self = me && m.id === me.id;
      const estimator = isEstimatorRow(m);
      const tr = document.createElement("tr");
      const classes = [];
      // An estimator row isn't "blocked" in any meaningful sense — it was
      // never an account — so don't dress it up as one.
      if (m.blocked && !estimator) classes.push("is-blocked");
      if (estimator) classes.push("is-estimator");
      tr.className = classes.join(" ");

      const nameTd = document.createElement("td");
      nameTd.textContent = m.name || "—";
      if (self) {
        const you = document.createElement("span");
        you.className = "you-pill";
        you.textContent = "you";
        nameTd.append(" ", you);
      }

      const idTd = document.createElement("td");
      if (estimator) {
        const tag = document.createElement("span");
        tag.className = "src-pill";
        tag.textContent = "from bid history";
        tag.title =
          "Picked up from the bids they are the lead estimator on. " +
          "Not a sign-in account.";
        idTd.appendChild(tag);
      } else {
        idTd.textContent = m.email || m.identity;
      }

      // Someone who has never signed in is still just an invitation.
      const stateTd = document.createElement("td");
      const state = document.createElement("span");
      if (estimator) {
        state.className = "status";
        state.textContent = "No login";
      } else if (m.blocked) {
        state.className = "status lost";
        state.textContent = "Blocked";
      } else if (m.first_seen_at) {
        state.className = "status won";
        state.textContent = "Active";
      } else {
        state.className = "status hold";
        state.textContent = "Invited";
      }
      stateTd.appendChild(state);

      const addedTd = document.createElement("td");
      addedTd.textContent = formatStamp(m.invited_at);

      const lastTd = document.createElement("td");
      lastTd.textContent = formatStamp(m.last_active_at);

      const roleTd = document.createElement("td");
      const sel = document.createElement("select");
      sel.className = "role-select";
      for (const role of MEMBER_ROLES) {
        const opt = document.createElement("option");
        opt.value = role;
        opt.textContent = role;
        sel.appendChild(opt);
      }
      sel.value = MEMBER_ROLES.includes(m.role) ? m.role : "User";
      // An admin locking themselves out of their own account helps nobody, and
      // a role on a row that cannot sign in means nothing.
      sel.disabled = self || estimator;
      if (estimator) sel.title = "Not a sign-in account";
      sel.addEventListener("change", () => setRole(m.id, sel.value));
      roleTd.appendChild(sel);

      // On the dashboard graphs? Reports are not affected either way.
      const repTd = document.createElement("td");
      const repLabel = document.createElement("label");
      repLabel.className = "rep-toggle";
      const repBox = document.createElement("input");
      repBox.type = "checkbox";
      repBox.checked = !m.hidden_from_charts;
      repBox.title = m.hidden_from_charts
        ? "Off the dashboard graphs. Their bids still count in every report."
        : "Shown on the dashboard graphs. Untick for a former employee.";
      // Matching is by name, so a row without one can't be matched to a bid.
      repBox.disabled = !(m.name || "").trim();
      repBox.addEventListener("change", () =>
        setHiddenFromCharts(m.id, !repBox.checked)
      );
      repLabel.appendChild(repBox);
      repTd.appendChild(repLabel);

      const accessTd = document.createElement("td");
      accessTd.className = "col-status";
      if (!estimator) {
        const block = document.createElement("button");
        block.type = "button";
        block.className = m.blocked ? "btn-ghost sm" : "btn-ghost sm danger";
        block.textContent = m.blocked ? "Unblock" : "Block";
        block.disabled = self;
        block.title = self ? "You can't block yourself" : "";
        block.addEventListener("click", () => setBlocked(m.id, !m.blocked));
        accessTd.appendChild(block);
      } else {
        // The useful action on an estimator row is turning it into a real
        // account, which takes nothing but an address.
        const activate = document.createElement("button");
        activate.type = "button";
        activate.className = "btn-ghost sm";
        activate.textContent = "Add email";
        activate.title =
          "Give this person a login. Their bids and their graph setting stay " +
          "as they are.";
        activate.addEventListener("click", () => {
          showAddForm(true, m);
          scrollToForm();
        });
        accessTd.appendChild(activate);
      }

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn-ghost sm danger";
      remove.textContent = "Remove";
      remove.disabled = self;
      remove.title = self ? "You can't remove yourself" : "";
      remove.addEventListener("click", () => removeMember(m));
      accessTd.appendChild(remove);

      tr.append(nameTd, idTd, stateTd, addedTd, lastTd, roleTd, repTd, accessTd);
      tbody.appendChild(tr);
    }
  }

  // ---------- Boot ----------
  // access.js has already decided whether this person gets in at all; by the
  // time its gate resolves, the only question left is whether to show the tab.

  (async () => {
    const access = await BBAccess.ready;
    me = access.member;
    if (!access.isAdmin) return;

    const tab = document.querySelector('.nav-tab[data-view="users"]');
    if (tab) tab.hidden = false;
    buildAddForm();
    onViewOpen("users", async () => {
      await fetchMembers();
      const added = await seedEstimators();
      if (added) {
        await fetchMembers();
        toastOk(
          `Added ${added} estimator${added === 1 ? "" : "s"} from the bid history`
        );
      }
      await renderUsers();
    });
  })();

  // Loaded for any signed-in person, not only an admin: the dashboard graphs
  // have to honour the list whoever is looking at them.
  BBAccess.ready.then(async () => {
    await fetchMembers();
    renderCharts(loadOpps());
  });

  window.BBUsers = {
    fetchMembers,
    renderUsers,
    MEMBER_ROLES,
    // Lower-cased estimator names to leave out of the charts and reports.
    // Names to leave off the dashboard graphs. Nothing else consults this —
    // see the comment on chartHidden.
    hiddenFromCharts: () => chartHidden,
    isHiddenFromCharts: (name) =>
      chartHidden.has(String(name || "").trim().toLowerCase()),
  };
})();
