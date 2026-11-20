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
    agents: 'Agentic Agent — Stock Market News Agent',
    plans: 'Manage My Plan — Credit Top-Ups in USD',
    about: 'About Us — Agentic',
    configure: 'Configure Your Subscription — Agentic',
    success: 'Subscription Confirmed — Agentic'
  };

  /* ============================ C. STATE ================================== */
  function defaultState() {
    return {
      credits: DEFAULT_CREDITS,
      email: '',
      name: '',
      subscriptions: [],
      lastSubscription: null
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
            : null
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
  const ROUTES = ['home', 'agents', 'plans', 'about', 'configure', 'success'];

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
      const active = r === route || ((route === 'configure' || route === 'success') && r === 'agents');
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    closeMobileNav();
    closeWallet();
    closeModal(false);

    if (route === 'configure') enterConfigure();
    if (route === 'plans') renderPlans();
    if (route === 'success') renderSuccess();

    document.title = TITLES[route] || TITLES.home;
    window.scrollTo(0, 0);
  }

  /* ======================= E. CREDIT UI / SUBSCRIBE ======================= */
  function syncCreditUI() {
    $$('[data-credit-count]').forEach(function (el) {
      el.textContent = String(state.credits);
    });
    updateSubscribeButton();
    renderWalletSubs();
    if (currentRoute() === 'configure') renderConfigure();
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

  function openModal(html) {
    const root = $('#modalRoot');
    const body = $('#modalBody');
    if (!root || !body) return;

    body.innerHTML = html;
    root.hidden = false;
    document.body.classList.add('modal-open');
    lastFocused = document.activeElement;

    const dialog = root.querySelector('.modal');
    if (dialog) {
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
    state = defaultState();
    selectedStocks = [];
    lastWebhookResult = null;
    pendingWebhook = false;
    saveState();

    syncCreditUI();
    renderPlans();
    renderSuccess();
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
