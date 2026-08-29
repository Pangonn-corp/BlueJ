/* ==========================================================================
   BlueJ — the official "Sign in with Google" button.

   Google Identity Services renders this button itself, from
   https://accounts.google.com/gsi/client. That is deliberate on Google's
   part: the mark, the wording and the proportions are theirs, and a
   hand-drawn copy is what their branding rules exist to prevent. The cost is
   a script from Google's servers.

   It hands back an ID token — a JWT signed by Google — rather than an OAuth
   code, so there is no redirect: Supabase verifies the signature and issues
   its own session in place.

   BlueJ gets opened on networks that block a great deal, and this is the one
   dependency that cannot be vendored. So if the script does not arrive, a
   plain button appears instead and signs in through the redirect flow, which
   only needs Supabase to be reachable.
   ========================================================================== */
(function (global) {
  'use strict';

  var SRC = 'https://accounts.google.com/gsi/client';
  var TIMEOUT = 6000;

  var loading = null;

  /**
   * Load Google Identity Services.
   *
   * Rejects on a timeout as well as on an error: a blocked request can hang
   * rather than fail, and a button that never appears is worse than a plain
   * one that works.
   */
  function load() {
    if (loading) { return loading; }

    loading = new Promise(function (resolve, reject) {
      if (global.google && global.google.accounts) {
        return resolve(global.google);
      }

      var tag = document.createElement('script');
      var timer = setTimeout(function () {
        reject(new Error('Google’s sign-in script did not load in time.'));
      }, TIMEOUT);

      tag.src = SRC;
      tag.async = true;
      tag.onload = function () {
        clearTimeout(timer);
        if (global.google && global.google.accounts) { resolve(global.google); }
        else { reject(new Error('Google’s sign-in script loaded but is unusable.')); }
      };
      tag.onerror = function () {
        clearTimeout(timer);
        reject(new Error('Google’s sign-in script could not be reached.'));
      };
      document.head.appendChild(tag);
    }).catch(function (err) {
      loading = null;              // let a later attempt try again
      throw err;
    });

    return loading;
  }

  /**
   * Render the official button into `host`.
   *
   * `onSession` is called once a Supabase session exists; `onError` for
   * anything the person should be told about. Resolves false when the button
   * could not be rendered, so the caller can show its fallback.
   */
  function render(host, options) {
    options = options || {};
    var cfg = global.BlueJConfig || {};
    var auth = global.BlueJAuth;

    if (!cfg.googleClientId) {
      return Promise.resolve(false);
    }

    return Promise.all([load(), auth.makeNonce()]).then(function (parts) {
      var google = parts[0];
      var nonce = parts[1];

      google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        // Hashed for Google, raw for Supabase — Supabase re-hashes and
        // compares, which is what ties the token to this attempt.
        nonce: nonce ? nonce.hashed : undefined,
        // One Tap is a separate, automatic prompt. The person asked for a
        // button, so this stays a button.
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: function (response) {
          if (!response || !response.credential) {
            return options.onError && options.onError(
              new Error('Google did not return a sign-in token.'));
          }
          auth.signInWithIdToken(response.credential, nonce && nonce.raw)
            .then(function () { options.onSession && options.onSession(); })
            .catch(function (err) { options.onError && options.onError(err); });
        }
      });

      host.textContent = '';
      google.accounts.id.renderButton(host, {
        type: 'standard',
        // The panel is near-black, so the dark button is the one Google's
        // guidelines call for.
        theme: 'filled_black',
        size: 'large',
        // Honest for a form that both signs in and signs up.
        text: 'continue_with',
        shape: 'pill',
        logo_alignment: 'left',
        width: options.width || 320
      });

      host.hidden = false;
      return true;
    }).catch(function (err) {
      if (options.onUnavailable) { options.onUnavailable(err); }
      return false;
    });
  }

  global.BlueJGoogle = { load: load, render: render };
}(window));
