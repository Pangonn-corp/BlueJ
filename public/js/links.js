/* ==========================================================================
   Links dashboard — bar chart, news/update cards, filterable result rows.
   Filtering the rows also highlights the matching bars in the rail.
   ========================================================================== */
BlueJ.ready().then(function () {
  'use strict';

  var B = window.BlueJ;
  var data = window.BlueJData;
  var $ = B.$, el = B.el;

  if (!B.requireSession('index.html')) { return; }

  var state = { status: 'all', type: 'all', query: '' };

  /* --- Data source ---------------------------------------------------------
     Live rows from Supabase when it is configured, otherwise the sample data
     in data.js so the page is never blank. `live` holds whichever won, and
     everything below reads from it rather than from data.js directly.
     ------------------------------------------------------------------------ */

  var REVIEW = '__review__';

  function fold(name) {
    return window.BlueJSupabase
      ? window.BlueJSupabase.nameKey(name)
      : String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  // Give the bundled sample data the same shape the live rows arrive in, so
  // everything downstream has one case to handle.
  var live = {
    links: data.links.map(function (l) {
      return {
        name: l.name, url: l.url, status: l.status, type: l.type,
        key: fold(l.type), review: false
      };
    }),
    providers: data.providers.map(function (p) {
      return { name: p.name, count: p.count, key: fold(p.name) };
    }),
    review: 0,
    source: 'sample'
  };

  function setSourceBadge(text, variant) {
    var badge = $('#data-source');
    if (!badge) { return; }
    badge.textContent = text;
    badge.className = 'source-badge' + (variant ? ' source-badge--' + variant : '');
    badge.hidden = false;
  }

  function loadLive() {
    var sb = window.BlueJSupabase;

    if (!sb || !sb.isConfigured()) {
      setSourceBadge('Sample data — set supabasePublishableKey in js/config.js', 'warn');
      return Promise.resolve();
    }

    setSourceBadge('Loading…', null);
    return sb.fetchLinks()
      .then(function (result) {
        if (!result.links.length) {
          setSourceBadge('Connected — table is empty, run the scraper', 'warn');
          return;
        }
        live = result;
        setSourceBadge('Live · ' + result.links.length + ' links', 'ok');
      })
      .catch(function (err) {
        // Falling back is better than an empty page; say why.
        setSourceBadge('Sample data — ' + err.message, 'warn');
      });
  }

  /* --- News + update cards --------------------------------------------------
     Both come from Supabase when it is reachable: news from the `_news`
     table (Markdown), additions from the `_recent_additions` view. The
     sample copy in data.js is only the offline fallback.
     ------------------------------------------------------------------------- */

  function renderNewsFallback() {
    $('#news-date').textContent = data.news.date;
    $('#news-body').textContent = data.news.body;
  }

  function renderUpdatesFallback() {
    var list = $('#update-list');
    list.textContent = '';
    data.updates.forEach(function (item) {
      list.appendChild(el('li', { class: 'update__row' }, [
        el('span', { class: 'update__delta', text: '+' + item.delta }),
        el('span', { text: item.name })
      ]));
    });
    var total = data.updates.reduce(function (sum, item) { return sum + item.delta; }, 0);
    $('#update-total').textContent = 'Total: +' + total;
  }

  function renderNews(posts) {
    var body = $('#news-body');
    var latest = posts[0];

    $('#news-date').textContent = latest.published_at
      ? new Date(latest.published_at).toLocaleDateString()
      : '';

    body.textContent = '';
    body.classList.add('md');

    if (latest.title) {
      body.appendChild(el('h3', { class: 'news__title', text: latest.title }));
    }
    // Safe: the renderer escapes the source before producing any markup.
    body.appendChild(el('div', { html: window.BlueJMarkdown.render(latest.body) }));

    if (posts.length > 1) {
      body.appendChild(el('p', { class: 'news__more',
        text: '+ ' + (posts.length - 1) + ' earlier post' + (posts.length > 2 ? 's' : '') }));
    }
  }

  function renderUpdates(rows) {
    var list = $('#update-list');
    list.textContent = '';

    if (!rows.length) {
      list.appendChild(el('li', { class: 'update__row', text: 'Nothing new this week.' }));
      $('#update-total').textContent = '';
      return;
    }

    rows.slice(0, 6).forEach(function (row) {
      list.appendChild(el('li', { class: 'update__row' }, [
        el('span', { class: 'update__delta', text: '+' + row.added }),
        el('span', { text: row.name || 'Unknown' })
      ]));
    });

    var total = rows.reduce(function (sum, row) { return sum + row.added; }, 0);
    $('#update-total').textContent = 'Total: +' + total;
  }

  function loadCards() {
    var sb = window.BlueJSupabase;
    if (!sb || !sb.isConfigured()) {
      renderNewsFallback();
      renderUpdatesFallback();
      return;
    }

    sb.fetchNews(10)
      .then(function (posts) {
        if (posts && posts.length) { renderNews(posts); }
        else { renderNewsFallback(); }
      })
      .catch(renderNewsFallback);

    sb.fetchRecentAdditions()
      .then(function (rows) {
        if (rows && rows.length) { renderUpdates(rows); }
        else { renderUpdatesFallback(); }
      })
      .catch(renderUpdatesFallback);
  }

  loadCards();

  /* --- Bar chart ----------------------------------------------------------- */

  var chart = $('#chart');
  var chartRows = {};

  function renderChart() {
    chart.textContent = '';

    var grid = el('div', { class: 'chart__grid', 'aria-hidden': 'true' });
    for (var i = 0; i < 5; i++) { grid.appendChild(el('div', { class: 'chart__gridline' })); }
    chart.appendChild(grid);

    // Scale against the largest real provider, not the largest bar. The
    // review bucket collects every unnamed link, so it dwarfs everything —
    // at 1178 vs 134 it pinned Space to 11% and the rest under 5%, which
    // told you nothing. It is clamped to full width instead.
    var providers = live.providers.filter(function (p) { return !p.review; });
    var max = providers.reduce(function (m, p) { return Math.max(m, p.count); }, 0) ||
              live.providers.reduce(function (m, p) { return Math.max(m, p.count); }, 0) || 1;

    var sorted = live.providers.slice().sort(function (a, b) {
      if (a.review !== b.review) { return a.review ? 1 : -1; }
      return b.count - a.count;
    });

    sorted.forEach(function (provider, index) {
      var bar = el('span', { class: 'chart__bar' });
      // Anything at or above the largest provider fills the track.
      bar.style.width = Math.max(2, Math.min(100, (provider.count / max) * 100)) + '%';
      bar.style.maxWidth = 'calc(100% - 32px)';
      bar.style.animationDelay = (index * 40) + 'ms';

      var row = el('div', {
        class: 'chart__row' + (provider.review ? ' chart__row--review' : '')
      }, [
        el('span', { class: 'chart__label', text: provider.name }),
        bar,
        el('span', { class: 'chart__value', text: String(provider.count) })
      ]);

      chartRows[provider.review ? REVIEW : provider.key] = row;
      chart.appendChild(row);
    });
  }

  /** Dim the providers the current filter excludes. */
  function syncChart(visibleKeys) {
    var filtering = visibleKeys.length !== live.providers.length;
    Object.keys(chartRows).forEach(function (key) {
      var row = chartRows[key];
      var matches = visibleKeys.indexOf(key) !== -1;
      row.classList.toggle('is-dimmed', filtering && !matches);
      row.classList.toggle('is-match', filtering && matches);
    });
  }

  /* --- Result rows --------------------------------------------------------- */

  var results = $('#results');
  var countEl = $('#result-count');

  function statusOf(key) {
    return data.statuses[key] || { label: key, className: '' };
  }

  function visibleLinks() {
    var query = state.query.trim().toLowerCase();
    return live.links.filter(function (link) {
      if (state.status !== 'all' && link.status !== state.status) { return false; }
      if (state.type === REVIEW) {
        if (!link.review) { return false; }
      } else if (state.type !== 'all' && link.key !== state.type) {
        // Compared on the folded key, so picking "Space" also catches "space".
        return false;
      }
      if (query && link.name.toLowerCase().indexOf(query) === -1
                && link.type.toLowerCase().indexOf(query) === -1) { return false; }
      return true;
    });
  }

  function renderResults() {
    var links = visibleLinks();
    results.textContent = '';

    if (!links.length) {
      results.appendChild(el('p', { class: 'empty-state', text: 'No links match those filters.' }));
    } else {
      links.forEach(function (link) {
        var status = statusOf(link.status);

        // The row is a div, not an anchor: a <button> inside an <a> is invalid
        // HTML. The anchor stretches across the row through ::after, so a
        // click anywhere still opens the link, while the report button sits
        // above that overlay and stays independently clickable.
        results.appendChild(el('div', {
          class: 'result' + (link.review ? ' result--review' : '')
        }, [
          el('a', {
            class: 'result__link',
            href: link.url,
            target: '_blank',
            rel: 'noopener',
            title: link.review
              ? 'Name needs re-examination — ' + link.url
              : 'Open ' + link.url
          }, [
            el('span', { class: 'result__name', text: link.name })
          ]),
          // The pills are the controls. They already say what they mean, so
          // hanging the action off each one is less to look at than a pair of
          // icon buttons and puts the target where the eye already is.
          el('button', {
            class: 'badge badge--action ' + status.className,
            type: 'button',
            text: status.label,
            title: 'Status: ' + status.label + ' — click to report a problem',
            'aria-label': 'Report a problem with ' + link.name +
                          ', currently ' + status.label,
            onclick: function (e) {
              e.preventDefault();
              e.stopPropagation();
              openReport(link);
            }
          }),
          el('button', {
            class: 'badge badge--type badge--action' + (link.review ? ' badge--review' : ''),
            type: 'button',
            text: link.type,
            title: link.review
              ? 'No trusted category — click to suggest one'
              : 'Category: ' + link.type + ' — click to change it',
            'aria-label': 'Change the category of ' + link.name +
                          (link.review ? '' : ', currently ' + link.type),
            onclick: function (e) {
              e.preventDefault();
              e.stopPropagation();
              openCategory(link);
            }
          }),
          el('span', { class: 'result__spacer' })
        ]));
      });
    }

    countEl.textContent = links.length + ' of ' + live.links.length;

    // Which providers survive the filter — drives the chart highlight.
    var keys = [];
    links.forEach(function (link) {
      var key = link.review ? REVIEW : link.key;
      if (keys.indexOf(key) === -1) { keys.push(key); }
    });
    syncChart(keys);
  }

  /* --- Report a problem -----------------------------------------------------
     Two questions, because one alone is ambiguous. "Doesn't load" away from
     home usually means a filter caught it and the site is fine; the same
     answer at home means the site is actually gone. The pair is what makes a
     report worth acting on.
     ------------------------------------------------------------------------- */

  var ISSUES = [
    { value: 'doesnt_load', label: "Doesn't load", hint: 'Blank page, error, or times out' },
    { value: 'blocked', label: 'Blocked', hint: 'A filter or block page appeared' }
  ];

  var PLACES = [
    { value: true, label: 'At home', hint: 'On your own network' },
    { value: false, label: 'Somewhere else', hint: 'School, work, or public Wi-Fi' }
  ];

  function openReport(link) {
    var sb = window.BlueJSupabase;
    if (!sb || !sb.isConfigured()) {
      B.toast('Reports need Supabase configured in js/config.js', 'error');
      return;
    }

    var chosenIssue = null;

    var title = el('h2', { class: 'dialog__title', text: 'Report a problem' });
    var subtitle = el('p', { class: 'report__url', text: link.name });
    var question = el('p', { class: 'report__question' });
    var choices = el('div', { class: 'report__choices' });
    var back = el('button', {
      class: 'btn btn--sm btn--ghost', type: 'button', text: 'Back', hidden: true,
      onclick: function () { step1(); }
    });
    var cancel = el('button', {
      class: 'btn btn--sm btn--ghost', type: 'button', text: 'Cancel',
      onclick: function () { close(); }
    });

    function renderChoices(options, onPick) {
      choices.textContent = '';
      options.forEach(function (option) {
        choices.appendChild(el('button', {
          class: 'report__choice',
          type: 'button',
          onclick: function () { onPick(option.value); }
        }, [
          el('span', { class: 'report__choice-label', text: option.label }),
          el('span', { class: 'report__choice-hint', text: option.hint })
        ]));
      });
    }

    function step1() {
      question.textContent = "What's happening?";
      back.hidden = true;
      renderChoices(ISSUES, function (value) {
        chosenIssue = value;
        step2();
      });
    }

    function step2() {
      question.textContent = 'Where were you when it failed?';
      back.hidden = false;
      renderChoices(PLACES, submit);
    }

    function submit(atHome) {
      choices.textContent = '';
      question.textContent = 'Sending…';
      back.hidden = true;

      var session = B.Session.get();
      sb.reportIssue(link.url, chosenIssue, atHome, session && session.email)
        .then(function () {
          close();
          B.toast('Thanks — report filed for ' + link.name);
        })
        .catch(function (err) {
          close();
          B.toast(err.message, 'error');
        });
    }

    var panel = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, [
      title, subtitle, question, choices,
      el('div', { class: 'dialog__actions' }, [back, cancel])
    ]);
    var backdrop = el('div', { class: 'dialog-backdrop' }, [panel]);

    backdrop.addEventListener('mousedown', function (e) {
      if (e.target === backdrop) { close(); }
    });

    function onKey(e) { if (e.key === 'Escape') { close(); } }

    function close() {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
    }

    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    step1();
    var first = choices.querySelector('.report__choice');
    if (first) { first.focus(); }
  }

  /* --- Suggest a category ---------------------------------------------------
     The extractor cannot name every link — some posts state no provider at
     all — so this is the way a person puts one right. Suggestions are stored
     rather than applied directly, so agreement accumulates as votes instead
     of the last click winning.
     ------------------------------------------------------------------------- */

  function openCategory(link) {
    var sb = window.BlueJSupabase;
    if (!sb || !sb.isConfigured()) {
      B.toast('Suggestions need Supabase configured in js/config.js', 'error');
      return;
    }

    var current = link.review ? '' : link.type;

    // Existing providers, biggest first, so the common answers are one click.
    var known = live.providers
      .filter(function (p) { return !p.review; })
      .map(function (p) { return p.name; });

    var listId = 'category-options';
    var datalist = el('datalist', { id: listId },
      known.map(function (n) { return el('option', { value: n }); }));

    var input = el('input', {
      class: 'field field--sm',
      type: 'text',
      list: listId,
      value: current,
      placeholder: 'e.g. Galaxy V7',
      'aria-label': 'Category',
      maxlength: '120'
    });

    var save = el('button', { class: 'btn btn--sm', type: 'submit', text: 'Suggest' });

    function sync() {
      var value = input.value.trim();
      save.disabled = !value || value === current;
    }
    input.addEventListener('input', sync);

    var quick = el('div', { class: 'category__quick' },
      known.slice(0, 6).map(function (name) {
        return el('button', {
          class: 'category__chip', type: 'button', text: name,
          onclick: function () { input.value = name; sync(); input.focus(); }
        });
      }));

    var form = el('form', { class: 'dialog__form' }, [
      el('label', { class: 'dialog__field' }, [
        el('span', { class: 'dialog__label', text: 'Category' }),
        input
      ]),
      datalist,
      known.length ? quick : null,
      el('div', { class: 'dialog__actions' }, [
        el('button', {
          class: 'btn btn--sm btn--ghost', type: 'button', text: 'Cancel',
          onclick: function () { close(); }
        }),
        save
      ])
    ]);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var value = input.value.trim();
      if (!value || value === current) { return; }

      save.disabled = true;
      save.textContent = 'Sending…';
      var session = B.Session.get();

      sb.suggestCategory(link.url, link.type, value, session && session.email)
        .then(function () {
          close();
          B.toast('Thanks — suggested "' + value + '" for ' + link.name);
        })
        .catch(function (err) {
          close();
          B.toast(err.message, 'error');
        });
    });

    var panel = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, [
      el('h2', { class: 'dialog__title', text: 'Change category' }),
      el('p', { class: 'report__url', text: link.name }),
      el('p', { class: 'report__question',
        text: current ? 'Currently listed under "' + current + '".'
                      : 'This link has no category yet.' }),
      form
    ]);
    var backdrop = el('div', { class: 'dialog-backdrop' }, [panel]);

    backdrop.addEventListener('mousedown', function (e) {
      if (e.target === backdrop) { close(); }
    });

    function onKey(e) { if (e.key === 'Escape') { close(); } }

    function close() {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
    }

    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    sync();
    input.focus();
    input.select();
  }

  /* --- Filter dropdowns ---------------------------------------------------- */

  function buildDropdown(button, labelEl, options, key, defaultLabel) {
    button.addEventListener('click', function () {
      if (button.getAttribute('aria-expanded') === 'true') { return; }

      var menu = el('div', { class: 'menu', role: 'menu' });

      // `options` may be a function so the list reflects the data currently
      // loaded rather than whatever existed when the page booted.
      var opts = typeof options === 'function' ? options() : options;

      opts.forEach(function (option) {
        menu.appendChild(el('button', {
          class: 'menu__item',
          type: 'button',
          role: 'menuitemradio',
          'aria-checked': String(state[key] === option.value),
          text: (state[key] === option.value ? '✓  ' : '  ') + option.label,
          onclick: function () {
            state[key] = option.value;
            labelEl.textContent = option.value === 'all'
              ? defaultLabel
              : (option.short || option.label);
            button.classList.toggle('is-active', option.value !== 'all');
            dismiss();
            renderResults();
          }
        }));
      });

      var rect = button.getBoundingClientRect();
      menu.style.left = (rect.left + window.scrollX) + 'px';
      menu.style.right = 'auto';
      document.body.appendChild(menu);
      // Height and vertical placement depend on the rendered size, so this
      // has to run after the menu is in the document.
      B.fitMenu(menu, button);
      button.setAttribute('aria-expanded', 'true');

      // The menu is positioned against the viewport, but the panel scrolls
      // underneath it — close it rather than let it float away from its chip.
      function onPanelScroll() { dismiss(); }
      var panel = $('.panel');
      if (panel) { panel.addEventListener('scroll', onPanelScroll); }

      var dismiss = B.dismissable(menu, function () {
        menu.remove();
        button.setAttribute('aria-expanded', 'false');
        if (panel) { panel.removeEventListener('scroll', onPanelScroll); }
      });
    });
  }

  var statusOptions = [{ value: 'all', label: 'All statuses' }].concat(
    Object.keys(data.statuses).map(function (key) {
      return { value: key, label: data.statuses[key].label };
    })
  );

  /* Providers, in the chart's order (most links first) rather than A-Z.
     Built after the data loads, since live rows decide what the options are. */
  function typeOptions() {
    return [{ value: 'all', label: 'All types' }].concat(
      live.providers.slice()
        .sort(function (a, b) { return b.count - a.count; })
        .map(function (p) {
          return {
            value: p.review ? REVIEW : p.key,
            label: p.name + '  (' + p.count + ')',
            short: p.name          // the chip stays narrow; the menu shows counts
          };
        })
    );
  }

  /* --- Search -------------------------------------------------------------- */

  var searchInput = $('#filter-search');
  searchInput.addEventListener('input', function () {
    state.query = searchInput.value;
    renderResults();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement === document.body) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  /* --- Go ------------------------------------------------------------------ */

  // Draw immediately from whatever `live` currently holds so the page is never
  // blank, then redraw once Supabase answers.
  function render() {
    renderChart();
    renderResults();
  }

  buildDropdown($('#filter-status'), $('#filter-status-label'), statusOptions, 'status', 'Status');
  buildDropdown($('#filter-type'), $('#filter-type-label'), typeOptions, 'type', 'Type');
  render();

  loadLive().then(function () {
    // A filter chosen against the sample data may not exist in the live set.
    var known = state.type === REVIEW || live.providers.some(function (p) {
      return (p.review ? REVIEW : p.key) === state.type;
    });
    if (state.type !== 'all' && !known) {
      state.type = 'all';
      $('#filter-type-label').textContent = 'Type';
      $('#filter-type').classList.remove('is-active');
    }
    chartRows = {};
    render();
  });

  var refresh = $('#refresh');
  if (refresh) {
    refresh.addEventListener('click', function () {
      refresh.disabled = true;
      loadLive().then(function () {
        chartRows = {};
        render();
        refresh.disabled = false;
      });
    });
  }
});
