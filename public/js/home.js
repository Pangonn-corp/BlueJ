/* ==========================================================================
   Home — search, shortcut tiles, apps launcher, profile menu, Customize panel
   ========================================================================== */
BlueJ.ready().then(function () {
  'use strict';

  var B = window.BlueJ;
  var D = window.BlueJData;
  var $ = B.$, el = B.el;

  var session = B.requireSession('index.html');
  if (!session) { return; }

  /* --- Profile -------------------------------------------------------------- */

  var pfp = $('#pfp');
  var drawerAvatar = $('#drawer-avatar');
  var nameInput = $('#drawer-name');
  var wallpaperPreview = $('#wallpaper-preview');
  var homeEl = $('#home');

  /* Without a supplied pfp.jpg the account button would be a featureless grey
     circle, which reads as decoration rather than a menu. Fall back to a
     person glyph so it is obviously an account control. */
  function personAvatar(size) {
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 40 40">' +
      '<rect width="40" height="40" rx="20" fill="#424242"/>' +
      '<circle cx="20" cy="15.5" r="6.2" fill="#b9b9b9"/>' +
      '<path d="M6.6 35a13.4 13.4 0 0 1 26.8 0z" fill="#b9b9b9"/></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function withPersonFallback(img, size) {
    var fallback = personAvatar(size);
    function apply() { if (img.src !== fallback) { img.src = fallback; } }
    img.addEventListener('error', apply);
    if (img.complete && img.naturalWidth === 0) { apply(); }
  }

  withPersonFallback(pfp, 40);
  withPersonFallback(drawerAvatar, 128);
  B.withFallback(wallpaperPreview, 'Wallpaper', 244, 162, 8);
  B.withFallback($('#logo-mark'), 'Logo', 100, 99, 0);

  function applyProfile(profile) {
    if (profile.avatar) {
      pfp.src = profile.avatar;
      drawerAvatar.src = profile.avatar;
    }
    if (nameInput.value !== profile.name) { nameInput.value = profile.name; }
    pfp.alt = profile.name;

    if (profile.wallpaper) {
      homeEl.style.backgroundImage = 'url("' + profile.wallpaper + '")';
      wallpaperPreview.src = profile.wallpaper;
    } else {
      homeEl.style.backgroundImage = '';
    }
  }

  applyProfile(B.Profile.get());
  B.on('profile', applyProfile);

  /* --- Search --------------------------------------------------------------- */

  var searchForm = $('#search-form');
  var queryInput = $('#q');
  var aiBtn = $('#ai-mode');

  function engine() { return D.engines[B.Prefs.get().engine] || D.engines.google; }
  function aiProvider() { return D.aiProviders[B.Prefs.get().ai] || D.aiProviders['google-ai']; }

  function syncSearchUi() {
    var prefs = B.Prefs.get();
    aiBtn.setAttribute('aria-pressed', String(prefs.aiMode));
    queryInput.placeholder = prefs.aiMode
      ? 'Ask ' + aiProvider().name
      : 'Ask ' + engine().name.toLowerCase();
  }

  aiBtn.addEventListener('click', function () {
    B.Prefs.set({ aiMode: !B.Prefs.get().aiMode });
    syncSearchUi();
    queryInput.focus();
  });

  function runSearch(query) {
    query = String(query || '').trim();
    if (!query) { return queryInput.focus(); }

    // A bare domain typed into the box should navigate, not search.
    if (/^(https?:\/\/|[\w-]+\.[a-z]{2,}(\/|$))/i.test(query)) {
      window.open(B.normalizeUrl(query), '_blank', 'noopener');
      return;
    }

    var target = B.Prefs.get().aiMode ? aiProvider() : engine();
    window.open(target.url.replace('%s', encodeURIComponent(query)), '_blank', 'noopener');
  }

  searchForm.addEventListener('submit', function (e) {
    e.preventDefault();
    closeSuggest();
    runSearch(queryInput.value);
  });

  syncSearchUi();
  B.on('prefs', syncSearchUi);

  /* --- Search suggestions ---------------------------------------------------
     Typeahead from the provider that matches the selected engine, so what is
     suggested lines up with where Enter will actually take you.
     ------------------------------------------------------------------------- */

  var searchBox = $('#searchbox');
  var suggestList = $('#suggest');
  var items = [];
  var activeIndex = -1;
  var debounce = null;
  var inflight = null;

  var LANG = (navigator.language || 'en').slice(0, 2);

  function suggestUrl(query) {
    return D.suggestApi
      .replace('%s', encodeURIComponent(query))
      .replace('%l', encodeURIComponent(LANG))
      .replace('%p', encodeURIComponent(engine().suggest || 'duckduckgo'));
  }

  function closeSuggest() {
    items = [];
    activeIndex = -1;
    suggestList.textContent = '';
    suggestList.hidden = true;
    searchBox.classList.remove('is-open');
    queryInput.setAttribute('aria-expanded', 'false');
    queryInput.removeAttribute('aria-activedescendant');
  }

  function renderSuggest() {
    suggestList.textContent = '';

    items.forEach(function (item, index) {
      var kids = [];

      if (item.image) {
        var thumb = el('img', { class: 'suggest__thumb', src: item.image, alt: '', loading: 'lazy' });
        thumb.addEventListener('error', function () { thumb.remove(); }, { once: true });
        kids.push(thumb);
      } else {
        kids.push(el('span', {
          class: 'suggest__icon',
          html: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7 1a6 6 0 1 1-3.8 10.7l-2 2a1 1 0 0 1-1.4-1.4l2-2A6 6 0 0 1 7 1zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" fill="currentColor"/></svg>'
        }));
      }

      kids.push(el('span', { class: 'suggest__text', text: item.text }));
      if (item.desc) { kids.push(el('span', { class: 'suggest__desc', text: item.desc })); }

      var li = el('li', {
        class: 'suggest__item' + (index === activeIndex ? ' is-active' : ''),
        id: 'suggest-' + index,
        role: 'option',
        'aria-selected': String(index === activeIndex),
        // mousedown would blur the input before click lands; take the action here.
        onmousedown: function (e) {
          e.preventDefault();
          queryInput.value = item.text;
          closeSuggest();
          runSearch(item.text);
        }
      }, kids);

      suggestList.appendChild(li);
    });

    var any = items.length > 0;
    suggestList.hidden = !any;
    searchBox.classList.toggle('is-open', any);
    queryInput.setAttribute('aria-expanded', String(any));
  }

  function fetchSuggest(query) {
    if (inflight) { inflight.abort(); }
    inflight = new AbortController();

    fetch(suggestUrl(query), { signal: inflight.signal })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (list) {
        // The box may have been cleared or changed while this was in flight.
        if (queryInput.value.trim() !== query) { return; }
        items = (Array.isArray(list) ? list : [])
          .filter(function (x) { return x && x.text; })
          .slice(0, 8);
        activeIndex = -1;
        renderSuggest();
      })
      .catch(function () { /* aborted or offline — leave the list as it is */ });
  }

  function moveActive(delta) {
    if (!items.length) { return; }
    activeIndex += delta;
    if (activeIndex < -1) { activeIndex = items.length - 1; }
    if (activeIndex >= items.length) { activeIndex = -1; }
    renderSuggest();
    if (activeIndex >= 0) {
      queryInput.setAttribute('aria-activedescendant', 'suggest-' + activeIndex);
    } else {
      queryInput.removeAttribute('aria-activedescendant');
    }
  }

  queryInput.addEventListener('input', function () {
    var query = queryInput.value.trim();
    clearTimeout(debounce);
    if (!query) { return closeSuggest(); }
    debounce = setTimeout(function () { fetchSuggest(query); }, 120);
  });

  queryInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
    else if (e.key === 'Escape') { closeSuggest(); }
    else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      var chosen = items[activeIndex];
      queryInput.value = chosen.text;
      closeSuggest();
      runSearch(chosen.text);
    }
  });

  queryInput.addEventListener('blur', function () { setTimeout(closeSuggest, 120); });
  queryInput.addEventListener('focus', function () {
    if (queryInput.value.trim()) { fetchSuggest(queryInput.value.trim()); }
  });

  /* A different engine means a different suggestion source. */
  B.on('prefs', function () {
    var query = queryInput.value.trim();
    if (query && document.activeElement === queryInput) { fetchSuggest(query); }
    else { closeSuggest(); }
  });

  /* --- Shortcut tiles -------------------------------------------------------
     Only configured shortcuts render — there are no empty slots.
     ------------------------------------------------------------------------- */

  var grid = $('#shortcuts');

  /* Live favicon first, then the entry's local file, then a letter tile. */
  function tileIcon(item) {
    var letter = (item.name || '?').charAt(0).toUpperCase();
    return B.iconImage(
      [B.faviconUrl(item.url, 64), item.icon],
      function () { return el('span', { class: 'shortcut__glyph', text: letter }); },
      { alt: '', loading: 'lazy' }
    );
  }

  function renderShortcuts(items) {
    grid.textContent = '';

    if (!items.length) {
      grid.appendChild(el('p', { class: 'shortcuts__empty', text: 'No shortcuts — add one in Customize.' }));
      return;
    }

    items.forEach(function (item) {
      var internal = B.isInternal(item.url);
      grid.appendChild(el('a', {
        class: 'shortcut',
        href: item.url,
        target: internal ? null : '_blank',
        rel: internal ? null : 'noopener',
        title: item.name + ' — ' + item.url
      }, [
        el('span', { class: 'shortcut__icon' }, [tileIcon(item)]),
        el('span', { class: 'shortcut__label', text: item.name })
      ]));
    });
  }

  renderShortcuts(B.Shortcuts.all());
  B.on('shortcuts', function (items) {
    renderShortcuts(items);
    renderShortcutManager(items);
  });

  /* --- Apps launcher --------------------------------------------------------
     Same structure and metrics as Google's launcher: a scrollable popover of
     3-across tiles, each a 48px icon over a small centred label, with a
     divider and a footer action.
     ------------------------------------------------------------------------- */

  function appIcon(app) {
    var favicon = B.faviconUrl(app.url, 64);
    // See `preferBuiltInAppIcons` in data.js for why the order flips here.
    var sources = D.preferBuiltInAppIcons ? [app.icon, favicon] : [favicon, app.icon];
    return B.iconImage(
      sources,
      function () {
        var tile = el('span', { class: 'app__icon app__icon--fallback', text: app.name.charAt(0) });
        tile.style.background = app.color || '#5f6368';
        return tile;
      },
      { class: 'app__icon', alt: '', loading: 'lazy' }
    );
  }

  var appsBtn = $('#apps');

  appsBtn.addEventListener('click', function () {
    if (appsBtn.getAttribute('aria-expanded') === 'true') { return; }

    var body = el('div', { class: 'apps__body', role: 'menu' });
    var gridEl = null;
    var section = null;

    D.apps.forEach(function (app) {
      // Start a fresh grid whenever the group changes, matching the
      // divided sections of Google's own launcher.
      if (app.section !== section) {
        if (gridEl) { body.appendChild(el('div', { class: 'apps__divider' })); }
        gridEl = el('div', { class: 'apps__grid' });
        body.appendChild(gridEl);
        section = app.section;
      }

      var isCustomize = app.url === '#customize';
      var internal = isCustomize || B.isInternal(app.url);

      gridEl.appendChild(el('a', {
        class: 'app',
        role: 'menuitem',
        href: isCustomize ? '#' : app.url,
        target: internal ? null : '_blank',
        rel: internal ? null : 'noopener',
        onclick: function (e) {
          if (isCustomize) { e.preventDefault(); openDrawer(); }
          dismiss();
        }
      }, [
        appIcon(app),
        el('span', { class: 'app__name', text: app.name })
      ]));
    });

    var panel = el('div', { class: 'apps' }, [
      body,
      el('div', { class: 'apps__footer' }, [
        el('a', {
          class: 'apps__more',
          href: 'https://about.google/products/',
          target: '_blank',
          rel: 'noopener',
          text: 'More from Google',
          onclick: function () { dismiss(); }
        })
      ])
    ]);

    var rect = appsBtn.getBoundingClientRect();
    panel.style.top = (rect.bottom + 8 + window.scrollY) + 'px';
    panel.style.right = (document.documentElement.clientWidth - rect.right) + 'px';
    document.body.appendChild(panel);
    appsBtn.setAttribute('aria-expanded', 'true');

    var dismiss = B.dismissable(panel, function () {
      panel.remove();
      appsBtn.setAttribute('aria-expanded', 'false');
    });
  });

  /* --- Profile menu ---------------------------------------------------------- */

  function openMenu(anchor, items) {
    if (anchor.getAttribute('aria-expanded') === 'true') { return; }

    var menu = el('div', { class: 'menu', role: 'menu' });

    items.forEach(function (item) {
      if (item.type === 'separator') {
        menu.appendChild(el('div', { class: 'menu__sep' }));
      } else if (item.type === 'header') {
        menu.appendChild(el('div', { class: 'menu__head', text: item.label }));
      } else if (item.href) {
        menu.appendChild(el('a', {
          class: 'menu__item', role: 'menuitem', href: item.href, text: item.label,
          onclick: function () { dismiss(); }
        }));
      } else {
        menu.appendChild(el('button', {
          class: 'menu__item' + (item.danger ? ' menu__item--danger' : ''),
          type: 'button', role: 'menuitem', text: item.label,
          onclick: function () { dismiss(); item.action(); }
        }));
      }
    });

    var rect = anchor.getBoundingClientRect();
    menu.style.right = (document.documentElement.clientWidth - rect.right) + 'px';
    document.body.appendChild(menu);
    B.fitMenu(menu, anchor);
    anchor.setAttribute('aria-expanded', 'true');

    var dismiss = B.dismissable(menu, function () {
      menu.remove();
      anchor.setAttribute('aria-expanded', 'false');
    });
  }

  function openProfileMenu() {
    openMenu(pfp, [
      { type: 'header', label: session.email },
      { label: 'Customize', action: openDrawer },
      { label: 'Links dashboard', href: 'links.html' },
      { type: 'separator' },
      { label: 'Sign out', danger: true, action: signOut }
    ]);
  }

  pfp.addEventListener('click', openProfileMenu);
  pfp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfileMenu(); }
  });

  /* --- Customize panel -------------------------------------------------------- */

  var drawer = $('#drawer');
  var scrim = $('#scrim');
  var fab = $('#customize-open');

  function openDrawer() {
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    scrim.classList.add('is-open');
    fab.setAttribute('aria-expanded', 'true');
    $('#drawer-close').focus();
  }

  function closeDrawer() {
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    scrim.classList.remove('is-open');
    fab.setAttribute('aria-expanded', 'false');
  }

  fab.addEventListener('click', openDrawer);
  $('#drawer-close').addEventListener('click', closeDrawer);
  scrim.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) { closeDrawer(); }
  });

  /* Name */
  function commitName() {
    var value = nameInput.value.trim() || 'Peter Griffin';
    nameInput.value = value;
    B.Profile.set({ name: value });
  }
  nameInput.addEventListener('blur', commitName);
  nameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
  });

  /* Avatar + wallpaper */
  var avatarFile = $('#avatar-file');
  var wallpaperFile = $('#wallpaper-file');

  function pickImage(input, key, label) {
    input.value = '';
    input.click();
    input.onchange = function () {
      B.readImageFile(input.files[0])
        .then(function (dataUrl) {
          var patch = {};
          patch[key] = dataUrl;
          return B.Profile.set(patch).then(function (ok) {
            B.toast(ok === false ? 'Could not save that image' : label + ' updated',
                    ok === false ? 'error' : null);
          });
        })
        .catch(function (err) { B.toast(err.message, 'error'); });
    };
  }

  drawerAvatar.addEventListener('click', function () {
    pickImage(avatarFile, 'avatar', 'Profile picture');
  });
  drawerAvatar.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pickImage(avatarFile, 'avatar', 'Profile picture');
    }
  });

  $('#wallpaper').addEventListener('click', function () {
    pickImage(wallpaperFile, 'wallpaper', 'Wallpaper');
  });

  $('#wallpaper-clear').addEventListener('click', function () {
    B.Profile.set({ wallpaper: '' });
    wallpaperPreview.src = 'img/wallpaper.jpg';
    B.toast('Wallpaper cleared');
  });

  /* --- Search engine + AI provider selects ------------------------------------ */

  function fillSelect(select, table, selected) {
    Object.keys(table).forEach(function (key) {
      select.appendChild(el('option', { value: key, text: table[key].name }));
    });
    select.value = selected;
  }

  var engineSelect = $('#engine-select');
  var aiSelect = $('#ai-select');
  var faviconSelect = $('#favicon-select');
  var prefs = B.Prefs.get();

  fillSelect(engineSelect, D.engines, prefs.engine);
  fillSelect(aiSelect, D.aiProviders, prefs.ai);
  fillSelect(faviconSelect, D.faviconProviders, prefs.favicons);

  engineSelect.addEventListener('change', function () {
    B.Prefs.set({ engine: engineSelect.value });
    B.toast('Search engine: ' + D.engines[engineSelect.value].name);
  });

  aiSelect.addEventListener('change', function () {
    B.Prefs.set({ ai: aiSelect.value });
    B.toast('AI provider: ' + D.aiProviders[aiSelect.value].name);
  });

  faviconSelect.addEventListener('change', function () {
    B.Prefs.set({ favicons: faviconSelect.value });
    renderShortcuts(B.Shortcuts.all());   // repaint tiles against the new source
    B.toast('Icons: ' + D.faviconProviders[faviconSelect.value].name);
  });

  /* --- Shortcut manager -------------------------------------------------------- */

  var scList = $('#sc-list');

  function renderShortcutManager(items) {
    scList.textContent = '';

    items.forEach(function (item, index) {
      scList.appendChild(el('li', { class: 'sc' }, [
        el('span', { class: 'sc__name', text: item.name, title: item.url }),

        el('button', {
          class: 'sc__btn', type: 'button', 'aria-label': 'Move ' + item.name + ' up',
          disabled: index === 0,
          text: '↑',
          onclick: function () { B.Shortcuts.move(item.id, -1); }
        }),
        el('button', {
          class: 'sc__btn', type: 'button', 'aria-label': 'Move ' + item.name + ' down',
          disabled: index === items.length - 1,
          text: '↓',
          onclick: function () { B.Shortcuts.move(item.id, 1); }
        }),
        el('button', {
          class: 'sc__btn', type: 'button', 'aria-label': 'Edit ' + item.name,
          text: '✎',
          onclick: function () { editShortcut(item); }
        }),
        el('button', {
          class: 'sc__btn sc__btn--danger', type: 'button', 'aria-label': 'Remove ' + item.name,
          text: '✕',
          onclick: function () {
            B.Shortcuts.remove(item.id);
            B.toast('Shortcut removed');
          }
        })
      ]));
    });
  }

  function editShortcut(existing) {
    openDialog({
      title: existing ? 'Edit shortcut' : 'Add shortcut',
      fields: [
        { name: 'name', label: 'Name', value: existing ? existing.name : '' },
        { name: 'url', label: 'URL', value: existing ? existing.url : '', placeholder: 'example.com' },
        { name: 'icon', label: 'Icon path (optional)', value: existing ? existing.icon : '', placeholder: 'img/icons/name.png' }
      ]
    }).then(function (result) {
      if (!result) { return; }

      var url = B.normalizeUrl(result.values.url);
      if (!url) { return B.toast('Enter a valid URL', 'error'); }

      var patch = {
        name: result.values.name.trim() || B.hostOf(url) || 'Shortcut',
        url: url,
        icon: result.values.icon.trim()
      };

      if (existing) {
        B.Shortcuts.update(existing.id, patch);
        B.toast('Shortcut updated');
      } else {
        B.Shortcuts.add(patch);
        B.toast('Shortcut added');
      }
    });
  }

  $('#sc-add').addEventListener('click', function () { editShortcut(null); });

  $('#shortcuts-reset').addEventListener('click', function () {
    B.Shortcuts.reset().then(function () { B.toast('Shortcuts reset'); });
  });

  renderShortcutManager(B.Shortcuts.all());

  /* --- Account ----------------------------------------------------------------- */

  $('#drawer-email').textContent = session.email;

  function signOut() {
    // Clear the cookies first, and locally regardless of whether the server
    // round trip succeeds — a sign-out that half-works is worse than none.
    var auth = window.BlueJAuth;
    var revoked = auth ? auth.signOut() : Promise.resolve();
    revoked.catch(function () {})
      .then(function () { return B.Session.end(); })
      .then(function () { location.href = 'index.html'; });
  }

  $('#sign-out').addEventListener('click', signOut);

  /* --- Promise-based dialog ------------------------------------------------------ */

  function openDialog(config) {
    return new Promise(function (resolve) {
      var inputs = {};

      var body = config.fields.map(function (field) {
        var input = el('input', {
          class: 'field field--sm',
          type: 'text',
          value: field.value || '',
          placeholder: field.placeholder || '',
          'aria-label': field.label
        });
        inputs[field.name] = input;
        return el('label', { class: 'dialog__field' }, [
          el('span', { class: 'dialog__label', text: field.label }),
          input
        ]);
      });

      var actions = el('div', { class: 'dialog__actions' }, [
        el('button', {
          class: 'btn btn--sm btn--ghost', type: 'button', text: 'Cancel',
          onclick: function () { close(); resolve(null); }
        }),
        el('button', { class: 'btn btn--sm', type: 'submit', text: 'Save' })
      ]);

      var form = el('form', { class: 'dialog__form' }, body.concat([actions]));

      var backdrop = el('div', { class: 'dialog-backdrop' }, [
        el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, [
          el('h2', { class: 'dialog__title', text: config.title }),
          form
        ])
      ]);

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var values = {};
        Object.keys(inputs).forEach(function (k) { values[k] = inputs[k].value; });
        close();
        resolve({ values: values });
      });

      backdrop.addEventListener('mousedown', function (e) {
        if (e.target === backdrop) { close(); resolve(null); }
      });

      function onKey(e) { if (e.key === 'Escape') { close(); resolve(null); } }

      function close() {
        document.removeEventListener('keydown', onKey);
        backdrop.remove();
      }

      document.addEventListener('keydown', onKey);
      document.body.appendChild(backdrop);
      inputs[config.fields[0].name].focus();
      inputs[config.fields[0].name].select();
    });
  }

  /* "/" focuses the search box, like a browser new-tab page. */
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement === document.body) {
      e.preventDefault();
      queryInput.focus();
    }
  });
});
