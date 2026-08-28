// ===========================================================================
//  Supabase client + config.
//
//  The publishable key is meant to live in client code — what it can actually
//  do is decided by each table's Row Level Security policy. Do NOT put the
//  secret / service_role key here.
//
//  NOTE: the RLS policies currently grant this key full read AND write on
//  every table, which also lets anyone holding it add themselves to
//  app_members and sign in. Tightening that is outstanding work.
// ===========================================================================

const SUPABASE_URL = "https://syxfuydxpuewhewmfajj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Id5Tt9PSvhneLXK71-nDOA_DiRn2mBG";
const SUPABASE_TABLE = "opportunities";

// Created from the UMD global provided by the @supabase/supabase-js CDN script.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
