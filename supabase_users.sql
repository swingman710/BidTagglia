-- ============================================================================
--  BidTagglia: manual (non-Microsoft) login accounts.
--  Run this in Supabase -> SQL Editor. Safe to re-run.
--
--  Passwords are bcrypt-hashed and the table is locked down so the public anon
--  key CANNOT read it. Login is verified through verify_login(), a
--  SECURITY DEFINER function the client calls via sb.rpc(...).
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- 1. The accounts table --------------------------------------------------------
create table if not exists public.app_users (
  username      text primary key,
  password_hash text not null,
  created_at    timestamptz default now()
);

-- 2. Lock it down: RLS on + no policies + no grants = anon/authenticated can't
--    read or write it directly (only the SECURITY DEFINER function below can).
alter table public.app_users enable row level security;
revoke all on public.app_users from anon, authenticated;

-- 3. Verify a login. Runs as the owner, so it can read app_users even though
--    the caller can't. Returns true only when the password matches.
create or replace function public.verify_login(p_username text, p_password text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.app_users
    where username = p_username
      and password_hash = crypt(p_password, password_hash)
  );
$$;

-- 4. Let the client CALL the function (but still not read the table).
revoke all on function public.verify_login(text, text) from public;
grant execute on function public.verify_login(text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- ADD A USER (run when you're ready; replace the username/password). 'bf' =
-- bcrypt. The password is hashed here, never stored in plain text.
--
--   insert into public.app_users (username, password_hash)
--   values ('guest', crypt('change-me', gen_salt('bf')));
--
-- CHANGE A PASSWORD:
--   update public.app_users
--     set password_hash = crypt('new-password', gen_salt('bf'))
--     where username = 'guest';
--
-- REMOVE A USER:
--   delete from public.app_users where username = 'guest';
-- ----------------------------------------------------------------------------
