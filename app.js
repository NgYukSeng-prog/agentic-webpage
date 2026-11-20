/* ============================================================================
   Agentic — app.js
   ----------------------------------------------------------------------------
   Vanilla JS single-page application.

   Sections
   A. Helpers
   B. Static content (credit packs, sample briefs)
   C. Persistent state (localStorage): credits, subscriptions, email
   D. Hash router
   E. Credit UI (bottom-left pill, subscribe button states)
   F. Home / sample output rendering
   G. Manage My Plan (packs, checkout modal, active subscriptions)
   H. Configure page (calculator, stock grid lock, activation form)
   I. Success page + webhook sync
   J. Wallet popover, modal, toast, init
   ========================================================================== */

(function () {
  'use strict';

  /* =============================== A. HELPERS ============================= */
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) =>
    Array.prototype.slice.call((root || document).querySelectorAll(selector));

  const CFG = window.CONFIG || {};

  const CREDITS_PER_STOCK = toPositiveInt(CFG.CREDITS_PER_STOCK_WEEK, 5);
  const SUB_DAYS = toPositiveInt(CFG.SUBSCRIPTION_DAYS, 7);
  const DEFAULT_CREDITS = Number.isFinite(Number(CFG.DEFAULT_CREDITS))
    ? Math.max(0, Math.floor(Number(CFG.DEFAULT_CREDITS)))
    : 4;
  const TIMEZONE = CFG.TIMEZONE || 'Asia/Kuala_Lumpur';
  const STORAGE_KEY = CFG.STORAGE_KEY || 'agentic.state.v1';
  const AGENT_ID = CFG.AGENT_ID || 'stock-market-news-agent';
  const AGENT_NAME = CFG.AGENT_NAME || 'Stock Market News Agent';
  const STOCKS = Array.isArray(CFG.SUPPORTED_STOCKS) ? CFG.SUPPORTED_STOCKS : [];

  /* B2B Lead Scraper configuration (15 credits per 1,000-lead run). */
  const LEAD_CREDITS = toPositiveInt(CFG.LEAD_SCRAPER_CREDITS, 15);
  const LEAD_AGENT_ID = CFG.LEAD_SCRAPER_AGENT_ID || 'b2b-lead-scraper';
  const LEAD_AGENT_NAME = CFG.LEAD_SCRAPER_AGENT_NAME || 'B2B Lead Scraper Agent';
  const LEAD_TARGET = toPositiveInt(CFG.LEAD_SCRAPER_TARGET_ROWS, 1000);
  const LEAD_POLL_MS = toPositiveInt(CFG.LEAD_SCRAPER_POLL_MS, 5000);
  const LEAD_START_URL = CFG.LEAD_SCRAPER_START_URL || '';
  const LEAD_STATUS_URL = CFG.LEAD_SCRAPER_STATUS_URL || '';
  const LEAD_DOWNLOAD_URL = CFG.LEAD_SCRAPER_DOWNLOAD_URL || '';
  const LEAD_COUNTRIES = Array.isArray(CFG.LEAD_SCRAPER_COUNTRIES) && CFG.LEAD_SCRAPER_COUNTRIES.length
    ? CFG.LEAD_SCRAPER_COUNTRIES
    : ['Malaysia', 'Other (Custom Country)'];
  const LEAD_SAMPLE_TERMS = Array.isArray(CFG.LEAD_SCRAPER_SAMPLE_TERMS)
    ? CFG.LEAD_SCRAPER_SAMPLE_TERMS
    : [];
  const LEAD_REQUIRED_COLUMNS = Array.isArray(CFG.LEAD_SCRAPER_REQUIRED_COLUMNS)
    ? CFG.LEAD_SCRAPER_REQUIRED_COLUMNS
    : [
        { id: 'company_name', label: 'Company Name' },
        { id: 'email', label: 'Email' },
        { id: 'phone', label: 'Phone Number' }
      ];
  const LEAD_OPTIONAL_COLUMNS = Array.isArray(CFG.LEAD_SCRAPER_OPTIONAL_COLUMNS)
    ? CFG.LEAD_SCRAPER_OPTIONAL_COLUMNS
    : [];
  const RING_LENGTH = 364.42; // 2 * PI * 58

  function toPositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  /* Note: entity values are written as \u0026… escapes so the source file itself
     never contains raw characters that could be re-escaped by tooling. */
  const HTML_ESCAPES = {
    '&': '\u0026amp;',
    '<': '\u0026lt;',
    '>': '\u0026gt;',
    '"': '\u0026quot;',
    "'": '\u0026#39;'
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return HTML_ESCAPES[ch];
    });
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(String(value || '').trim());
  }

  function money(n) {
    return '$' + Number(n).toFixed(2);
  }

  function fmtMYT(iso) {
    try {
      return (
        new Date(iso).toLocaleString('en-GB', {
          timeZone: TIMEZONE,
          weekday: 'short',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }) + ' MYT'
      );
    } catch (err) {
      return String(iso);
    }
  }

  function daysLeft(iso) {
    const ms = new Date(iso).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86400000));
  }

  /* =========================== B. STATIC CONTENT ========================== */

  const PACKS = [
    {
      id: 'starter',
      name: 'Starter Top-Up',
      price: 5,
      credits: 5,
      blurb: 'Covers 1 stock for 7 days',
      note: '$5.00/wk effective rate',
      features: [
        '1 stock monitored for 7 days',
        'Daily brief at 07:00 MYT',
        'MACD bias + news synthesis',
        'No auto-renewal'
      ]
    },
    {
      id: 'standard',
      name: 'Standard Trader Pack',
      price: 10,
      credits: 10,
      blurb: 'Covers 2 stocks for 7 days',
      note: 'Most traders start here',
      popular: true,
      features: [
        '2 stocks monitored for 7 days',
        'Everything in Starter',
        'Swap watchlist on each activation',
        'Delivery + receipt email'
      ]
    },
    {
      id: 'pro',
      name: 'Pro Watchlist Pack',
      price: 15,
      credits: 15,
      blurb: 'Covers 3 stocks for 7 days',
      note: 'Ideal for sector rotation',
      features: [
        '3 stocks monitored for 7 days',
        'Everything in Standard',
        'Priority data verification pass',
        'Great for comparing peers'
      ]
    },
    {
      id: 'power',
      name: 'Power Portfolio Pack',
      price: 25,
      credits: 30,
      bonus: 5,
      blurb: 'Covers up to 6 stocks for 7 days',
      note: 'Best value per credit ($0.83)',
      features: [
        '6 stocks monitored for 7 days',
        'Includes 5 bonus credits',
        'Everything in Pro',
        'Best value per credit'
      ]
    }
  ];

  /* Realistic sample briefs used by the home preview + "live sample" modal.
     Numbers are illustrative only. */
  const BRIEFS = {
    NVDA: {
      symbol: 'NVDA',
      price: 138.42,
      prev: 135.88,
      low52: 86.62,
      high52: 153.13,
      volume: '1.8× avg vol',
      changePct: 1.87,
      bias: 'Hold',
      score: 62,
      note:
        'MACD line +0.42 above signal +0.28 (histogram +0.14). Bullish structure intact above the $132.40 shelf, but momentum is flattening — hence Hold rather than Buy.',
      news: [
        { text: 'Hyperscaler capex guidance reaffirmed for H2; data-centre orders remain the swing factor.', src: 'Reuters' },
        { text: 'Rack-scale Blackwell shipments reportedly tracking ahead of internal schedule.', src: 'Bloomberg' },
        { text: 'Options desks flag heavy call skew into the December expiry.', src: 'MarketWatch' }
      ]
    },
    AAPL: {
      symbol: 'AAPL',
      price: 227.64,
      prev: 229.11,
      low52: 164.08,
      high52: 240.03,
      volume: '0.9× avg vol',
      changePct: -0.64,
      bias: 'Hold',
      score: 47,
      note:
        'MACD line +0.08 versus signal +0.05 (histogram +0.03). Momentum is neutral and price is mid-range — no actionable edge until either $218 support or $234 resistance breaks.',
      news: [
        { text: 'Services revenue mix hits a record share of gross profit, per channel checks.', src: 'CNBC' },
        { text: 'EU App Store fee ruling adds a modest, quantified overhang to services margins.', src: 'Financial Times' },
        { text: 'Supplier orders for the next handset cycle described as "stable, not urgent".', src: 'Nikkei' }
      ]
    },
    TSLA: {
      symbol: 'TSLA',
      price: 251.87,
      prev: 257.83,
      low52: 138.8,
      high52: 299.29,
      volume: '1.4× avg vol',
      changePct: -2.31,
      bias: 'Sell',
      score: 27,
      note:
        'MACD line −1.86 below signal −1.21 (histogram −0.65). Bearish crossover with expanding negative histogram; rallies into $265 have been sold.',
      news: [
        { text: 'Quarterly delivery estimates trimmed by two sell-side desks on softer European registrations.', src: 'Reuters' },
        { text: 'Energy storage deployments hit a quarterly record, partially offsetting auto softness.', src: 'Bloomberg' },
        { text: 'Price cuts extended to two more markets; margin commentary due at the next call.', src: 'WSJ' }
      ]
    }
  };

  const TITLES = {
    home: 'Agentic — Autonomous Pre-Market Intelligence',
    agents: 'Agentic Agent — Stock Brief and B2B Lead Scraper',
    plans: 'Manage My Plan — Credit Top-Ups in USD',
    about: 'About Us — Agentic',
    configure: 'Configure Your Subscription — Agentic',
    'scraper-results': 'Scraper Results — Agentic',
    success: 'Subscription Confirmed — Agentic'
  };

  /* ============================ C. STATE ================================== */
  function defaultState() {
    return {
      credits: DEFAULT_CREDITS,
      email: '',
      name: '',
      subscriptions: [],
      lastSubscription: null,
      scraperJob: null
    };
  }

  function loadState() {
    const base = defaultState();
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return base;

      const credits = Number(parsed.credits);
      return {
        credits: Number.isFinite(credits) && credits >= 0 ? Math.floor(credits) : base.credits,
        email: typeof parsed.email === 'string' ? parsed.email : '',
        name: typeof parsed.name === 'string' ? parsed.name : '',
        subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
        lastSubscription:
          parsed.lastSubscription && typeof parsed.lastSubscription === 'object'
            ? parsed.lastSubscription
            : null,
        scraperJob:
          parsed.scraperJob && typeof parsed.scraperJob === 'object' ? parsed.scraperJob : null
      };
    } catch (err) {
      return base;
    }
  }

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      // Private mode / storage disabled — the session still works in memory.
      console.warn('[Agentic] Could not persist state to localStorage.', err);
    }
  }

  let state = loadState();
  let selectedStocks = []; // in-memory watchlist selection for #configure
  let lastWebhookResult = null;
  let pendingWebhook = false;

  function maxAffordableStocks() {
    return Math.floor(Math.max(0, state.credits) / CREDITS_PER_STOCK);
  }

  function activeSubscriptions() {
    return (state.subscriptions || []).filter(function (sub) {
      return sub && sub.expiresAt && new Date(sub.expiresAt).getTime() > Date.now();
    });
  }

  /* ============================ D. ROUTER ================================= */
  const ROUTES = ['home', 'agents', 'plans', 'about', 'configure', 'scraper-results', 'success'];

  function currentRoute() {
    const raw = String(window.location.hash || '').replace(/^#\/?/, '');
    const name = raw.split('?')[0].toLowerCase();
    return ROUTES.indexOf(name) !== -1 ? name : 'home';
  }

  function onRouteChange() {
    const route = currentRoute();

    $$('.view').forEach(function (view) {
      view.classList.toggle('is-active', view.getAttribute('data-view') === route);
    });

    $$('.nav-links a[data-route]').forEach(function (link) {
      const r = link.getAttribute('data-route');
      const agentRoutes = route === 'configure' || route === 'success' || route === 'scraper-results';
      const active = r === route || (agentRoutes && r === 'agents');
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    closeMobileNav();
    closeWallet();
    closeModal(false);
    stopScraperTimers();

    if (route === 'configure') enterConfigure();
    if (route === 'plans') renderPlans();
    if (route === 'success') renderSuccess();
    if (route === 'scraper-results') renderScraperResults();

    document.title = TITLES[route] || TITLES.home;
    window.scrollTo(0, 0);
  }

  /* ======================= E. CREDIT UI / SUBSCRIBE ======================= */
  function syncCreditUI() {
    $$('[data-credit-count]').forEach(function (el) {
      el.textContent = String(state.credits);
    });
    updateSubscribeButton();
    updateScraperButton();
    renderWalletSubs();
    if (currentRoute() === 'configure') renderConfigure();
  }

  /* Second live agent — same grey/red gate, 15 credits. */
  function updateScraperButton() {
    const btn = $('#scraperSubscribeBtn');
    if (!btn) return;
    const caption = $('#scraperSubscribeCaption');
    const enough = state.credits >= LEAD_CREDITS;

    btn.disabled = !enough;
    btn.classList.toggle('is-disabled', !enough);
    btn.classList.toggle('is-ready', enough);
    btn.setAttribute('aria-disabled', enough ? 'false' : 'true');
    btn.textContent = 'Subscribe';

    if (caption) {
      caption.innerHTML = enough
        ? '<strong>' + state.credits + ' credits</strong> available · ' + LEAD_CREDITS +
          ' credits per 1,000-lead run.'
        : 'Needs ' + LEAD_CREDITS +
          ' credits (1,000 leads). <a href="#plans">Top up in Manage My Plan</a>.';
    }
  }

  function updateSubscribeButton() {
    const btn = $('#subscribeBtn');
    if (!btn) return;
    const caption = $('#subscribeCaption');
    const enough = state.credits >= CREDITS_PER_STOCK;

    btn.disabled = !enough;
    btn.classList.toggle('is-disabled', !enough);
    btn.classList.toggle('is-ready', enough);
    btn.setAttribute('aria-disabled', enough ? 'false' : 'true');
    btn.textContent = 'Subscribe';

    if (caption) {
      caption.innerHTML = enough
        ? 'You have <strong>' +
          state.credits +
          ' credits</strong>. Activating deducts ' +
          CREDITS_PER_STOCK +
          ' credits for 1 stock / ' +
          SUB_DAYS +
          ' days.'
        : 'Requires at least ' +
          CREDITS_PER_STOCK +
          ' credits for ' +
          SUB_DAYS +
          ' days (1 stock). <a href="#plans">Top up in Manage My Plan</a>.';
    }
  }

  function pulsePill() {
    const pill = $('.credit-pill');
    if (!pill) return;
    pill.classList.remove('is-pulse');
    // Force reflow so the animation can restart.
    void pill.offsetWidth;
    pill.classList.add('is-pulse');
  }

  /* ==================== F. HOME / SAMPLE BRIEF RENDER ===================== */
  function renderBrief(symbol) {
    const b = BRIEFS[symbol];
    if (!b) return '';

    const rangePct = clamp(((b.price - b.low52) / (b.high52 - b.low52)) * 100, 2, 98);
    const scorePct = clamp((b.score + 100) / 2, 2, 98);
    const up = b.changePct >= 0;
    const changeText = (up ? '+' : '-') + Math.abs(b.changePct).toFixed(2) + '%';
    const biasClass = String(b.bias).toLowerCase();

    const news = b.news
      .map(function (item) {
        return '<li>' + escapeHtml(item.text) + ' <em>· ' + escapeHtml(item.src) + '</em></li>';
      })
      .join('');

    return (
      '<div class="brief">' +
      '  <div class="brief-head">' +
      '    <div class="brief-agent">' +
      '      <span class="brief-avatar" aria-hidden="true">A</span>' +
      '      <div class="brief-agent-text">' +
      '        <strong>' + escapeHtml(AGENT_NAME) + '</strong>' +
      '        <span>to you · 07:00 MYT · Day 1 of ' + SUB_DAYS + '</span>' +
      '      </div>' +
      '    </div>' +
      '    <span class="brief-tag">7-Day Brief</span>' +
      '  </div>' +
      '  <div class="brief-title">Pre-market brief · ' + escapeHtml(b.symbol) + '</div>' +
      '  <div class="brief-price-row">' +
      '    <div class="brief-price-wrap">' +
      '      <span class="brief-price">' + money(b.price) + '</span>' +
      '      <span class="pill-change ' + (up ? 'up' : 'down') + '">' + changeText + '</span>' +
      '    </div>' +
      '    <span class="brief-sub">Prev close ' + money(b.prev) + ' · ' + escapeHtml(b.volume) + '</span>' +
      '  </div>' +
      '  <div class="brief-block">' +
      '    <div class="brief-block-head"><span>52-week range</span><span>' +
      money(b.low52) + ' — ' + money(b.high52) + '</span></div>' +
      '    <div class="range-track">' +
      '      <span class="range-fill" style="width:' + rangePct.toFixed(1) + '%"></span>' +
      '      <span class="range-marker" style="left:' + rangePct.toFixed(1) + '%"></span>' +
      '    </div>' +
      '  </div>' +
      '  <div class="brief-block">' +
      '    <div class="brief-block-head"><span>MACD 12/26/9 momentum</span>' +
      '      <span class="bias-chip ' + biasClass + '">' + escapeHtml(b.bias.toUpperCase()) + '</span></div>' +
      '    <div class="bias-track"><span class="bias-marker" style="left:' + scorePct.toFixed(1) + '%"></span></div>' +
      '    <div class="bias-scale"><span>Sell</span><span>Hold</span><span>Buy</span></div>' +
      '    <p class="brief-note">' + escapeHtml(b.note) + '</p>' +
      '  </div>' +
      '  <div class="brief-news">' +
      '    <div class="brief-block-head"><span>Curated news synthesis</span><span>3 sources</span></div>' +
      '    <ul>' + news + '</ul>' +
      '  </div>' +
      '  <div class="brief-foot">Verified OHLC · MACD 12/26/9 · Not financial advice</div>' +
      '</div>'
    );
  }

  function renderHomeBrief(symbol) {
    const target = $('#homeBrief');
    if (target) target.innerHTML = renderBrief(symbol || 'NVDA');
  }

  function openSampleModal() {
    const symbols = Object.keys(BRIEFS);
    openModal(
      '<h2 class="modal-title" id="modalTitle">View Live Sample Output</h2>' +
        '<p class="modal-sub">This is exactly what lands in your inbox at 07:00 MYT — every day of your 7-day window. Switch ticker to preview another brief.</p>' +
        '<div class="tab-row" role="tablist" aria-label="Sample ticker">' +
        symbols
          .map(function (s, i) {
            return (
              '<button type="button" role="tab" aria-selected="' + (i === 0) + '"' +
              ' class="' + (i === 0 ? 'is-active' : '') + '" data-modal-tab="' + s + '">' + s + '</button>'
            );
          })
          .join('') +
        '</div>' +
        '<div class="modal-brief" id="modalBrief">' + renderBrief(symbols[0]) + '</div>' +
        '<div class="modal-foot">' +
        '<span class="fine">Verified OHLC · MACD 12/26/9 · Not financial advice.</span>' +
        '<button type="button" class="btn btn-primary btn-sm" data-modal-close>Close preview</button>' +
        '</div>'
    );

    $$('[data-modal-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('[data-modal-tab]').forEach(function (b) {
          const on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-selected', String(on));
        });
        const panel = $('#modalBrief');
        if (panel) panel.innerHTML = renderBrief(btn.getAttribute('data-modal-tab'));
      });
    });
  }

  /* ======================== G. MANAGE MY PLAN ============================ */
  function renderPlans() {
    const grid = $('#packGrid');
    if (!grid) return;

    grid.innerHTML = PACKS.map(function (p) {
      const bonus = p.bonus ? ' <span class="pack-bonus">(+' + p.bonus + ' bonus)</span>' : '';
      return (
        '<article class="pack' + (p.popular ? ' is-popular' : '') + '">' +
        (p.popular ? '<span class="pack-badge">Most Popular</span>' : '') +
        '<h2>' + escapeHtml(p.name) + '</h2>' +
        '<div class="pack-price"><span class="pack-currency">$</span>' + p.price +
        '<span class="pack-unit">USD</span></div>' +
        '<p class="pack-blurb">' + escapeHtml(p.blurb) + '</p>' +
        '<div class="pack-credits"><strong>' + p.credits + '</strong> credits' + bonus + '</div>' +
        '<ul class="pack-features">' +
        p.features.map(function (f) { return '<li>' + escapeHtml(f) + '</li>'; }).join('') +
        '</ul>' +
        '<button type="button" class="btn ' + (p.popular ? 'btn-primary' : 'btn-ghost') +
        ' btn-block" data-buy="' + p.id + '">Purchase Credits (USD)</button>' +
        '<p class="pack-note">' + escapeHtml(p.note) + '</p>' +
        '</article>'
      );
    }).join('');

    grid.querySelectorAll('[data-buy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openCheckout(btn.getAttribute('data-buy'));
      });
    });

    renderActiveSubs();
    $$('[data-credit-count]').forEach(function (el) {
      el.textContent = String(state.credits);
    });
  }

  function renderActiveSubs() {
    const target = $('#activeSubsList');
    if (!target) return;

    const subs = activeSubscriptions();

    if (!subs.length) {
      target.innerHTML =
        '<p class="empty-note">No active subscriptions yet. Activate the Stock Market News Agent to start receiving 07:00 MYT briefs.</p>';
      return;
    }

    target.innerHTML = subs
      .map(function (sub) {
        const tickers = (sub.watchlist || [])
          .map(function (t) { return '<span class="pill-ticker">' + escapeHtml(t) + '</span>'; })
          .join('');
        const left = daysLeft(sub.expiresAt);
        return (
          '<div class="sub-row">' +
          '<div class="sub-row-main">' +
          '<strong>' + escapeHtml(sub.agentName || AGENT_NAME) + '</strong>' +
          '<span class="sub-emails">' + escapeHtml(sub.email || '') + ' · expires ' + escapeHtml(fmtMYT(sub.expiresAt)) + '</span>' +
          '</div>' +
          '<div class="sub-row-tickers">' + tickers + '</div>' +
          '<div class="sub-row-meta">' +
          '<span>' + left + ' day' + (left === 1 ? '' : 's') + ' left</span>' +
          '<span>' + (sub.creditsSpent || 0) + ' credits</span>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function openCheckout(packId) {
    const pack = PACKS.filter(function (p) { return p.id === packId; })[0];
    if (!pack) return;

    const newBalance = state.credits + pack.credits;

    openModal(
      '<h2 class="modal-title" id="modalTitle">Purchase Credits (USD)</h2>' +
        '<p class="modal-sub">Top up once, spend whenever. Credits sit in your wallet until you activate a subscription.</p>' +
        '<div class="checkout">' +
        '  <div class="checkout-summary">' +
        '    <div class="checkout-pack">' +
        '      <span class="checkout-pack-name">' + escapeHtml(pack.name) + '</span>' +
        '      <span class="checkout-pack-credits">+' + pack.credits + ' credits</span>' +
        '    </div>' +
        '    <p>' + escapeHtml(pack.blurb) + (pack.bonus ? ' · includes ' + pack.bonus + ' bonus credits' : '') + '</p>' +
        '    <div class="checkout-line"><span>Subtotal</span><span>' + money(pack.price) + '</span></div>' +
        '    <div class="checkout-line"><span>Processing fee</span><span>$0.00</span></div>' +
        '    <div class="checkout-line total"><span>Total due today</span><span>' + money(pack.price) + ' USD</span></div>' +
        '    <div class="checkout-line"><span>New balance</span><span>' + newBalance + ' credits</span></div>' +
        '  </div>' +
        '  <form class="checkout-form" id="checkoutForm" novalidate>' +
        '    <label class="field"><span>Email for receipt (optional)</span>' +
        '      <input type="email" id="checkoutEmail" placeholder="you@example.com" autocomplete="email" value="' +
        escapeHtml(state.email) + '"></label>' +
        '    <label class="field"><span>Card number</span>' +
        '      <input type="text" class="is-readonly" value="4242 4242 4242 4242" readonly aria-readonly="true"></label>' +
        '    <div class="field-row">' +
        '      <label class="field"><span>Expiry</span>' +
        '        <input type="text" class="is-readonly" value="12 / 29" readonly aria-readonly="true"></label>' +
        '      <label class="field"><span>CVC</span>' +
        '        <input type="text" class="is-readonly" value="•••" readonly aria-readonly="true"></label>' +
        '    </div>' +
        '    <p class="demo-note">Demo checkout — no payment is processed. Credits are added instantly so you can test the full flow.</p>' +
        '    <button type="submit" class="btn btn-primary btn-lg btn-block">Pay ' + money(pack.price) + ' (Demo)</button>' +
        '  </form>' +
        '</div>'
    );

    const form = $('#checkoutForm');
    if (!form) return;

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const emailEl = $('#checkoutEmail');
      const email = emailEl ? emailEl.value.trim() : '';

      if (email && !isValidEmail(email)) {
        toast('Enter a valid email address, or leave the receipt field blank.', 'warn');
        if (emailEl) emailEl.focus();
        return;
      }

      if (email) state.email = email;
      state.credits += pack.credits;
      saveState();

      syncCreditUI();
      renderPlans();
      closeModal();
      pulsePill();
      toast('+' + pack.credits + ' credits added · new balance ' + state.credits + ' credits', 'success');
    });
  }

  /* =========================== H. CONFIGURE ============================== */
  function buildStockGrid() {
    const grid = $('#stockGrid');
    if (!grid) return;

    grid.innerHTML = STOCKS.map(function (stock) {
      return (
        '<button type="button" class="stock-card" data-ticker="' + escapeHtml(stock.symbol) + '" aria-pressed="false">' +
        '<span class="stock-check" aria-hidden="true">' +
        '<svg viewBox="0 0 20 20" width="12" height="12"><path d="M4.5 10.5l3.4 3.4 7.6-7.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</span>' +
        '<span class="stock-symbol">' + escapeHtml(stock.symbol) + '</span>' +
        '<span class="stock-name">' + escapeHtml(stock.name) + '</span>' +
        '<span class="stock-tag">' + escapeHtml(stock.tag || '') + '</span>' +
        '</button>'
      );
    }).join('');

    grid.addEventListener('click', function (event) {
      const card = event.target.closest ? event.target.closest('.stock-card') : null;
      if (!card || card.disabled) return;
      toggleStock(card.getAttribute('data-ticker'));
    });
  }

  function toggleStock(symbol) {
    const max = maxAffordableStocks();
    const index = selectedStocks.indexOf(symbol);

    if (index !== -1) {
      selectedStocks.splice(index, 1);
      renderConfigure();
      return;
    }

    if (selectedStocks.length >= max) {
      toast('Insufficient credits for +1 stock (needs +' + CREDITS_PER_STOCK + ' credits).', 'warn');
      return;
    }

    selectedStocks.push(symbol);
    renderConfigure();
  }

  function enterConfigure() {
    const max = maxAffordableStocks();

    // Prune selections that the balance no longer supports.
    if (selectedStocks.length > max) selectedStocks = selectedStocks.slice(0, Math.max(0, max));
    // Default to a single pre-selected stock when the user can afford one.
    if (selectedStocks.length === 0 && max > 0 && STOCKS.length) {
      selectedStocks = [STOCKS[0].symbol];
    }
    if (max === 0) selectedStocks = [];

    // Restore saved identity once.
    const nameEl = $('#fullName');
    const emailEl = $('#email');
    if (nameEl && !nameEl.value && state.name) nameEl.value = state.name;
    if (emailEl && !emailEl.value && state.email) emailEl.value = state.email;

    renderConfigure();
  }

  function renderConfigure() {
    const body = $('#configureBody');
    const lockedNotice = $('#configureLocked');
    const grid = $('#stockGrid');
    if (!body || !lockedNotice) return;

    const max = maxAffordableStocks();
    const locked = max === 0;

    lockedNotice.hidden = !locked;
    body.hidden = locked;
    if (locked) return;

    if (selectedStocks.length > max) selectedStocks = selectedStocks.slice(0, max);

    const cost = selectedStocks.length * CREDITS_PER_STOCK;
    const remaining = Math.max(state.credits - cost, 0);

    const setText = function (selector, text) {
      const el = $(selector);
      if (el) el.textContent = text;
    };

    setText('#calcAvailable', state.credits + ' Credits');
    setText('#calcSelected', String(selectedStocks.length));
    setText('#calcDuration', SUB_DAYS + ' Days / 1 Week');
    setText('#calcCost', cost + ' Credits');
    setText('#calcRemaining', 'Remaining after activation: ' + remaining + ' credits');

    // Stock grid lock enforcement.
    if (grid) {
      const atCap = selectedStocks.length >= max;
      $$('.stock-card', grid).forEach(function (card) {
        const ticker = card.getAttribute('data-ticker');
        const isSelected = selectedStocks.indexOf(ticker) !== -1;
        const isLocked = !isSelected && atCap;

        card.classList.toggle('is-selected', isSelected);
        card.classList.toggle('is-locked', isLocked);
        card.disabled = isLocked;
        card.setAttribute('aria-pressed', String(isSelected));
        if (isLocked) {
          card.setAttribute(
            'title',
            'Insufficient credits for +1 stock (needs +' + CREDITS_PER_STOCK + ' credits)'
          );
        } else {
          card.removeAttribute('title');
        }
      });
    }

    const hint = $('#stockGridHint');
    if (hint) {
      if (selectedStocks.length >= max) {
        hint.textContent =
          'Selection limit reached · ' + selectedStocks.length + ' of ' + max +
          ' affordable stock' + (max === 1 ? '' : 's') +
          ' selected. Deselect one to swap, or top up for more.';
      } else {
        const free = max - selectedStocks.length;
        hint.textContent =
          'Choose up to ' + max + ' stock' + (max === 1 ? '' : 's') +
          ' for this activation · ' + free + ' slot' + (free === 1 ? '' : 's') + ' left.';
      }
    }

    // Live form summary.
    const summary = $('#configSummary');
    if (summary) {
      const tickers = selectedStocks.length
        ? selectedStocks
            .map(function (t) { return '<span class="pill-ticker">' + escapeHtml(t) + '</span>'; })
            .join('')
        : '<span class="muted">None selected</span>';

      summary.innerHTML =
        '<div class="config-summary-row"><span>Watchlist</span>' +
        '<span class="config-summary-tickers">' + tickers + '</span></div>' +
        '<div class="config-summary-row"><span>Activation cost</span>' +
        '<span>' + cost + ' credits · ' + SUB_DAYS + ' days</span></div>' +
        '<div class="config-summary-row"><span>Balance after activation</span>' +
        '<span>' + remaining + ' credits</span></div>';
    }

    const activateBtn = $('#activateBtn');
    if (activateBtn) {
      activateBtn.classList.remove('is-busy');
      activateBtn.textContent =
        'Confirm & Spend ' + cost + ' Credits (' + SUB_DAYS + ' Days)';
      activateBtn.disabled = selectedStocks.length === 0 || cost > state.credits;
    }
  }

  function setFieldError(input, message) {
    const wrap = input.closest('.field');
    if (!wrap) return;
    wrap.classList.add('has-error');
    const err = $('.field-error', wrap);
    if (err) err.textContent = message;
    input.setAttribute('aria-invalid', 'true');
  }

  function clearFieldError(input) {
    const wrap = input.closest('.field');
    if (!wrap) return;
    wrap.classList.remove('has-error');
    const err = $('.field-error', wrap);
    if (err) err.textContent = '';
    input.removeAttribute('aria-invalid');
  }

  function handleActivate(event) {
    event.preventDefault();

    const nameEl = $('#fullName');
    const emailEl = $('#email');
    if (!nameEl || !emailEl) return;

    clearFieldError(nameEl);
    clearFieldError(emailEl);

    const name = nameEl.value.trim();
    const email = emailEl.value.trim();
    const cost = selectedStocks.length * CREDITS_PER_STOCK;
    let valid = true;

    if (name.length < 2) {
      setFieldError(nameEl, 'Please enter your full name.');
      valid = false;
    }
    if (!isValidEmail(email)) {
      setFieldError(emailEl, 'Enter a valid email address (e.g. you@example.com).');
      valid = false;
    }
    if (selectedStocks.length === 0) {
      toast('Select at least one stock to activate.', 'warn');
      valid = false;
    }
    if (cost > state.credits) {
      toast('Not enough credits for this watchlist. Top up in Manage My Plan.', 'warn');
      valid = false;
    }
    if (!valid) return;

    const now = new Date();
    const expires = new Date(now.getTime() + SUB_DAYS * 86400000);

    const subscription = {
      id: 'sub_' + now.getTime(),
      agentId: AGENT_ID,
      agentName: AGENT_NAME,
      name: name,
      email: email,
      watchlist: selectedStocks.slice(),
      durationDays: SUB_DAYS,
      creditsSpent: cost,
      startedAt: now.toISOString(),
      expiresAt: expires.toISOString()
    };

    // 1. Deduct credits + persist subscription immediately.
    state.credits -= cost;
    state.name = name;
    state.email = email;
    state.subscriptions = [subscription].concat(state.subscriptions || []);
    state.lastSubscription = subscription;
    saveState();

    // 2. Reflect the new balance everywhere (pill, subscribe button, etc.).
    syncCreditUI();
    pulsePill();

    // 3. Build + fire the n8n webhook payload (non-blocking).
    const payload = {
      event: 'subscriber.activated',
      agent_id: AGENT_ID,
      name: name,
      email: email,
      watchlist: subscription.watchlist,
      duration_days: SUB_DAYS,
      credits_spent: cost,
      remaining_credits: state.credits,
      timezone: TIMEZONE,
      subscribed_at: subscription.startedAt,
      expires_at: subscription.expiresAt
    };

    console.log('[Agentic] subscriber.activated → ' + (CFG.WEBHOOK_URL || '(no webhook configured)'));
    console.log('[Agentic] webhook payload:', JSON.stringify(payload, null, 2));

    sendWebhook(payload);

    // 4. Show the success page.
    const activateBtn = $('#activateBtn');
    if (activateBtn) {
      activateBtn.disabled = true;
      activateBtn.classList.add('is-busy');
    }
    window.location.hash = '#success';
  }

  /* ====================== I. SUCCESS + WEBHOOK SYNC ====================== */
  function setWebhookBadge(stateName, text) {
    const badge = $('#webhookStatus');
    if (!badge) return;
    badge.classList.remove('is-pending', 'is-ok', 'is-fail');
    if (stateName) badge.classList.add('is-' + stateName);
    const label = $('.webhook-text', badge);
    if (label) label.textContent = text;
  }

  function sendWebhook(payload) {
    pendingWebhook = true;
    lastWebhookResult = { status: 'pending' };
    setWebhookBadge('pending', 'Syncing subscriber to the n8n webhook…');

    const url = CFG.WEBHOOK_URL;

    if (!url || !/^https?:\/\//i.test(url)) {
      pendingWebhook = false;
      lastWebhookResult = { status: 'fail', reason: 'not-configured' };
      setWebhookBadge('fail', 'Demo mode · webhook URL not configured — payload logged to console.');
      return Promise.resolve(lastWebhookResult);
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(function () { controller.abort(); }, 10000)
      : null;

    return fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) {
        if (timer) clearTimeout(timer);
        pendingWebhook = false;

        // n8n's "Respond 200 Subscribed" node returns JSON: { ok, email, … }.
        return response
          .json()
          .catch(function () {
            return null;
          })
          .then(function (body) {
            if (!response.ok) {
              lastWebhookResult = { status: 'fail', code: response.status, body: body };
              setWebhookBadge(
                'fail',
                'Webhook responded HTTP ' + response.status +
                  ' — activation saved locally, payload logged.'
              );
              return lastWebhookResult;
            }

            if (body && body.ok === false) {
              lastWebhookResult = { status: 'fail', code: response.status, body: body };
              setWebhookBadge(
                'fail',
                'n8n rejected the subscriber — check the Upsert Active Subscriber code node.'
              );
              return lastWebhookResult;
            }

            lastWebhookResult = { status: 'ok', code: response.status, body: body };
            setWebhookBadge('ok', 'Synced with 07:00 MYT Agent');
            return lastWebhookResult;
          });
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        pendingWebhook = false;
        lastWebhookResult = { status: 'fail', reason: 'network' };
        // CORS / offline / not-yet-deployed endpoint — the UI flow still completes.
        console.warn(
          '[Agentic] Webhook not reachable yet (the UI flow still completed). Reason:',
          err && err.message ? err.message : err
        );
        setWebhookBadge(
          'fail',
          'Webhook not reachable yet — payload logged to console, activation saved locally.'
        );
        return lastWebhookResult;
      });
  }

  function renderSuccess() {
    const main = $('#successMain');
    const empty = $('#successEmpty');
    if (!main || !empty) return;

    const sub = state.lastSubscription;

    if (!sub) {
      main.hidden = true;
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    main.hidden = false;

    const windowEl = $('#successWindow');
    if (windowEl) {
      windowEl.innerHTML =
        'Active from <strong>' + escapeHtml(fmtMYT(sub.startedAt)) + '</strong> until <strong>' +
        escapeHtml(fmtMYT(sub.expiresAt)) + '</strong> · ' + SUB_DAYS + ' days';
    }

    const summary = $('#successSummary');
    if (summary) {
      const tickers = (sub.watchlist || [])
        .map(function (t) { return '<span class="pill-ticker">' + escapeHtml(t) + '</span>'; })
        .join('');

      summary.innerHTML =
        '<div class="summary-row"><dt>Agent</dt><dd>' + escapeHtml(sub.agentName || AGENT_NAME) + '</dd></div>' +
        '<div class="summary-row"><dt>Delivery email</dt><dd>' + escapeHtml(sub.email || '') + '</dd></div>' +
        '<div class="summary-row"><dt>Monitored stocks</dt><dd>' + tickers + '</dd></div>' +
        '<div class="summary-row"><dt>Credits deducted</dt><dd><strong>' +
        (sub.creditsSpent || 0) + ' Credits</strong></dd></div>' +
        '<div class="summary-row"><dt>Remaining credit balance</dt><dd><strong>' +
        state.credits + ' Credits</strong></dd></div>';
    }

    if (pendingWebhook) {
      setWebhookBadge('pending', 'Syncing subscriber to the n8n webhook…');
    } else if (lastWebhookResult && lastWebhookResult.status === 'ok') {
      setWebhookBadge('ok', 'Synced with 07:00 MYT Agent');
    } else if (lastWebhookResult && lastWebhookResult.status === 'fail') {
      setWebhookBadge(
        'fail',
        'Not synced yet — webhook unreachable. Activation saved locally and logged.'
      );
    } else {
      setWebhookBadge('', 'Activation saved locally.');
    }

    // The bottom-left widget must already show the new balance.
    $$('[data-credit-count]').forEach(function (el) {
      el.textContent = String(state.credits);
    });
  }

  /* ================= J. WALLET, MODAL, TOAST, EVENTS ==================== */
  function toggleWallet(force) {
    const pop = $('#walletPop');
    const btn = $('#pillToggle');
    if (!pop || !btn) return;
    const shouldOpen = typeof force === 'boolean' ? force : pop.hidden;
    pop.hidden = !shouldOpen;
    btn.setAttribute('aria-expanded', String(shouldOpen));
    if (shouldOpen) renderWalletSubs();
  }

  function closeWallet() {
    const pop = $('#walletPop');
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    const btn = $('#pillToggle');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function renderWalletSubs() {
    const list = $('#walletSubs');
    if (!list) return;
    const subs = activeSubscriptions().slice(0, 3);

    if (!subs.length) {
      list.innerHTML =
        '<li><strong>No active subscriptions</strong><span>Top up to start</span></li>';
      return;
    }

    list.innerHTML = subs
      .map(function (sub) {
        return (
          '<li><strong>' + escapeHtml((sub.watchlist || []).join(' · ')) + '</strong>' +
          '<span>' + daysLeft(sub.expiresAt) + 'd left</span></li>'
        );
      })
      .join('');
  }

  let lastFocused = null;

  function openModal(html, wide) {
    const root = $('#modalRoot');
    const body = $('#modalBody');
    if (!root || !body) return;

    body.innerHTML = html;
    root.hidden = false;
    document.body.classList.add('modal-open');
    lastFocused = document.activeElement;

    const dialog = root.querySelector('.modal');
    if (dialog) {
      dialog.classList.toggle('modal-lg', !!wide);
      window.requestAnimationFrame(function () {
        dialog.focus();
      });
    }
  }

  function closeModal(restoreFocus) {
    const root = $('#modalRoot');
    if (!root || root.hidden) return;

    root.hidden = true;
    const body = $('#modalBody');
    if (body) body.innerHTML = '';
    document.body.classList.remove('modal-open');

    const shouldRestore = restoreFocus !== false;
    if (shouldRestore && lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
    lastFocused = null;
  }

  function toast(message, tone) {
    const root = $('#toastRoot');
    if (!root) return;

    const el = document.createElement('div');
    el.className = 'toast toast-' + (tone || 'info');
    el.innerHTML = '<span class="toast-dot" aria-hidden="true"></span><span>' + escapeHtml(message) + '</span>';
    root.appendChild(el);

    while (root.children.length > 3) root.removeChild(root.firstElementChild);

    window.setTimeout(function () {
      el.classList.add('is-out');
      window.setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 320);
    }, 3600);
  }

  function closeMobileNav() {
    const links = $('#navLinks');
    const toggle = $('#navToggle');
    if (!links) return;
    links.classList.remove('is-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function resetDemo() {
    stopScraperTimers();
    state = defaultState();
    selectedStocks = [];
    lastWebhookResult = null;
    pendingWebhook = false;
    saveState();

    syncCreditUI();
    renderPlans();
    renderSuccess();
    renderScraperResults();
    pulsePill();
    closeWallet();
    closeMobileNav();
    toast('Demo reset — balance restored to ' + DEFAULT_CREDITS + ' credits.', 'info');
    if (currentRoute() === 'configure') enterConfigure();
  }

  function updateNextBrief() {
    const el = $('#nextBriefIn');
    if (!el) return;

    const offsetMs = (Number(CFG.TIMEZONE_OFFSET_HOURS) || 8) * 3600000;
    const deliveryHour = Number(CFG.DELIVERY_HOUR_MYT);
    const hour = Number.isFinite(deliveryHour) ? deliveryHour : 7;

    const nowMs = Date.now();
    const mytMs = nowMs + offsetMs;
    const dayStart = Math.floor(mytMs / 86400000) * 86400000;
    let target = dayStart + hour * 3600000;
    while (target <= mytMs) target += 86400000;

    const diff = target - mytMs;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);

    el.textContent = h > 0 ? 'next in ' + h + 'h ' + String(m).padStart(2, '0') + 'm' : 'next in ' + m + 'm';
  }

  function bindEvents() {
    /* Navigation */
    const navToggle = $('#navToggle');
    if (navToggle) {
      navToggle.addEventListener('click', function () {
        const links = $('#navLinks');
        if (!links) return;
        const open = !links.classList.contains('is-open');
        links.classList.toggle('is-open', open);
        navToggle.setAttribute('aria-expanded', String(open));
        if (open) closeWallet();
      });
    }

    $$('#navLinks a').forEach(function (link) {
      link.addEventListener('click', closeMobileNav);
    });

    /* Skip link: focus the main region without hijacking the hash router */
    const skipLink = $('.skip-link');
    if (skipLink && $('#main')) {
      skipLink.addEventListener('click', function (event) {
        event.preventDefault();
        $('#main').focus();
      });
    }

    /* Click-away for the nav + wallet */
    document.addEventListener('click', function (event) {
      const nav = $('#navbar');
      if (nav && !nav.contains(event.target)) closeMobileNav();

      const wallet = $('#wallet');
      if (wallet && !wallet.contains(event.target)) closeWallet();
    });

    /* Wallet popover */
    const pillToggle = $('#pillToggle');
    if (pillToggle) {
      pillToggle.addEventListener('click', function (event) {
        event.stopPropagation();
        toggleWallet();
      });
    }

    const walletClose = $('#walletClose');
    if (walletClose) {
      walletClose.addEventListener('click', function (event) {
        event.stopPropagation();
        closeWallet();
      });
    }

    $$('.pill-cta').forEach(function (link) {
      link.addEventListener('click', closeWallet);
    });

    ['#demoResetPopover', '#demoResetFooter'].forEach(function (selector) {
      const btn = $(selector);
      if (btn) btn.addEventListener('click', resetDemo);
    });

    /* Escape closes overlays */
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeModal();
        closeWallet();
        closeMobileNav();
      }
    });

    /* Modal close targets (backdrop + buttons) */
    const modalRoot = $('#modalRoot');
    if (modalRoot) {
      modalRoot.addEventListener('click', function (event) {
        if (event.target.closest('[data-modal-close]')) closeModal();
      });
    }

    /* Home preview ticker tabs */
    $$('[data-preview-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('[data-preview-tab]').forEach(function (b) {
          const on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-selected', String(on));
        });
        renderHomeBrief(btn.getAttribute('data-preview-tab'));
      });
    });

    /* Sample output modal */
    $$('[data-open-sample]').forEach(function (btn) {
      btn.addEventListener('click', openSampleModal);
    });

    /* Coming-soon waitlist buttons */
    $$('[data-waitlist]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toast(btn.getAttribute('data-waitlist') + ' is on the way — you are on the list.', 'info');
      });
    });

    /* Subscribe → configuration (only reachable when enough credits) */
    const subscribeBtn = $('#subscribeBtn');
    if (subscribeBtn) {
      subscribeBtn.addEventListener('click', function () {
        if (state.credits < CREDITS_PER_STOCK) {
          toast('You need at least ' + CREDITS_PER_STOCK + ' credits to subscribe.', 'warn');
          return;
        }
        window.location.hash = '#configure';
      });
    }

    /* Lead Scraper: subscribe (15 credits) → configuration modal */
    const scraperBtn = $('#scraperSubscribeBtn');
    if (scraperBtn) {
      scraperBtn.addEventListener('click', function () {
        if (state.credits < LEAD_CREDITS) {
          toast('Needs ' + LEAD_CREDITS + ' credits to start a 1,000-lead scrape.', 'warn');
          return;
        }
        openScraperModal();
      });
    }

    /* Lead Scraper: column reference */
    $$('[data-open-columns]').forEach(function (btn) {
      btn.addEventListener('click', openColumnsModal);
    });

    /* Scraper results: resume + download */
    const resumeBtn = $('#resumeBtn');
    if (resumeBtn) resumeBtn.addEventListener('click', handleResume);
    const resumeInput = $('#resumeJobId');
    if (resumeInput) {
      resumeInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          handleResume();
        }
      });
    }
    const downloadBtn = $('#downloadBtn');
    if (downloadBtn) downloadBtn.addEventListener('click', downloadLeads);

    /* Configuration form */
    const configForm = $('#configureForm');
    if (configForm) {
      configForm.addEventListener('submit', handleActivate);
    }

    $$('.config-form input').forEach(function (input) {
      input.addEventListener('input', function () { clearFieldError(input); });
    });

    /* Keep the "next brief" countdown fresh */
    window.setInterval(updateNextBrief, 30000);

    /* Close the mobile menu if the viewport grows */
    window.addEventListener('resize', function () {
      if (window.innerWidth > 960) closeMobileNav();
    });
  }

  /* ==================== K. B2B LEAD SCRAPER ENGINE ======================= */
  const LEAD_COLUMN_LABELS = (function () {
    const map = {};
    LEAD_REQUIRED_COLUMNS.concat(LEAD_OPTIONAL_COLUMNS).forEach(function (col) {
      map[col.id] = col.label;
    });
    return map;
  })();

  /* Lightweight sample-data banks for the offline demo (no external calls). */
  const COUNTRY_META = {
    Malaysia: { suffix: 'Sdn Bhd', tld: '.com.my', dial: '+60', cities: ['Kuala Lumpur', 'Penang', 'Johor Bahru', 'Shah Alam'] },
    Singapore: { suffix: 'Pte Ltd', tld: '.sg', dial: '+65', cities: ['Singapore', 'Jurong', 'Ubi'] },
    Indonesia: { suffix: 'Group', tld: '.co.id', dial: '+62', cities: ['Jakarta', 'Surabaya', 'Bandung'] },
    Thailand: { suffix: 'Co., Ltd.', tld: '.co.th', dial: '+66', cities: ['Bangkok', 'Chiang Mai', 'Rayong'] },
    Vietnam: { suffix: 'JSC', tld: '.vn', dial: '+84', cities: ['Ho Chi Minh City', 'Hanoi', 'Da Nang'] },
    Philippines: { suffix: 'Corp.', tld: '.ph', dial: '+63', cities: ['Manila', 'Cebu', 'Davao'] },
    'United States': { suffix: 'LLC', tld: '.com', dial: '+1', cities: ['Austin', 'Chicago', 'Seattle', 'Atlanta'] },
    'United Kingdom': { suffix: 'Ltd', tld: '.co.uk', dial: '+44', cities: ['London', 'Manchester', 'Leeds'] },
    Germany: { suffix: 'GmbH', tld: '.de', dial: '+49', cities: ['Berlin', 'Munich', 'Stuttgart'] },
    Australia: { suffix: 'Pty Ltd', tld: '.com.au', dial: '+61', cities: ['Sydney', 'Melbourne', 'Brisbane'] },
    Japan: { suffix: 'K.K.', tld: '.co.jp', dial: '+81', cities: ['Tokyo', 'Osaka', 'Nagoya'] },
    'South Korea': { suffix: 'Co., Ltd.', tld: '.co.kr', dial: '+82', cities: ['Seoul', 'Busan', 'Incheon'] },
    India: { suffix: 'Pvt Ltd', tld: '.in', dial: '+91', cities: ['Mumbai', 'Bengaluru', 'Pune'] },
    'United Arab Emirates': { suffix: 'LLC', tld: '.ae', dial: '+971', cities: ['Dubai', 'Abu Dhabi', 'Sharjah'] },
    Canada: { suffix: 'Inc.', tld: '.ca', dial: '+1', cities: ['Toronto', 'Vancouver', 'Calgary'] },
    France: { suffix: 'SARL', tld: '.fr', dial: '+33', cities: ['Paris', 'Lyon', 'Toulouse'] },
    Netherlands: { suffix: 'B.V.', tld: '.nl', dial: '+31', cities: ['Amsterdam', 'Rotterdam', 'Eindhoven'] },
    Brazil: { suffix: 'Ltda', tld: '.com.br', dial: '+55', cities: ['Sao Paulo', 'Rio de Janeiro', 'Curitiba'] },
    'Saudi Arabia': { suffix: 'LLC', tld: '.sa', dial: '+966', cities: ['Riyadh', 'Jeddah', 'Dammam'] },
    Taiwan: { suffix: 'Co., Ltd.', tld: '.com.tw', dial: '+886', cities: ['Taipei', 'Taichung', 'Kaohsiung'] },
    'Hong Kong': { suffix: 'Limited', tld: '.hk', dial: '+852', cities: ['Hong Kong', 'Kowloon', 'Tsuen Wan'] },
    Other: { suffix: 'Ltd', tld: '.com', dial: '+1', cities: ['Central District', 'Industrial Park', 'Business Bay'] }
  };

  const COMPANY_PREFIXES = [
    'Meridian', 'Apex', 'Northwind', 'Vertex', 'Blue Harbor', 'Summit', 'Orbit',
    'Keystone', 'Ironline', 'Cobalt', 'Evergreen', 'Nova', 'Stratus', 'Lumen',
    'Redwood', 'Prime', 'Pinnacle', 'Atlas', 'Crestline', 'Halcyon'
  ];
  const STREETS = [
    'Jalan Merdeka', 'Jalan Industri', 'Market Street', 'Business Park Drive',
    'High Street', 'Rue de Commerce', 'Handelsweg', 'Trade Avenue', 'Foundry Road'
  ];
  const HOURS_BANK = [
    'Mon-Fri · 9:00-18:00',
    'Mon-Sat · 8:30-17:30',
    'Mon-Fri · 8:00-17:00',
    'Mon-Fri · 10:00-19:00'
  ];

  let scraperPollTimer = null;
  let scraperDemoTimer = null;
  const demoRowsCache = Object.create(null);

  /* ----- state helpers ----- */
  function getSelectedColumns(job) {
    const ids =
      job && Array.isArray(job.selected_columns) && job.selected_columns.length
        ? job.selected_columns
        : LEAD_REQUIRED_COLUMNS.map(function (c) { return c.id; });
    return ids.filter(function (id) { return LEAD_COLUMN_LABELS[id]; });
  }

  function stopScraperTimers() {
    if (scraperPollTimer) {
      window.clearInterval(scraperPollTimer);
      scraperPollTimer = null;
    }
    if (scraperDemoTimer) {
      window.clearInterval(scraperDemoTimer);
      scraperDemoTimer = null;
    }
  }

  function setScraperBadge(kind, text) {
    const badge = $('#scraperStatus');
    if (!badge) return;
    badge.classList.remove('is-pending', 'is-ok', 'is-fail');
    if (kind) badge.classList.add('is-' + kind);
    const label = $('.webhook-text', badge);
    if (label) label.textContent = text;
  }

  /* ----- results view ----- */
  function renderScraperResults() {
    const empty = $('#scraperEmpty');
    const main = $('#scraperMain');
    if (!empty || !main) return;

    const job = state.scraperJob;
    if (!job) {
      empty.hidden = false;
      main.hidden = true;
      return;
    }

    empty.hidden = true;
    main.hidden = false;

    const resume = $('#resumeJobId');
    if (resume) resume.value = job.job_id || '';

    renderJobSummary();
    renderLeadsTable();
    updateScraperProgress();

    if (job.status === 'completed' || Number(job.collected_count) >= LEAD_TARGET) {
      completeScraperJob(true);
      return;
    }
    if (job.status === 'failed') {
      setScraperBadge('fail', 'Job failed · start a new scrape');
      return;
    }
    ensureScraperRunning();
  }

  function renderJobSummary() {
    const job = state.scraperJob;
    if (!job) return;
    const summary = $('#jobSummary');
    const meta = $('#jobMeta');
    const cols = getSelectedColumns(job);

    if (meta) {
      meta.textContent =
        job.country + ' · ' + (job.search_terms || []).length + ' terms · ' + cols.length + ' columns';
    }

    if (summary) {
      summary.innerHTML =
        '<div class="summary-row"><dt>Country</dt><dd>' + escapeHtml(job.country) + '</dd></div>' +
        '<div class="summary-row"><dt>Search terms</dt><dd>' + (job.search_terms || []).length + '</dd></div>' +
        '<div class="summary-row"><dt>Columns</dt><dd>' + cols.length + '</dd></div>' +
        '<div class="summary-row"><dt>Started</dt><dd>' + escapeHtml(fmtMYT(job.started_at)) + '</dd></div>' +
        '<div class="summary-row"><dt>Job ID</dt><dd><code>' + escapeHtml(job.job_id) + '</code></dd></div>';
    }
  }

  function updateScraperProgress() {
    const job = state.scraperJob;
    if (!job) return;

    const count = clamp(Math.floor(Number(job.collected_count) || 0), 0, LEAD_TARGET);
    const percent = Math.min(100, Math.floor((count / LEAD_TARGET) * 100));
    const fill = $('#ringFill');

    if (fill) {
      fill.style.strokeDashoffset = String(RING_LENGTH - (RING_LENGTH * percent) / 100);
    }

    const percentEl = $('#ringPercent');
    if (percentEl) percentEl.textContent = percent + '%';

    const countEl = $('#ringCount');
    if (countEl) {
      countEl.textContent =
        count.toLocaleString('en-US') + ' / ' + LEAD_TARGET.toLocaleString('en-US') + ' leads';
    }

    const card = $('#ringCard');
    if (card) card.classList.toggle('is-complete', percent >= 100);

    const downloadBtn = $('#downloadBtn');
    if (downloadBtn) downloadBtn.disabled = percent < 100;

    const downloadTitle = $('#downloadTitle');
    if (downloadTitle) {
      downloadTitle.textContent =
        percent >= 100 ? 'Excel (.xlsx) · ' + LEAD_TARGET.toLocaleString('en-US') + ' leads' : 'Excel (.xlsx)';
    }

    const downloadSub = $('#downloadSub');
    if (downloadSub) {
      if (percent >= 100) {
        downloadSub.textContent =
          job.mode === 'demo' ? 'Demo file · 1,000 sample leads' : 'Ready to download';
      } else {
        downloadSub.textContent = 'Unlocks at 1,000 leads';
      }
    }

    const tableMeta = $('#tableMeta');
    if (tableMeta) {
      tableMeta.textContent =
        'First 25 rows · ' + count.toLocaleString('en-US') + ' of ' +
        LEAD_TARGET.toLocaleString('en-US') + ' leads · ' + getSelectedColumns(job).length + ' columns';
    }
  }

  function currentPreviewRows(job) {
    if (job && Array.isArray(job.preview_rows) && job.preview_rows.length) {
      return job.preview_rows.slice(0, 25);
    }
    if (job && job.mode === 'demo') return getDemoRows(job, 25);
    return [];
  }

  function renderLeadsTable() {
    const table = $('#leadsTable');
    if (!table || !state.scraperJob) return;

    const job = state.scraperJob;
    const cols = getSelectedColumns(job);
    const rows = currentPreviewRows(job);
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');

    if (thead) {
      thead.innerHTML =
        '<tr>' +
        cols.map(function (id) { return '<th>' + escapeHtml(LEAD_COLUMN_LABELS[id]) + '</th>'; }).join('') +
        '</tr>';
    }

    if (tbody) {
      if (!rows.length) {
        const message =
          job.mode === 'demo' || job.status === 'completed'
            ? 'Preview unavailable — download the .xlsx for every lead.'
            : 'Waiting for the first rows…';
        tbody.innerHTML =
          '<tr><td colspan="' + cols.length + '" class="table-empty">' + message + '</td></tr>';
      } else {
        tbody.innerHTML = rows
          .map(function (row) {
            return (
              '<tr>' +
              cols
                .map(function (id, index) {
                  const value = row[id] == null || row[id] === '' ? '—' : String(row[id]);
                  return '<td class="' + (index === 0 ? 'cell-strong' : '') + '">' + escapeHtml(value) + '</td>';
                })
                .join('') +
              '</tr>'
            );
          })
          .join('');
      }
    }

    const pill = $('#previewPill');
    if (pill) pill.textContent = rows.length + ' rows';
  }

  function completeScraperJob(silent) {
    const job = state.scraperJob;
    if (!job) return;

    job.status = 'completed';
    job.collected_count = LEAD_TARGET;
    stopScraperTimers();
    saveState();

    updateScraperProgress();
    renderLeadsTable();
    setScraperBadge('ok', 'Completed · .xlsx ready');

    const btn = $('#downloadBtn');
    if (btn) btn.disabled = false;

    if (!silent) toast('Lead list complete — Excel download ready.', 'success');
  }

  function failScraperJob(reason) {
    const job = state.scraperJob;
    if (!job) return;
    job.status = 'failed';
    stopScraperTimers();
    saveState();
    setScraperBadge('fail', reason ? 'Job failed · ' + reason : 'Job failed');
    toast('The scrape could not finish. Start a new run.', 'warn');
  }

  /* ----- live backend: POST start, then poll every 5s ----- */
  function ensureScraperRunning() {
    const job = state.scraperJob;
    if (!job || job.status === 'completed' || job.status === 'failed') return;

    if (job.mode === 'demo') {
      startDemoScrape();
      return;
    }

    if (!job.posted) {
      job.posted = true;
      saveState();
      postScraperStart(job);
      return;
    }

    startLivePolling(job);
  }

  function postScraperStart(job) {
    if (!LEAD_START_URL) {
      switchToDemo(job, 'No start endpoint configured');
      return;
    }

    setScraperBadge('pending', 'Starting cloud scrape…');

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? window.setTimeout(function () { controller.abort(); }, 9000) : null;

    fetch(LEAD_START_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: job.job_id,
        agent_id: LEAD_AGENT_ID,
        name: job.name,
        email: job.email,
        country: job.country,
        search_terms: job.search_terms,
        selected_columns: job.selected_columns,
        target_rows: LEAD_TARGET,
        credits_spent: LEAD_CREDITS
      }),
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) {
        if (timer) window.clearTimeout(timer);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json().catch(function () { return null; });
      })
      .then(function (body) {
        if (body && body.ok === false) throw new Error(body.error || 'rejected');
        if (body && body.job_id && String(body.job_id) !== String(job.job_id)) {
          job.job_id = String(body.job_id);
          saveState();
        }
        if (body && (body.mode === 'demo' || body.status === 'demo')) {
          switchToDemo(job, 'Backend demo mode');
          return;
        }
        startLivePolling(job);
      })
      .catch(function (err) {
        if (timer) window.clearTimeout(timer);
        console.warn(
          '[Agentic] Lead scraper backend unreachable — using local demo mode.',
          err && err.message ? err.message : err
        );
        switchToDemo(job, 'Backend unreachable');
      });
  }

  function startLivePolling(job) {
    if (scraperPollTimer || scraperDemoTimer) return;
    if (currentRoute() !== 'scraper-results') return;
    setScraperBadge('pending', 'Cloud extraction running…');
    pollScraperStatus();
    scraperPollTimer = window.setInterval(pollScraperStatus, LEAD_POLL_MS);
  }

  function pollScraperStatus() {
    const job = state.scraperJob;
    if (!job || !LEAD_STATUS_URL || job.mode === 'demo' || job.status === 'completed') return;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? window.setTimeout(function () { controller.abort(); }, 8000) : null;

    fetch(LEAD_STATUS_URL + '?job_id=' + encodeURIComponent(job.job_id), {
      mode: 'cors',
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) {
        if (timer) window.clearTimeout(timer);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data || typeof data !== 'object') throw new Error('Empty status response');

        const raw =
          data.collected_count != null
            ? data.collected_count
            : data.leads_collected != null
            ? data.leads_collected
            : data.count;
        const count = Number(raw);
        if (Number.isFinite(count)) {
          job.collected_count = clamp(Math.floor(count), 0, LEAD_TARGET);
        }

        if (Array.isArray(data.preview_rows) && data.preview_rows.length) {
          job.preview_rows = data.preview_rows.slice(0, 25);
        }

        const status = String(data.status || job.status || 'running').toLowerCase();
        job.status = status;

        if (['completed', 'complete', 'success', 'done'].indexOf(status) !== -1 ||
            Number(job.collected_count) >= LEAD_TARGET) {
          completeScraperJob(false);
          return;
        }

        if (['failed', 'error', 'cancelled', 'canceled'].indexOf(status) !== -1) {
          failScraperJob(data.error ? String(data.error) : '');
          return;
        }

        saveState();
        updateScraperProgress();
        renderLeadsTable();
      })
      .catch(function (err) {
        if (timer) window.clearTimeout(timer);
        console.warn(
          '[Agentic] Lead scraper status unavailable — switching to demo mode.',
          err && err.message ? err.message : err
        );
        switchToDemo(job);
      });
  }

  function switchToDemo(job, reason) {
    if (!job || job.status === 'completed') return;
    if (scraperDemoTimer) return;

    if (scraperPollTimer) {
      window.clearInterval(scraperPollTimer);
      scraperPollTimer = null;
    }

    job.mode = 'demo';
    job.posted = true;
    saveState();

    if (!job.demo_notified && reason) {
      job.demo_notified = true;
      saveState();
      toast('Backend offline — running a local demo scrape.', 'info');
    }

    startDemoScrape();
  }

  /* ----- offline demo: +10 leads (= +1%) every 160ms ----- */
  function startDemoScrape() {
    if (scraperDemoTimer) return;
    if (currentRoute() !== 'scraper-results') return;
    const job = state.scraperJob;
    if (!job) return;

    renderLeadsTable();

    if (Number(job.collected_count) >= LEAD_TARGET) {
      completeScraperJob(true);
      return;
    }

    setScraperBadge('pending', 'Demo mode · scraping sample leads…');

    scraperDemoTimer = window.setInterval(function () {
      const current = state.scraperJob;
      if (!current) {
        stopScraperTimers();
        return;
      }

      current.collected_count = Math.min(LEAD_TARGET, (Number(current.collected_count) || 0) + 10);
      updateScraperProgress();

      if (current.collected_count % 100 === 0) saveState();

      if (current.collected_count >= LEAD_TARGET) {
        completeScraperJob(false);
      }
    }, 160);
  }

  /* ----- resume / check job ----- */
  function handleResume() {
    const input = $('#resumeJobId');
    const job = state.scraperJob;
    if (!input) return;

    const value = input.value.trim();
    if (!value) {
      toast('Enter a Job ID to check.', 'warn');
      input.focus();
      return;
    }
    if (!job) {
      toast('No job stored in this browser.', 'warn');
      return;
    }

    stopScraperTimers();
    job.job_id = value;
    job.mode = 'live';
    job.status = 'running';
    job.posted = true;
    if (Number(job.collected_count) >= LEAD_TARGET) job.collected_count = 0;
    saveState();

    renderJobSummary();
    updateScraperProgress();
    startLivePolling(job);
    toast('Checking job ' + value + '…', 'info');
  }

  /* ----- download ----- */
  function downloadLeads() {
    const job = state.scraperJob;
    if (!job) return;

    if (job.mode === 'live' && LEAD_DOWNLOAD_URL) {
      const url = LEAD_DOWNLOAD_URL + '?job_id=' + encodeURIComponent(job.job_id);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      toast('Requesting your .xlsx from the cloud…', 'info');
      return;
    }

    const rows = getDemoRows(job, LEAD_TARGET);
    const blob = buildXlsx(job, rows);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download =
      'agentic-leads-' + slug(job.country || 'global') + '-' + job.job_id + '.xlsx';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast(rows.length.toLocaleString('en-US') + ' leads exported to .xlsx.', 'success');
  }

  /* ----- configuration modal ----- */
  function openScraperModal() {
    if (state.credits < LEAD_CREDITS) {
      toast('Needs ' + LEAD_CREDITS + ' credits (1,000 leads).', 'warn');
      return;
    }

    const countryOptions = LEAD_COUNTRIES.map(function (country) {
      const selected = country === 'Malaysia' ? ' selected' : '';
      return '<option value="' + escapeHtml(country) + '"' + selected + '>' + escapeHtml(country) + '</option>';
    }).join('');

    const terms = [];
    for (let i = 0; i < 10; i += 1) {
      const placeholder = LEAD_SAMPLE_TERMS[i] || 'Search term ' + (i + 1);
      terms.push(
        '<label class="term-field"><span class="term-num">' + (i + 1) + '</span>' +
        '<input type="text" data-term="' + i + '" placeholder="' + escapeHtml(placeholder) +
        '" autocomplete="off" /></label>'
      );
    }

    const lockedColumns = LEAD_REQUIRED_COLUMNS.map(function (col) {
      return '<span>✓ ' + escapeHtml(col.label) + '</span>';
    }).join('');

    const optionalColumns = LEAD_OPTIONAL_COLUMNS.map(function (col) {
      return (
        '<label class="column-option" data-col-option="' + escapeHtml(col.id) + '">' +
        '<input type="checkbox" name="scraperCol" value="' + escapeHtml(col.id) + '" />' +
        '<span><span class="col-label">' + escapeHtml(col.label) +
        (col.badge ? ' <span class="col-badge">' + escapeHtml(col.badge) + '</span>' : '') +
        '</span><span class="col-hint">' + escapeHtml(col.hint || '') + '</span></span>' +
        '</label>'
      );
    }).join('');

    openModal(
      '<h2 class="modal-title" id="modalTitle">B2B Lead Scraper</h2>' +
        '<p class="modal-sub">1,000 leads · .xlsx · 10 search terms · ' + LEAD_CREDITS + ' credits</p>' +
        '<form class="scraper-form" id="scraperForm" novalidate>' +
        '<div class="form-two">' +
        '<div class="field"><label for="scraperName">Full name <span class="req">*</span></label>' +
        '<input type="text" id="scraperName" autocomplete="name" placeholder="Alex Tan" value="' +
        escapeHtml(state.name || '') + '" /></div>' +
        '<div class="field"><label for="scraperEmail">Delivery email <span class="req">*</span></label>' +
        '<input type="email" id="scraperEmail" autocomplete="email" inputmode="email" placeholder="you@example.com" value="' +
        escapeHtml(state.email || '') + '" /></div>' +
        '</div>' +
        '<div class="field"><label for="scraperCountry">Target country</label>' +
        '<select id="scraperCountry">' + countryOptions + '</select></div>' +
        '<div class="field" id="customCountryField" hidden>' +
        '<label for="scraperCustomCountry">Custom country</label>' +
        '<input type="text" id="scraperCustomCountry" placeholder="e.g. New Zealand" /></div>' +
        '<div class="modal-section"><h3>10 search terms</h3>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="fillTermsBtn">Fill Sample B2B Terms</button></div>' +
        '<div class="term-grid">' + terms.join('') + '</div>' +
        '<p class="pill-note">Stops automatically at 1,000 unique leads</p>' +
        '<div class="modal-section"><h3>Excel columns</h3>' +
        '<span class="fine">Company, email and phone always included</span></div>' +
        '<div class="column-group">' +
        '<div class="column-locked">' + lockedColumns + '</div>' +
        '<p class="col-group-label">Optional columns</p>' +
        optionalColumns +
        '</div>' +
        '<div class="modal-actions">' +
        '<div class="scraper-modal-error" id="scraperFormError" role="alert"></div>' +
        '<button type="submit" class="btn btn-activate" id="scraperStartBtn">Confirm & Spend ' +
        LEAD_CREDITS + ' Credits · Start Scrape</button>' +
        '<p class="fine">Credits are deducted immediately. Extraction runs in the cloud.</p>' +
        '</div>' +
        '</form>',
      true
    );

    const countrySelect = $('#scraperCountry');
    if (countrySelect) {
      countrySelect.addEventListener('change', function () {
        const isOther = countrySelect.value === 'Other (Custom Country)';
        const field = $('#customCountryField');
        if (field) field.hidden = !isOther;
        if (isOther && $('#scraperCustomCountry')) $('#scraperCustomCountry').focus();
      });
    }

    const fillBtn = $('#fillTermsBtn');
    if (fillBtn) {
      fillBtn.addEventListener('click', function () {
        $$('.term-field input').forEach(function (input, index) {
          input.value = LEAD_SAMPLE_TERMS[index] || '';
        });
        toast('Sample B2B terms filled.', 'info');
      });
    }

    $$('input[name="scraperCol"]').forEach(function (box) {
      box.addEventListener('change', function () {
        const option = box.closest('.column-option');
        if (option) option.classList.toggle('is-checked', box.checked);
      });
    });

    const form = $('#scraperForm');
    if (form) form.addEventListener('submit', handleScraperStart);

    const nameEl = $('#scraperName');
    if (nameEl) nameEl.focus();
  }

  function handleScraperStart(event) {
    event.preventDefault();

    const nameEl = $('#scraperName');
    const emailEl = $('#scraperEmail');
    const errorEl = $('#scraperFormError');
    if (!nameEl || !emailEl) return;

    const name = nameEl.value.trim();
    const email = emailEl.value.trim();
    const countryEl = $('#scraperCountry');
    const customEl = $('#scraperCustomCountry');
    const countryValue = countryEl ? countryEl.value : 'Malaysia';
    const customCountry = customEl ? customEl.value.trim() : '';
    const country = countryValue === 'Other (Custom Country)' ? customCountry : countryValue;

    const terms = $$('.term-field input')
      .map(function (input) { return input.value.trim(); })
      .filter(Boolean)
      .slice(0, 10);

    const optionalChosen = LEAD_OPTIONAL_COLUMNS.filter(function (col) {
      const box = $('input[name="scraperCol"][value="' + col.id + '"]');
      return box && box.checked;
    }).map(function (col) { return col.id; });

    const columns = LEAD_REQUIRED_COLUMNS.map(function (col) { return col.id; }).concat(optionalChosen);

    const problems = [];
    if (name.length < 2) problems.push('Full name is required.');
    if (!isValidEmail(email)) problems.push('A valid delivery email is required.');
    if (!country) problems.push('Choose a target country.');
    if (!terms.length) problems.push('Add at least one search term.');
    if (state.credits < LEAD_CREDITS) problems.push('You need ' + LEAD_CREDITS + ' credits.');

    if (problems.length) {
      if (errorEl) errorEl.textContent = problems.join(' ');
      return;
    }

    const job = {
      job_id: 'lead_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      agent_id: LEAD_AGENT_ID,
      name: name,
      email: email,
      country: country,
      search_terms: terms,
      selected_columns: columns,
      target_rows: LEAD_TARGET,
      credits_spent: LEAD_CREDITS,
      started_at: new Date().toISOString(),
      status: 'running',
      mode: 'live',
      posted: false,
      collected_count: 0
    };

    state.credits -= LEAD_CREDITS;
    state.name = name;
    state.email = email;
    state.scraperJob = job;
    delete demoRowsCache[job.job_id];
    saveState();

    syncCreditUI();
    pulsePill();
    closeModal();

    if (currentRoute() === 'scraper-results') {
      renderScraperResults();
    } else {
      window.location.hash = '#scraper-results';
    }
  }

  function openColumnsModal() {
    const required = LEAD_REQUIRED_COLUMNS.map(function (col) {
      return (
        '<div class="column-option is-checked"><input type="checkbox" checked disabled />' +
        '<span><span class="col-label">' + escapeHtml(col.label) + '</span>' +
        '<span class="col-hint">Always included</span></span></div>'
      );
    }).join('');

    const optional = LEAD_OPTIONAL_COLUMNS.map(function (col) {
      return (
        '<div class="column-option"><input type="checkbox" checked disabled />' +
        '<span><span class="col-label">' + escapeHtml(col.label) +
        (col.badge ? ' <span class="col-badge">' + escapeHtml(col.badge) + '</span>' : '') +
        '</span><span class="col-hint">' + escapeHtml(col.hint || '') + '</span></span></div>'
      );
    }).join('');

    openModal(
      '<h2 class="modal-title" id="modalTitle">Excel columns</h2>' +
        '<p class="modal-sub">Pick only what you need — columns are toggleable per run.</p>' +
        '<div class="column-group"><p class="col-group-label">Always included</p>' +
        required +
        '<p class="col-group-label">Optional</p>' +
        optional +
        '</div>' +
        '<div class="modal-actions"><button type="button" class="btn btn-primary" data-modal-close>Got it</button></div>',
      true
    );
  }

  /* ----- deterministic demo rows ----- */
  function hashSeed(text) {
    let hash = 2166136261;
    const str = String(text);
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let a = seed;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function slug(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 24) || 'business';
  }

  function industryWords(term) {
    const words = String(term || '')
      .replace(/[^a-zA-Z0-9 ]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    return (
      words
        .map(function (word) { return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(); })
        .join(' ') || 'Business'
    );
  }

  function getDemoRows(job, limit) {
    if (!job) return [];
    const total = Math.min(limit || 25, LEAD_TARGET);
    const key = job.job_id + '|' + total;
    if (demoRowsCache[key]) return demoRowsCache[key];

    const rng = mulberry32(hashSeed(job.job_id + '|' + job.country + '|' + (job.search_terms || []).join(',')));
    const meta = COUNTRY_META[job.country] || COUNTRY_META.Other;
    const terms = job.search_terms && job.search_terms.length ? job.search_terms : ['Business services'];
    const rows = [];

    for (let i = 0; i < total; i += 1) {
      const term = terms[i % terms.length];
      const prefix = COMPANY_PREFIXES[Math.floor(rng() * COMPANY_PREFIXES.length)];
      const industry = industryWords(term);
      const company = prefix + ' ' + industry + ' ' + meta.suffix;
      const city = meta.cities[Math.floor(rng() * meta.cities.length)];
      const domain = slug(prefix + industry) + meta.tld;
      const street = STREETS[Math.floor(rng() * STREETS.length)];
      const streetNo = 1 + Math.floor(rng() * 240);
      const postcode = 10000 + Math.floor(rng() * 80000);
      const phone =
        meta.dial + ' ' + (10 + Math.floor(rng() * 89)) + ' ' +
        (1000 + Math.floor(rng() * 8999)) + ' ' + (1000 + Math.floor(rng() * 8999));
      const rating = (3.8 + rng() * 1.2).toFixed(1);
      const reviews = 40 + Math.floor(rng() * 900);

      rows.push({
        company_name: company,
        email: (rng() > 0.5 ? 'info@' : 'sales@') + domain,
        phone: phone,
        website: 'https://' + domain,
        address: streetNo + ' ' + street + ', ' + city + ' ' + postcode + ', ' + job.country,
        maps_url: 'https://maps.google.com/?q=' + encodeURIComponent(company + ', ' + city),
        rating: rating + '★ · ' + reviews + ' reviews',
        category: String(term).charAt(0).toUpperCase() + String(term).slice(1),
        hours: HOURS_BANK[Math.floor(rng() * HOURS_BANK.length)]
      });
    }

    demoRowsCache[key] = rows;
    return rows;
  }

  /* ----- minimal, dependency-free .xlsx (store-only ZIP + OOXML) ----- */
  function xmlEsc(value) {
    /* Same \u0026… trick as escapeHtml: keeps entity literals out of the source. */
    const map = {
      '&': '\u0026amp;',
      '<': '\u0026lt;',
      '>': '\u0026gt;',
      '"': '\u0026quot;',
      "'": '\u0026apos;'
    };
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return map[ch];
    });
  }

  let crcTable = null;

  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipStore(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    files.forEach(function (file) {
      const nameBytes = encoder.encode(file.name);
      const data = encoder.encode(file.content);
      const crc = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, 0, true);
      localView.setUint16(12, 0, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      localParts.push(local, data);
      offset += local.length + data.length;

      const central = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, 0, true);
      centralView.setUint16(14, 0, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, offset - local.length - data.length, true);
      central.set(nameBytes, 46);

      centralParts.push(central);
    });

    const centralSize = centralParts.reduce(function (sum, part) { return sum + part.length; }, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);

    return new Blob(localParts.concat(centralParts, [end]), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  function buildXlsx(job, rows) {
    const cols = getSelectedColumns(job);
    const header = cols.map(function (id) { return LEAD_COLUMN_LABELS[id]; });

    const sheetRows = [header].concat(
      rows.map(function (row) {
        return cols.map(function (id) { return row[id] == null ? '' : String(row[id]); });
      })
    );

    const xmlRows = sheetRows
      .map(function (row, rowIndex) {
        const cells = row
          .map(function (value, colIndex) {
            const ref = String.fromCharCode(65 + colIndex) + (rowIndex + 1);
            return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' +
              xmlEsc(value) + '</t></is></c>';
          })
          .join('');
        return '<row r="' + (rowIndex + 1) + '">' + cells + '</row>';
      })
      .join('');

    const contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>';

    const rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    const workbook =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Leads" sheetId="1" r:id="rId1"/></sheets></workbook>';

    const workbookRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>';

    const sheet =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' + xmlRows + '</sheetData></worksheet>';

    return zipStore([
      { name: '[Content_Types].xml', content: contentTypes },
      { name: '_rels/.rels', content: rootRels },
      { name: 'xl/workbook.xml', content: workbook },
      { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
      { name: 'xl/worksheets/sheet1.xml', content: sheet }
    ]);
  }

  /* ============================== INIT =================================== */
  function init() {
    const year = $('#year');
    if (year) year.textContent = String(new Date().getFullYear());

    if (!window.location.hash) {
      window.history.replaceState(null, '', '#home');
    }

    buildStockGrid();
    renderPlans();
    renderHomeBrief('NVDA');
    renderWalletSubs();
    syncCreditUI();
    updateNextBrief();
    bindEvents();

    window.addEventListener('hashchange', onRouteChange);
    onRouteChange();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
