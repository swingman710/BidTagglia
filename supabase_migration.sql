-- ============================================================================
--  BidTagglia: normalize opportunities table — one column per form field.
--  Run this in Supabase → SQL Editor. Safe to re-run (idempotent adds).
--  The old `data` jsonb column is KEPT (made nullable) as a backup; once you've
--  confirmed everything works you can drop it (see last line).
-- ============================================================================

-- 1. Add a column per form field -------------------------------------------------
alter table public.opportunities
  add column if not exists name text,
  add column if not exists bid_due_date date,
  add column if not exists division text,
  add column if not exists internal_bid_number text,
  add column if not exists project_manager text,
  add column if not exists status text,
  add column if not exists lead_estimator text,
  add column if not exists owner_customer text,
  add column if not exists cm text,
  add column if not exists architect text,
  add column if not exists engineer text,
  add column if not exists local_unions text[] default '{}',
  add column if not exists market_segment text,
  add column if not exists industry text,
  add column if not exists bid_category text,
  add column if not exists bid_type text,
  add column if not exists contract_type text,
  add column if not exists delivery_method text,
  add column if not exists flags text[] default '{}',
  add column if not exists description text,
  add column if not exists project_address text,
  add column if not exists city text,
  add column if not exists zip_code text,
  add column if not exists state text,
  add column if not exists budgeted_project_value numeric,
  add column if not exists budgeted_cost numeric,
  add column if not exists budgeted_labor_hours numeric,
  add column if not exists budgeted_square_footage numeric,
  add column if not exists est_start_date date,
  add column if not exists est_end_date date,
  add column if not exists docs_received_date date;

-- 2. Backfill the new columns from the existing jsonb ----------------------------
update public.opportunities set
  name                    = data->>'name',
  bid_due_date            = nullif(data->>'bidDueDate','')::date,
  division                = data->>'division',
  internal_bid_number     = data->>'internalBidNumber',
  project_manager         = data->>'projectManager',
  status                  = data->>'status',
  lead_estimator          = data->>'leadEstimator',
  owner_customer          = data->>'ownerCustomer',
  cm                      = data->>'cm',
  architect               = data->>'architect',
  engineer                = data->>'engineer',
  local_unions            = case when jsonb_typeof(data->'localUnions') = 'array'
                              then array(select jsonb_array_elements_text(data->'localUnions'))
                              else '{}' end,
  market_segment          = data->>'marketSegment',
  industry                = data->>'industry',
  bid_category            = data->>'bidCategory',
  bid_type                = data->>'bidType',
  contract_type           = data->>'contractType',
  delivery_method         = data->>'deliveryMethod',
  flags                   = case when jsonb_typeof(data->'flags') = 'array'
                              then array(select jsonb_array_elements_text(data->'flags'))
                              else '{}' end,
  description             = data->>'description',
  project_address         = data->>'projectAddress',
  city                    = data->>'city',
  zip_code                = data->>'zipCode',
  state                   = data->>'state',
  budgeted_project_value  = nullif(data->>'budgetedProjectValue','')::numeric,
  budgeted_cost           = nullif(data->>'budgetedCost','')::numeric,
  budgeted_labor_hours    = nullif(data->>'budgetedLaborHours','')::numeric,
  budgeted_square_footage = nullif(data->>'budgetedSquareFootage','')::numeric,
  est_start_date          = nullif(data->>'estStartDate','')::date,
  est_end_date            = nullif(data->>'estEndDate','')::date,
  docs_received_date      = nullif(data->>'docsReceivedDate','')::date
where data is not null;

-- 3. The app no longer writes `data`, so it must be optional --------------------
alter table public.opportunities alter column data drop not null;

-- 4. (LATER, once verified) remove the backup column:
-- alter table public.opportunities drop column data;
