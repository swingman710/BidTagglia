# ============================================================================
#  Creates the SharePoint list that will hold bid opportunities.
#
#  RUN THIS BEFORE IMPORTING ANYTHING. The indexes at the bottom are built by
#  scanning the list, and that scan hits SharePoint's own 5,000-item limit —
#  so on a list that already holds 6,500 bids, creating them can fail. On an
#  empty list it's instant.
#
#  Setup (once):
#      Install-Module PnP.PowerShell -Scope CurrentUser
#
#  Then:
#      ./sharepoint_bids_list.ps1
#
#  It signs you in interactively as yourself — no secrets live in this file.
#  Safe to re-run: existing columns are left alone, missing ones are added.
#
#  Column internal names deliberately match the camelCase keys in dashboard.js
#  COLUMN_MAP, so the app maps to them one-to-one. Left to itself SharePoint
#  would turn "Bid Due" into "Bid_x0020_Due".
# ============================================================================

$SiteUrl  = "https://battag.sharepoint.com/sites/battagbid"
$ListName = "Bid Opportunities"

# ---------------------------------------------------------------------------
#  Columns. Type is the SharePoint field type; Extra is applied afterwards.
#
#  Decisions baked in here:
#   - bidDueDate + bidDueTime are folded into one DateTime column, bidDue.
#   - cm / gc / localUnions / flags are multi-value in the app, and are stored
#     as JSON in plain-text columns (RichText off, or SharePoint injects HTML
#     and the JSON won't parse back).
#   - Money is Number, not Currency.
#   - Fixed-value fields (division, status, bidType, deliveryMethod) are Text
#     rather than Choice on purpose: Choice rejects anything off-list, and one
#     stray spelling among 6,500 imported rows would fail that row. Tighten
#     them to Choice after the import, once you've seen the real values.
# ---------------------------------------------------------------------------

$Columns = @(
  # --- General -------------------------------------------------------------
  @{ Name = "bidDue";               Display = "Bid Due";                Type = "DateTime"; Extra = @{ DisplayFormat = 1 } }
  @{ Name = "division";             Display = "Division";               Type = "Text" }
  @{ Name = "internalBidNumber";    Display = "Internal Bid Number";    Type = "Text" }
  @{ Name = "projectManager";       Display = "Project Manager";        Type = "Text" }
  @{ Name = "status";               Display = "Opportunity Status";     Type = "Text" }
  @{ Name = "leadEstimator";        Display = "Lead Estimator";         Type = "Text" }

  # --- Project team --------------------------------------------------------
  @{ Name = "ownerCustomer";        Display = "Owner / Customer";       Type = "Text" }
  @{ Name = "cm";                   Display = "CM (JSON)";              Type = "Note"; Extra = @{ RichText = $false; NumberOfLines = 4 } }
  @{ Name = "gc";                   Display = "GC (JSON)";              Type = "Note"; Extra = @{ RichText = $false; NumberOfLines = 4 } }
  @{ Name = "architect";            Display = "Architect";              Type = "Text" }
  @{ Name = "engineer";             Display = "Engineer";               Type = "Text" }
  @{ Name = "localUnions";          Display = "Local Unions (JSON)";    Type = "Note"; Extra = @{ RichText = $false; NumberOfLines = 4 } }

  # --- Classification ------------------------------------------------------
  @{ Name = "marketSegment";        Display = "Market Segment";         Type = "Text" }
  @{ Name = "industry";             Display = "Industry";               Type = "Text" }
  @{ Name = "bidType";              Display = "Bid Type";               Type = "Text" }
  @{ Name = "deliveryMethod";       Display = "Delivery Method";        Type = "Text" }

  # --- Requirements --------------------------------------------------------
  @{ Name = "flags";                Display = "Flags (JSON)";           Type = "Note"; Extra = @{ RichText = $false; NumberOfLines = 4 } }
  @{ Name = "description";          Display = "Description";            Type = "Note"; Extra = @{ RichText = $false; NumberOfLines = 8 } }

  # --- Location ------------------------------------------------------------
  @{ Name = "projectAddress";       Display = "Project Address";        Type = "Text" }
  @{ Name = "city";                 Display = "City";                   Type = "Text" }
  @{ Name = "zipCode";              Display = "Zip Code";               Type = "Text" }
  @{ Name = "state";                Display = "State";                  Type = "Text" }

  # --- Budget & schedule ---------------------------------------------------
  @{ Name = "budgetedProjectValue"; Display = "Budgeted Project Value"; Type = "Number" }
  @{ Name = "budgetedCost";         Display = "Budgeted Cost";          Type = "Number" }
  @{ Name = "finalPrice";           Display = "Final Price";            Type = "Number" }
  @{ Name = "budgetedLaborHours";   Display = "Budgeted Labor Hours";   Type = "Number" }
  @{ Name = "budgetedSquareFootage";Display = "Budgeted Square Footage";Type = "Number" }
  @{ Name = "estStartDate";         Display = "Est. Start Date";        Type = "DateTime"; Extra = @{ DisplayFormat = 0 } }
  @{ Name = "estEndDate";           Display = "Est. End Date";          Type = "DateTime"; Extra = @{ DisplayFormat = 0 } }
  @{ Name = "docsReceivedDate";     Display = "Docs Received Date";     Type = "DateTime"; Extra = @{ DisplayFormat = 0 } }

  # --- Import provenance ---------------------------------------------------
  # SharePoint's built-in Created is when the row was IMPORTED, which for all
  # 6,500 of these will be the same afternoon. Keep the date the bid was
  # actually raised in the old tracker, or every historical report is wrong.
  @{ Name = "originalCreated";      Display = "Originally Created";     Type = "DateTime"; Extra = @{ DisplayFormat = 0 } }
)

