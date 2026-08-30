// ===========================================================================
//  Activities tab — anything scheduled or logged against a bid: a site walk,
//  an RFI due date, a voicemail left.
//
//  ACTIVITY_TYPES is a suggestion list, not a constraint: the type field is a
//  combobox you can also type into, and whatever you type is saved as-is.
//  Related opportunity and related contact are pickers over the bids and
//  contacts already in the app, matched back to an id when the form is saved.
//
//  The Calendar tab reads these through window.BBActivities.list(). Table:
//  public.activities (see supabase_crm.sql).
// ===========================================================================

const ACTIVITY_TYPES = [
  "Email Received",
  "Email Sent",
  "Fire Alarm",
  "Last/Final Offer",
  "Left Voicemail",
  "Mandatory Pre Bid-Meeting",
  "Pre-Bid Walkthrough",
  "RFI Due Date",
  "Scope Review",
  "Site Walk",
  "Verification Call",
];

(() => {
  const TABLE = "activities";
  const $ = (id) => document.getElementById(id);

  let activities = [];
  let editingId = null;

  // ---------- Data ----------

  async function fetchActivities() {
    const { rows, error } = await fetchAll(TABLE, { order: "scheduled_date" });
    if (error) return activities;
    activities = rows;
    return activities;
  }

  async function saveActivity(row) {
    const q = editingId
      ? sb.from(TABLE).update(row).eq("id", editingId)
      : sb.from(TABLE).insert(row);
    const { error } = await q;
    if (error) {
      toastError("Could not save activity: " + error.message);
      return false;
    }
    return true;
  }

  async function deleteActivity(activity) {
    if (!confirm(`Delete “${activity.title}”?`)) return;
    const { error } = await sb.from(TABLE).delete().eq("id", activity.id);
    if (error) {
      toastError("Could not delete activity: " + error.message);
      return;
    }
    toastOk(`Deleted “${activity.title}”`);
    await renderActivities();
  }

  // ---------- Looking bids and contacts up by their typed label ----------
  // The pickers are plain datalists, so what comes back is the label the
  // person chose. These turn a label back into the row it names.

  const oppLabel = (o) => o.name || `Opportunity ${o.id}`;

  function contactLabel(c) {
    return c.company ? `${c.name} — ${c.company}` : c.name;
  }

  function oppByLabel(label) {
    const want = label.trim().toLowerCase();
    if (!want) return null;
    return loadOpps().find((o) => oppLabel(o).toLowerCase() === want) || null;
  }

  function contactByLabel(label) {
    const want = label.trim().toLowerCase();
    if (!want) return null;
    const list = window.BBContacts ? BBContacts.list() : [];
    return (
      list.find((c) => contactLabel(c).toLowerCase() === want) ||
      list.find((c) => (c.name || "").toLowerCase() === want) ||
      null
    );
  }

  function oppById(id) {
    if (id == null) return null;
    return loadOpps().find((o) => String(o.id) === String(id)) || null;
  }

  // ---------- Form ----------

  const fields = () => ({
    title: $("ac-title"),
    type: $("ac-type"),
    date: $("ac-date"),
    opp: $("ac-opp"),
    contact: $("ac-contact"),
    notes: $("ac-notes"),
    error: $("ac-error"),
  });

  async function fillPickers() {
    fillDatalist("dl-activity-type", ACTIVITY_TYPES);
    fillDatalist("dl-activity-opp", loadOpps().map(oppLabel));
    // Contacts may not have been loaded yet if this tab is opened first.
    if (window.BBContacts) {
      if (!BBContacts.list().length) await BBContacts.fetchContacts();
      fillDatalist("dl-activity-contact", BBContacts.list().map(contactLabel));
    }
  }

  async function showForm(show, activity) {
    const form = $("new-activity-form");
    if (!form) return;
    form.hidden = !show;
    if (!show) {
      editingId = null;
      return;
    }

    await fillPickers();
    const f = fields();
    editingId = activity ? activity.id : null;
    $("ac-form-title").textContent = activity ? "Edit activity" : "New activity";
    $("ac-save").textContent = activity ? "Save changes" : "Add activity";

    const opp = activity ? oppById(activity.opportunity_id) : null;
    const contact =
      activity && window.BBContacts ? BBContacts.byId(activity.contact_id) : null;

    f.title.value = activity ? activity.title || "" : "";
    f.type.value = activity ? activity.type || "" : "";
    f.date.value = activity ? activity.scheduled_date || "" : "";
    f.opp.value = opp ? oppLabel(opp) : "";
    f.contact.value = contact ? contactLabel(contact) : "";
    f.notes.value = activity ? activity.notes || "" : "";
    f.error.hidden = true;
    f.title.focus();
  }

  async function submitForm() {
    const f = fields();
    const title = f.title.value.trim();

    const fail = (msg, el) => {
      f.error.textContent = msg;
      f.error.hidden = false;
      el.focus();
    };

    if (!title) {
      fail("An activity needs a title.", f.title);
      return;
    }

    // A typed opportunity that matches nothing is a typo, not a new bid —
    // saying so beats silently filing the activity against no bid at all.
    const oppText = f.opp.value.trim();
    const opp = oppByLabel(oppText);
    if (oppText && !opp) {
      fail("Pick an opportunity from the list.", f.opp);
      return;
    }

    const contactText = f.contact.value.trim();
    const contact = contactByLabel(contactText);
    if (contactText && !contact) {
      fail("Pick a contact from the list, or add them on the Contacts tab.", f.contact);
      return;
    }

    const ok = await saveActivity({
      title,
      type: f.type.value.trim() || null,
      scheduled_date: f.date.value || null,
      opportunity_id: opp ? String(opp.id) : null,
      contact_id: contact ? contact.id : null,
      notes: f.notes.value.trim() || null,
    });
    if (!ok) return;

    toastOk(editingId ? `Saved “${title}”` : `Added “${title}”`);
    await showForm(false);
    await renderActivities();
  }

  // ---------- Table ----------

  async function renderActivities() {
    const tbody = $("activity-rows");
    if (!tbody) return;
    await fetchActivities();
    if (window.BBContacts && !BBContacts.list().length) {
      await BBContacts.fetchContacts();
    }

    $("activity-count").textContent = activities.length;
    $("activity-empty").style.display = activities.length ? "none" : "block";
    tbody.innerHTML = "";

    for (const a of activities) {
      const tr = document.createElement("tr");

      const title = document.createElement("td");
      title.textContent = a.title;

      const type = document.createElement("td");
      type.textContent = a.type || "—";

      const when = document.createElement("td");
      when.textContent = a.scheduled_date ? formatDate(a.scheduled_date) : "—";

      const oppTd = document.createElement("td");
      const opp = oppById(a.opportunity_id);
      if (opp) {
        const link = document.createElement("button");
        link.type = "button";
        link.className = "linklike";
        link.textContent = oppLabel(opp);
        link.addEventListener("click", () => openDetail(opp));
        oppTd.appendChild(link);
      } else {
        oppTd.textContent = "—";
      }

      const contactTd = document.createElement("td");
      const contact = window.BBContacts ? BBContacts.byId(a.contact_id) : null;
      contactTd.textContent = contact ? contactLabel(contact) : "—";

      const actions = document.createElement("td");
      actions.className = "col-status";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn-ghost sm";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => showForm(true, a));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn-ghost sm danger";
      del.textContent = "Delete";
      del.addEventListener("click", () => deleteActivity(a));
      actions.append(edit, del);

      tr.append(title, type, when, oppTd, contactTd, actions);
      if (a.notes) tr.title = a.notes;
      tbody.appendChild(tr);
    }
  }

  // ---------- Boot ----------

  $("new-activity")?.addEventListener("click", () => showForm(true));
  $("ac-cancel")?.addEventListener("click", () => showForm(false));
  $("ac-save")?.addEventListener("click", submitForm);

  onViewOpen("activities", renderActivities);

  window.BBActivities = {
    fetchActivities,
    renderActivities,
    list: () => activities,
    openEditor: (activity) => showForm(true, activity),
    labelFor: contactLabel,
    ACTIVITY_TYPES,
  };
})();
