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
//  the bid history (source = 'estimator'). Those rows exist so that someone
//  who has never had a login can still be kept out of the reports. They are
//  always blocked and their `identity` is "estimator:<name>", never an email,
//  so nothing can sign in as one — access.js looks people up by the address
//  they signed in with, which can never take that shape.
// ===========================================================================

(() => {
  const TABLE = MEMBERS_DIR_TABLE;
  const $ = (id) => document.getElementById(id);

  let members = [];
  let me = null; // this session's app_members row
  let seeded = false; // estimators pulled out of the bid history yet?

  const ESTIMATOR_PREFIX = "estimator:";
  const isEstimatorRow = (m) => m.source === "estimator";

  // Lower-cased names the charts, the Overdue tab and the reports should leave
  // out. Read by those from BBUsers.hiddenFromReports(); kept as a plain Set of
  // names because that is what they have to match on — a bid records who the
  // estimator was as text, not as a user id.
  let hiddenNames = new Set();

  function rebuildHiddenNames() {
    hiddenNames = new Set();
    for (const m of members) {
      if (!m.hidden_from_reports) continue;
      const name = (m.name || "").trim().toLowerCase();
      if (name) hiddenNames.add(name);
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
    rebuildHiddenNames();
    return members;
  }

  async function setHiddenFromReports(id, hidden) {
    const { error } = await sb
      .from(TABLE)
      .update({ hidden_from_reports: hidden })
      .eq("id", id);
    if (error) {
      toastError("Could not change this: " + error.message);
      return;
    }
    await renderUsers();
    // The chart, the badge and whichever tab is open all read the set.
    renderCharts(loadOpps());
    if (window.BBOverdue) BBOverdue.renderBadge();
    refreshActiveView();
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
      // Not worth a red toast — the tab still works, there are just no
      // estimator rows in it.
      console.error("Could not add estimators from the bid history:", error.message);
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

  // ---------- Add-user form ----------

  function addFormFields() {
    return {
      email: $("nu-email"),
      name: $("nu-name"),
      role: $("nu-role"),
      error: $("nu-error"),
    };
  }

  function showAddForm(show) {
    const form = $("new-user-form");
    if (!form) return;
    form.hidden = !show;
    const f = addFormFields();
    if (show) {
      f.email.value = "";
      f.name.value = "";
      f.role.value = "User";
      f.error.hidden = true;
      f.email.focus();
    }
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

    if (await addMember({ email, name: f.name.value, role: f.role.value })) {
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

      // Counted in the estimator chart, the Overdue tab and the reports?
      const repTd = document.createElement("td");
      const repLabel = document.createElement("label");
      repLabel.className = "rep-toggle";
      const repBox = document.createElement("input");
      repBox.type = "checkbox";
      repBox.checked = !m.hidden_from_reports;
      repBox.title = m.hidden_from_reports
        ? "Left out of the estimator chart, the Overdue tab and the reports"
        : "Counted in the estimator chart, the Overdue tab and the reports";
      // Matching is by name, so a row without one can't be matched to a bid.
      repBox.disabled = !(m.name || "").trim();
      repBox.addEventListener("change", () =>
        setHiddenFromReports(m.id, !repBox.checked)
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
        // account, which is the add form with the name already filled in.
        const invite = document.createElement("button");
        invite.type = "button";
        invite.className = "btn-ghost sm";
        invite.textContent = "Invite";
        invite.title = "Give this person a login";
        invite.addEventListener("click", () => {
          showAddForm(true);
          $("nu-name").value = m.name || "";
          $("nu-email").focus();
        });
        accessTd.appendChild(invite);
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

  // Everyone else reads the hidden list, not the members. Loaded for any
  // signed-in person, not only an admin — the charts have to honour it too.
  BBAccess.ready.then(async () => {
    await fetchMembers();
    renderCharts(loadOpps());
    if (window.BBOverdue) BBOverdue.renderBadge();
  });

  window.BBUsers = {
    fetchMembers,
    renderUsers,
    MEMBER_ROLES,
    // Lower-cased estimator names to leave out of the charts and reports.
    hiddenFromReports: () => hiddenNames,
    isHidden: (name) => hiddenNames.has(String(name || "").trim().toLowerCase()),
  };
})();
