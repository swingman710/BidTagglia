// ===========================================================================
//  Hard-coded option lists for the New Opportunity form.
//  Source: /Lists folder. Field type for each is noted below (from filenames).
// ===========================================================================

const FIELD_LISTS = {
  // Dropdown
  division: ["BEI", "BAI", "BAX", "BIT", "BEI-PHI", "BEI-CHE", "BPS"],

  // Dropdown
  opportunityStatus: [
    "Opportunity", "Pending", "Bidding", "Budgeting", "Lost", "No Bid",
    "On Hold (Bid)", "Won",
  ],

  // Searchable combobox (single)
  projectManager: [
    "Bill Ossowski", "Christopher Dion", "Roy Dowell", "James Foraker",
    "Christine Meyer", "Jim Meyer", "PJ Meyer", "Cameron Williams",
    "Bill Broomall", "Scott Hibbard", "Daniel Whitehurst", "Joe Zalewski",
    "Mark Conomon", "Robby Bolen", "William Shahan", "John Weinhardt",
    "Steve Navert", "Justin Stockton", "Kelsey Sill", "Jordan Herrick",
  ],

  // Searchable combobox (single)
  leadEstimator: [
    "Bill Ossowski", "Christopher Dion", "Roy Dowell", "James Foraker",
    "Christine Meyer", "Jim Meyer", "PJ Meyer", "Cameron Williams",
    "Bill Broomall", "Scott Hibbard", "Daniel Whitehurst", "Joe Zalewski",
    "Mark Conomon", "Robby Bolen", "William Shahan", "John Weinhardt",
    "Steve Navert", "Kelsey Sill", "Thanh Le", "Jason Carney", "Jordan Herrick",
  ],

  // Searchable combobox (single)
  industry: [
    "Healthcare", "Education", "Commercial", "Manufacturing", "Data Center",
    "Oil & Gas", "DAS", "Sports & Exhibition", "Government", "Industrial",
    "Food Services", "Utility", "Banking", "Legal", "Entertainment",
    "Pharmaceutical", "Gaming", "Transportation", "Mixed Use", "Retail",
    "Insurance", "Hotel", "Media", "BAS", "Residential", "Solar", "Warehouse",
    "Prison", "Public Works", "Sporting", "Casino",
  ],

  // Checkboxes (multi)
  marketSegment: [
    "Commercial", "Industrial", "Mixed Use", "Infrastructure", "Heavy Civil",
  ],

  // Searchable combobox with checkboxes (multi)
  localUnions: [
    "102", "1249", "126", "143", "164", "17", "222", "229", "229-T", "236",
    "24", "24-T", "25", "26", "26-T", "269", "269-T", "3", "307", "313", "98",
    "313-T", "351", "351-T", "400", "429", "456", "488", "5", "6", "654",
    "654-T", "683", "743", "743-T", "8", "98 N", "98-T",
  ],

  // Dropdown
  bidType: [
    "Budget", "GMP", "Hard Bid", "Lump Sum", "MSA", "Request for Proposal",
    "Request for Qualifications", "T&M", "Unit Pricing",
  ],

  // Dropdown
  deliveryMethod: ["Plan and Spec", "Design Build", "Design Assist", "IPD"],
};
