/* ==========================================================================
   BlueJ — persistence (IndexedDB), shared state and small DOM helpers.

   All application data lives in one IndexedDB store, `bluej / kv`.

   Reads are synchronous because every record is loaded into memory once by
   `BlueJ.ready()`; writes update that cache immediately and persist in the
   background. Pages therefore look like plain synchronous code but never
   block on the database.
   ========================================================================== */
(function (global) {
  'use strict';

  var DB_NAME = 'bluej';
  var DB_VERSION = 1;
  var STORE = 'kv';
  var KEYS = ['session', 'profile', 'shortcuts', 'prefs'];

  /* --- Backends -----------------------------------------------------------
     Tried in order and each proven with a real write/read/delete round-trip
     before it is adopted. A store that accepts writes and silently drops them
     is exactly what caused sign-in to bounce between pages, so a backend is
     never assumed to work just because opening it succeeded.
     ----------------------------------------------------------------------- */

  var dbPromise = null;

  function openVersion(version) {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { return reject(new Error('IndexedDB unavailable')); }

      var request;
      try {
        request = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
      } catch (err) {
        return reject(err);
      }

      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE)) { db.createObjectStore(STORE); }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB open failed')); };
      request.onblocked = function () { reject(new Error('IndexedDB blocked')); };
    });
  }

  function openDB() {
    if (dbPromise) { return dbPromise; }
    dbPromise = openVersion(DB_VERSION).then(function (db) {
      if (db.objectStoreNames.contains(STORE)) { return db; }
      // The database exists but our object store does not — a half-finished
      // upgrade. Bump the version to force onupgradeneeded and create it.
      var next = db.version + 1;
      db.close();
      return openVersion(next);
    });
    return dbPromise;
  }

  var idb = {
    get: function (key) {
      return openDB().then(function (db) {
        return new Promise(function (resolve, reject) {
          var req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      });
    },
    set: function (key, value) {
      return openDB().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(STORE, 'readwrite');
          t.objectStore(STORE).put(value, key);
          t.oncomplete = function () { resolve(true); };
          t.onerror = function () { reject(t.error); };
          t.onabort = function () { reject(t.error); };
        });
      });
    },
    del: function (key) {
      return openDB().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(STORE, 'readwrite');
          t.objectStore(STORE).delete(key);
          t.oncomplete = function () { resolve(true); };
          t.onerror = function () { reject(t.error); };
        });
      });
    }
  };

  /* localStorage / sessionStorage. Merely touching these throws in some
     privacy modes, so every access is guarded. */
  function webStorage(kind) {
    function store() { return global[kind]; }
    return {
      get: function (key) {
        return Promise.resolve().then(function () {
          var raw = store().getItem('bluej.' + key);
          return raw === null ? undefined : JSON.parse(raw);
        });
      },
      set: function (key, value) {
        return Promise.resolve().then(function () {
          store().setItem('bluej.' + key, JSON.stringify(value));
          return true;
        });
      },
      del: function (key) {
        return Promise.resolve().then(function () {
          store().removeItem('bluej.' + key);
          return true;
        });
      }
    };
  }

  /* Last resort. Survives nothing, but keeps the app usable for one page
     view instead of bouncing the user between login and home forever. */
  var memoryData = {};
  var memoryBackend = {
    get: function (key) { return Promise.resolve(memoryData[key]); },
    set: function (key, value) { memoryData[key] = value; return Promise.resolve(true); },
    del: function (key) { delete memoryData[key]; return Promise.resolve(true); }
  };

  /* Every tier that proved itself, best first. -----------------------------
     Deliberately NOT "the first one that works". If one page adopted
     IndexedDB and the next fell through to localStorage, the two would
     disagree about whether a session exists and bounce the user between
     login and home forever. Writing to all of them keeps every tier holding
     the same answer, so no two page loads can disagree.
     ----------------------------------------------------------------------- */
  var working = [];
  var backendName = 'none';

  /** Prove a backend really round-trips a value before trusting it. */
  function probe(be) {
    var token = { t: Date.now() + Math.random() };
    return be.set('__probe', token)
      .then(function () { return be.get('__probe'); })
      .then(function (read) {
        return be.del('__probe').then(function () {
          return !!read && read.t === token.t;
        });
      })
      .catch(function () { return false; });
  }

  function selectBackend() {
    var tiers = [
      { name: 'indexeddb', build: function () { return openDB().then(function () { return idb; }); } },
      { name: 'localstorage', build: function () { return Promise.resolve(webStorage('localStorage')); } },
      { name: 'sessionstorage', build: function () { return Promise.resolve(webStorage('sessionStorage')); } }
    ];

    return tiers.reduce(function (chain, tier) {
      return chain.then(function () {
        return tier.build()
          .then(function (be) {
            return probe(be).then(function (ok) {
              if (ok) { working.push({ name: tier.name, be: be }); }
            });
          })
          .catch(function () { /* tier unusable — skip it */ });
      });
    }, Promise.resolve()).then(function () {
      if (!working.length) { working.push({ name: 'memory', be: memoryBackend }); }
      backendName = working.map(function (w) { return w.name; }).join('+');
    });
  }

  /** Reads take the first tier that has the key; writes go to all of them. */
  var backend = {
    get: function (key) {
      return working.reduce(function (chain, w) {
        return chain.then(function (found) {
          if (found !== undefined) { return found; }
          return w.be.get(key).catch(function () { return undefined; });
        });
      }, Promise.resolve(undefined));
    },
    set: function (key, value) {
      return Promise.all(working.map(function (w) {
        return w.be.set(key, value).then(function () { return true; })
          .catch(function () { return false; });
      })).then(function (results) {
        return results.some(Boolean);
      });
    },
    del: function (key) {
      return Promise.all(working.map(function (w) {
        return w.be.del(key).catch(function () { /* already gone */ });
      })).then(function () { return true; });
    }
  };

  /** True when at least one tier survives a page navigation. */
  function canPersist() {
    return working.some(function (w) { return w.name !== 'memory'; });
  }

  /* --- In-memory cache ---------------------------------------------------- */

  var cache = {};
  var readyPromise = null;

  /**
   * Pick the working backends and load every record into memory.
   * Resolves once reads are safe; never rejects.
   *
   * Data written by the pre-IndexedDB build needs no migration: the
   * localStorage tier uses the same `bluej.<key>` names, so it is read back
   * natively and then mirrored into the other tiers on the next write.
   */
  function ready() {
    if (readyPromise) { return readyPromise; }

    readyPromise = selectBackend()
      .then(function () {
        return Promise.all(KEYS.map(function (key) {
          return backend.get(key).then(function (value) {
            if (value !== undefined) { cache[key] = value; }
          }).catch(function () { /* leave unset */ });
        }));
      })
      .catch(function () { /* fall through with whatever loaded */ })
      .then(function () {
        console.info('BlueJ storage: ' + backendName);
        document.documentElement.classList.remove('booting');
        return true;
      });

    return readyPromise;
  }

  /**
   * Cache-first write; persistence happens in the background.
   * The cache is updated before `topic` is emitted so listeners that call
   * a `.get()` see the new value, not the one it replaced.
   */
  function put(key, value, topic) {
    cache[key] = value;
    var saved = backend.set(key, value).catch(function (err) {
      console.warn('BlueJ: could not persist "' + key + '"', err);
      return false;
    });
    if (topic) { emit(topic, value); }
    return saved;
  }

  function drop(key, topic) {
    delete cache[key];
    var removed = backend.del(key).catch(function () { return false; });
    if (topic) { emit(topic, null); }
    return removed;
  }

  /* --- Session ------------------------------------------------------------ */

  var Session = {
    get: function () { return cache.session || null; },

    start: function (email, method) {
      var session = { email: email, method: method || 'password', startedAt: Date.now() };
      return put('session', session, 'session').then(function () { return session; });
    },

    end: function () { return drop('session', 'session'); },

    isActive: function () { return !!Session.get(); }
  };

  /* --- Profile ------------------------------------------------------------ */

  var DEFAULT_PROFILE = { name: 'Peter Griffin', avatar: '', wallpaper: '' };

  var Profile = {
    get: function () { return Object.assign({}, DEFAULT_PROFILE, cache.profile || {}); },
    set: function (patch) {
      return put('profile', Object.assign(Profile.get(), patch), 'profile');
    }
  };

  /* --- Shortcuts ----------------------------------------------------------
     A plain ordered list — there are no fixed slots and no empty tiles.
     Each entry: { id, name, url, icon }. `icon` is optional; when absent the
     tile falls back to the design's grey rounded square.
     ------------------------------------------------------------------------ */

  function uid() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  var Shortcuts = {
    all: function () {
      var list = cache.shortcuts;
      if (!Array.isArray(list)) {
        // First run — seed from the defaults in data.js.
        var seed = (global.BlueJData && global.BlueJData.defaultShortcuts) || [];
        list = seed.map(function (item) {
          return { id: uid(), name: item.name, url: item.url, icon: item.icon || '' };
        });
        put('shortcuts', list);
      }
      return list.slice();
    },

    save: function (list) { return put('shortcuts', list, 'shortcuts'); },

    add: function (item) {
      var list = Shortcuts.all();
      list.push({ id: uid(), name: item.name, url: item.url, icon: item.icon || '' });
      return Shortcuts.save(list);
    },

    update: function (id, patch) {
      var list = Shortcuts.all().map(function (item) {
        return item.id === id ? Object.assign({}, item, patch) : item;
      });
      return Shortcuts.save(list);
    },

    remove: function (id) {
      return Shortcuts.save(Shortcuts.all().filter(function (item) { return item.id !== id; }));
    },

    /** Move an entry by `delta` places, clamped to the ends. */
    move: function (id, delta) {
      var list = Shortcuts.all();
      var from = list.findIndex(function (item) { return item.id === id; });
      if (from < 0) { return Promise.resolve(false); }
      var to = Math.max(0, Math.min(list.length - 1, from + delta));
      if (to === from) { return Promise.resolve(false); }
      list.splice(to, 0, list.splice(from, 1)[0]);
      return Shortcuts.save(list);
    },

    /** Clear the stored list so `all()` re-seeds from data.js. */
    reset: function () {
      return drop('shortcuts').then(function () {
        var seeded = Shortcuts.all();
        emit('shortcuts', seeded);
        return seeded;
      });
    }
  };

  /* --- Preferences --------------------------------------------------------- */

  var DEFAULT_PREFS = {
    aiMode: false,
    engine: 'google',        // key into BlueJData.engines
    ai: 'google-ai',         // key into BlueJData.aiProviders
    favicons: 'duckduckgo',  // key into BlueJData.faviconProviders
    lastEmail: ''
  };

  var Prefs = {
    get: function () { return Object.assign({}, DEFAULT_PREFS, cache.prefs || {}); },
    set: function (patch) {
      return put('prefs', Object.assign(Prefs.get(), patch), 'prefs');
    }
  };

  /* --- Redirect guard ------------------------------------------------------
     Redirects run one way only: a page needing a session sends you to login,
     and login never sends you back (see the note at the top of login.js), so
     the two cannot bounce off each other.

     The hop count is the remaining safety net. If storage refuses writes,
     signing in repeatedly would keep landing back on login; counting the
     round trips in the URL — never in storage, which is the thing that may
     be broken — lets us stop and explain after MAX_HOPS attempts.
     ------------------------------------------------------------------------ */

  var MAX_HOPS = 2;

  function hops() {
    var match = /[?&]r=(\d+)/.exec(location.search);
    return match ? parseInt(match[1], 10) : 0;
  }

  function withHops(url, n) {
    return n ? url + (url.indexOf('?') === -1 ? '?' : '&') + 'r=' + n : url;
  }

  /** Full-page message used when we would otherwise loop. */
  function fatal(title, detail) {
    document.documentElement.classList.remove('booting');
    document.body.innerHTML = '';
    document.body.appendChild(
      el('div', { class: 'fatal' }, [
        el('div', { class: 'fatal__box' }, [
          el('h1', { class: 'fatal__title', text: title }),
          el('p', { class: 'fatal__text', text: detail }),
          el('button', {
            class: 'btn btn--sm', type: 'button', text: 'Try again',
            onclick: function () { location.href = location.pathname; }
          })
        ])
      ])
    );
  }

  var STORAGE_HELP =
    'BlueJ could not save your session in this browser, so signing in never ' +
    'sticks. This usually means the page was opened directly from the file ' +
    'system, or the browser is blocking site data (private window, or ' +
    'cookies/site-data turned off). Serve the folder over http:// — for ' +
    'example "npx serve" in the project folder — and allow site data.';

  /**
   * Gate a page that requires a session. Returns the session, or null after
   * starting a redirect (in which case the caller must stop).
   */
  function requireSession(loginUrl) {
    // The auth cookie is what actually counts: the local record is a cache
    // of it, and after a sign-out elsewhere or an expired refresh token the
    // cache can say "signed in" when the server will refuse every request.
    var auth = global.BlueJAuth;
    if (auth && !auth.signedIn()) {
      Session.end();
      var away = hops();
      if (away >= MAX_HOPS) {
        fatal('Can’t keep you signed in', STORAGE_HELP);
        return null;
      }
      location.replace(withHops(loginUrl, away + 1));
      return null;
    }

    var session = Session.get();
    if (session) { return session; }

    var n = hops();
    if (n >= MAX_HOPS) {
      fatal('Can’t keep you signed in', STORAGE_HELP);
      return null;
    }

    location.replace(withHops(loginUrl, n + 1));
    return null;
  }

  /** Called by the login page once a session exists, preserving the count. */
  function gotoApp(url) { location.href = withHops(url, hops()); }

  /* --- Tiny event bus ------------------------------------------------------ */

  var listeners = {};

  function on(topic, fn) {
    (listeners[topic] = listeners[topic] || []).push(fn);
    return function off() {
      listeners[topic] = listeners[topic].filter(function (f) { return f !== fn; });
    };
  }

  function emit(topic, payload) {
    (listeners[topic] || []).forEach(function (fn) { fn(payload); });
  }

  /* --- DOM helpers ---------------------------------------------------------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'class') { node.className = props[k]; }
      else if (k === 'text') { node.textContent = props[k]; }
      else if (k === 'html') { node.innerHTML = props[k]; }
      else if (k.slice(0, 2) === 'on') { node.addEventListener(k.slice(2).toLowerCase(), props[k]); }
      else if (props[k] !== null && props[k] !== undefined && props[k] !== false) {
        node.setAttribute(k, props[k]);
      }
    });
    (children || []).forEach(function (c) {
      if (c) { node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
    });
    return node;
  }

  /**
   * Ask the person to confirm something. Resolves true or false.
   *
   * Replaces window.confirm, which cannot be styled, cannot be tested
   * without driving a native dialog, blocks the whole page, and in some
   * browsers offers "prevent this page from creating more dialogs" — which
   * silently turns every later confirmation into a no.
   *
   *   confirm({ title, body, confirmLabel, danger })
   */
  function confirm(options) {
    options = options || {};

    return new Promise(function (resolve) {
      var done = false;
      function settle(answer) {
        if (done) { return; }
        done = true;
        document.removeEventListener('keydown', onKey);
        backdrop.remove();
        if (previous && previous.focus) { previous.focus(); }
        resolve(answer);
      }

      var previous = document.activeElement;

      var confirmButton = el('button', {
        class: 'btn btn--sm' + (options.danger ? ' btn--danger' : ' btn--accent'),
        type: 'button',
        text: options.confirmLabel || 'Confirm',
        onclick: function () { settle(true); }
      });

      var panel = el('div', {
        class: 'dialog dialog--confirm', role: 'alertdialog', 'aria-modal': 'true'
      }, [
        el('h2', { class: 'dialog__title', text: options.title || 'Are you sure?' }),
        options.body ? el('p', { class: 'dialog__body', text: options.body }) : null,
        el('div', { class: 'dialog__actions' }, [
          el('button', {
            class: 'btn btn--sm btn--ghost', type: 'button',
            text: options.cancelLabel || 'Cancel',
            onclick: function () { settle(false); }
          }),
          confirmButton
        ])
      ]);

      var backdrop = el('div', { class: 'dialog-backdrop' }, [panel]);
      backdrop.addEventListener('mousedown', function (e) {
        if (e.target === backdrop) { settle(false); }
      });

      // Escape cancels, and so does dismissing any other way: the safe answer
      // is always no.
      function onKey(e) {
        if (e.key === 'Escape') { settle(false); }
        if (e.key === 'Tab') {
          // Keep focus inside the dialog while it is open.
          var focusable = $$('button', panel);
          var first = focusable[0], last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault(); last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault(); first.focus();
          }
        }
      }

      document.addEventListener('keydown', onKey);
      document.body.appendChild(backdrop);
      confirmButton.focus();
    });
  }

  function toast(message, variant) {
    var host = $('.toast-host');
    if (!host) {
      host = el('div', { class: 'toast-host' });
      document.body.appendChild(host);
    }
    var node = el('div', { class: 'toast' + (variant ? ' toast--' + variant : ''), text: message });
    host.appendChild(node);
    setTimeout(function () {
      node.style.transition = 'opacity 200ms';
      node.style.opacity = '0';
      setTimeout(function () { node.remove(); }, 220);
    }, 2600);
  }

  function readImageFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { return reject(new Error('No file selected')); }
      if (!/^image\//.test(file.type)) { return reject(new Error('That file is not an image')); }
      if (file.size > 4 * 1024 * 1024) { return reject(new Error('Image must be under 4 MB')); }
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Could not read that image')); };
      reader.readAsDataURL(file);
    });
  }

  /** Normalise user input into a URL. Relative paths (links.html) pass through. */
  function normalizeUrl(input) {
    var value = String(input || '').trim();
    if (!value) { return ''; }
    if (/^[\w-]+\.html?(\?|#|$)/i.test(value) || value.charAt(0) === '/') { return value; }
    if (!/^https?:\/\//i.test(value)) { value = 'https://' + value; }
    try {
      var url = new URL(value);
      return url.hostname ? url.href : '';
    } catch (err) {
      return '';
    }
  }

  function isInternal(url) { return !/^https?:\/\//i.test(url); }

  function hostOf(url) {
    try { return new URL(url, location.href).hostname.replace(/^www\./, ''); }
    catch (err) { return ''; }
  }

  /**
   * Keep a popup inside the viewport.
   *
   * Menus are absolutely positioned under their anchor, which is fine until
   * the list grows — the Type dropdown reaches ~2,400px with 60 providers and
   * simply runs off the bottom of the screen. This caps its height to the
   * space actually available, and flips it above the anchor when there is
   * more room there.
   */
  function fitMenu(menu, anchor) {
    var GAP = 8;
    var MARGIN = 12;      // breathing room against the viewport edge
    var MIN = 160;        // below this, flipping is worth more than fitting

    var rect = anchor.getBoundingClientRect();
    var viewport = window.innerHeight;
    var below = viewport - rect.bottom - GAP - MARGIN;
    var above = rect.top - GAP - MARGIN;

    // Measure the natural height before constraining it.
    menu.style.maxHeight = 'none';
    var natural = menu.scrollHeight;

    if (natural <= below || below >= above || below >= MIN) {
      menu.style.top = (rect.bottom + GAP + window.scrollY) + 'px';
      menu.style.bottom = 'auto';
      menu.style.maxHeight = Math.max(MIN, below) + 'px';
      menu.style.transformOrigin = 'top ' + (menu.style.right === 'auto' ? 'left' : 'right');
    } else {
      // More room above: hang the menu upward from the anchor.
      menu.style.top = (rect.top - GAP - Math.min(natural, above) + window.scrollY) + 'px';
      menu.style.bottom = 'auto';
      menu.style.maxHeight = Math.max(MIN, above) + 'px';
      menu.style.transformOrigin = 'bottom ' + (menu.style.right === 'auto' ? 'left' : 'right');
    }
  }

  function dismissable(node, onClose) {
    function away(e) { if (!node.contains(e.target)) { close(); } }
    function key(e) { if (e.key === 'Escape') { close(); } }
    function close() {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
      onClose();
    }
    setTimeout(function () {
      document.addEventListener('mousedown', away);
      document.addEventListener('keydown', key);
    }, 0);
    return close;
  }

  /** Grey tile stand-in used until real artwork is dropped into /img. */
  function placeholderImage(label, w, h, radius) {
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<rect width="100%" height="100%" rx="' + (radius || 0) + '" fill="#424242"/>' +
      (label
        ? '<text x="50%" y="50%" fill="#7b7b7b" text-anchor="middle" dominant-baseline="middle" ' +
          'font-family="Inter,Segoe UI,sans-serif" font-size="' +
          Math.max(9, Math.min(14, Math.round(w / 10))) + '">' +
          label + '</text>'
        : '') +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /**
   * Live favicon for a page URL, via the provider chosen in Customize.
   * Returns '' for local pages — a relative URL would otherwise resolve
   * against this origin and fetch the favicon of the dev server.
   */
  function faviconUrl(pageUrl, size) {
    if (!pageUrl || isInternal(pageUrl)) { return ''; }
    var host = hostOf(pageUrl);
    if (!host) { return ''; }

    var table = (global.BlueJData && global.BlueJData.faviconProviders) || {};
    var provider = table[Prefs.get().favicons] || table.duckduckgo;
    if (!provider) { return ''; }

    return provider.url
      .replace('%d', encodeURIComponent(host))
      .replace('%s', String(size || 64));
  }

  /**
   * An <img> that walks a list of candidate sources, falling through on each
   * error, and swaps itself for `fallback()` once they are all exhausted.
   */
  function iconImage(sources, fallback, attrs) {
    var list = sources.filter(Boolean);
    if (!list.length) { return fallback(); }

    var index = 0;
    var img = el('img', attrs || {});
    img.addEventListener('error', function () {
      index++;
      if (index < list.length) { img.src = list[index]; }
      else { img.replaceWith(fallback()); }
    });
    img.src = list[0];
    return img;
  }

  /** Swap in a placeholder when an image 404s, including before this ran. */
  function withFallback(img, label, w, h, radius) {
    var fallback = placeholderImage(label, w, h, radius);
    function apply() { if (img.src !== fallback) { img.src = fallback; } }
    img.addEventListener('error', apply);
    if (img.complete && img.naturalWidth === 0) { apply(); }
  }

  global.BlueJ = {
    ready: ready,
    storageKind: function () { return backendName; },
    canPersist: canPersist,
    storageHelp: STORAGE_HELP,
    requireSession: requireSession,
    gotoApp: gotoApp,
    fatal: fatal,
    Session: Session,
    Profile: Profile,
    Shortcuts: Shortcuts,
    Prefs: Prefs,
    on: on,
    emit: emit,
    $: $,
    $$: $$,
    el: el,
    toast: toast,
    confirm: confirm,
    readImageFile: readImageFile,
    normalizeUrl: normalizeUrl,
    isInternal: isInternal,
    hostOf: hostOf,
    dismissable: dismissable,
    fitMenu: fitMenu,
    placeholderImage: placeholderImage,
    withFallback: withFallback,
    faviconUrl: faviconUrl,
    iconImage: iconImage
  };
})(window);
