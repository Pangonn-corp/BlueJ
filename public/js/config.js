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

  // Google OAuth client ID. Public by design — it identifies the app to
  // Google and is meant to be read by anyone. The matching client SECRET
  // (GOCSPX-...) belongs in the Supabase dashboard and must never appear
  // here, in any file served to a browser, or in the repository.
  //
  // Google Cloud Console -> Credentials -> your OAuth 2.0 Client ID.
  // That client also needs, on the same screen:
  //   Authorised JavaScript origins:  the site's origin, e.g.
  //       https://bluejay.onrender.com          (and http://localhost:4173)
  //   Authorised redirect URIs:       Supabase's callback, NOT this site —
  //       https://uepdmgyvvlawtzdswtlz.supabase.co/auth/v1/callback
  googleClientId: '295261384102-v51gbfj3e9lkmjv8kq6bum7m8m807u2f.apps.googleusercontent.com',

  // Must match SUPABASE_TABLE in scraper/.env
  supabaseTable: 'links',

  // Upper bound on links pulled. Supabase returns at most 1000 rows per
  // request, so anything above that is fetched in pages.
  linkLimit: 5000
};
