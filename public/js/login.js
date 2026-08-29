/* ==========================================================================
   BlueJ — sign in.

   Email and password. There is no sign-up: accounts are created
   in the Supabase dashboard (Authentication -> Users -> Add user, with "Auto
   Confirm User" ticked), which also sidesteps the confirmation email
   entirely. The database creates the matching profile row from a trigger.

   Nothing here decides access. Every page and every write is checked again
   by the database against the session's own JWT, so a page edited in
   devtools gets a different set of buttons and exactly the same permissions.
   ========================================================================== */
BlueJ.ready().then(function () {
  'use strict';

  var B = window.BlueJ;
  var $ = B.$;
  var auth = window.BlueJAuth;
  var sb = window.BlueJSupabase;

  var HOME = 'home.html';

  function credentialError(message) {
    $('#credentials-error').textContent = message || '';
  }

  /** Record the session locally, then leave. */
  function enter(profile) {
    var who = auth.user() || {};
    return B.Session.start((profile && profile.email) || who.email, 'supabase')
      .then(function () { location.replace(HOME); });
  }

  /**
   * Finish signing in.
   *
   * The profile row is what the app reads for a display name and for admin
   * rights. A missing one is not fatal here — the database will refuse
   * whatever that account may not do — so this only reports a real failure.
   */
  function afterSignIn() {
    return sb.fetchProfile()
      .then(enter)
      .catch(function (err) {
        // No profiles table means the accounts schema has not been run, and
        // the older policies still apply. Let the person in rather than
        // blocking on a rule that is not in force.
        if (err.missingTable) { return enter(null); }
        credentialError(err.message);
      });
  }

  /* --- Credentials ----------------------------------------------------------- */

  $('#credentials').addEventListener('submit', function (event) {
    event.preventDefault();
    credentialError('');

    var email = $('#email').value.trim();
    var password = $('#password').value;

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return credentialError('Enter a valid email address.');
    }
    if (!password) {
      return credentialError('Enter your password.');
    }

    var button = $('#credentials button[type=submit]');
    button.disabled = true;

    auth.signIn(email, password)
      .then(afterSignIn)
      .catch(function (err) { credentialError(friendly(err)); })
      .then(function () { button.disabled = false; });
  });

  /** GoTrue's wording is terse and sometimes misleading; these are not. */
  function friendly(err) {
    var message = String(err.message || '');
    if (/invalid login credentials/i.test(message)) {
      return 'Wrong email or password. Accounts are created in the Supabase ' +
             'dashboard — there is no sign-up here.';
    }
    if (/email not confirmed/i.test(message)) {
      return 'This address is not confirmed. Confirm it in Supabase → ' +
             'Authentication → Users, or switch off “Confirm email” under ' +
             'Sign In / Providers → Email.';
    }
    if (err.status === 0 || /failed to fetch/i.test(message)) {
      return 'Could not reach the server. Check your connection.';
    }
    return message || 'Sign-in failed.';
  }

  /* --- Arrival --------------------------------------------------------------- */

  // Already signed in: straight on, no form.
  if (auth.signedIn()) { afterSignIn(); }
});