# Columns worth indexing: the ones you'd filter or sort on server-side.
# Modified is what the app's delta sync ("what changed since last time?")
# queries on, so it matters most. Note columns can't be indexed at all.
$Indexed = @("bidDue", "status", "division", "leadEstimator", "internalBidNumber", "Modified")

# ---------------------------------------------------------------------------

Connect-PnPOnline -Url $SiteUrl -Interactive

$list = Get-PnPList -Identity $ListName -ErrorAction SilentlyContinue
if (-not $list) {
  Write-Host "Creating list '$ListName'..."
  $list = New-PnPList -Title $ListName -Template GenericList -EnableVersioning
} else {
  Write-Host "List '$ListName' already exists — adding anything missing."
}

# "Title" is mandatory and can't be removed, so use it for the bid name. That
# is also what SharePoint shows as the clickable item, which is what you want.
Set-PnPField -List $ListName -Identity "Title" -Values @{ Title = "Opportunity" } | Out-Null

foreach ($col in $Columns) {
  $existing = Get-PnPField -List $ListName -Identity $col.Name -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host ("  = {0} (already there)" -f $col.Name)
    continue
  }

  Add-PnPField -List $ListName `
               -DisplayName $col.Display `
               -InternalName $col.Name `
               -Type $col.Type `
               -AddToDefaultView | Out-Null

  if ($col.ContainsKey("Extra")) {
    Set-PnPField -List $ListName -Identity $col.Name -Values $col.Extra | Out-Null
  }
  Write-Host ("  + {0} ({1})" -f $col.Name, $col.Type)
}

Write-Host "`nIndexing columns (do this while the list is still empty)..."
foreach ($name in $Indexed) {
  try {
    Set-PnPField -List $ListName -Identity $name -Values @{ Indexed = $true } | Out-Null
    Write-Host ("  * {0}" -f $name)
  } catch {
    Write-Warning ("Could not index {0}: {1}" -f $name, $_.Exception.Message)
  }
}

Write-Host "`nDone. List: $SiteUrl/Lists/$($ListName -replace ' ','')"
Write-Host "Import the 6,500 bids only after this has run."
