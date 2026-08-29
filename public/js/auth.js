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
    signOut: signOut,
    resetPassword: resetPassword,
    token: token,
    user: user,
    signedIn: signedIn,
    forget: forget
  };
}(window));
