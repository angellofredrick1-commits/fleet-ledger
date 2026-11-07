// Supabase connection for Bolt Fleet Ledger.
// The publishable key is safe to ship in the browser: row-level security
// in supabase/schema.sql makes sure each account only sees its own records.
window.FLEET_CONFIG = {
  supabaseUrl: "YOUR_SUPABASE_URL",
  supabaseKey: "YOUR_SUPABASE_PUBLISHABLE_KEY"
};
