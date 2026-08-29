/* ==========================================================================
   Minimal Supabase (PostgREST) reader.

   Deliberately not the supabase-js SDK: this page needs exactly one GET, and
   a ~40 line fetch wrapper avoids a 40 KB dependency on a page whose whole
   job is to render a list.

   Shapes the flat `url, status, name` rows into what the Links page draws:
   a provider list for the chart and per-link rows for the table.
   ========================================================================== */
(function (global) {
  'use strict';

  var cfg = global.BlueJConfig || {};

  function apiKey() {
    return cfg.supabasePublishableKey || '';
  }

  function isConfigured() {
    return Boolean(cfg.supabaseUrl && apiKey() && cfg.supabaseTable);
  }

  /** Readable label for a link that has no stored name. */
  function hostLabel(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (err) {
      return url;
    }
  }

  /**
   * Folds casing and spacing exactly as the database's name_key does, so
   * "Study Hub", "StudyHub" and "studyhub" are one provider on both sides.
   */
  function nameKey(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'unknown';
  }

  /**
   * Headers for a data request.
   *
   * `apikey` identifies the project; the bearer token identifies the person.
   * Without the token every request runs as `anon`, which since the accounts
   * change is granted nothing at all — so this is what makes reads work, and
   * what makes them stop working the moment a session ends.
   */
  function headers(extra) {
    return authToken().then(function (token) {
      var base = { apikey: apiKey() };
      if (token) { base.Authorization = 'Bearer ' + token; }
      return Object.assign(base, extra || {});
    });
  }

  function authToken() {
    var auth = global.BlueJAuth;
    return auth ? auth.token() : Promise.resolve('');
  }

  function get(pathAndQuery) {
    var url = cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + pathAndQuery;
    return headers().then(function (h) {
      return fetch(url, { headers: h });
    }).then(function (response) {
      if (response.ok) { return response.json(); }

      // Read the body: PostgREST explains itself, and a bare status code
      // ("Supabase returned 400") tells nobody anything.
      return response.text().then(function (body) {
        var detail = '';
        var code = '';
        try {
          var parsed = JSON.parse(body);
          detail = parsed.message || '';
          code = parsed.code || '';
        } catch (e) { detail = (body || '').slice(0, 120); }

        var err;
        if (response.status === 404 || code === 'PGRST205') {
          err = new Error('Table "' + cfg.supabaseTable + '" not found');
          err.missingTable = true;
        } else if (response.status === 401 || response.status === 403) {
          err = new Error(global.BlueJAuth && global.BlueJAuth.signedIn()
            ? 'Your account cannot read this yet — finish signing up'
            : 'Sign in to view links');
          err.unauthorised = true;
        } else {
          err = new Error(detail || ('Supabase returned ' + response.status));
          // 42703 = undefined_column, PGRST204 = not in the schema cache.
          err.missingColumn = code === '42703' || code === 'PGRST204' ||
                              /column .* does not exist/i.test(detail);
        }
        err.status = response.status;
        throw err;
      });
    });
  }

  /**
   * Fetch the links plus the maintained provider totals.
   * Resolves to { links, providers, review, source }.
   */
  function fetchLinks() {
    if (!isConfigured()) {
      return Promise.reject(new Error('Supabase is not configured'));
    }

    var table = encodeURIComponent(cfg.supabaseTable);
    var cap = cfg.linkLimit || 5000;
    var PAGE = 1000;   // Supabase caps a single response at 1000 rows

    /**
     * Page through the table.
     * A single request silently returns only the first 1000 rows, which read
     * as "all of them" — so the page claimed 1000 links when the table held
     * 1301. Requests continue until a short page arrives or `cap` is reached.
     */
    function fetchPage(columns, offset, collected) {
      var query = table + '?select=' + columns +
                  '&order=url.asc&limit=' + PAGE + '&offset=' + offset;
      return get(query).then(function (rows) {
        var all = collected.concat(rows);
        if (rows.length < PAGE || all.length >= cap) { return all.slice(0, cap); }
        return fetchPage(columns, offset + rows.length, all);
      });
    }

    // `name` and `needs_review` are optional. A table created before they
    // existed must still render rather than failing the whole page, so the
    // select narrows on a missing-column error — the same tolerance the
    // writer already has.
    var links = fetchPage('url,status,name,needs_review', 0, [])
      .catch(function (err) {
        if (!err.missingColumn) { throw err; }
        return fetchPage('url,status,name', 0, []);
      })
      .catch(function (err) {
        if (!err.missingColumn) { throw err; }
        return fetchPage('url,status', 0, []);
      });

    // The totals table is maintained by a trigger, so it counts every row in
    // the database rather than only the page fetched here — and it folds name
    // variants. If it is missing we fall back to deriving them.
    var totals = get(table + '_totals?select=name_key,display_name,total&order=total.desc')
      .catch(function () { return null; });

    return Promise.all([links, totals]).then(function (parts) {
      return shape(parts[0], parts[1]);
    });
  }

  var REVIEW_LABEL = 'Needs review';

  /** Count providers from the rows on hand, folding name variants. */
  function deriveProviders(links) {
    var byKey = {};
    links.forEach(function (link) {
      if (link.review) { return; }
      var entry = byKey[link.key];
      if (!entry) {
        byKey[link.key] = { name: link.type, count: 1, key: link.key };
      } else {
        entry.count += 1;
        // Prefer a spelling that is neither all-lower nor all-upper.
        if (!/[a-z]/.test(entry.name) || !/[A-Z]/.test(entry.name)) {
          if (/[a-z]/.test(link.type) && /[A-Z]/.test(link.type)) { entry.name = link.type; }
        }
      }
    });
    return Object.keys(byKey).map(function (k) { return byKey[k]; });
  }

  /** Flat rows (+ optional totals) -> { links, providers, review }. */
  function shape(rows, totals) {
    if (!Array.isArray(rows)) { rows = []; }

    var links = rows
      .filter(function (row) { return row && row.url; })
      .map(function (row) {
        var review = row.needs_review === true;
        var provider = (row.name || '').trim();
        return {
          name: hostLabel(row.url),
          url: row.url,
          status: (row.status || 'untested').toLowerCase(),
          // A flagged row's name is exactly what is not trusted, so it is
          // labelled as such rather than presented as a real provider.
          type: review || !provider ? REVIEW_LABEL : provider,
          key: review ? '' : nameKey(provider),
          review: review
        };
      });

    // Authoritative: counted across the whole table by a trigger, name
    // variants folded, flagged rows collected under one bucket. Every
    // category is present, so nothing is counted here.
    var providers = (Array.isArray(totals) ? totals : [])
      .filter(function (t) { return t && t.display_name && t.total > 0; })
      .map(function (t) {
        var isReview = t.name_key === '__review__' ||
                       t.display_name === REVIEW_LABEL;
        return {
          name: t.display_name,
          count: t.total,
          key: isReview ? '' : nameKey(t.display_name),
          review: isReview
        };
      });

    // The table is filled by an insert trigger, so it is legitimately empty
    // until the scraper next runs. Deriving beats showing an empty rail.
    if (!providers.length) { providers = deriveProviders(links); }

    // The flagged bucket belongs at the end regardless of size: it is a
    // holding pen, not the biggest provider.
    providers.sort(function (a, b) {
      if (a.review !== b.review) { return a.review ? 1 : -1; }
      return b.count - a.count;
    });

    var review = providers.reduce(function (n, p) {
      return p.review ? n + p.count : n;
    }, 0);

    // Derived fallback only: the totals table already carries this bucket.
    if (!review) {
      var flagged = links.filter(function (l) { return l.review; }).length;
      if (flagged) {
        providers.push({ name: REVIEW_LABEL, count: flagged, key: '', review: true });
        review = flagged;
      }
    }

    return { links: links, providers: providers, review: review, source: 'supabase' };
  }

  /**
   * File a status report for a link.
   *
   * `atHome` is what makes the report actionable: the same failure means
   * "a filter blocked it" away from home and "the site is down" at home.
   */
  function reportIssue(url, issue, atHome, reportedBy) {
    if (!isConfigured()) {
      return Promise.reject(new Error('Supabase is not configured'));
    }

    var endpoint = cfg.supabaseUrl.replace(/\/$/, '') +
      '/rest/v1/' + encodeURIComponent(cfg.supabaseTable) + '_reports';

    return headers({ 'Content-Type': 'application/json',
                     Prefer: 'return=minimal' }).then(function (h) {
      return fetch(endpoint, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          url: url,
          issue: issue,
          at_home: !!atHome,
          reported_by: reportedBy || null
        })
      });
    }).then(function (response) {
      if (response.ok) { return true; }
      return response.text().then(function (body) {
        var detail = '';
        try { detail = (JSON.parse(body) || {}).message || ''; } catch (e) { detail = body.slice(0, 120); }
        if (response.status === 404) {
          throw new Error('Reports table missing — run the SQL in scraper/sql/schema.sql');
        }
        if (response.status === 401 || response.status === 403) {
          throw new Error('Supabase refused the report; the insert policy may be missing');
        }
        throw new Error(detail || ('Supabase returned ' + response.status));
      });
    });
  }

  /** Latest news posts, newest first, pinned ones ahead of the rest. */
  function fetchNews(limit) {
    if (!isConfigured()) {
      return Promise.reject(new Error('Supabase is not configured'));
    }
    return get(encodeURIComponent(cfg.supabaseTable) +
      '_news?select=id,title,body,pinned,published_at' +
      '&order=pinned.desc,published_at.desc&limit=' + (limit || 10));
  }

  /** Providers that gained links in the last week. */
  function fetchRecentAdditions() {
    if (!isConfigured()) {
      return Promise.reject(new Error('Supabase is not configured'));
    }
    return get(encodeURIComponent(cfg.supabaseTable) +
      '_recent_additions?select=name,added,last_added');
  }

  /** Suggest a different provider for a link. */
  function suggestCategory(url, currentName, suggestedName, reportedBy) {
    if (!isConfigured()) {
      return Promise.reject(new Error('Supabase is not configured'));
    }

    var name = String(suggestedName || '').trim();
    if (!name) { return Promise.reject(new Error('Enter a category')); }
    if (name.length > 120) { name = name.slice(0, 120); }

    var endpoint = cfg.supabaseUrl.replace(/\/$/, '') +
      '/rest/v1/' + encodeURIComponent(cfg.supabaseTable) + '_category_suggestions';

    return headers({ 'Content-Type': 'application/json',
                     Prefer: 'return=minimal' }).then(function (h) {
      return fetch(endpoint, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          url: url,
          current_name: currentName || null,
          suggested_name: name,
          reported_by: reportedBy || null
        })
      });
    }).then(function (response) {
      if (response.ok) { return true; }
      return response.text().then(function (body) {
        var detail = '';
        try { detail = (JSON.parse(body) || {}).message || ''; } catch (e) { detail = body.slice(0, 120); }
        if (response.status === 404) {
          throw new Error('Suggestions table missing — run scraper/sql/schema.sql');
        }
        if (response.status === 401 || response.status === 403) {
          throw new Error('Supabase refused the suggestion; the insert policy may be missing');
        }
        throw new Error(detail || ('Supabase returned ' + response.status));
      });
    });
  }

  /**
   * Call a database function.
   *
   * News edits go through these rather than a direct table write. Nothing
   * this page ships can be a write credential — it is public the moment it
   * loads — so the passphrase is typed by the person editing and checked in
   * the database, and the publishable key alone can still only read.
   */
  function rpc(name, args) {
    if (!isConfigured()) {
      return Promise.reject(new Error('Supabase is not configured'));
    }
    var endpoint = cfg.supabaseUrl.replace(/\/$/, '') +
      '/rest/v1/rpc/' + encodeURIComponent(cfg.supabaseTable) + '_' + name;

    return headers({ 'Content-Type': 'application/json' }).then(function (h) {
      return fetch(endpoint, { method: 'POST', headers: h,
                               body: JSON.stringify(args || {}) });
    }).then(function (response) {
      return response.text().then(function (body) {
        var payload = null;
        try { payload = JSON.parse(body); } catch (e) { payload = null; }
        if (response.ok) { return payload; }

        var detail = (payload || {}).message || '';
        if (response.status === 404) {
          var absent = new Error('Editing functions missing — run scraper/sql/schema.sql');
          // Told apart from a failure, because "this function does not exist"
          // and "this function refused" call for opposite responses.
          absent.missingFunction = true;
          throw absent;
        }
        // 42501 is what the functions raise when the account is not an admin.
        if ((payload || {}).code === '42501' || /admin only/i.test(detail)) {
          throw new Error('That account is not an admin');
        }
        throw new Error(detail || ('Supabase returned ' + response.status));
      });
    });
  }

  /** Create (id null) or update a news post. Resolves to its id. */
  function saveNews(post) {
    return rpc('news_save', {
      p_id: post.id || null,
      p_title: post.title || null,
      p_body: post.body || '',
      p_pinned: !!post.pinned
    });
  }

  function deleteNews(id) {
    return rpc('news_delete', { p_id: id });
  }

  /**
   * Settle a category suggestion.
   *
   * Accepting renames the link and clears its review flag, which the totals
   * trigger then reflects on its own; denying only marks the suggestion.
   */
  function resolveSuggestion(url, name, accept) {
    return rpc('suggestion_resolve', {
      p_url: url,
      p_name: name,
      p_accept: !!accept
    });
  }

  /**
   * Ban an account, or lift a ban.
   *
   *   setBan(email, { days: 7 })      a week
   *   setBan(email, { forever: true }) until further notice
   *   setBan(email, {})                lift it
   *
   * The end time is worked out in the database, not here: a browser that
   * chooses its own expiry is one whose clock can be wrong, or whose owner
   * can be dishonest. Resolves to the new banned_until, or null.
   */
  function setBan(email, options) {
    options = options || {};
    return rpc('set_ban', {
      p_email: email,
      p_days: options.days || null,
      p_indefinite: !!options.forever
    });
  }

  /**
   * Every account, with what it has done. Admin-only in the database, so a
   * non-admin gets an empty list rather than an error.
   */
  function fetchAccounts() {
    if (!isConfigured()) {
      return Promise.reject(new Error('Supabase is not configured'));
    }
    return get(encodeURIComponent(cfg.supabaseTable) +
      '_accounts?select=*&order=created_at.asc');
  }

  /**
   * Reports as filed, straight from the table. `reported_by` is not requested
   * and could not be read if it were: the browser role has no grant on it.
   */
  function fetchReports(limit) {
    if (!isConfigured()) {
      return Promise.reject(new Error('Supabase is not configured'));
    }
    return get(encodeURIComponent(cfg.supabaseTable) +
      '_reports?select=id,url,issue,at_home,created_at' +
      '&order=created_at.desc&limit=' + (limit || 500));
  }

  /** Category suggestions as filed, likewise minus the reporter. */
  function fetchSuggestions(limit) {
    if (!isConfigured()) {
      return Promise.reject(new Error('Supabase is not configured'));
    }
    return get(encodeURIComponent(cfg.supabaseTable) +
      '_category_suggestions?select=id,url,current_name,suggested_name,created_at' +
      '&order=created_at.desc&limit=' + (limit || 500));
  }

  /**
   * The signed-in account's profile row.
   *
   * `is_admin` is read here only to decide what to render. It is not what
   * grants anything: every admin function re-checks it in the database, so
   * flipping the flag in devtools changes the buttons and nothing else.
   */
  function fetchProfile() {
    if (!isConfigured()) {
      return Promise.reject(new Error('Supabase is not configured'));
    }

    var auth = global.BlueJAuth;
    if (!auth) { return Promise.reject(new Error('Not signed in')); }

    // Refresh first, so the id is read from a token that has not expired.
    return auth.token().then(function () {
      var me = auth.user();
      if (!me || !me.id) { throw new Error('Not signed in'); }

      // Asked for by id, never "whichever row comes back first". An admin
      // may read every profile, so an unfiltered LIMIT 1 returns a stranger's
      // row — and reading is_admin off it says the admin is not one. The
      // more rights the account has, the more wrong the answer gets.
      return get(encodeURIComponent(cfg.supabaseTable) +
        '_profiles?select=id,email,name,avatar_url,is_admin' +
        '&id=eq.' + encodeURIComponent(me.id) + '&limit=1')
        .then(function (rows) {
          var profile = (rows || [])[0] || null;
          // The filter should make this impossible; checked anyway, because
          // acting on someone else's row is the failure that just happened.
          if (profile && profile.id !== me.id) {
            throw new Error('Supabase returned a different account’s profile');
          }
          return profile;
        });
    });
  }

  global.BlueJSupabase = {
    fetchProfile: fetchProfile,
    isConfigured: isConfigured,
    fetchLinks: fetchLinks,
    fetchNews: fetchNews,
    fetchAccounts: fetchAccounts,
    setBan: setBan,
    fetchReports: fetchReports,
    fetchSuggestions: fetchSuggestions,
    saveNews: saveNews,
    deleteNews: deleteNews,
    resolveSuggestion: resolveSuggestion,
    fetchRecentAdditions: fetchRecentAdditions,
    reportIssue: reportIssue,
    suggestCategory: suggestCategory,
    hostLabel: hostLabel,
    nameKey: nameKey,
    REVIEW_LABEL: REVIEW_LABEL
  };
})(window);
