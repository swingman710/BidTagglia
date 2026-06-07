// Shared store for the admin-managed dropdown lists that feed the
// New Opportunity form. Each list is one field's option set: { name: [options] }.
// localStorage is the placeholder backend — swap for SharePoint later.

const LISTS_KEY = "battag_lists";

// Canonical dropdowns the New Opportunity form expects. Any field whose spec
// says "populates from admin page" reads its options from one of these. They
// are seeded empty so an admin can fill them in on the admin page.
const ADMIN_LISTS = [
  "Project Manager",
  "Lead Estimator",
  "Local Unions",
  "Market Segment",
  "Industry",
  "Bid Category",
  "Bid Type",
  "Contract Type",
  "Delivery Method",
];

function loadLists() {
  let lists;
  try {
    lists = JSON.parse(localStorage.getItem(LISTS_KEY)) || {};
  } catch {
    lists = {};
  }

  // Make sure every form-required dropdown exists (empty until filled in).
  let changed = false;
  for (const name of ADMIN_LISTS) {
    if (!Array.isArray(lists[name])) {
      lists[name] = [];
      changed = true;
    }
  }
  if (changed) saveLists(lists);

  return lists;
}

function saveLists(lists) {
  localStorage.setItem(LISTS_KEY, JSON.stringify(lists));
}
