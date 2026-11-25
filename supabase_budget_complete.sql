-- ============================================================================
--  BidTagglia — a budgetary price can be marked Budget Complete.
--
--  RUN THIS ONCE in the Supabase SQL Editor (paste it whole, press Run).
--  Until it runs, clicking Budget Complete on a budgetary price says so and
--  changes nothing. Safe to re-run.
--
--  Budgetary prices walk Draft -> Sent -> Budget Complete, where proposals
--  walk Draft -> Sent -> Won. See renderQuoteRow() in dashboard.js.
-- ============================================================================

alter table public.pricing_quotes
  drop constraint if exists pricing_quotes_status_check;

alter table public.pricing_quotes
  add constraint pricing_quotes_status_check
  check (status in ('Draft', 'Sent', 'Won', 'Budget Complete', 'Lost', 'Withdrawn'));

-- Sanity check — should come back true.
select count(*) = 1 as budget_complete_allowed
  from pg_constraint
 where conname = 'pricing_quotes_status_check'
   and pg_get_constraintdef(oid) like '%Budget Complete%';
