/* ==========================================================================
   BlueJ — authentication.

   Real accounts, backed by Supabase Auth (GoTrue). Called directly over its
   REST API rather than through supabase-js: the project has no build step,
   and a CDN script is one more thing a school network can block.

   The session lives in cookies, as asked. An honest note on what that buys:
   the cookie CANNOT be HttpOnly, because only a server can set that flag and
   this site is static files. Any script running on the page can therefore
   read the token — so a cross-site-scripting hole would still be fatal, the
   same as it would be with localStorage. What cookies do give here is a
   single place to expire the session, SameSite=Lax to keep it off other
   origins' requests, and Secure so it never crosses plain HTTP.

   The access token is short-lived (an hour) and refreshed from the refresh
   token, so a leaked access token stops working on its own.
   ========================================================================== */
(function (global) {
  'use strict';

  var cfg = global.BlueJConfig || {};
  var BASE = String(cfg.supabaseUrl || '').replace(/\/$/, '');
  var KEY = cfg.supabasePublishableKey || '';

  var ACCESS = 'bluej_at';
  var REFRESH = 'bluej_rt';

  /* --- Cookies -------------------------------------------------------------- */

  function writeCookie(name, value, maxAgeSeconds) {
    var parts = [
      name + '=' + encodeURIComponent(value),
      'Path=/',
      'SameSite=Lax',
      'Max-Age=' + Math.max(0, Math.floor(maxAgeSeconds))
    ];
    // Secure would make the cookie unwritable over plain http, which is how
    // the site is opened while developing. https gets it; localhost does not.
    if (location.protocol === 'https:') { parts.push('Secure'); }
    document.cookie = parts.join('; ');
  }

  function readCookie(name) {
    var target = name + '=';
    var all = String(document.cookie || '').split(';');
    for (var i = 0; i < all.length; i++) {
      var part = all[i].trim();
      if (part.indexOf(target) === 0) {
        return decodeURIComponent(part.slice(target.length));
      }
    }
    return '';
  }

  function clearCookie(name) {
    writeCookie(name, '', 0);
  }

  /* --- Tokens --------------------------------------------------------------- */

  /** Seconds until a JWT expires; 0 when unreadable or already expired. */
  function secondsLeft(token) {
    var payload = decode(token);
    if (!payload || !payload.exp) { return 0; }
    return Math.max(0, payload.exp - Math.floor(Date.now() / 1000));
  }

  /**
   * Read a JWT's payload.
   *
   * This is for deciding when to refresh and what to show — never for
   * deciding what the user may do. The token is not verified here and could
   * not be: the signature is checked by the database, which is the only
   * place a claim like is_admin is allowed to matter.
   */
  function decode(token) {
    try {
      var part = String(token).split('.')[1];
      if (!part) { return null; }
      var json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(decodeURIComponent(escape(json)));
    } catch (e) {
      return null;
    }
  }

  function store(session) {
    if (!session || !session.access_token) { return null; }
    // Cookies outlive the access token so the refresh token survives to
    // mint a new one; the access token carries its own expiry regardless.
    writeCookie(ACCESS, session.access_token, session.expires_in || 3600);
    if (session.refresh_token) {
      writeCookie(REFRESH, session.refresh_token, 60 * 60 * 24 * 30);
    }
    return session;
  }

  function forget() {
    clearCookie(ACCESS);
    clearCookie(REFRESH);
  }

  /* --- Requests ------------------------------------------------------------- */

  function call(path, options) {
    options = options || {};
    var headers = { apikey: KEY, 'Content-Type': 'application/json' };
    if (options.token) { headers.Authorization = 'Bearer ' + options.token; }

    return fetch(BASE + '/auth/v1' + path, {
      method: options.method || 'POST',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (response) {
      return response.text().then(function (text) {
        var payload = null;
        try { payload = JSON.parse(text); } catch (e) { payload = null; }
        if (response.ok) { return payload; }

        var message = (payload || {}).error_description ||
                      (payload || {}).msg ||
                      (payload || {}).message ||
                      ('Sign-in failed (' + response.status + ')');
        var err = new Error(message);
        err.status = response.status;
        throw err;
      });
    });
  }

  /* --- Session -------------------------------------------------------------- */

  var refreshing = null;

  /**
   * A usable access token, refreshed when it is close to expiry.
   *
   * Concurrent callers share one refresh: several pages' fetches firing at
   * once must not each spend the refresh token, since using it rotates it.
   */
  function token() {
    var access = readCookie(ACCESS);
    if (access && secondsLeft(access) > 60) { return Promise.resolve(access); }

    var refresh = readCookie(REFRESH);
    if (!refresh) { return Promise.resolve(''); }

    if (!refreshing) {
      refreshing = call('/token?grant_type=refresh_token', {
        body: { refresh_token: refresh }
      }).then(function (session) {
        store(session);
        return session.access_token;
      }).catch(function () {
        forget();          // the refresh token is spent or revoked
        return '';
      }).then(function (result) {
        refreshing = null;
        return result;
      });
    }
    return refreshing;
  }

  /** The signed-in user, or null. Cheap: read from the token, not the network. */
  function user() {
    var access = readCookie(ACCESS);
    if (!access) { return null; }
    var payload = decode(access);
    if (!payload) { return null; }
    return {
      id: payload.sub,
      email: payload.email || '',
      name: (payload.user_metadata || {}).full_name ||
            (payload.user_metadata || {}).name || ''
    };
  }

  /** True when a session exists, even if the access token needs refreshing. */
  function signedIn() {
    return !!(readCookie(ACCESS) || readCookie(REFRESH));
  }

  /* --- Entry points --------------------------------------------------------- */

  function signIn(email, password) {
    return call('/token?grant_type=password', {
      body: { email: email, password: password }
    }).then(function (session) {
      store(session);
      return session;
    });
  }

  /* --- Google -------------------------------------------------------------- */

  var VERIFIER = 'bluej_pkce';

  function base64url(bytes) {
    var text = '';
    for (var i = 0; i < bytes.length; i++) { text += String.fromCharCode(bytes[i]); }
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /**
   * PKCE, when the browser can do it.
   *
   * The alternative — the implicit flow — hands the access token back in the
   * URL fragment, which means it lands in history and in anything the person
   * pastes. PKCE returns a single-use code instead, worthless without the
   * verifier held in this tab. crypto.subtle needs a secure context, so over
   * plain http (anywhere but localhost) this returns null and the implicit
   * flow is used, which captureRedirect still understands.
   */
  function beginPkce() {
    if (!(global.crypto && global.crypto.subtle && global.isSecureContext)) {
      return Promise.resolve(null);
    }
    var bytes = new Uint8Array(48);
    global.crypto.getRandomValues(bytes);
    var verifier = base64url(bytes);

    return global.crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(verifier))
      .then(function (digest) {
        try { sessionStorage.setItem(VERIFIER, verifier); } catch (e) { return null; }
        return base64url(new Uint8Array(digest));
      })
      .catch(function () { return null; });
  }

  /**
   * Trade the ID token from Google's own button for a Supabase session.
   *
   * This is the other half of the official button: it hands back a signed
   * JWT about the person, not an OAuth code, so there is no redirect and no
   * code exchange — Supabase verifies Google's signature and issues its own
   * session.
   *
   * `nonce` is the RAW value. The hashed form went to Google, which embedded
   * it in the token; Supabase hashes this one and compares. That pairing is
   * what stops a token minted for another site being replayed here.
   */
  function signInWithIdToken(credential, nonce) {
    return call('/token?grant_type=id_token', {
      body: {
        provider: 'google',
        id_token: credential,
        nonce: nonce || undefined
      }
    }).then(function (session) {
      store(session);
      return session;
    });
  }

  /** SHA-256 of `text`, lowercase hex — the form Google wants the nonce in. */
  function sha256Hex(text) {
    return global.crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(text))
      .then(function (digest) {
        return Array.prototype.map
          .call(new Uint8Array(digest), function (b) {
            return ('0' + b.toString(16)).slice(-2);
          })
          .join('');
      });
  }

  /** A raw nonce and its hash, for one sign-in attempt. */
  function makeNonce() {
    if (!(global.crypto && global.crypto.subtle && global.isSecureContext)) {
      // Without SubtleCrypto there is no way to produce the hashed form, so
      // the attempt goes ahead unnonced rather than not at all.
      return Promise.resolve(null);
    }
    var bytes = new Uint8Array(32);
    global.crypto.getRandomValues(bytes);
    var raw = base64url(bytes);
    return sha256Hex(raw).then(function (hashed) {
      return { raw: raw, hashed: hashed };
    }).catch(function () { return null; });
  }

  /**
   * Send the browser to Google. Control returns to `redirectTo`.
   *
   * `redirectTo` must be listed under Authentication -> URL Configuration ->
   * Redirect URLs in Supabase, or GoTrue silently sends the person to the
   * site root instead.
   */
  function signInWithGoogle(redirectTo) {
    var target = redirectTo || (location.origin + location.pathname);

    return beginPkce().then(function (challenge) {
      var url = BASE + '/auth/v1/authorize?provider=google&redirect_to=' +
                encodeURIComponent(target);
      if (challenge) {
        url += '&code_challenge=' + challenge + '&code_challenge_method=s256';
      }
      location.href = url;
    });
  }

  /**
   * Pick up whatever Google's round trip left behind.
   *
   * Three shapes are possible: `?code=` for PKCE, `#access_token=` for the
   * implicit fallback, and an error in either place. The URL is cleaned up
   * afterwards so nothing sensitive stays in the address bar.
   */
  function captureRedirect() {
    var hash = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    var query = new URLSearchParams(location.search || '');

    function clean() {
      history.replaceState(null, '', location.pathname);
    }

    var failure = hash.get('error_description') || hash.get('error') ||
                  query.get('error_description') || query.get('error');
    if (failure) {
      clean();
      return Promise.resolve({ error: failure });
    }

    var code = query.get('code');
    if (code) {
      var verifier = '';
      try { verifier = sessionStorage.getItem(VERIFIER) || ''; } catch (e) { verifier = ''; }
      try { sessionStorage.removeItem(VERIFIER); } catch (e) { /* fine */ }
      clean();

      if (!verifier) {
        return Promise.resolve({
          error: 'This sign-in was started in a different tab. Try again here.'
        });
      }

      return call('/token?grant_type=pkce', {
        body: { auth_code: code, code_verifier: verifier }
      }).then(function (session) {
        store(session);
        return { user: user() };
      }).catch(function (err) {
        return { error: err.message };
      });
    }

    if (hash.get('access_token')) {
      store({
        access_token: hash.get('access_token'),
        refresh_token: hash.get('refresh_token'),
        expires_in: parseInt(hash.get('expires_in'), 10) || 3600
      });
      clean();
      return Promise.resolve({ user: user() });
    }

    return Promise.resolve(null);
  }

  function signOut() {
    var access = readCookie(ACCESS);
    forget();
    if (!access) { return Promise.resolve(); }
    // Best effort: the cookies are already gone either way.
    return call('/logout', { token: access }).catch(function () {});
  }

  function resetPassword(email, redirectTo) {
    return call('/recover', {
      body: { email: email, redirect_to: redirectTo || location.origin }
    });
  }

  global.BlueJAuth = {
    signIn: signIn,
    signInWithGoogle: signInWithGoogle,
    signInWithIdToken: signInWithIdToken,
    makeNonce: makeNonce,
    captureRedirect: captureRedirect,
    signOut: signOut,
    resetPassword: resetPassword,
    token: token,
    user: user,
    signedIn: signedIn,
    forget: forget
  };
}(window));
