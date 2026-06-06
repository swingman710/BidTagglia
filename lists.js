// Shared store for the admin-managed dropdown lists that feed the
// New Opportunity form. Each list is one dropdown field: { name: [options] }.
// localStorage is the placeholder backend — swap for SharePoint later.

const LISTS_KEY = "battag_lists";

const DEFAULT_LISTS = {
  Status: ["Open", "Won", "Lost"],
  Type: ["RFP", "RFQ", "Sole Source"],
};

function loadLists() {
  const raw = localStorage.getItem(LISTS_KEY);
  if (raw === null) {
    // First run — seed sensible defaults.
    saveLists(DEFAULT_LISTS);
    return { ...DEFAULT_LISTS };
  }
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function saveLists(lists) {
  localStorage.setItem(LISTS_KEY, JSON.stringify(lists));
}
