-- ============================================================================
--  BidTagglia — September 2026 changes.
--
--  RUN THIS ONCE in the Supabase SQL Editor (paste it whole, press Run) BEFORE
--  or right after deploying the matching code. Until it runs:
--    * marking a quote Won fails with a constraint error
--    * the contacts Active/Inactive toggle fails to save
--    * keeping a user off the dashboard graphs fails to save
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
--  3. A user can be kept off the dashboard graphs.
--
--  For former employees. Someone who left still has years of bid history, and
--  that history has to stay in the reports — it is what the win rates are made
--  of. What it should stop doing is sitting at the top of the estimator chart
--  on the dashboard as though it were live work.
--
--  So this is narrow on purpose: it hides a name from the dashboard graphs and
--  nothing else. Reports, the Overdue tab and every total still count them.
--
--  Separate from `blocked`, which is only about signing in.
--
--  (An earlier draft of this file called the column hidden_from_reports, which
--  described the opposite of what it does. Renamed here, so running either
--  version of the file leaves the same column.)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'app_members'
                and column_name = 'hidden_from_reports')
     and not exists (select 1 from information_schema.columns
                      where table_name = 'app_members'
                        and column_name = 'hidden_from_charts')
  then
    alter table public.app_members
      rename column hidden_from_reports to hidden_from_charts;
  end if;
end $$;

alter table public.app_members
  add column if not exists hidden_from_charts boolean not null default false;


-- ---------------------------------------------------------------------------
--  4. Estimators found in the bid history can be listed as users.
--
--  The Users tab now also lists every lead estimator who appears on a bid, so
--  a former employee can be kept off the dashboard graphs without having to be
--  a real sign-in account. Those rows carry source = 'estimator' and are always blocked:
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
      and column_name = 'hidden_from_charts')                         = 1 as users_can_be_hidden,
  (select count(*) from pg_constraint
    where conname = 'app_members_source_check'
      and pg_get_constraintdef(oid) like '%estimator%')               = 1 as estimators_allowed;
