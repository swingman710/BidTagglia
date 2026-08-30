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

  async function deleteContact(contact) {
    if (!confirm(`Delete ${contact.name}?`)) return;
    const { error } = await sb.from(TABLE).delete().eq("id", contact.id);
    if (error) {
      toastError("Could not delete contact: " + error.message);
      return;
    }
    toastOk(`Deleted ${contact.name}`);
    await renderContacts();
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

    $("contact-count").textContent = contacts.length;
    $("contact-empty").style.display = contacts.length ? "none" : "block";
    tbody.innerHTML = "";

    for (const c of contacts) {
      const tr = document.createElement("tr");

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

      const actions = document.createElement("td");
      actions.className = "col-status";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn-ghost sm";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => showForm(true, c));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn-ghost sm danger";
      del.textContent = "Delete";
      del.addEventListener("click", () => deleteContact(c));
      actions.append(edit, del);

      tr.append(name, email, phone, company, actions);
      tbody.appendChild(tr);
    }
  }

  // ---------- Boot ----------

  $("new-contact")?.addEventListener("click", () => showForm(true));
  $("ct-cancel")?.addEventListener("click", () => showForm(false));
  $("ct-save")?.addEventListener("click", submitForm);

  onViewOpen("contacts", renderContacts);

  window.BBContacts = {
    fetchContacts,
    renderContacts,
    list: () => contacts,
    byId: (id) => contacts.find((c) => String(c.id) === String(id)) || null,
  };
})();
