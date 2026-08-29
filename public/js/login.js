/* ==========================================================================
   BlueJ — sign in.

   Email and password, or Google. There is no sign-up: accounts are created
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

  /* --- Google ---------------------------------------------------------------
     Two routes to the same place. Google's own button is the one its
     branding rules ask for and needs no redirect, but it depends on a script
     from accounts.google.com. Where that cannot be reached — which is
     exactly the sort of network this site gets opened on — the plain button
     takes over and uses the redirect flow, which only needs Supabase.
     ------------------------------------------------------------------------- */

  var plainGoogle = $('#google');

  plainGoogle.addEventListener('click', function () {
    credentialError('');
    plainGoogle.disabled = true;
    auth.signInWithGoogle(location.origin + location.pathname);
  });

  window.BlueJGoogle.render($('#google-button'), {
    width: 320,
    onSession: function () {
      credentialError('');
      afterSignIn();
    },
    onError: function (err) {
      credentialError(err.message);
    },
    onUnavailable: function (err) {
      // Not shown as an error: sign-in still works, just by the other route.
      console.warn('Google button unavailable — ' + err.message);
    }
  }).then(function (rendered) {
    if (!rendered) { plainGoogle.hidden = false; }
  });

  /* --- Arrival --------------------------------------------------------------- */

  // Google sends the browser back here; exchanging its code is a request, so
  // this waits rather than assuming.
  auth.captureRedirect().then(function (returned) {
    if (returned && returned.error) { return credentialError(returned.error); }
    if (returned && returned.user) { return afterSignIn(); }
    // Already has a session: send them straight on.
    if (auth.signedIn()) { return afterSignIn(); }
  });
});
