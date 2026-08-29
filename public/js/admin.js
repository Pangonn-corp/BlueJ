/* ==========================================================================
   Admin — metrics, discovery trend, reports and category suggestions.

   Two gates, and they are not the same gate. This file checks is_admin so a
   non-admin is not shown the page; the database checks it again on every
   read and every write, because this check runs in a browser the visitor
   controls. Editing it out reveals an empty shell and nothing else.
   ========================================================================== */
BlueJ.ready().then(function () {
  'use strict';

  var B = window.BlueJ;
  var $ = B.$, el = B.el;

  if (!B.requireSession('index.html')) { return; }

  var cfg = window.BlueJConfig || {};
  var TABLE = cfg.supabaseTable || 'links';

  var state = { trendDays: 30, daily: [], links: [] };

  /* --- Fetch ---------------------------------------------------------------- */

  /**
   * `apikey` names the project, the bearer names the person. Since accounts
   * landed, `anon` is granted nothing, so the token is what makes any of
   * this readable — and its absence is what makes it stop.
   */
  function authHeaders(extra) {
    var auth = window.BlueJAuth;
    return (auth ? auth.token() : Promise.resolve('')).then(function (token) {
      var h = { apikey: cfg.supabasePublishableKey };
      if (token) { h.Authorization = 'Bearer ' + token; }
      return Object.assign(h, extra || {});
    });
  }

  function get(pathAndQuery) {
    var url = cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + pathAndQuery;
    return authHeaders().then(function (h) {
      return fetch(url, { headers: h });
    }).then(function (response) {
        if (response.ok) { return response.json(); }
        return response.text().then(function (body) {
          var payload = null;
          try { payload = JSON.parse(body); } catch (e) { payload = null; }
          var err = new Error((payload || {}).message || ('HTTP ' + response.status));
          err.status = response.status;
          err.missing = response.status === 404;
          // 42703 is "column does not exist" — an older schema, not a fault.
          err.undefinedColumn = (payload || {}).code === '42703';
          throw err;
        });
      });
  }

  /**
   * Count matching rows without transferring them: PostgREST reports the
   * total in Content-Range when asked for an exact count, so `Range: 0-0`
   * costs one row. This counts the table itself rather than trusting
   * links_totals, which is only as current as the trigger that fills it.
   */
  function count(filter) {
    var url = cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + TABLE +
              '?select=url' + (filter ? '&' + filter : '');
    return authHeaders({ Prefer: 'count=exact', Range: '0-0' }).then(function (h) {
      return fetch(url, { headers: h });
    }).then(function (response) {
      if (!response.ok) { return null; }
      var range = response.headers.get('content-range') || '';
      var total = range.split('/')[1];
      return total && total !== '*' ? Number(total) : null;
    }).catch(function () { return null; });
  }

  var DAY = 86400000;
  function since(days) {
    return 'created_at=gte.' + new Date(Date.now() - days * DAY).toISOString();
  }

  /** The numbers links_stats would report, counted directly from the table. */
  function countStats() {
    return Promise.all([
      count(''),
      count('status=eq.working'),
      count('status=eq.unstable'),
      count('status=eq.down'),
      count('status=eq.untested'),
      count('needs_review=is.true'),
      count(since(7)),
      count(since(30))
    ]).then(function (n) {
      if (n[0] === null) { return null; }
      return {
        total: n[0], working: n[1], unstable: n[2], down: n[3], untested: n[4],
        needs_review: n[5], added_7d: n[6], added_30d: n[7],
        last_seen: null, derived: true
      };
    });
  }

  /**
   * Whether the current schema is applied, decided by asking for a column
   * the page must never be able to read.
   *
   * With the grants in place the database refuses `reported_by` outright, so
   * a 403 is proof of two things at once: the schema is current, and the
   * reporter's address is unreadable. A 200 means the grants are missing —
   * and then an empty reports list is ambiguous, because row-level security
   * hides rows by returning an empty array rather than an error.
   */
  function grantsApplied() {
    return get(TABLE + '_reports?select=reported_by&limit=1')
      .then(function () { return false; })
      .catch(function (err) { return err.status === 403 || err.status === 401; });
  }

  /**
   * Suggestions still awaiting a decision.
   *
   * `resolution` only exists once the current schema is applied. Against an
   * older database the column is asked for, refused, and dropped from the
   * query — everything then counts as pending, which is exactly what it was
   * before decisions existed.
   */
  function fetchPendingSuggestions() {
    var base = TABLE + '_category_suggestions' +
               '?select=id,url,current_name,suggested_name,created_at';
    var tail = '&order=created_at.desc&limit=500';

    return get(base + ',resolution&resolution=is.null' + tail)
      .catch(function (err) {
        if (err.missing) { return null; }
        if (!err.undefinedColumn) { throw err; }
        return get(base + tail);
      })
      .catch(function (err) {
        if (!err.missing) { console.warn('admin: suggestions — ' + err.message); }
        return null;
      });
  }

  /** A view that has not been created yet must not take the page down. */
  function optional(path, fallback) {
    return get(path).catch(function (err) {
      if (err.missing) { return fallback; }
      console.warn('admin: ' + path + ' — ' + err.message);
      return fallback;
    });
  }

  function setBadge(text, variant) {
    var badge = $('#data-source');
    badge.textContent = text;
    badge.className = 'source-badge' + (variant ? ' source-badge--' + variant : '');
    badge.hidden = false;
  }

  function load() {
    if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) {
      setBadge('Supabase not configured — set js/config.js', 'warn');
      return Promise.resolve(null);
    }

    setBadge('Loading…');
    return Promise.all([
      optional(TABLE + '_stats?select=*', []),
      optional(TABLE + '_daily?select=*', []),
      optional(TABLE + '_totals?select=display_name,total,name_key&order=total.desc', []),
      // Straight from the tables the Links page writes to. `reported_by` is
      // never requested, and the browser role holds no grant on it anyway.
      optional(TABLE + '_reports?select=id,url,issue,at_home,created_at' +
                       '&order=created_at.desc&limit=500', null),
      fetchPendingSuggestions(),
      optional(TABLE + '_news?select=id,title,body,pinned,published_at' +
                       '&order=pinned.desc,published_at.desc&limit=20', null),
      grantsApplied(),
      optional(TABLE + '_accounts?select=*&order=created_at.asc', null)
    ]).then(function (parts) {
      var stats = (parts[0] || [])[0] || null;
      // No stats view yet — count the rows instead of summing the totals
      // table, which misses anything the trigger has not bucketed.
      if (stats) { return { stats: stats, parts: parts }; }
      return countStats().then(function (counted) {
        return { stats: counted, parts: parts };
      });
    }).then(function (r) {
      var parts = r.parts;
      var reports = parts[3];
      var suggestions = parts[4];

      // Only the links that were actually reported on, so the join stays
      // small however big the table gets.
      var urls = {};
      (reports || []).forEach(function (x) { urls[x.url] = true; });
      (suggestions || []).forEach(function (x) { urls[x.url] = true; });

      return fetchLinkDetails(Object.keys(urls)).then(function (byUrl) {
        return {
          stats: r.stats,
          daily: parts[1] || [],
          totals: parts[2] || [],
          reports: reports || [],
          suggestions: suggestions || [],
          reportSummary: summariseReports(reports || [], byUrl),
          suggestionSummary: summariseSuggestions(suggestions || [], byUrl),
          news: parts[5],                 // null when the table is absent
          // A missing table and an empty one mean different things: one needs
          // SQL run, the other means nobody has filed anything yet.
          reportsMissing: reports === null,
          suggestionsMissing: suggestions === null,
          // False means an empty list cannot be trusted: rows may exist and
          // be hidden, because the read policy is not in place.
          schemaCurrent: parts[6] === true,
          accounts: parts[7]              // null when the view is absent
        };
      });
    });
  }

  /* --- Aggregation ----------------------------------------------------------- */

  /** Names and statuses for a set of URLs, fetched in chunks so the query
      string cannot grow unbounded. */
  function fetchLinkDetails(urls) {
    var byUrl = {};
    if (!urls.length) { return Promise.resolve(byUrl); }

    var chunks = [];
    for (var i = 0; i < urls.length; i += 50) { chunks.push(urls.slice(i, i + 50)); }

    return Promise.all(chunks.map(function (chunk) {
      var list = chunk.map(function (u) {
        return '"' + String(u).replace(/"/g, '\\"') + '"';
      }).join(',');
      return optional(TABLE + '?select=url,name,status,needs_review&url=in.(' +
                      encodeURIComponent(list) + ')', []);
    })).then(function (groups) {
      groups.forEach(function (rows) {
        (rows || []).forEach(function (row) { byUrl[row.url] = row; });
      });
      return byUrl;
    });
  }

  /** Fold names the way the database does, so "Study Hub" and "studyhub"
      count as agreement rather than two competing suggestions. */
  function nameKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'unknown';
  }

  function summariseReports(rows, byUrl) {
    var map = {};
    rows.forEach(function (r) {
      var e = map[r.url];
      if (!e) {
        e = map[r.url] = { url: r.url, reports: 0, doesnt_load: 0, blocked: 0,
                           at_home: 0, away: 0, last_report: null };
      }
      e.reports += 1;
      if (r.issue === 'doesnt_load') { e.doesnt_load += 1; }
      if (r.issue === 'blocked') { e.blocked += 1; }
      if (r.at_home) { e.at_home += 1; } else { e.away += 1; }
      if (!e.last_report || r.created_at > e.last_report) { e.last_report = r.created_at; }
    });

    return Object.keys(map).map(function (url) {
      var e = map[url], link = byUrl[url] || {};
      e.name = link.name;
      e.status = link.status;
      return e;
    }).sort(function (a, b) { return b.reports - a.reports; });
  }

  function summariseSuggestions(rows, byUrl) {
    var map = {};
    rows.forEach(function (s) {
      var key = s.url + ' ' + nameKey(s.suggested_name);
      var e = map[key];
      if (!e) {
        e = map[key] = { url: s.url, suggested_name: s.suggested_name,
                         votes: 0, last_suggested: null };
      }
      e.votes += 1;
      if (!e.last_suggested || s.created_at > e.last_suggested) {
        e.last_suggested = s.created_at;
        e.suggested_name = s.suggested_name;   // keep the most recent spelling
      }
    });

    return Object.keys(map).map(function (key) {
      var e = map[key], link = byUrl[e.url] || {};
      e.current_name = link.name;
      e.needs_review = link.needs_review;
      return e;
    }).sort(function (a, b) { return b.votes - a.votes; });
  }

  /* --- Formatting ------------------------------------------------------------ */

  function num(value) {
    return (value === null || value === undefined) ? '—' : Number(value).toLocaleString();
  }

  function pct(part, whole) {
    if (!whole) { return '0%'; }
    return Math.round((part / whole) * 100) + '%';
  }

  function ago(iso) {
    if (!iso) { return ''; }
    var then = new Date(iso).getTime();
    if (isNaN(then)) { return ''; }
    var mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) { return 'just now'; }
    if (mins < 60) { return mins + 'm ago'; }
    var hours = Math.round(mins / 60);
    if (hours < 24) { return hours + 'h ago'; }
    var days = Math.round(hours / 24);
    if (days < 31) { return days + 'd ago'; }
    return new Date(iso).toLocaleDateString();
  }

  function host(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch (e) { return url || ''; }
  }

  /* --- Stat tiles ------------------------------------------------------------ */

  function tile(label, value, note, variant) {
    return el('div', { class: 'stat' + (variant ? ' stat--' + variant : '') }, [
      el('span', { class: 'stat__label', text: label }),
      el('span', { class: 'stat__value', text: value }),
      note ? el('span', { class: 'stat__note', text: note }) : null
    ]);
  }

  function renderStats(d) {
    var box = $('#stats');
    box.textContent = '';

    var s = d.stats;
    // Without the stats view, derive what we can from the totals instead.
    var total = s ? s.total : d.totals.reduce(function (n, t) { return n + t.total; }, 0);
    var review = s ? s.needs_review
                   : (d.totals.filter(function (t) { return t.name_key === '__review__'; })[0] || {}).total || 0;
    var providers = d.totals.filter(function (t) { return t.name_key !== '__review__'; }).length;

    box.appendChild(tile('Total links', num(total),
      s && s.last_seen ? 'newest ' + ago(s.last_seen) : null));

    box.appendChild(tile('Working', num(s ? s.working : null),
      s ? pct(s.working, s.total) + ' of all links' : null, 'ok'));

    box.appendChild(tile('Down / unstable',
      s ? num((s.down || 0) + (s.unstable || 0)) : '—',
      s ? num(s.down) + ' down · ' + num(s.unstable) + ' unstable' : null, 'warn'));

    box.appendChild(tile('Needs review', num(review),
      total ? pct(review, total) + ' unnamed' : null, review ? 'warn' : null));

    box.appendChild(tile('Providers', num(providers),
      d.totals.length ? 'top: ' + (d.totals[0] || {}).display_name : null));

    box.appendChild(tile('Added this week', s ? num(s.added_7d) : '—',
      s ? num(s.added_30d) + ' in 30 days' : null, 'accent'));

    box.appendChild(tile('Open reports', num(d.reportSummary.length),
      d.reports.length ? 'latest ' + ago(d.reports[0].created_at) : 'none filed'));

    box.appendChild(tile('Suggestions', num(d.suggestionSummary.length),
      d.suggestions.length ? 'latest ' + ago(d.suggestions[0].created_at) : 'none filed'));
  }

  /* --- Trend ----------------------------------------------------------------- */

  function renderTrend() {
    var box = $('#trend');
    box.textContent = '';

    var days = state.trendDays;
    var cutoff = Date.now() - days * 86400000;

    // Fill every day in the window so gaps read as gaps, not as missing bars.
    var byDay = {};
    state.daily.forEach(function (row) {
      byDay[row.day] = row.added;
    });

    var buckets = [];
    for (var i = days - 1; i >= 0; i--) {
      var date = new Date(Date.now() - i * 86400000);
      var key = date.toISOString().slice(0, 10);
      buckets.push({ day: key, added: byDay[key] || 0, date: date });
    }

    var withinWindow = state.daily.filter(function (r) {
      return new Date(r.day).getTime() >= cutoff;
    });
    if (!withinWindow.length) {
      box.appendChild(el('p', { class: 'empty-state',
        text: 'No links recorded in this window.' }));
      return;
    }

    var max = buckets.reduce(function (m, b) { return Math.max(m, b.added); }, 0) || 1;
    var total = buckets.reduce(function (n, b) { return n + b.added; }, 0);

    var chart = el('div', { class: 'trend__bars' });
    buckets.forEach(function (bucket) {
      var bar = el('span', { class: 'trend__bar' + (bucket.added ? '' : ' is-empty') });
      bar.style.height = bucket.added ? Math.max(2, (bucket.added / max) * 100) + '%' : '2px';
      chart.appendChild(el('div', {
        class: 'trend__slot',
        title: bucket.day + ': ' + bucket.added + ' link' + (bucket.added === 1 ? '' : 's')
      }, [bar]));
    });

    box.appendChild(chart);
    box.appendChild(el('div', { class: 'trend__axis' }, [
      el('span', { text: buckets[0].day }),
      el('span', { class: 'trend__total',
        text: num(total) + ' links · peak ' + num(max) + '/day' }),
      el('span', { text: buckets[buckets.length - 1].day })
    ]));
  }

  /* --- Status split ---------------------------------------------------------- */

  var STATUS_META = {
    working: { label: 'Working', className: 'badge--working' },
    unstable: { label: 'Unstable', className: 'badge--unstable' },
    down: { label: 'Down', className: 'badge--down' },
    untested: { label: 'Untested', className: 'badge--untested' }
  };

  function renderStatus(d) {
    var box = $('#status-split');
    box.textContent = '';

    var s = d.stats;
    if (!s) {
      box.appendChild(el('p', { class: 'empty-state', text: 'Stats view not available.' }));
      return;
    }

    ['working', 'unstable', 'down', 'untested'].forEach(function (key) {
      var meta = STATUS_META[key];
      var count = s[key] || 0;
      var row = el('div', { class: 'split' }, [
        el('span', { class: 'badge ' + meta.className, text: meta.label }),
        el('span', { class: 'split__track' }, [
          (function () {
            var fill = el('span', { class: 'split__fill split__fill--' + key });
            fill.style.width = (s.total ? (count / s.total) * 100 : 0) + '%';
            return fill;
          })()
        ]),
        el('span', { class: 'split__value', text: num(count) }),
        el('span', { class: 'split__pct', text: pct(count, s.total) })
      ]);
      box.appendChild(row);
    });
  }

  /* --- Providers -------------------------------------------------------------- */

  function renderProviders(d) {
    var box = $('#providers');
    box.textContent = '';

    var providers = d.totals.filter(function (t) { return t.name_key !== '__review__'; });
    $('#provider-count').textContent = providers.length + ' total';

    if (!providers.length) {
      box.appendChild(el('p', { class: 'empty-state', text: 'No providers yet.' }));
      return;
    }

    var max = providers[0].total || 1;
    providers.slice(0, 12).forEach(function (p, i) {
      var fill = el('span', { class: 'rank__fill' });
      fill.style.width = (p.total / max) * 100 + '%';
      box.appendChild(el('li', { class: 'rank__row' }, [
        el('span', { class: 'rank__pos', text: String(i + 1) }),
        el('span', { class: 'rank__name', text: p.display_name }),
        el('span', { class: 'rank__track' }, [fill]),
        el('span', { class: 'rank__value', text: num(p.total) })
      ]));
    });
  }

  /* --- News ---------------------------------------------------------------------
     Posts are Markdown. BlueJMarkdown escapes the source before producing any
     markup, so rendering stored text cannot inject HTML.
     ------------------------------------------------------------------------------ */

  function renderNews(d) {
    var box = $('#news');
    box.textContent = '';

    if (d.news === null) {
      $('#news-note').textContent = 'table missing';
      $('#news-new').hidden = true;
      box.appendChild(el('p', { class: 'empty-state',
        text: 'No news table yet — run sql/schema.sql to create it.' }));
      return;
    }

    $('#news-new').hidden = false;
    var posts = d.news || [];
    $('#news-note').textContent = posts.length
      ? posts.length + ' post' + (posts.length === 1 ? '' : 's') : '';

    if (!posts.length) {
      box.appendChild(el('p', { class: 'empty-state',
        text: 'No posts yet. Use “New post” to write the first one.' }));
      return;
    }

    posts.forEach(function (post) {
      box.appendChild(el('article', {
        class: 'news-item' + (post.pinned ? ' news-item--pinned' : '')
      }, [
        el('header', { class: 'news-item__head' }, [
          el('h3', { class: 'news-item__title', text: post.title || 'Untitled' }),
          post.pinned ? el('span', { class: 'news-item__pin', text: 'Pinned' }) : null,
          el('span', { class: 'card__time', text: ago(post.published_at) }),
          el('span', { class: 'news-item__actions' }, [
            el('button', { class: 'chip chip--sm', type: 'button', text: 'Edit',
              onclick: function () { openEditor(post); } }),
            el('button', { class: 'chip chip--sm chip--danger', type: 'button', text: 'Delete',
              onclick: function () { removePost(post); } })
          ])
        ]),
        el('div', { class: 'md', html: window.BlueJMarkdown.render(post.body) })
      ]));
    });
  }

  /* --- Editing news ------------------------------------------------------------
     Writes are gated on the account, not on anything this page holds. The
     database functions ask is_admin, a column no browser role may write, so
     editing this file cannot grant the privilege — at most it shows buttons
     whose calls then fail.
     ------------------------------------------------------------------------------ */

  var editing = null;      // the post being edited, or null for a new one

  function openEditor(post) {
    editing = post || null;
    var form = $('#news-editor');
    form.hidden = false;
    $('#news-editor-title').textContent = post ? 'Edit post' : 'New post';
    $('#news-title').value = (post && post.title) || '';
    $('#news-body').value = (post && post.body) || '';
    $('#news-pinned').checked = !!(post && post.pinned);
    updatePreview();
    $('#news-title').focus();
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeEditor() {
    editing = null;
    $('#news-editor').hidden = true;
    $('#news-error').textContent = '';
  }

  function updatePreview() {
    $('#news-preview').innerHTML = window.BlueJMarkdown.render($('#news-body').value || '');
  }

  function savePost() {
    var body = $('#news-body').value;
    if (!body.trim()) {
      $('#news-error').textContent = 'Body cannot be empty.';
      return;
    }

    var button = $('#news-save');
    button.disabled = true;
    $('#news-error').textContent = '';

    window.BlueJSupabase.saveNews({
      id: editing ? editing.id : null,
      title: $('#news-title').value,
      body: body,
      pinned: $('#news-pinned').checked
    }).then(function () {
      closeEditor();
      return refresh();
    }).catch(function (err) {
      $('#news-error').textContent = err.message;
    }).then(function () {
      button.disabled = false;
    });
  }

  function removePost(post) {
    B.confirm({
      title: 'Delete “' + (post.title || 'this post') + '”?',
      body: 'The post is removed from the Links page. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true
    }).then(function (yes) {
      if (!yes) { return; }
      return window.BlueJSupabase.deleteNews(post.id).then(function () {
        return refresh();
      }).catch(function (err) {
        $('#news-note').textContent = err.message;
      });
    });
  }

  /* --- Accounts ----------------------------------------------------------------
     Everything the database keeps about an account. There is no password
     field to show: the hash stays in auth.users, which PostgREST does not
     expose, so nothing here could print it even by mistake.
     ------------------------------------------------------------------------------ */

  function renderAccounts(d) {
    var box = $('#accounts');
    box.textContent = '';

    if (d.accounts === null) {
      $('#account-note').textContent = 'view missing';
      box.appendChild(el('p', { class: 'empty-state', html:
        'No <code>' + TABLE + '_accounts</code> view yet — run ' +
        '<code>scraper/sql/schema.sql</code>.' }));
      return;
    }

    var rows = d.accounts || [];
    var admins = rows.filter(function (a) { return a.is_admin; }).length;
    $('#account-note').textContent = rows.length
      ? rows.length + ' account' + (rows.length === 1 ? '' : 's') +
        ' · ' + admins + ' admin' + (admins === 1 ? '' : 's')
      : '';

    if (!rows.length) {
      box.appendChild(el('p', { class: 'empty-state', html:
        'No accounts. Add one in Supabase → Authentication → Users, with ' +
        '“Auto Confirm User” ticked.' }));
      return;
    }

    var me = (window.BlueJAuth && window.BlueJAuth.user()) || {};

    rows.forEach(function (a) {
      var self = a.id === me.id;
      box.appendChild(el('article', {
        class: 'account' + (a.banned ? ' account--banned' : ''),
        'data-email': a.email || ''
      }, [
        el('div', { class: 'account__who' }, [
          el('span', { class: 'account__email', text: a.email || '(no email)' }),
          el('span', { class: 'account__name', text: a.name || '' })
        ]),
        el('div', { class: 'account__tags' }, [
          a.is_admin ? el('span', { class: 'badge badge--admin', text: 'Admin' }) : null,
          a.banned ? el('span', { class: 'badge badge--review', text: banLabel(a) }) : null,
          !a.confirmed ? el('span', { class: 'badge badge--type', text: 'Unconfirmed' }) : null,
          el('span', { class: 'badge badge--type', text: a.provider || 'email' })
        ]),
        el('dl', { class: 'account__stats' }, [
          stat('Sign-ins', num(a.sign_in_count)),
          stat('Last seen', a.last_sign_in_at ? ago(a.last_sign_in_at) : 'never'),
          stat('Joined', a.created_at ? ago(a.created_at) : '—'),
          stat('Reported', num(a.reports_filed)),
          stat('Suggested', num(a.suggestions_made))
        ]),
        banControls(a, self)
      ]));
    });
  }

  function stat(label, value) {
    return el('div', { class: 'account__stat' }, [
      el('dt', { text: label }),
      el('dd', { text: value })
    ]);
  }

  /* --- Banning -----------------------------------------------------------------
     Written to auth.users by a database function, so a banned account is
     refused at sign-in as well as losing its data access. The page cannot
     write the column itself; it asks, and the database decides.
     ------------------------------------------------------------------------------ */

  // Anything this far out was set as "until further notice", not as a date.
  var FOREVER = 3000;

  function indefinite(until) {
    return !!until && new Date(until).getFullYear() >= FOREVER;
  }

  function banLabel(a) {
    if (!a.banned) { return ''; }
    if (indefinite(a.banned_until)) { return 'Suspended'; }
    return a.banned_until ? 'Banned until ' + shortDate(a.banned_until) : 'Banned';
  }

  function shortDate(iso) {
    var when = new Date(iso);
    if (isNaN(when.getTime())) { return '?'; }
    return when.toLocaleDateString(undefined,
      { day: 'numeric', month: 'short', year: 'numeric' });
  }

  var DURATIONS = [
    { label: '1 day', days: 1 },
    { label: '7 days', days: 7 },
    { label: '30 days', days: 30 },
    { label: 'Until further notice', forever: true }
  ];

  function banControls(account, isSelf) {
    // Banning yourself cannot be undone from the page you just lost, so the
    // database refuses it and the page does not offer it.
    if (isSelf) {
      return el('div', { class: 'account__ban' }, [
        el('span', { class: 'account__ban-note', text: 'This is you' })
      ]);
    }

    if (account.banned) {
      return el('div', { class: 'account__ban' }, [
        el('span', { class: 'account__ban-note',
          text: indefinite(account.banned_until)
            ? 'Suspended until further notice'
            : 'Banned until ' + shortDate(account.banned_until) }),
        el('button', {
          class: 'chip chip--sm chip--accept', type: 'button', text: 'Lift ban',
          onclick: function (e) { decideBan(e, account, {}, 'Lift the ban on '); }
        })
      ]);
    }

    return el('div', { class: 'account__ban' }, [
      el('span', { class: 'account__ban-note', text: 'Ban for' }),
      el('div', { class: 'account__ban-actions' }, DURATIONS.map(function (d) {
        return el('button', {
          class: 'chip chip--sm' + (d.forever ? ' chip--danger' : ''),
          type: 'button', text: d.label,
          onclick: function (e) { decideBan(e, account, d, 'Ban '); }
        });
      }))
    ]);
  }

  function decideBan(event, account, choice, verb) {
    var card = event.target.closest('.account');
    var buttons = B.$$('.chip', card);

    var what = choice.forever ? 'until further notice'
             : choice.days ? 'for ' + choice.days + ' day' + (choice.days === 1 ? '' : 's')
             : '';
    var body = choice.days || choice.forever
      ? 'They will be signed out and unable to sign in again until it expires. ' +
        'Their account and data are kept.'
      : 'They will be able to sign in again straight away.';

    B.confirm({
      title: verb + host2(account.email) + (what ? ' ' + what : '') + '?',
      body: body,
      confirmLabel: choice.days || choice.forever ? 'Ban' : 'Lift ban',
      danger: !!(choice.days || choice.forever)
    }).then(function (yes) {
      if (!yes) { return; }

      buttons.forEach(function (b) { b.disabled = true; });
      card.classList.add('is-busy');

      return window.BlueJSupabase.setBan(account.email, choice).then(function (until) {
        B.toast(until ? 'Banned ' + account.email : 'Ban lifted for ' + account.email,
                until ? 'warn' : 'ok');
        return refresh();
      }).catch(function (err) {
        card.classList.remove('is-busy');
        buttons.forEach(function (b) { b.disabled = false; });
        B.toast(err.message, 'warn');
      });
    });
  }

  /** An email is not a URL, so host() would mangle it. */
  function host2(email) {
    return String(email || 'this account');
  }

  /* --- Report boxes ------------------------------------------------------------ */

  /** Said when a list is empty but cannot be trusted to be. */
  function emptyOrHidden(table) {
    return 'Nothing shown — but <code>' + table + '</code> has no read policy yet, ' +
           'so any rows in it are hidden rather than reported as an error.<br>' +
           'Run <code>scraper/sql/schema.sql</code>.';
  }

  function renderReports(d) {
    var box = $('#reports');
    box.textContent = '';

    var summary = d.reportSummary;
    $('#report-note').textContent = summary.length
      ? summary.length + ' link' + (summary.length === 1 ? '' : 's') + ' reported'
      : '';

    if (!summary.length) {
      box.appendChild(el('p', { class: 'empty-state',
        html: d.reportsMissing
          ? 'Cannot read <code>' + TABLE + '_reports</code> — run <code>scraper/sql/schema.sql</code> ' +
            'to grant the page read access.'
          : d.schemaCurrent
            ? 'No reports yet. They appear here when someone flags a link on the Links page.'
            : emptyOrHidden(TABLE + '_reports') }));
      return;
    }

    summary.forEach(function (r) {
      // Away-only failures point at a filter; failures at home point at the
      // site itself. Saying which is the whole reason the question is asked.
      var verdict, variant;
      if (r.at_home > 0 && r.away === 0) { verdict = 'Fails at home — likely dead'; variant = 'down'; }
      else if (r.away > 0 && r.at_home === 0) { verdict = 'Only away — likely filtered'; variant = 'warn'; }
      else { verdict = 'Fails in both places'; variant = 'down'; }

      box.appendChild(el('article', { class: 'card card--' + variant }, [
        el('header', { class: 'card__head' }, [
          el('a', { class: 'card__title', href: r.url, target: '_blank', rel: 'noopener',
            text: host(r.url) }),
          el('span', { class: 'card__count', text: num(r.reports) })
        ]),
        el('p', { class: 'card__verdict', text: verdict }),
        el('div', { class: 'card__facts' }, [
          fact("Doesn't load", r.doesnt_load),
          fact('Blocked', r.blocked),
          fact('At home', r.at_home),
          fact('Away', r.away)
        ]),
        el('footer', { class: 'card__foot' }, [
          el('span', { class: 'badge badge--type', text: r.name || 'Unnamed' }),
          el('span', { class: 'card__time', text: ago(r.last_report) })
        ])
      ]));
    });
  }

  function fact(label, value) {
    return el('span', { class: 'fact' + (value ? '' : ' is-zero') }, [
      el('span', { class: 'fact__value', text: num(value || 0) }),
      el('span', { class: 'fact__label', text: label })
    ]);
  }

  /* --- Suggestion boxes --------------------------------------------------------- */

  function renderSuggestions(d) {
    var box = $('#suggestions');
    box.textContent = '';

    var summary = d.suggestionSummary;
    $('#suggestion-note').textContent = summary.length
      ? summary.length + ' pending' : '';

    if (!summary.length) {
      box.appendChild(el('p', { class: 'empty-state',
        html: d.suggestionsMissing
          ? 'Cannot read <code>' + TABLE + '_category_suggestions</code> — run ' +
            '<code>scraper/sql/schema.sql</code> to grant the page read access.'
          : d.schemaCurrent
            ? 'No suggestions yet. They appear here when someone changes a category on the ' +
              'Links page.'
            : emptyOrHidden(TABLE + '_category_suggestions') }));
      return;
    }

    summary.forEach(function (s) {
      box.appendChild(el('article', {
        class: 'card' + (s.needs_review ? ' card--accent' : '')
      }, [
        el('header', { class: 'card__head' }, [
          el('a', { class: 'card__title', href: s.url, target: '_blank', rel: 'noopener',
            text: host(s.url) }),
          el('span', { class: 'card__count', text: num(s.votes) })
        ]),
        el('div', { class: 'card__change' }, [
          el('span', { class: 'badge badge--type', text: s.current_name || 'Unnamed' }),
          el('span', { class: 'card__arrow', text: '→' }),
          el('span', { class: 'badge badge--suggested', text: s.suggested_name })
        ]),
        el('footer', { class: 'card__foot' }, [
          el('span', { class: 'card__time',
            text: s.votes > 1 ? s.votes + ' people agree' : '1 suggestion' }),
          el('span', { class: 'card__time', text: ago(s.last_suggested) })
        ]),
        el('div', { class: 'card__actions' }, [
          el('button', { class: 'chip chip--sm chip--accept', type: 'button',
            text: 'Accept',
            title: 'Rename the link to “' + s.suggested_name + '” and clear its review flag',
            onclick: function (event) { decide(event, s, true); } }),
          el('button', { class: 'chip chip--sm chip--danger', type: 'button',
            text: 'Deny',
            title: 'Dismiss this suggestion and leave the link as it is',
            onclick: function (event) { decide(event, s, false); } })
        ])
      ]));
    });
  }

  /**
   * Accept or deny a suggestion.
   *
   * Accepting is a real edit — the link is renamed — so it asks first. The
   * card's buttons are disabled while the write is in flight, so a double
   * click cannot file the decision twice.
   */
  function decide(event, suggestion, accept) {
    var card = event.target.closest('.card');
    var buttons = B.$$('.chip', card);

    var asked = accept
      ? B.confirm({
          title: 'Rename ' + host(suggestion.url) + '?',
          body: 'It becomes “' + suggestion.suggested_name + '”, and every other ' +
                'pending suggestion for this link is settled at the same time.',
          confirmLabel: 'Rename'
        })
      : Promise.resolve(true);

    asked.then(function (yes) {
      if (!yes) { return; }

      buttons.forEach(function (b) { b.disabled = true; });
      card.classList.add('is-busy');

      return window.BlueJSupabase.resolveSuggestion(
          suggestion.url, suggestion.suggested_name, accept).then(function () {
        B.toast(accept ? 'Renamed to “' + suggestion.suggested_name + '”'
                       : 'Suggestion denied', accept ? 'ok' : null);
        return refresh();
      }).catch(function (err) {
        card.classList.remove('is-busy');
        buttons.forEach(function (b) { b.disabled = false; });
        B.toast(err.message, 'warn');
      });
    });
  }

  /* --- Go ------------------------------------------------------------------------ */

  /**
   * Standing warning when the page is open without a real session.
   */
  function renderBypass(d) {
    var host = $('#bypass');
    host.textContent = '';
    host.hidden = false;

    host.hidden = !host.firstChild;
  }

  function renderAll(d) {
    if (!d) { return; }
    state.daily = d.daily;
    renderBypass(d);
    renderStats(d);
    renderTrend();
    renderStatus(d);
    renderProviders(d);
    renderNews(d);
    renderAccounts(d);
    renderReports(d);
    renderSuggestions(d);

    var missing = [];
    if (!d.stats) { missing.push('stats'); }
    if (!d.daily.length) { missing.push('daily'); }
    // Worth saying first: it makes reports and suggestions look empty when
    // they are not, which is a wrong answer rather than a missing one.
    if (!d.schemaCurrent) {
      setBadge('Reports hidden by row-level security — run sql/schema.sql', 'warn');
    } else if (missing.length) {
      setBadge('Some views missing (' + missing.join(', ') + ') — run sql/schema.sql', 'warn');
    } else {
      setBadge('Live · ' + num(d.stats.total) + ' links', 'ok');
    }
  }

  function refresh() {
    return load().then(renderAll);
  }

  /**
   * Let admins in, and nobody else.
   *
   * Fails closed on purpose: anything other than a profile that plainly says
   * is_admin — a network error, no profile row, an accounts schema that was
   * never run — is refused. The alternative reading, "cannot tell, so allow",
   * is how a page ends up open to everyone the first time something breaks.
   *
   * Nothing is fetched until this resolves, so a refused visitor never even
   * causes a request for the data they may not have.
   */
  function requireAdmin() {
    var sb = window.BlueJSupabase;

    if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) {
      return Promise.resolve({ ok: false, why: 'Supabase is not configured in js/config.js.' });
    }
    if (window.BlueJAuth && !window.BlueJAuth.signedIn()) {
      return Promise.resolve({ ok: false, why: 'You are not signed in to Supabase.' });
    }

    return sb.fetchProfile().then(function (profile) {
      if (profile && profile.is_admin === true) { return { ok: true, profile: profile }; }
      return {
        ok: false,
        why: 'This account is not an admin.',
        who: (profile && profile.email) || (window.BlueJAuth && (window.BlueJAuth.user() || {}).email)
      };
    }).catch(function (err) {
      return {
        ok: false,
        why: err.missingTable
          ? 'No accounts table — run scraper/sql/schema.sql.'
          : ('Could not check this account: ' + err.message)
      };
    });
  }

  /** Replace the page with a refusal. No admin markup is left behind. */
  function refuse(result) {
    var root = document.querySelector('.admin');
    root.textContent = '';
    root.appendChild(el('div', { class: 'refusal' }, [
      el('h1', { class: 'refusal__title', text: 'Admins only' }),
      el('p', { class: 'refusal__body', text: result.why }),
      result.who ? el('p', { class: 'refusal__who', text: 'Signed in as ' + result.who }) : null,
      el('p', { class: 'refusal__body', html:
        'An admin can grant it from the Supabase SQL editor:<br>' +
        '<code>SELECT ' + TABLE + '_set_admin(\'' +
        (result.who || 'you@example.com') + '\', true);</code>' }),
      el('div', { class: 'refusal__actions' }, [
        el('a', { class: 'btn btn--sm', href: 'home.html', text: 'Back to home' }),
        el('a', { class: 'btn btn--sm btn--ghost', href: 'links.html', text: 'Links' })
      ])
    ]));
  }

  requireAdmin().then(function (result) {
    if (!result.ok) { return refuse(result); }

    $('#who').textContent = result.profile.email || '';
    refresh();
    wire();
  });

  /** Listeners are attached only once the page is known to belong here. */
  function wire() {
    $('#refresh').addEventListener('click', function () {
      var button = $('#refresh');
      button.disabled = true;
      refresh().then(function () { button.disabled = false; });
    });

    $('#news-new').addEventListener('click', function () { openEditor(null); });
    $('#news-cancel').addEventListener('click', closeEditor);
    $('#news-save').addEventListener('click', savePost);
    $('#news-body').addEventListener('input', updatePreview);

    B.$$('#trend-range .seg__btn').forEach(function (button) {
      button.addEventListener('click', function () {
        B.$$('#trend-range .seg__btn').forEach(function (b) { b.classList.remove('is-active'); });
        button.classList.add('is-active');
        state.trendDays = parseInt(button.dataset.days, 10) || 30;
        renderTrend();
      });
    });
  }
});
