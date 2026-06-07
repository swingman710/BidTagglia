// ===========================================================================
//  Supabase client + config.
//  The anon (public) key is meant to live in client code — it's protected by
//  the table's Row Level Security policy. Do NOT put the service_role key here.
// ===========================================================================

const SUPABASE_URL = "https://hbfqisenzxjaktirqpxp.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhiZnFpc2VuenhqYWt0aXJxcHhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NTA3MTYsImV4cCI6MjA5NjQyNjcxNn0.MJK5QGuNpVNrU5wDXui-i6fHIjwln8CsYEeFudHanG8";
const SUPABASE_TABLE = "opportunities";

// Created from the UMD global provided by the @supabase/supabase-js CDN script.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
