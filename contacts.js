// ===========================================================================
//  Contacts tab — the people at the companies we bid to.
//
//  Company is typed against the same registry the Pricing tab and Companies
//  tab use (dashboard.js's canonicalCompany/knownCompanies), so a contact and
//  a quote spell the same company the same way.
//
//  Other tabs read contacts through window.BBContacts.list() — the Activities
//  form uses it for its "related contact" picker. Table: public.contacts (see
//  supabase_crm.sql).
// ===========================================================================

(() => {
  const TABLE = "contacts";
  const $ = (id) => document.getElementById(id);

  let contacts = [];
  let editingId = null;
  // Inactive people are kept on file — they stay attached to the activities
  // they're already on — but they're out of the way by default.
  let showInactive = false;

  // Rows written before the `active` column existed come back without it.
  const isActiveContact = (c) => c.active !== false;

  // ---------- Data ----------

  async function fetchContacts() {
    const { rows, error } = await fetchAll(TABLE, { order: "name" });
    if (error) return contacts;
    contacts = rows;
    for (const c of contacts) rememberCompany(c.company);
    return contacts;
  }

  async function saveContact(row) {
    const q = editingId
      ? sb.from(TABLE).update(row).eq("id", editingId)
      : sb.from(TABLE).insert(row);
    const { error } = await q;
    if (error) {
      toastError("Could not save contact: " + error.message);
      return false;
    }
    return true;
  }

  async function setActive(contact, active) {
    const { error } = await sb.from(TABLE).update({ active }).eq("id", contact.id);
    if (error) {
      toastError("Could not change status: " + error.message);
      return;
    }
    await renderContacts();
    toastOk(`${contact.name} marked ${active ? "active" : "inactive"}`);
  }

  async function deleteContact(contact) {
    const { error } = await sb.from(TABLE).delete().eq("id", contact.id);
    if (error) {
      toastError("Could not delete contact: " + error.message);
      return;
    }
    await renderContacts();

    // The row is already in memory, so undo just puts it back.
    const { id: _drop, ...values } = contact;
    toastUndo(`Deleted ${contact.name}`, async () => {
      const { error: err } = await sb.from(TABLE).insert(values);
      if (err) {
        toastError("Could not restore the contact: " + err.message);
        return;
      }
      await renderContacts();
      toastOk(`${contact.name} restored`);
    });
  }

  // ---------- Form ----------

  const fields = () => ({
    name: $("ct-name"),
    email: $("ct-email"),
    phone: $("ct-phone"),
    company: $("ct-company"),
    error: $("ct-error"),
  });

  function showForm(show, contact) {
    const form = $("new-contact-form");
    if (!form) return;
    form.hidden = !show;
    const f = fields();
    if (!show) {
      editingId = null;
      return;
    }

    editingId = contact ? contact.id : null;
    $("ct-form-title").textContent = contact ? "Edit contact" : "New contact";
    $("ct-save").textContent = contact ? "Save changes" : "Add contact";
    f.name.value = contact ? contact.name || "" : "";
    f.email.value = contact ? contact.email || "" : "";
    f.phone.value = contact ? contact.phone || "" : "";
    f.company.value = contact ? contact.company || "" : "";
    f.error.hidden = true;
    fillDatalist("dl-contact-company", knownCompanies());
    f.name.focus();
  }

  async function submitForm() {
    const f = fields();
    const name = f.name.value.trim();
    if (!name) {
      f.error.textContent = "A contact needs a name.";
      f.error.hidden = false;
      f.name.focus();
      return;
    }

    const company = canonicalCompany(f.company.value);
    if (company) rememberCompany(company);

    const ok = await saveContact({
      name,
      email: f.email.value.trim() || null,
      phone: f.phone.value.trim() || null,
      company: company || null,
    });
    if (!ok) return;

    toastOk(editingId ? `Saved ${name}` : `Added ${name}`);
    showForm(false);
    await renderContacts();
  }

  // ---------- Table ----------

  async function renderContacts() {
    const tbody = $("contact-rows");
    if (!tbody) return;
    await fetchContacts();

    const shown = showInactive ? contacts : contacts.filter(isActiveContact);
    const hidden = contacts.length - shown.length;

    $("contact-count").textContent = shown.length;
    $("contact-empty").style.display = shown.length ? "none" : "block";
    $("contact-empty").textContent = contacts.length
      ? `No active contacts — ${hidden} inactive. Tick "Show inactive" to see them.`
      : "No contacts yet — add one above.";
    tbody.innerHTML = "";

    for (const c of shown) {
      const active = isActiveContact(c);
      const tr = document.createElement("tr");
      if (!active) tr.className = "is-inactive";

      const name = document.createElement("td");
      name.textContent = c.name;

      const email = document.createElement("td");
      if (c.email) {
        const a = document.createElement("a");
        a.href = `mailto:${c.email}`;
        a.textContent = c.email;
        email.appendChild(a);
      } else {
        email.textContent = "—";
      }

      const phone = document.createElement("td");
      phone.textContent = c.phone || "—";

      const company = document.createElement("td");
      company.textContent = c.company || "—";

      const state = document.createElement("td");
      const pill = document.createElement("span");
      pill.className = `status ${active ? "won" : "lost"}`;
      pill.textContent = active ? "Active" : "Inactive";
      state.appendChild(pill);

      const actions = document.createElement("td");
      actions.className = "col-status";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn-ghost sm";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => showForm(true, c));
      const flip = document.createElement("button");
      flip.type = "button";
      flip.className = "btn-ghost sm";
      flip.textContent = active ? "Deactivate" : "Reactivate";
      flip.title = active
        ? "Keep them on file but out of the list and the pickers"
        : "Put them back in the list and the pickers";
      flip.addEventListener("click", () => setActive(c, !active));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn-ghost sm danger";
      del.textContent = "Delete";
      del.addEventListener("click", () => deleteContact(c));
      actions.append(edit, flip, del);

      tr.append(name, email, phone, company, state, actions);
      tbody.appendChild(tr);
    }
  }

  // ---------- Boot ----------

  $("ct-show-inactive")?.addEventListener("change", (e) => {
    showInactive = e.target.checked;
    renderContacts();
  });
  $("new-contact")?.addEventListener("click", () => showForm(true));
  $("ct-cancel")?.addEventListener("click", () => showForm(false));
  $("ct-save")?.addEventListener("click", submitForm);

  onViewOpen("contacts", renderContacts);

  window.BBContacts = {
    fetchContacts,
    renderContacts,
    // Everyone on file. byId() has to see inactive people too — they stay
    // named on the activities they were already attached to.
    list: () => contacts,
    // Just the people worth offering in a picker for something new.
    active: () => contacts.filter(isActiveContact),
    isActive: isActiveContact,
    byId: (id) => contacts.find((c) => String(c.id) === String(id)) || null,
  };
})();
