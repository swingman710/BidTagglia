-- ============================================================================
--  Companies: Type becomes multi-value.
--  Run in Supabase -> SQL Editor. Safe to re-run.
--
--  A company is often more than one thing — "Construction Manager;Electrician",
--  "Engineer;Integrator;Security Contractor" in the old tracker's export — so
--  type moves from text to text[]. Existing single values are carried across
--  as one-element arrays; the app reads either shape, so this can run before
--  or after the code is deployed.
-- ============================================================================

alter table public.companies
  add column if not exists type_list text[] default '{}';

-- Carry the old single value over, splitting on the ';' the export uses.
update public.companies
   set type_list = case
         when type is null or btrim(type) = '' then '{}'
         else (select array_agg(btrim(t))
                 from unnest(string_to_array(type, ';')) as t
                where btrim(t) <> '')
       end
 where type_list = '{}' or type_list is null;

-- Swap the columns over: the app writes an array to `type`.
alter table public.companies drop column if exists type;
alter table public.companies rename column type_list to type;
alter table public.companies alter column type set default '{}';

-- Sanity check.
select count(*) as companies,
       count(*) filter (where cardinality(type) > 0) as with_a_type,
       count(*) filter (where cardinality(type) > 1) as with_several
  from public.companies;
