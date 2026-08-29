/* ==========================================================================
   BlueJ — front-end configuration.

   This file ships to the browser, so everything in it is public.

   The key below is the PUBLISHABLE key (`sb_publishable_...`). It is meant to
   be public and is limited by row-level security — the links table grants it
   SELECT only.

   >>> Never put the SECRET key (`sb_secret_...`) here. <<<
   That one bypasses RLS and would give every visitor full write access. It
   belongs only in scraper/.env, which is gitignored.

   Both live at: Supabase dashboard -> Project Settings -> API Keys
   ========================================================================== */
window.BlueJConfig = {
  supabaseUrl: 'https://uepdmgyvvlawtzdswtlz.supabase.co',

  supabasePublishableKey: 'sb_publishable_mPqxqnYsQsobk-jK5We8Uw_7hFqzVBU',

  // Must match SUPABASE_TABLE in scraper/.env
  supabaseTable: 'links',

  // Upper bound on links pulled. Supabase returns at most 1000 rows per
  // request, so anything above that is fetched in pages.
  linkLimit: 5000
};
