// ===========================================================================
//  User directory (public.app_members) + the admin-only Users tab.
//
//  Everyone who reaches the dashboard is checked in: first sign-in creates
//  their row, every later visit stamps "last active". Blocked members are
//  bounced straight back out to the login page.
//
//  Only ADMIN_EMAIL sees the Users tab. Roles are stored and editable but not
//  enforced anywhere yet — that's deliberate, wire them up when the rules are
//  decided. See supabase_members.sql for the table.
// ===========================================================================

const ADMIN_EMAIL = "trossi@battag.com";

const MEMBER_ROLES = ["Admin", "Admin Super User", "Super User", "User", "Test"];

(() => {
  const TABLE = "app_members";
  const $ = (id) => document.getElementById(id);

  let members = [];
  let me = null; // this session's app_members row

  function isAdmin(account) {
    const id = identityOf(account);
    return !!id && id === ADMIN_EMAIL;
  }

  // The key we store a person under: their org email, or their username when
  // they came in through the manual fallback.
  function identityOf(account) {
    if (!account) return null;
    return String(account.email || account.name || "").trim().toLowerCase() || null;
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
    const { data, error } = await sb
      .from(TABLE)
      .select("*")
      .order("first_seen_at", { ascending: true });
    if (error) {
      console.error("Member load error:", error.message);
      return members;
    }
    members = data || [];
    return members;
  }

  // Create the row on first sign-in, otherwise refresh name + last active.
  async function checkIn(account) {
    const identity = identityOf(account);
    if (!identity || typeof sb === "undefined") return null;

    const { data: existing, error } = await sb
      .from(TABLE)
      .select("*")
      .eq("identity", identity)
      .maybeSingle();

    if (error) {
      console.error("Check-in lookup failed:", error.message);
      return null;
    }

    if (!existing) {
      const row = {
        identity,
        name: account.name || identity,
        email: account.email || null,
        source: account.source === "manual" ? "manual" : "microsoft",
        role: identity === ADMIN_EMAIL ? "Admin" : "User",
      };
      const { data: created, error: insErr } = await sb
        .from(TABLE)
        .insert(row)
        .select()
        .maybeSingle();
      if (insErr) {
        console.error("Could not add member:", insErr.message);
        return null;
      }
      return created;
    }

    // Blocked members don't get their timestamp refreshed — the last active
    // date should stay at their last real visit.
    if (existing.blocked) return existing;

    const patch = { last_active_at: new Date().toISOString() };
    if (account.name && account.name !== existing.name) patch.name = account.name;
    if (account.email && account.email !== existing.email) patch.email = account.email;

    const { data: updated, error: updErr } = await sb
      .from(TABLE)
      .update(patch)
      .eq("id", existing.id)
      .select()
      .maybeSingle();
    if (updErr) {
      console.error("Could not update member:", updErr.message);
      return existing;
    }
    return updated || existing;
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
      nameTd.textContent = m.name || m.identity;
      if (self) {
        const you = document.createElement("span");
        you.className = "you-pill";
        you.textContent = "you";
        nameTd.append(" ", you);
      }

      const idTd = document.createElement("td");
      idTd.textContent = m.email || m.identity;

      const srcTd = document.createElement("td");
      srcTd.textContent = m.source === "manual" ? "Username" : "Microsoft";

      const firstTd = document.createElement("td");
      firstTd.textContent = formatStamp(m.first_seen_at);

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
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = m.blocked ? "btn-ghost sm" : "btn-ghost sm danger";
      btn.textContent = m.blocked ? "Unblock" : "Block";
      btn.disabled = self;
      btn.title = self ? "You can't block yourself" : "";
      btn.addEventListener("click", () => setBlocked(m.id, !m.blocked));
      const state = document.createElement("span");
      state.className = `status ${m.blocked ? "lost" : "won"}`;
      state.textContent = m.blocked ? "Blocked" : "Active";
      accessTd.append(state, btn);

      tr.append(nameTd, idTd, srcTd, firstTd, lastTd, roleTd, accessTd);
      tbody.appendChild(tr);
    }
  }

  // ---------- Blocked screen ----------

  function showBlocked(account) {
    const overlay = document.createElement("div");
    overlay.className = "blocked-overlay";
    overlay.innerHTML =
      '<div class="blocked-card">' +
      "<h2>Access blocked</h2>" +
      `<p>${account.name || "Your account"} no longer has access to Battag Bid. ` +
      "Contact your administrator if you think this is a mistake.</p>" +
      '<button type="button" class="btn-primary" id="blocked-out">Sign out</button>' +
      "</div>";
    document.body.appendChild(overlay);
    document.getElementById("blocked-out").addEventListener("click", () => {
      BBAuth.signOut();
    });
  }

  // ---------- Boot ----------

  (async () => {
    const account = await BBAuth.requireAuth();
    if (!account) return; // requireAuth is redirecting to index.html

    me = await checkIn(account);

    if (me && me.blocked) {
      showBlocked(account);
      return;
    }

    if (isAdmin(account)) {
      const tab = document.querySelector('.nav-tab[data-view="users"]');
      if (tab) tab.hidden = false;
      onViewOpen("users", renderUsers);
    }
  })();

  window.BBUsers = { checkIn, fetchMembers, renderUsers, isAdmin, ADMIN_EMAIL, MEMBER_ROLES };
})();
