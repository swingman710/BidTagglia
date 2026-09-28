-- ============================================================================
--  BidTagglia — September 2026 changes.
--
--  RUN THIS ONCE in the Supabase SQL Editor (paste it whole, press Run) BEFORE
--  or right after deploying the matching code. Until it runs:
--    * marking a quote Won fails with a constraint error
--    * the contacts Active/Inactive toggle fails to save
--    * hiding a user from reports fails to save
--  Everything else in the app keeps working either way.
--
--  Safe to re-run.
-- ============================================================================


-- ---------------------------------------------------------------------------
--  1. A quote can now be Won.
--
--  Several companies get priced on one bid but only one of them wins it, so
--  the winner is recorded on the quote rather than only on the bid. See
--  setQuoteWon() in dashboard.js — marking one Won marks the other proposals
--  on that bid Lost, and moves the bid itself to Won.
-- ---------------------------------------------------------------------------

alter table public.pricing_quotes
  drop constraint if exists pricing_quotes_status_check;

alter table public.pricing_quotes
  add constraint pricing_quotes_status_check
  check (status in ('Draft', 'Sent', 'Won', 'Lost', 'Withdrawn'));


-- ---------------------------------------------------------------------------
--  2. Contacts can be marked inactive.
--
--  Inactive people stay on file and stay attached to the activities they are
--  already on — they're just filtered out of the list and the pickers by
--  default. Everyone already on file counts as active.
-- ---------------------------------------------------------------------------

alter table public.contacts
  add column if not exists active boolean not null default true;


-- ---------------------------------------------------------------------------
--  3. A user can be hidden from reports and graphs.
--
--  Separate from `blocked`: blocked is about signing in, this is only about
--  whether their name is counted in the estimator chart, the Overdue tab and
--  the reports. Someone who left the company still has their bid history, and
--  you may or may not want it in the averages.
-- ---------------------------------------------------------------------------

alter table public.app_members
  add column if not exists hidden_from_reports boolean not null default false;


-- ---------------------------------------------------------------------------
--  4. Estimators found in the bid history can be listed as users.
--
--  The Users tab now also lists every lead estimator who appears on a bid, so
--  they can be hidden from reports without having to be a real sign-in
--  account. Those rows carry source = 'estimator' and are always blocked:
--  their `identity` is a person's name, never an email, so nothing can ever
--  sign in as one. An admin can invite them properly from the same tab, which
--  turns the row into a normal 'manual' account.
-- ---------------------------------------------------------------------------

alter table public.app_members
  drop constraint if exists app_members_source_check;

alter table public.app_members
  add constraint app_members_source_check
  check (source in ('microsoft', 'manual', 'estimator'));


-- Sanity check — all four should come back true.
select
  (select count(*) from pg_constraint
    where conname = 'pricing_quotes_status_check'
      and pg_get_constraintdef(oid) like '%Won%')                     = 1 as quotes_can_be_won,
  (select count(*) from information_schema.columns
    where table_name = 'contacts' and column_name = 'active')         = 1 as contacts_have_active,
  (select count(*) from information_schema.columns
    where table_name = 'app_members'
      and column_name = 'hidden_from_reports')                        = 1 as users_can_be_hidden,
  (select count(*) from pg_constraint
    where conname = 'app_members_source_check'
      and pg_get_constraintdef(oid) like '%estimator%')               = 1 as estimators_allowed;
