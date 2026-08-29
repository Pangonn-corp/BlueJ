/* ==========================================================================
   BlueJ — static configuration and seed data.
   Edit this file to change what ships by default. Anything the user then
   changes is stored in IndexedDB and wins over these values.
   ========================================================================== */
window.BlueJData = {

  /* --- Home: shortcut tiles ----------------------------------------------
     Seeded into IndexedDB on first run, then fully editable from the
     Customize panel. `icon` is optional — drop a file at the path below and
     it is picked up automatically; otherwise the tile falls back to the
     design's grey rounded square with the initial.
     ---------------------------------------------------------------------- */
  defaultShortcuts: [
    // `icon` is the offline fallback; the live favicon is looked up from `url`.
    // Links is a local page with no domain, so its icon is the only source.
    { name: 'Links',      url: 'links.html',                        icon: 'img/icons/links.svg' },
    { name: 'Classroom',  url: 'https://classroom.google.com',      icon: 'img/apps/classroom.webp' },
    { name: 'Khan',       url: 'https://www.khanacademy.org',       icon: 'img/icons/khan.svg' },
    { name: 'Wikipedia',  url: 'https://www.wikipedia.org',         icon: 'img/icons/wikipedia.svg' },
    { name: 'Desmos',     url: 'https://www.desmos.com/calculator', icon: 'img/icons/desmos.svg' },
    { name: 'Quizlet',    url: 'https://quizlet.com',               icon: 'img/icons/quizlet.svg' },
    { name: 'Scholar',    url: 'https://scholar.google.com',        icon: 'img/apps/scholar.webp' }
  ],

  /* --- Favicon sources ----------------------------------------------------
     Tile artwork is fetched from one of these by domain, so shortcuts and
     apps show the site's real icon. `%d` is the hostname, `%s` the pixel
     size. Whichever is selected in Customize is tried first; if the request
     fails (offline, blocked) the entry's local `icon` file is used instead.
     ---------------------------------------------------------------------- */
  faviconProviders: {
    'duckduckgo': { name: 'DuckDuckGo', url: 'https://icons.duckduckgo.com/ip3/%d.ico' },
    'google':     { name: 'Google',     url: 'https://www.google.com/s2/favicons?sz=%s&domain=%d' }
  },

  /* Apps launcher only: use the drawn icon first and the favicon as backup.
     Measured against both providers, most *.google.com products return the
     same generic Google "G" — 8 of 14 identical on Google's API, 12 of 14 on
     DuckDuckGo's — which would make the launcher a wall of matching icons.
     Shortcuts are unaffected: they point at varied domains and resolve well,
     so they always try the favicon first.
     Set this to false to make the launcher favicon-first as well. */
  preferBuiltInAppIcons: true,

  /* --- Search suggestions --------------------------------------------------
     Typeahead source. `%s` query, `%l` language, `%p` provider — the last of
     which follows whichever engine is selected below, so the suggestions
     match where the search will actually go.
     ---------------------------------------------------------------------- */
  suggestApi: 'https://api.suggestions.victr.me/?q=%s&l=%l&with=%p',

  /* --- Search engines -----------------------------------------------------
     `%s` is replaced with the URL-encoded query. `suggest` is the provider
     name the suggestions API expects; Startpage has no provider there (it
     answers with an empty list), so it borrows Google's, which is what
     Startpage serves results from anyway.
     ---------------------------------------------------------------------- */
  engines: {
    'google':     { name: 'Google',     url: 'https://www.google.com/search?q=%s',              suggest: 'google' },
    'bing':       { name: 'Bing',       url: 'https://www.bing.com/search?q=%s',                suggest: 'bing' },
    'duckduckgo': { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s',                    suggest: 'duckduckgo' },
    'brave':      { name: 'Brave',      url: 'https://search.brave.com/search?q=%s',            suggest: 'brave' },
    'startpage':  { name: 'Startpage',  url: 'https://www.startpage.com/sp/search?query=%s',    suggest: 'google' }
  },

  /* --- AI providers (used when AI Mode is on) ---------------------------- */
  aiProviders: {
    'google-ai':  { name: 'Google AI Mode', url: 'https://www.google.com/search?udm=50&q=%s' },
    'chatgpt':    { name: 'ChatGPT',        url: 'https://chatgpt.com/?q=%s' },
    'claude':     { name: 'Claude',         url: 'https://claude.ai/new?q=%s' },
    'perplexity': { name: 'Perplexity',     url: 'https://www.perplexity.ai/search?q=%s' },
    'copilot':    { name: 'Copilot',        url: 'https://copilot.microsoft.com/?q=%s' }
  },

  /* --- Apps menu (the 3x3 grid button in the top bar) --------------------
     The Google entries, their order and their two-section grouping are the
     real app launcher's, read from Google's own One Google Bar. The icons
     are sliced from that launcher's sprite sheet, so they are the exact
     artwork Google ships.

     `section` draws the divider between groups. `icon` is the tile image;
     `color` (optional) only backs the letter tile if an icon file is
     missing. The two BlueJ entries lead the list the way Account leads
     Google's — delete them if you want the Google list verbatim.
     ---------------------------------------------------------------------- */
  apps: [
    // --- BlueJ's own
    { name: 'Links',              url: 'links.html',                                 icon: 'img/apps/links.svg',              color: '#1b9cfe', section: 'bluej' },
    { name: 'Customize',          url: '#customize',                                 icon: 'img/apps/customize.svg',          color: '#8a38f5', section: 'bluej' },

    // --- Google apps, first section
    { name: 'Account',            url: 'https://myaccount.google.com/',              icon: 'img/apps/account.png',            section: 'google' },
    { name: 'Search',             url: 'https://www.google.com/',                    icon: 'img/apps/search.png',             section: 'google' },
    { name: 'Maps',               url: 'https://maps.google.com/',                   icon: 'img/apps/maps.png',               section: 'google' },
    { name: 'YouTube',            url: 'https://www.youtube.com/',                   icon: 'img/apps/youtube.png',            section: 'google' },
    { name: 'News',               url: 'https://news.google.com/',                   icon: 'img/apps/news.png',               section: 'google' },
    { name: 'Gmail',              url: 'https://mail.google.com/mail/',              icon: 'img/apps/gmail.png',              section: 'google' },
    { name: 'Meet',               url: 'https://meet.google.com/',                   icon: 'img/apps/meet.png',               section: 'google' },
    { name: 'Chat',               url: 'https://chat.google.com/',                   icon: 'img/apps/chat.png',               section: 'google' },
    { name: 'Contacts',           url: 'https://contacts.google.com/',               icon: 'img/apps/contacts.png',           section: 'google' },
    { name: 'Drive',              url: 'https://drive.google.com/',                  icon: 'img/apps/drive.png',              section: 'google' },
    { name: 'Calendar',           url: 'https://calendar.google.com/calendar',       icon: 'img/apps/calendar.png',           section: 'google' },
    { name: 'Play',               url: 'https://play.google.com/',                   icon: 'img/apps/play.png',               section: 'google' },
    { name: 'Translate',          url: 'https://translate.google.com/',              icon: 'img/apps/translate.png',          section: 'google' },
    { name: 'Photos',             url: 'https://photos.google.com/',                 icon: 'img/apps/photos.png',             section: 'google' },
    { name: 'Chrome',             url: 'https://www.google.com/chrome/',             icon: 'img/apps/chrome.png',             section: 'google' },
    { name: 'Shopping',           url: 'https://www.google.com/shopping',            icon: 'img/apps/shopping.png',           section: 'google' },

    // --- Google apps, second section
    { name: 'Finance',            url: 'https://www.google.com/finance',             icon: 'img/apps/finance.png',            section: 'more' },
    { name: 'Docs',               url: 'https://docs.google.com/document/',          icon: 'img/apps/docs.png',               section: 'more' },
    { name: 'Sheets',             url: 'https://docs.google.com/spreadsheets/',      icon: 'img/apps/sheets.png',             section: 'more' },
    { name: 'Slides',             url: 'https://docs.google.com/presentation/',      icon: 'img/apps/slides.png',             section: 'more' },
    { name: 'Books',              url: 'https://books.google.com/',                  icon: 'img/apps/books.png',              section: 'more' },
    { name: 'Blogger',            url: 'https://www.blogger.com/',                   icon: 'img/apps/blogger.png',            section: 'more' },
    { name: 'Keep',               url: 'https://keep.google.com/',                   icon: 'img/apps/keep.png',               section: 'more' },
    { name: 'Earth',              url: 'https://earth.google.com/web/',              icon: 'img/apps/earth.png',              section: 'more' },
    { name: 'Saved',              url: 'https://www.google.com/save',                icon: 'img/apps/saved.png',              section: 'more' },
    { name: 'Arts and Culture',   url: 'https://artsandculture.google.com/',         icon: 'img/apps/arts-and-culture.png',   section: 'more' },
    { name: 'Google Ads',         url: 'https://ads.google.com/',                    icon: 'img/apps/google-ads.png',         section: 'more' },
    { name: 'Merchant Center',    url: 'https://merchants.google.com/',              icon: 'img/apps/merchant-center.png',    section: 'more' },
    { name: 'Travel',             url: 'https://www.google.com/travel/',             icon: 'img/apps/travel.png',             section: 'more' },
    { name: 'Forms',              url: 'https://docs.google.com/forms/',             icon: 'img/apps/forms.png',              section: 'more' },
    { name: 'Store',              url: 'https://store.google.com/',                  icon: 'img/apps/store.png',              section: 'more' },
    { name: 'Chrome Web Store',   url: 'https://chromewebstore.google.com/',         icon: 'img/apps/chrome-web-store.png',   section: 'more' },
    { name: 'Google Fi Wireless', url: 'https://fi.google.com/',                     icon: 'img/apps/google-fi-wireless.png', section: 'more' },
    { name: 'Google Analytics',   url: 'https://analytics.google.com/analytics/web', icon: 'img/apps/google-analytics.png',   section: 'more' },
    { name: 'YouTube Music',      url: 'https://music.youtube.com/',                 icon: 'img/apps/youtube-music.png',      section: 'more' }
  ],

  /* --- Links dashboard: news card ---------------------------------------- */
  news: {
    date: '8/5/26',
    body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Etiam ornare ' +
          'sagittis elit, vel dictum massa tincidunt eget. Praesent sollicitudin ' +
          'mauris quis ligula lacinia ultrices. Morbi ut lectus tellus. Suspendisse ' +
          'ut purus ac tortor faucibus suscipit vitae ut ante. Nam varius enim eget ' +
          'ex eleifend cursus. Sed cursus, ex in auctor dignissim, enim dui fermentum ' +
          'leo, vel tempus est erat vitae eros. Vivamus massa orci, suscipit eu libero ' +
          'sed, auctor ullamcorper purus. Duis vel ex lorem. Suspendisse hendrerit quis ' +
          'ante ac congue. Nunc fringilla volutpat tellus eget suscipit. Aliquam nec ' +
          'sapien nec enim auctor cursus. Praesent viverra, arcu sit amet imperdiet ' +
          'varius, neque arcu iaculis nibh, a commodo risus dolor sed odio. Aliquam ' +
          'eget nunc pharetra, lobortis sapien in, auctor sem. Sed ante augue, aliquam ' +
          'at leo at, semper volutpat turpis.'
  },

  /* --- Links dashboard: update card -------------------------------------- */
  updates: [
    { name: 'Overcloaked', delta: 15 },
    { name: 'Rammerhead', delta: 15 },
    { name: 'Lunar', delta: 15 }
  ],

  /* --- Links dashboard: providers ----------------------------------------
     Drives the "Total links" bar chart in the rail and the Type filter.
     `count` is the provider's total number of known links, which is why it
     is larger than the number of sample rows listed below.
     ---------------------------------------------------------------------- */
  providers: [
    { name: 'Overcloaked',  count: 179 },
    { name: 'Lunar',        count: 161 },
    { name: 'Nexora',       count: 132 },
    { name: 'Galaxy',       count:  87 },
    { name: 'DDX',          count:  72 },
    { name: 'Rammerhead',   count:  54 },
    { name: 'Utopia',       count:  29 },
    { name: 'Selenite',     count:  29 },
    { name: 'DogeUB',       count:  29 },
    { name: 'Interstellar', count:  29 },
    { name: 'Space',        count:  29 }
  ],

  /* --- Links dashboard: the links themselves ------------------------------
     One row per link. `type` is the provider it belongs to, so the Type
     filter narrows the list to a single provider and dims the other bars.
     Swap these for your real links — the whole row is the clickable target.
     ---------------------------------------------------------------------- */
  links: [
    { name: 'overcloaked.app',        url: 'https://overcloaked.app',        status: 'working',  type: 'Overcloaked' },
    { name: 'oc-mirror.pages.dev',    url: 'https://oc-mirror.pages.dev',    status: 'working',  type: 'Overcloaked' },
    { name: 'overcloaked2.dev',       url: 'https://overcloaked2.dev',       status: 'unstable', type: 'Overcloaked' },
    { name: 'lunar.rip',              url: 'https://lunar.rip',              status: 'working',  type: 'Lunar' },
    { name: 'lunar-mirror.app',       url: 'https://lunar-mirror.app',       status: 'working',  type: 'Lunar' },
    { name: 'lunar.pages.dev',        url: 'https://lunar.pages.dev',        status: 'down',     type: 'Lunar' },
    { name: 'nexora.app',             url: 'https://nexora.app',             status: 'working',  type: 'Nexora' },
    { name: 'nexora-mirror.net',      url: 'https://nexora-mirror.net',      status: 'untested', type: 'Nexora' },
    { name: 'galaxy.pages.dev',       url: 'https://galaxy.pages.dev',       status: 'unstable', type: 'Galaxy' },
    { name: 'galaxy-proxy.app',       url: 'https://galaxy-proxy.app',       status: 'working',  type: 'Galaxy' },
    { name: 'ddx.app',                url: 'https://ddx.app',                status: 'working',  type: 'DDX' },
    { name: 'ddx-mirror.dev',         url: 'https://ddx-mirror.dev',         status: 'down',     type: 'DDX' },
    { name: 'rammerhead.app',         url: 'https://rammerhead.app',         status: 'working',  type: 'Rammerhead' },
    { name: 'rh-mirror.dev',          url: 'https://rh-mirror.dev',          status: 'unstable', type: 'Rammerhead' },
    { name: 'utopia.pages.dev',       url: 'https://utopia.pages.dev',       status: 'unstable', type: 'Utopia' },
    { name: 'selenite.app',           url: 'https://selenite.app',           status: 'down',     type: 'Selenite' },
    { name: 'selenite-mirror.dev',    url: 'https://selenite-mirror.dev',    status: 'untested', type: 'Selenite' },
    { name: 'dogeub.app',             url: 'https://dogeub.app',             status: 'working',  type: 'DogeUB' },
    { name: 'interstellar.app',       url: 'https://interstellar.app',       status: 'untested', type: 'Interstellar' },
    { name: 'interstellar-mirror.dev',url: 'https://interstellar-mirror.dev',status: 'working',  type: 'Interstellar' },
    { name: 'space.pages.dev',        url: 'https://space.pages.dev',        status: 'working',  type: 'Space' },
    { name: 'space-mirror.app',       url: 'https://space-mirror.app',       status: 'unstable', type: 'Space' }
  ],

  statuses: {
    working:  { label: 'Working',  className: 'badge--working' },
    unstable: { label: 'Unstable', className: 'badge--unstable' },
    down:     { label: 'Down',     className: 'badge--down' },
    untested: { label: 'Untested', className: 'badge--untested' }
  }
};
