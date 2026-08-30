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
// ===========================================================================

(() => {
  const TABLE = MEMBERS_DIR_TABLE;
  const $ = (id) => document.getElementById(id);

  let members = [];
  let me = null; // this session's app_members row

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
    return members;
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
    if (!confirm(`Remove ${who}? They won't be able to sign in again.`)) return;
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

    for (const m of members) {
      const self = me && m.id === me.id;
      const tr = document.createElement("tr");
      if (m.blocked) tr.className = "is-blocked";

      const nameTd = document.createElement("td");
      nameTd.textContent = m.name || "—";
      if (self) {
        const you = document.createElement("span");
        you.className = "you-pill";
        you.textContent = "you";
        nameTd.append(" ", you);
      }

      const idTd = document.createElement("td");
      idTd.textContent = m.email || m.identity;

      // Someone who has never signed in is still just an invitation.
      const stateTd = document.createElement("td");
      const state = document.createElement("span");
      if (m.blocked) {
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
      // An admin locking themselves out of their own account helps nobody.
      sel.disabled = self;
      sel.addEventListener("change", () => setRole(m.id, sel.value));
      roleTd.appendChild(sel);

      const accessTd = document.createElement("td");
      accessTd.className = "col-status";
      const block = document.createElement("button");
      block.type = "button";
      block.className = m.blocked ? "btn-ghost sm" : "btn-ghost sm danger";
      block.textContent = m.blocked ? "Unblock" : "Block";
      block.disabled = self;
      block.title = self ? "You can't block yourself" : "";
      block.addEventListener("click", () => setBlocked(m.id, !m.blocked));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn-ghost sm danger";
      remove.textContent = "Remove";
      remove.disabled = self;
      remove.title = self ? "You can't remove yourself" : "";
      remove.addEventListener("click", () => removeMember(m));

      accessTd.append(block, remove);

      tr.append(nameTd, idTd, stateTd, addedTd, lastTd, roleTd, accessTd);
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
    onViewOpen("users", renderUsers);
  })();

  window.BBUsers = { fetchMembers, renderUsers, MEMBER_ROLES };
})();
