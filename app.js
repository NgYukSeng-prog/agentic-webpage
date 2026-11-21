/* ============================================================================
   Agentic — app.js
   ----------------------------------------------------------------------------
   Vanilla JS single-page application.

   Sections
   A. Helpers
   B. Static content (credit packs, sample briefs)
   C. Session state: Neon-backed auth token + live profile, local job history
   D. Hash router
   E. Credit UI (bottom-left pill, subscribe button states)
   F. Home / sample output rendering
   G. Manage My Plan (packs, checkout modal, active subscriptions)
   H. Configure page (calculator, stock grid lock, activation form)
   I. Success page + webhook sync
   J. Wallet popover, modal, toast, init
   K. Auth modal, account settings, animated avatars
   L. B2B Lead Scraper engine
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
  const TIMEZONE = CFG.TIMEZONE || 'Asia/Kuala_Lumpur';
  const STORAGE_KEY = CFG.STORAGE_KEY || 'agentic.state.v1';
  const AGENT_ID = CFG.AGENT_ID || 'stock-market-news-agent';
  const AGENT_NAME = CFG.AGENT_NAME || 'Stock Market News Agent';
  const STOCKS = Array.isArray(CFG.SUPPORTED_STOCKS) ? CFG.SUPPORTED_STOCKS : [];

  /* --- Neon-backed auth API ------------------------------------------------ */
  const API_BASE = String(
    CFG.API_BASE || 'https://n8n.20.205.96.122.sslip.io/webhook'
  ).replace(/\/+$/, '');
  const TOKEN_KEY = CFG.AUTH_TOKEN_KEY || 'aaas_token';
  const AUTH_ME_URL = API_BASE + '/auth/me';
  const AUTH_REGISTER_URL = API_BASE + '/auth/register';
  const AUTH_LOGIN_URL = API_BASE + '/auth/login';
  const AUTH_GOOGLE_URL = API_BASE + '/auth/google';
  const FORGOT_PASSWORD_URL = API_BASE + '/auth/forgot-password';
  const RESET_PASSWORD_URL = API_BASE + '/auth/reset-password';
  const ACCOUNT_AVATAR_URL = API_BASE + '/account/avatar';
  const FREE_SIGNUP_CREDITS = toPositiveInt(CFG.FREE_SIGNUP_CREDITS, 5);
  const GOOGLE_CLIENT_ID = String(CFG.GOOGLE_CLIENT_ID || '').trim();
  const GOOGLE_GSI_SRC = 'https://accounts.google.com/gsi/client';

  /* B2B Lead Scraper: 1 search term = 50 leads = 3 credits (max 10 terms). */
  const LEAD_CREDITS_PER_TERM = toPositiveInt(CFG.LEAD_SCRAPER_CREDITS_PER_TERM, 3);
  const LEAD_LEADS_PER_TERM = toPositiveInt(CFG.LEAD_SCRAPER_LEADS_PER_TERM, 50);
  const LEAD_MIN_CREDITS = toPositiveInt(CFG.LEAD_SCRAPER_MIN_CREDITS, 3);
  const LEAD_MAX_TERMS = toPositiveInt(CFG.LEAD_SCRAPER_MAX_TERMS, 10);
  const LEAD_MAX_TARGET = LEAD_LEADS_PER_TERM * LEAD_MAX_TERMS;
  const LEAD_AGENT_ID = CFG.LEAD_SCRAPER_AGENT_ID || 'b2b-lead-scraper';
  const LEAD_AGENT_NAME = CFG.LEAD_SCRAPER_AGENT_NAME || 'B2B Lead Scraper Agent';
  const LEAD_POLL_MS = toPositiveInt(CFG.LEAD_SCRAPER_POLL_MS, 2500);
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
      /* Credits/identity are server-authoritative. Never seeded from demo data. */
      credits: 0,
      email: '',
      name: '',
      subscriptions: [],
      lastSubscription: null,
      scraperJob: null
    };
  }

  /* Only local job/subscription history is cached. Legacy demo credits in
     agentic.state.v1 are intentionally ignored. */
  function loadState() {
    const base = defaultState();
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return base;

      return {
        credits: 0,
        email: '',
        name: '',
        subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
        lastSubscription:
          parsed.lastSubscription && typeof parsed.lastSubscription === 'object'
            ? parsed.lastSubscription
            : null,
        scraperJob:
          parsed.scraperJob &&
          typeof parsed.scraperJob === 'object' &&
          parsed.scraperJob.mode !== 'demo'
            ? parsed.scraperJob
            : null
      };
    } catch (err) {
      return base;
    }
  }

  function saveState() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          subscriptions: state.subscriptions || [],
          lastSubscription: state.lastSubscription || null,
          scraperJob: state.scraperJob || null
        })
      );
    } catch (err) {
      // Private mode / storage disabled — the session still works in memory.
      console.warn('[Agentic] Could not persist state to localStorage.', err);
    }
  }

  let state = loadState();
  let selectedStocks = []; // in-memory watchlist selection for #configure
  let lastWebhookResult = null;
  let pendingWebhook = false;

  /* Session token is the ONLY auth artefact persisted on the client. */
  const auth = {
    token: readToken(),
    user: null,
    loading: false
  };
  let pendingGate = null;

  function readToken() {
    try {
      return window.localStorage.getItem(TOKEN_KEY) || '';
    } catch (err) {
      return '';
    }
  }

  function writeToken(token) {
    try {
      window.localStorage.setItem(TOKEN_KEY, String(token));
    } catch (err) {
      console.warn('[Agentic] Could not persist the session token.', err);
    }
  }

  function clearToken() {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch (err) {
      /* storage disabled — nothing to remove */
    }
  }

  function isLoggedIn() {
    return !!(auth && auth.user);
  }

  function maxAffordableStocks() {
    return Math.floor(Math.max(0, state.credits) / CREDITS_PER_STOCK);
  }

  function activeSubscriptions() {
    return (state.subscriptions || []).filter(function (sub) {
      return sub && sub.expiresAt && new Date(sub.expiresAt).getTime() > Date.now();
    });
  }

  /* ==================== K. AUTH, ACCOUNT & AVATARS ======================= */
  const AVATARS = [
    { id: 'mochi-circle', label: 'Mochi' },
    { id: 'boba-squircle', label: 'Boba' },
    { id: 'star-puff', label: 'Star Puff' },
    { id: 'hex-bot', label: 'Hex Bot' },
    { id: 'cloud-cat', label: 'Cloud Cat' }
  ];
  const AVATAR_IDS = AVATARS.map(function (a) { return a.id; });
  let authModalMode = 'login';
  let authSubmitBusy = false;

  function readJson(response) {
    return response.json().catch(function () {
      return null;
    });
  }

  function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    if (auth.token) headers.Authorization = 'Bearer ' + auth.token;
    return headers;
  }

  function apiFetch(url, options, timeoutMs) {
    const opts = options || {};
    const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (auth.token) headers.Authorization = 'Bearer ' + auth.token;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? window.setTimeout(function () { controller.abort(); }, timeoutMs || 15000)
      : null;

    return fetch(
      url,
      Object.assign({}, opts, {
        headers: headers,
        signal: controller ? controller.signal : undefined
      })
    ).then(
      function (response) {
        if (timer) window.clearTimeout(timer);
        return response;
      },
      function (err) {
        if (timer) window.clearTimeout(timer);
        throw err;
      }
    );
  }

  /* Server may return remaining_credits at the top level or inside user/data. */
  function extractRemaining(body) {
    if (!body || typeof body !== 'object') return null;
    const data = body.data && typeof body.data === 'object' ? body.data : null;
    const user = body.user && typeof body.user === 'object' ? body.user : null;
    const candidates = [
      body.remaining_credits,
      body.credits,
      body.balance,
      body.credit_balance,
      user ? user.remaining_credits : null,
      user ? user.credits : null,
      data ? data.remaining_credits : null,
      data ? data.credits : null,
      data && data.user ? data.user.credits : null
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const raw = candidates[i];
      /* Number(null) is 0 — never let an absent field zero the wallet. */
      if (raw === null || raw === undefined || raw === '') continue;
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    }
    return null;
  }

  function normalizeAuthPayload(body) {
    const b = body && typeof body === 'object' ? body : {};
    const data = b.data && typeof b.data === 'object' ? b.data : {};
    const user = b.user && typeof b.user === 'object' ? b.user : null;
    const src = user || (data.user && typeof data.user === 'object' ? data.user : null) || data || b;

    const token =
      b.token ||
      b.access_token ||
      b.session_token ||
      b.jwt ||
      (b.session && b.session.token) ||
      data.token ||
      (data.session && data.session.token) ||
      '';

    let credits = extractRemaining(b);
    if (credits === null) credits = extractRemaining(data);
    if (credits === null) credits = extractRemaining(src);

    return {
      token: String(token || ''),
      user: {
        id: src.id || src.user_id || b.id || data.id || '',
        email: src.email || b.email || data.email || '',
        name:
          src.name ||
          src.display_name ||
          src.full_name ||
          b.name ||
          data.name ||
          '',
        avatar_id:
          src.avatar_id ||
          src.avatar ||
          b.avatar_id ||
          data.avatar_id ||
          'mochi-circle',
        credits: credits
      }
    };
  }

  function applyAuthSession(token, body, isNewAccount) {
    if (token) {
      auth.token = String(token);
      writeToken(auth.token);
    }

    const norm = normalizeAuthPayload(body);
    let credits = norm.user.credits;
    if (credits === null || !Number.isFinite(Number(credits))) {
      credits = isNewAccount ? FREE_SIGNUP_CREDITS : state.credits;
    }
    credits = Math.max(0, Math.floor(Number(credits) || 0));

    if (norm.user.email) state.email = norm.user.email;
    if (norm.user.name) state.name = norm.user.name;
    state.credits = credits;

    const avatarId =
      AVATAR_IDS.indexOf(String(norm.user.avatar_id || '')) !== -1
        ? String(norm.user.avatar_id)
        : 'mochi-circle';

    auth.user = {
      id: norm.user.id,
      email: norm.user.email,
      name: norm.user.name,
      avatar_id: avatarId,
      credits: credits
    };
    auth.loading = false;

    renderAuthUI();
    syncCreditUI();
  }

  function clearAuthSession() {
    clearToken();
    auth.token = '';
    auth.user = null;
    auth.loading = false;
    state.credits = 0;
    state.email = '';
    state.name = '';
    renderAuthUI();
    syncCreditUI();
  }

  function displayUserName(user) {
    if (!user) return 'Account';
    if (user.name) return user.name;
    const email = String(user.email || '');
    return email ? email.split('@')[0] : 'Account';
  }

  function renderAuthUI() {
    const guest = $('#authGuest');
    const userEl = $('#authUser');
    if (!guest || !userEl) return;

    const signedIn = !!auth.user;
    guest.hidden = signedIn;
    userEl.hidden = !signedIn;
    document.body.classList.toggle('is-authed', signedIn);

    if (signedIn) {
      const nameEl = $('#navUserName');
      const emailEl = $('#navUserEmail');
      const avatarEl = $('#navAvatar');
      if (nameEl) nameEl.textContent = displayUserName(auth.user);
      if (emailEl) emailEl.textContent = auth.user.email || 'Signed in';
      if (avatarEl) avatarEl.innerHTML = avatarMarkup(auth.user.avatar_id, 'avatar--nav');
    }

    updateSubscribeButton();
    updateScraperButton();
  }

  function refreshSession() {
    if (!auth.token) {
      auth.loading = false;
      renderAuthUI();
      return Promise.resolve(false);
    }

    auth.loading = true;
    renderAuthUI();

    return apiFetch(AUTH_ME_URL, { method: 'GET' })
      .then(function (response) {
        return readJson(response).then(function (body) {
          if (response.status === 401) {
            clearToken();
            auth.token = '';
            auth.user = null;
            auth.loading = false;
            state.credits = 0;
            renderAuthUI();
            syncCreditUI();
            return false;
          }
          if (!response.ok) throw new Error('HTTP ' + response.status);
          applyAuthSession('', body, false);
          return true;
        });
      })
      .catch(function (err) {
        auth.loading = false;
        renderAuthUI();
        console.warn('[Agentic] Could not refresh the live session.', err);
        return false;
      });
  }

  function handleAuthExpired(message, gate) {
    clearToken();
    auth.token = '';
    auth.user = null;
    auth.loading = false;
    state.credits = 0;
    state.email = '';
    state.name = '';
    stopScraperTimers();
    renderAuthUI();
    syncCreditUI();
    pendingGate = gate || null;
    openAuthModal('login', message || 'Your session expired. Log in again to continue.');
  }

  function requireAuth(gate, message) {
    if (isLoggedIn()) return true;
    pendingGate = gate || null;
    openAuthModal(
      'register',
      message || 'Log in or sign up to get 5 free credits and continue.'
    );
    return false;
  }

  function resumePendingGate() {
    const gate = pendingGate;
    pendingGate = null;
    if (!gate) return;

    window.setTimeout(function () {
      if (gate.action === 'stock') openStockModal();
      else if (gate.action === 'scraper') openScraperModal();
      else if (gate.action === 'checkout') openCheckout(gate.packId);
      else if (gate.action === 'account') openAccountModal();
    }, 180);
  }

  function setAuthError(message) {
    const el = $('#authError');
    if (el) el.textContent = message || '';
  }

  const PASSWORD_RULES = [
    { id: 'length', label: 'At least 8 characters', test: function (v) { return String(v).length >= 8; } },
    { id: 'upper', label: 'At least 1 uppercase letter (A-Z)', test: function (v) { return /[A-Z]/.test(String(v)); } },
    { id: 'lower', label: 'At least 1 lowercase letter (a-z)', test: function (v) { return /[a-z]/.test(String(v)); } },
    { id: 'number', label: 'At least 1 number (0-9)', test: function (v) { return /[0-9]/.test(String(v)); } }
  ];
  let authResetStage = 'request';
  let authResetEmail = '';
  let authFlashMessage = '';
  let googleScriptPromise = null;

  function passwordIsStrong(value) {
    return PASSWORD_RULES.every(function (rule) { return rule.test(value); });
  }

  function passwordChecklistMarkup(id) {
    return (
      '<ul class="pw-checklist" id="' + id + '" aria-live="polite">' +
      PASSWORD_RULES.map(function (rule) {
        return (
          '<li class="is-bad" data-pw-rule="' + rule.id + '">' +
          '<span class="pw-mark" aria-hidden="true">✗</span>' +
          '<span>' + escapeHtml(rule.label) + '</span>' +
          '</li>'
        );
      }).join('') +
      '</ul>'
    );
  }

  function updatePasswordChecklist(input) {
    if (!input) return true;
    const selector = input.getAttribute('data-pw-check');
    const list = selector ? $(selector) : null;
    if (!list) return true;

    let allGood = true;
    PASSWORD_RULES.forEach(function (rule) {
      const ok = rule.test(input.value);
      if (!ok) allGood = false;
      const item = list.querySelector('[data-pw-rule="' + rule.id + '"]');
      if (!item) return;
      item.classList.toggle('is-good', ok);
      item.classList.toggle('is-bad', !ok);
      const mark = item.querySelector('.pw-mark');
      if (mark) mark.textContent = ok ? '✓' : '✗';
    });

    syncAuthSubmitState();
    return allGood;
  }

  function syncAuthSubmitState() {
    const btn = $('#authSubmit');
    if (!btn) return;
    const pwInput = $('input[data-pw-check]');
    const strong = !pwInput || passwordIsStrong(pwInput.value);
    btn.disabled = authSubmitBusy || !strong;
  }

  function setAuthBusy(busy) {
    authSubmitBusy = !!busy;
    const btn = $('#authSubmit');
    if (btn) {
      btn.classList.toggle('is-busy', !!busy);
      btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    }
    syncAuthSubmitState();
  }

  function googleMarkSvg() {
    return (
      '<svg class="google-mark" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">' +
      '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>' +
      '<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>' +
      '<path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33z"/>' +
      '<path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.65 8.65 0 0 0 9 0 9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>' +
      '</svg>'
    );
  }

  function loadGoogleIdentity() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      return Promise.resolve();
    }
    if (googleScriptPromise) return googleScriptPromise;

    googleScriptPromise = new Promise(function (resolve, reject) {
      const existing = document.querySelector('script[data-google-gsi]');
      if (existing) {
        existing.addEventListener('load', resolve);
        existing.addEventListener('error', function () {
          reject(new Error('Google script failed to load'));
        });
        return;
      }
      const script = document.createElement('script');
      script.src = GOOGLE_GSI_SRC;
      script.async = true;
      script.defer = true;
      script.setAttribute('data-google-gsi', '1');
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error('Google script failed to load')); };
      document.head.appendChild(script);
    });

    return googleScriptPromise;
  }

  function googleDisabledMarkup(note) {
    return (
      '<button type="button" class="google-btn is-disabled" disabled title="' +
      escapeHtml(note || 'Google Sign-In is unavailable.') + '">' +
      googleMarkSvg() +
      '<span class="google-btn-label">Continue with Google</span>' +
      '<span class="google-btn-note">' + escapeHtml(note || 'Unavailable') + '</span>' +
      '</button>'
    );
  }

  function mountGoogleSignIn() {
    const slot = $('#googleSlot');
    if (!slot) return;

    if (!GOOGLE_CLIENT_ID) {
      slot.innerHTML = googleDisabledMarkup('Not configured — add GOOGLE_CLIENT_ID to config.js.');
      return;
    }

    slot.innerHTML =
      '<button type="button" class="google-btn is-loading" disabled>' +
      '<span class="google-loading-dot" aria-hidden="true"></span>' +
      '<span class="google-btn-label">Loading Google Sign-In…</span>' +
      '</button>';

    loadGoogleIdentity()
      .then(function () {
        if (!window.google || !window.google.accounts || !window.google.accounts.id) {
          throw new Error('Google Identity Services unavailable');
        }
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleCredential,
          auto_select: false,
          cancel_on_tap_outside: true
        });
        const target = $('#googleButton');
        if (!target) return;
        const buttonWidth = Math.max(200, Math.min(320, (slot.clientWidth || 320) - 4));
        window.google.accounts.id.renderButton(target, {
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text: 'continue_with',
          logo_alignment: 'left',
          width: buttonWidth
        });
        slot.classList.add('is-rendered');
      })
      .catch(function (err) {
        console.warn('[Agentic] Google Sign-In could not load.', err);
        slot.innerHTML = googleDisabledMarkup('Google Sign-In is unavailable right now.');
      });
  }

  function completeAuthSuccess(body, isNewAccount, message) {
    const norm = normalizeAuthPayload(body);
    if (!norm.token) {
      const err = new Error('Missing token');
      err.status = 200;
      err.body = {
        error: 'Signed in, but no session token was returned. Please try logging in again.'
      };
      throw err;
    }

    applyAuthSession(norm.token, body, isNewAccount);
    closeModal();
    toast(
      message ||
        (isNewAccount
          ? 'Account created — ' + FREE_SIGNUP_CREDITS + ' free credits added.'
          : 'Welcome back, ' + (displayUserName(auth.user) || 'trader') + '.'),
      'success'
    );
    resumePendingGate();
  }

  function handleGoogleCredential(googleResponse) {
    if (authSubmitBusy) return;
    if (!googleResponse || !googleResponse.credential) {
      setAuthError('Google did not return a credential. Please try again.');
      return;
    }

    setAuthError('');
    setAuthBusy(true);

    apiFetch(AUTH_GOOGLE_URL, {
      method: 'POST',
      body: JSON.stringify({ id_token: googleResponse.credential })
    })
      .then(function (response) {
        return readJson(response).then(function (body) {
          if (!response.ok || (body && body.ok === false)) {
            const err = new Error('Google auth failed');
            err.status = response.status;
            err.body = body;
            throw err;
          }
          completeAuthSuccess(body, false, 'Signed in with Google.');
        });
      })
      .catch(function (err) {
        setAuthBusy(false);
        setAuthError(friendlyAuthError(err));
      });
  }

  function friendlyAuthError(err) {
    if (err && err.status) {
      const body = err.body || {};
      const serverMessage =
        typeof body.error === 'string'
          ? body.error
          : typeof body.message === 'string'
          ? body.message
          : '';
      if (err.status === 400 || err.status === 422) {
        return serverMessage || 'Please check your details and try again.';
      }
      if (err.status === 401) return 'Email or password is incorrect.';
      if (err.status === 403) return 'This session is not permitted. Please log in again.';
      if (err.status === 409) return 'That email is already registered. Try logging in instead.';
      if (err.status === 429) return 'Too many attempts. Please wait a moment and try again.';
      if (err.status >= 500) {
        return 'Our auth service is busy right now. Please try again in a moment.';
      }
      return serverMessage || 'Something went wrong (HTTP ' + err.status + ').';
    }
    if (err && err.name === 'AbortError') {
      return 'The request timed out. Check your connection and try again.';
    }
    return 'Cannot reach the auth service. Check your connection and try again.';
  }

  function setAuthTab(mode) {
    authModalMode = mode === 'login' ? 'login' : 'register';
    const isLogin = authModalMode === 'login';

    $$('[data-auth-tab]').forEach(function (btn) {
      const on = btn.getAttribute('data-auth-tab') === authModalMode;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });

    const title = $('#authTitle');
    if (title) title.textContent = isLogin ? 'Log in to Agentic' : 'Create your free account';
    const sub = $('#authSub');
    if (sub) {
      sub.textContent = isLogin
        ? 'Welcome back — your live credit balance is waiting.'
        : 'New accounts start with ' + FREE_SIGNUP_CREDITS + ' free credits. No card required.';
    }
    setAuthError('');
    renderAuthPanel(authModalMode);
  }

  function openForgotStep(stage) {
    authModalMode = 'forgot';
    authResetStage = stage === 'verify' ? 'verify' : 'request';
    const isRequest = authResetStage === 'request';

    $$('[data-auth-tab]').forEach(function (btn) {
      const on = btn.getAttribute('data-auth-tab') === 'login';
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });

    const title = $('#authTitle');
    if (title) title.textContent = isRequest ? 'Reset your password' : 'Enter verification code';
    const sub = $('#authSub');
    if (sub) {
      sub.textContent = isRequest
        ? 'We will email you a 6-digit verification code.'
        : 'Enter the code and choose a new password.';
    }
    setAuthError('');
    renderAuthPanel('forgot');
  }

  function renderAuthPanel(mode) {
    const panel = $('#authPanel');
    if (!panel) return;

    const isLogin = mode === 'login';
    const isRegister = mode === 'register';
    const isForgot = mode === 'forgot';
    const flash = isForgot ? '' : authFlashMessage;
    authFlashMessage = '';

    let html = '';

    if (isForgot) {
      if (authResetStage === 'request') {
        html =
          '<form class="auth-form" id="forgotForm" novalidate>' +
          '  <div class="auth-reset-note"><strong>Email verification</strong>' +
          '    <span>Enter the email on your account and we will send a 6-digit code.</span></div>' +
          '  <label class="field"><span>Account email</span>' +
          '    <input type="email" id="forgotEmail" autocomplete="email" inputmode="email" placeholder="you@example.com" value="' +
          escapeHtml(authResetEmail || state.email || '') + '" required />' +
          '  </label>' +
          '  <p class="auth-error" id="authError" role="alert"></p>' +
          '  <button type="submit" class="btn btn-primary btn-lg btn-block auth-submit" id="authSubmit">' +
          '    <span class="auth-submit-label" id="authSubmitLabel">Send Verification Code</span>' +
          '    <span class="auth-spinner" aria-hidden="true"></span>' +
          '  </button>' +
          '  <div class="auth-links"><button type="button" class="auth-link" data-auth-back>← Back to log in</button></div>' +
          '</form>';
      } else {
        html =
          '<form class="auth-form" id="resetForm" novalidate>' +
          '  <div class="auth-reset-note"><strong>Check your email</strong>' +
          '    <span>Enter the 6-digit code sent to ' + escapeHtml(authResetEmail || 'your email') + '.</span></div>' +
          '  <label class="field"><span>6-digit verification code</span>' +
          '    <input type="text" id="resetOtp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="123456" required />' +
          '  </label>' +
          '  <label class="field"><span>New password</span>' +
          '    <input type="password" id="resetPassword" data-pw-check="#resetPwChecklist" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" required />' +
          '  </label>' +
          passwordChecklistMarkup('resetPwChecklist') +
          '  <p class="auth-error" id="authError" role="alert"></p>' +
          '  <button type="submit" class="btn btn-primary btn-lg btn-block auth-submit" id="authSubmit">' +
          '    <span class="auth-submit-label" id="authSubmitLabel">Reset Password</span>' +
          '    <span class="auth-spinner" aria-hidden="true"></span>' +
          '  </button>' +
          '  <div class="auth-links">' +
          '    <button type="button" class="auth-link" data-auth-resend>Resend code</button>' +
          '    <button type="button" class="auth-link" data-auth-back>Back to log in</button>' +
          '  </div>' +
          '</form>';
      }
    } else {
      html =
        '<form class="auth-form" id="authForm" novalidate>' +
        (flash ? '<div class="auth-success">' + escapeHtml(flash) + '</div>' : '') +
        '  <div class="google-slot" id="googleSlot"></div>' +
        '  <div class="auth-divider"><span>or use email</span></div>' +
        (isRegister
          ? '  <label class="field"><span>Name <em>(optional)</em></span>' +
            '    <input type="text" id="authName" autocomplete="name" placeholder="Alex Tan" />' +
            '  </label>'
          : '') +
        '  <label class="field"><span>Email</span>' +
        '    <input type="email" id="authEmail" autocomplete="email" inputmode="email" placeholder="you@example.com" value="' +
        escapeHtml(state.email || authResetEmail || '') + '" required />' +
        '  </label>' +
        '  <label class="field"><span>Password</span>' +
        '    <input type="password" id="authPassword"' +
        (isRegister
          ? ' data-pw-check="#authPwChecklist" autocomplete="new-password" minlength="8"'
          : ' autocomplete="current-password"') +
        ' placeholder="' + (isRegister ? 'At least 8 characters' : 'Your password') + '" required />' +
        '  </label>' +
        (isRegister ? passwordChecklistMarkup('authPwChecklist') : '') +
        (isRegister
          ? '  <div class="auth-signup-badge" id="authCreditsBadge">' +
            '    <span class="auth-gift" aria-hidden="true">+5</span>' +
            '    <span>Get <strong>' + FREE_SIGNUP_CREDITS + ' free credits</strong> on sign up</span>' +
            '  </div>'
          : '  <div class="auth-inline-row"><button type="button" class="auth-link" data-auth-forgot>Forgot password?</button></div>') +
        '  <p class="auth-error" id="authError" role="alert"></p>' +
        '  <button type="submit" class="btn btn-primary btn-lg btn-block auth-submit" id="authSubmit">' +
        '    <span class="auth-submit-label" id="authSubmitLabel">' + (isLogin ? 'Log In' : 'Create Account') + '</span>' +
        '    <span class="auth-spinner" aria-hidden="true"></span>' +
        '  </button>' +
        '  <p class="fine center auth-fine" id="authFine">' +
        (isLogin
          ? 'Your session stays on this device until you log out.'
          : 'By signing up you agree to fair use of agent credits.') +
        '  </p>' +
        '</form>';
    }

    panel.innerHTML = html;

    if (isForgot) {
      const form = $(authResetStage === 'request' ? '#forgotForm' : '#resetForm');
      if (form) {
        form.addEventListener(
          'submit',
          authResetStage === 'request' ? handleForgotRequest : handleResetSubmit
        );
      }
    } else {
      const form = $('#authForm');
      if (form) form.addEventListener('submit', handleAuthSubmit);
      mountGoogleSignIn();
      const forgot = $('[data-auth-forgot]');
      if (forgot) forgot.addEventListener('click', function () { openForgotStep('request'); });
    }

    $$('#authPanel input').forEach(function (input) {
      input.addEventListener('input', function () {
        setAuthError('');
        if (input.hasAttribute('data-pw-check')) updatePasswordChecklist(input);
      });
    });

    $$('[data-auth-back]').forEach(function (btn) {
      btn.addEventListener('click', function () { setAuthTab('login'); });
    });

    $$('[data-auth-resend]').forEach(function (btn) {
      btn.addEventListener('click', function () { openForgotStep('request'); });
    });

    const pwInput = $('#authPanel input[data-pw-check]');
    if (pwInput) updatePasswordChecklist(pwInput);
    else syncAuthSubmitState();

    const firstInput = $('#authPanel input');
    if (firstInput) {
      window.setTimeout(function () { firstInput.focus(); }, 70);
    }
  }

  function handleForgotRequest(event) {
    event.preventDefault();
    if (authSubmitBusy) return;

    const emailEl = $('#forgotEmail');
    const email = emailEl ? emailEl.value.trim() : '';
    if (!isValidEmail(email)) {
      setAuthError('Enter the email address on your account.');
      if (emailEl) emailEl.focus();
      return;
    }

    setAuthError('');
    setAuthBusy(true);

    apiFetch(FORGOT_PASSWORD_URL, {
      method: 'POST',
      body: JSON.stringify({ email: email })
    })
      .then(function (response) {
        return readJson(response).then(function (body) {
          if (!response.ok || (body && body.ok === false)) {
            const err = new Error('Forgot password failed');
            err.status = response.status;
            err.body = body;
            throw err;
          }
          authResetEmail = email;
          setAuthBusy(false);
          openForgotStep('verify');
          toast('Check your email for a 6-digit verification code.', 'info');
        });
      })
      .catch(function (err) {
        setAuthBusy(false);
        setAuthError(friendlyAuthError(err));
      });
  }

  function handleResetSubmit(event) {
    event.preventDefault();
    if (authSubmitBusy) return;

    const otpEl = $('#resetOtp');
    const passEl = $('#resetPassword');
    const otp = otpEl ? otpEl.value.trim() : '';
    const password = passEl ? passEl.value : '';

    if (!/^\d{6}$/.test(otp)) {
      setAuthError('Enter the 6-digit verification code from your email.');
      if (otpEl) otpEl.focus();
      return;
    }
    if (!passwordIsStrong(password)) {
      setAuthError('Choose a password that meets all 4 requirements.');
      if (passEl) passEl.focus();
      return;
    }

    setAuthError('');
    setAuthBusy(true);

    apiFetch(RESET_PASSWORD_URL, {
      method: 'POST',
      body: JSON.stringify({
        email: authResetEmail,
        otp: otp,
        code: otp,
        new_password: password,
        password: password
      })
    })
      .then(function (response) {
        return readJson(response).then(function (body) {
          if (!response.ok || (body && body.ok === false)) {
            const err = new Error('Password reset failed');
            err.status = response.status;
            err.body = body;
            throw err;
          }
          setAuthBusy(false);
          authFlashMessage = 'Password reset successfully. Log in with your new password.';
          setAuthTab('login');
          toast('Password updated. Please log in.', 'success');
        });
      })
      .catch(function (err) {
        setAuthBusy(false);
        setAuthError(friendlyAuthError(err));
      });
  }

  function openAuthModal(mode, prompt) {
    authSubmitBusy = false;
    authResetStage = 'request';
    authResetEmail = '';
    authFlashMessage = '';

    openModal(
      '<div class="auth-modal">' +
        '<div class="auth-brand-row">' +
        '  <span class="auth-orb" aria-hidden="true">5</span>' +
        '  <span class="auth-brand-copy"><strong>Agentic account</strong><span>Neon-backed credits, one wallet for every agent.</span></span>' +
        '</div>' +
        '<h2 class="modal-title" id="modalTitle"><span id="authTitle">Log in to Agentic</span></h2>' +
        '<p class="modal-sub" id="authSub"></p>' +
        '<div class="auth-prompt" id="authPrompt" hidden>' +
        '  <span class="auth-prompt-dot" aria-hidden="true"></span>' +
        '  <span id="authPromptText"></span>' +
        '</div>' +
        '<div class="tab-row auth-tabs" role="tablist" aria-label="Log in or sign up">' +
        '  <button type="button" role="tab" data-auth-tab="login" aria-selected="true">Log In</button>' +
        '  <button type="button" role="tab" data-auth-tab="register" aria-selected="false">Sign Up</button>' +
        '</div>' +
        '<div class="auth-panel" id="authPanel"></div>' +
        '</div>',
      false
    );

    const promptEl = $('#authPrompt');
    if (promptEl) {
      promptEl.hidden = !prompt;
      const promptText = $('#authPromptText');
      if (promptText) promptText.textContent = prompt || '';
    }

    $$('[data-auth-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setAuthTab(btn.getAttribute('data-auth-tab'));
      });
    });

    setAuthTab(mode);
  }

  function handleAuthSubmit(event) {
    event.preventDefault();
    if (authSubmitBusy) return;

    const isLogin = authModalMode === 'login';
    const nameEl = $('#authName');
    const emailEl = $('#authEmail');
    const passEl = $('#authPassword');

    const name = nameEl ? nameEl.value.trim() : '';
    const email = emailEl ? emailEl.value.trim() : '';
    const password = passEl ? passEl.value : '';

    if (!isValidEmail(email)) {
      setAuthError('Enter a valid email address (e.g. you@example.com).');
      if (emailEl) emailEl.focus();
      return;
    }
    if (!isLogin && !passwordIsStrong(password)) {
      setAuthError('Choose a password that meets all 4 requirements.');
      if (passEl) passEl.focus();
      return;
    }
    if (isLogin && !password) {
      setAuthError('Enter your password.');
      if (passEl) passEl.focus();
      return;
    }

    setAuthError('');
    setAuthBusy(true);

    const payload = { email: email, password: password };
    if (!isLogin && name) payload.name = name;

    apiFetch(isLogin ? AUTH_LOGIN_URL : AUTH_REGISTER_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        return readJson(response).then(function (body) {
          if (!response.ok || (body && body.ok === false)) {
            const err = new Error('Auth failed');
            err.status = response.status;
            err.body = body;
            throw err;
          }
          completeAuthSuccess(
            body,
            !isLogin,
            isLogin ? '' : 'Account created — ' + FREE_SIGNUP_CREDITS + ' free credits added.'
          );
        });
      })
      .catch(function (err) {
        setAuthBusy(false);
        setAuthError(friendlyAuthError(err));
      });
  }

  function openAccountModal() {
    if (!auth.user) {
      pendingGate = { action: 'account' };
      openAuthModal('login', 'Log in to manage your account and avatar.');
      return;
    }

    const currentId =
      AVATAR_IDS.indexOf(String(auth.user.avatar_id || '')) !== -1
        ? String(auth.user.avatar_id)
        : 'mochi-circle';
    let selectedId = currentId;

    const choices = AVATARS.map(function (avatar) {
      return (
        '<button type="button" class="avatar-choice' +
        (avatar.id === currentId ? ' is-selected' : '') +
        '" data-avatar-choice="' + avatar.id + '" aria-pressed="' +
        (avatar.id === currentId ? 'true' : 'false') + '">' +
        avatarMarkup(avatar.id, 'avatar--picker') +
        '<span class="avatar-choice-label">' + escapeHtml(avatar.label) + '</span>' +
        '<span class="avatar-choice-id">' + escapeHtml(avatar.id) + '</span>' +
        '</button>'
      );
    }).join('');

    openModal(
      '<div class="account-modal">' +
        '<h2 class="modal-title" id="modalTitle">Account Settings</h2>' +
        '<p class="modal-sub">Your identity, live credit balance and animated profile picture.</p>' +
        '<div class="account-card">' +
        '  <div class="account-card-main">' +
        '    <span class="account-card-label">Signed in as</span>' +
        '    <strong id="accountEmail">' + escapeHtml(auth.user.email || '—') + '</strong>' +
        '    <span class="account-card-name">' + escapeHtml(displayUserName(auth.user)) + '</span>' +
        '  </div>' +
        '  <div class="account-card-credits">' +
        '    <span class="account-card-label">Credits</span>' +
        '    <strong><span data-credit-count>' + state.credits + '</span></strong>' +
        '  </div>' +
        '</div>' +
        '<div class="avatar-section-head">' +
        '  <h3>Choose your avatar</h3>' +
        '  <span>5 shapes · subtle looping animation</span>' +
        '</div>' +
        '<div class="avatar-picker" id="avatarPicker" role="group" aria-label="Profile avatar">' +
        choices +
        '</div>' +
        '<div class="avatar-preview" id="avatarPreviewRow">' +
        '  <span class="avatar-preview-art" id="avatarPreview">' +
        avatarMarkup(currentId, 'avatar--preview') +
        '  </span>' +
        '  <span class="avatar-preview-copy">' +
        '    <strong id="avatarPreviewName">' +
        escapeHtml(
          (AVATARS.filter(function (a) { return a.id === currentId; })[0] || {}).label || 'Mochi'
        ) +
        '</strong>' +
        '    <span>Preview updates instantly. Save to sync with Neon.</span>' +
        '  </span>' +
        '</div>' +
        '<p class="avatar-error" id="avatarError" role="alert"></p>' +
        '<div class="account-session">' +
        '  <div class="account-session-copy">' +
        '    <strong>Session</strong>' +
        '    <span>Signed in on this device. Logging out clears your token and local job history.</span>' +
        '  </div>' +
        '  <button type="button" class="btn btn-danger-ghost" id="accountLogoutBtn">Log Out</button>' +
        '</div>' +
        '<div class="modal-actions account-actions">' +
        '  <button type="button" class="btn btn-ghost" data-modal-close>Cancel</button>' +
        '  <button type="button" class="btn btn-primary" id="avatarSaveBtn">Save avatar</button>' +
        '</div>' +
        '</div>',
      true
    );

    const applyChoice = function (id) {
      selectedId = id;
      const avatar = AVATARS.filter(function (a) { return a.id === id; })[0] || AVATARS[0];
      $$('#avatarPicker [data-avatar-choice]').forEach(function (btn) {
        const on = btn.getAttribute('data-avatar-choice') === id;
        btn.classList.toggle('is-selected', on);
        btn.setAttribute('aria-pressed', String(on));
      });
      const preview = $('#avatarPreview');
      if (preview) preview.innerHTML = avatarMarkup(id, 'avatar--preview');
      const name = $('#avatarPreviewName');
      if (name) name.textContent = avatar.label;
      const err = $('#avatarError');
      if (err) err.textContent = '';
    };

    $$('#avatarPicker [data-avatar-choice]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyChoice(btn.getAttribute('data-avatar-choice'));
      });
    });

    const logoutBtn = $('#accountLogoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        closeModal(false);
        logoutUser();
      });
    }

    const saveBtn = $('#avatarSaveBtn');
    if (!saveBtn) return;

    saveBtn.addEventListener('click', function () {
      const errEl = $('#avatarError');
      if (errEl) errEl.textContent = '';
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';

      apiFetch(ACCOUNT_AVATAR_URL, {
        method: 'POST',
        body: JSON.stringify({ avatar_id: selectedId })
      })
        .then(function (response) {
          return readJson(response).then(function (body) {
            if (response.status === 401) {
              closeModal(false);
              handleAuthExpired(
                'Your session expired. Log in again to save your avatar.',
                { action: 'account' }
              );
              return;
            }
            if (!response.ok || (body && body.ok === false)) {
              const message =
                body && typeof body.error === 'string'
                  ? body.error
                  : body && typeof body.message === 'string'
                  ? body.message
                  : 'Could not save your avatar. Please try again.';
              throw new Error(message);
            }

            auth.user.avatar_id =
              (body && (body.avatar_id || (body.user && body.user.avatar_id))) || selectedId;
            renderAuthUI();
            closeModal();
            toast('Avatar updated — it will follow you across devices.', 'success');
          });
        })
        .catch(function (error) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save avatar';
          if (errEl) {
            errEl.textContent =
              error && error.name === 'AbortError'
                ? 'The save timed out. Check your connection and try again.'
                : error && error.message
                ? error.message
                : 'Could not save your avatar. Please try again.';
          }
        });
    });
  }

  /* ---- Five pure CSS + inline SVG avatars (no images, no libraries) ------ */
  function avatarMarkup(id, sizeClass) {
    const safeId = AVATAR_IDS.indexOf(String(id || '')) !== -1 ? String(id) : 'mochi-circle';
    return (
      '<span class="avatar avatar--' + safeId + (sizeClass ? ' ' + sizeClass : '') +
      '" data-avatar="' + safeId + '" aria-hidden="true">' +
      avatarSvg(safeId) +
      '</span>'
    );
  }

  function avatarSvg(id) {
    if (id === 'boba-squircle') {
      return (
        '<svg viewBox="0 0 64 64" role="img" aria-hidden="true">' +
        '<g class="av-bob">' +
        '<rect x="26" y="9" width="9" height="15" rx="4.5" fill="#F9A8D4" transform="rotate(12 30.5 16)"/>' +
        '<rect x="14" y="20" width="36" height="37" rx="14" fill="#FDE68A" stroke="#F59E0B" stroke-width="1.8"/>' +
        '<rect x="18" y="24" width="28" height="9" rx="4.5" fill="#FEF3C7" opacity=".75"/>' +
        '<g class="av-pearls" fill="#7C3AED">' +
        '<circle cx="23" cy="49" r="3.1"/><circle cx="31" cy="51.5" r="3.4"/><circle cx="40" cy="49" r="3.1"/>' +
        '</g>' +
        '<g class="av-blink">' +
        '<circle cx="25" cy="36" r="2.1" fill="#3B1F2B"/><circle cx="39" cy="36" r="2.1" fill="#3B1F2B"/>' +
        '<circle cx="24.2" cy="35.2" r=".7" fill="#fff"/><circle cx="38.2" cy="35.2" r=".7" fill="#fff"/>' +
        '</g>' +
        '<ellipse cx="20.5" cy="41" rx="2.5" ry="1.8" fill="#F472B6" opacity=".5"/>' +
        '<ellipse cx="43.5" cy="41" rx="2.5" ry="1.8" fill="#F472B6" opacity=".5"/>' +
        '<path d="M29 41q3 2.8 6 0" fill="none" stroke="#3B1F2B" stroke-width="1.8" stroke-linecap="round"/>' +
        '</g></svg>'
      );
    }

    if (id === 'star-puff') {
      return (
        '<svg viewBox="0 0 64 64" role="img" aria-hidden="true">' +
        '<g class="av-bob">' +
        '<polygon points="32,4 39.8,23.2 60,25.1 44.6,38.4 49.2,58 32,47.8 14.8,58 19.4,38.4 4,25.1 24.2,23.2" ' +
        'fill="#FDE68A" stroke="#F59E0B" stroke-width="2.4" stroke-linejoin="round"/>' +
        '<ellipse cx="25" cy="31" rx="2.5" ry="3.3" fill="#3B1F2B"/>' +
        '<ellipse cx="39" cy="31" rx="2.5" ry="3.3" fill="#3B1F2B"/>' +
        '<circle cx="23.9" cy="30" r=".8" fill="#fff"/><circle cx="37.9" cy="30" r=".8" fill="#fff"/>' +
        '<circle cx="19.5" cy="35.5" r="2" fill="#FB7185" opacity=".55"/>' +
        '<circle cx="44.5" cy="35.5" r="2" fill="#FB7185" opacity=".55"/>' +
        '<path d="M28 37q4 3.2 8 0" fill="none" stroke="#3B1F2B" stroke-width="1.9" stroke-linecap="round"/>' +
        '<g class="av-twinkle" fill="#FFF7ED">' +
        '<circle cx="53" cy="11" r="1.6"/><circle cx="9" cy="17" r="1.2"/><circle cx="55" cy="47" r="1.1"/>' +
        '</g></g></svg>'
      );
    }

    if (id === 'hex-bot') {
      return (
        '<svg viewBox="0 0 64 64" role="img" aria-hidden="true">' +
        '<g class="av-bob">' +
        '<path d="M32 9V3" stroke="#6366F1" stroke-width="2.2" stroke-linecap="round"/>' +
        '<circle cx="32" cy="2.5" r="2.2" fill="#34D399"/>' +
        '<polygon points="32,7 54,19 54,46 32,58 10,46 10,19" fill="#C7D2FE" stroke="#6366F1" stroke-width="2.4" stroke-linejoin="round"/>' +
        '<rect x="14" y="15" width="6" height="10" rx="3" fill="#818CF8"/>' +
        '<rect x="44" y="15" width="6" height="10" rx="3" fill="#818CF8"/>' +
        '<rect class="av-visor" x="17" y="22" width="30" height="12" rx="6" fill="#0F172A"/>' +
        '<g class="av-blink">' +
        '<circle cx="26" cy="28" r="2.2" fill="#22D3EE"/><circle cx="38" cy="28" r="2.2" fill="#22D3EE"/>' +
        '</g>' +
        '<path d="M28 42q4 2.4 8 0" fill="none" stroke="#4338CA" stroke-width="1.9" stroke-linecap="round"/>' +
        '<circle cx="21" cy="40" r="1.7" fill="#F472B6" opacity=".45"/>' +
        '<circle cx="43" cy="40" r="1.7" fill="#F472B6" opacity=".45"/>' +
        '</g></svg>'
      );
    }

    if (id === 'cloud-cat') {
      return (
        '<svg viewBox="0 0 64 64" role="img" aria-hidden="true">' +
        '<g class="av-bob">' +
        '<g class="av-ears">' +
        '<path d="M17 25 L13 8 L27 17 Z" fill="#E0E7FF" stroke="#818CF8" stroke-width="1.6" stroke-linejoin="round"/>' +
        '<path d="M47 25 L51 8 L37 17 Z" fill="#E0E7FF" stroke="#818CF8" stroke-width="1.6" stroke-linejoin="round"/>' +
        '</g>' +
        '<g fill="#EEF2FF" stroke="#A5B4FC" stroke-width="1.5">' +
        '<circle cx="18" cy="39" r="9"/><circle cx="32" cy="32" r="12"/><circle cx="46" cy="39" r="9"/>' +
        '<circle cx="25" cy="44" r="9"/><circle cx="39" cy="44" r="9"/>' +
        '</g>' +
        '<g class="av-blink">' +
        '<ellipse cx="26" cy="36" rx="2.2" ry="3" fill="#312E81"/>' +
        '<ellipse cx="38" cy="36" rx="2.2" ry="3" fill="#312E81"/>' +
        '<circle cx="25.1" cy="35" r=".7" fill="#fff"/><circle cx="37.1" cy="35" r=".7" fill="#fff"/>' +
        '</g>' +
        '<path d="M20 39h-6M20 42l-6 2M44 39h6M44 42l6 2" fill="none" stroke="#A5B4FC" stroke-width="1.2" stroke-linecap="round"/>' +
        '<circle cx="22" cy="40.5" r="1.6" fill="#F9A8D4" opacity=".6"/>' +
        '<circle cx="42" cy="40.5" r="1.6" fill="#F9A8D4" opacity=".6"/>' +
        '<path d="M29 41q3 2.2 6 0" fill="none" stroke="#312E81" stroke-width="1.8" stroke-linecap="round"/>' +
        '</g></svg>'
      );
    }

    /* mochi-circle (default) */
    return (
      '<svg viewBox="0 0 64 64" role="img" aria-hidden="true">' +
      '<g class="av-bob">' +
      '<circle cx="32" cy="36" r="24" fill="#FFE1E8"/>' +
      '<circle cx="32" cy="32" r="20" fill="#FFF1F4"/>' +
      '<ellipse cx="18" cy="40" rx="4.4" ry="3" fill="#FDBA74" opacity=".5"/>' +
      '<ellipse cx="46" cy="40" rx="4.4" ry="3" fill="#FDBA74" opacity=".5"/>' +
      '<g class="av-blink">' +
      '<ellipse cx="24.5" cy="33" rx="2.6" ry="3.6" fill="#3B1F2B"/>' +
      '<ellipse cx="39.5" cy="33" rx="2.6" ry="3.6" fill="#3B1F2B"/>' +
      '<circle cx="23.5" cy="31.8" r=".9" fill="#fff"/><circle cx="38.5" cy="31.8" r=".9" fill="#fff"/>' +
      '</g>' +
      '<path d="M28 42q4 3.6 8 0" fill="none" stroke="#3B1F2B" stroke-width="2" stroke-linecap="round"/>' +
      '</g></svg>'
    );
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

    /* Re-assert BOTH agents' credit gates on every route render. */
    updateSubscribeButton();
    updateScraperButton();

    closeMobileNav();
    closeWallet();
    closeModal(false);

    /* Keep the live job poller running between #scraper-results and #agents. */
    if (route !== 'agents' && route !== 'scraper-results') stopScraperTimers();

    if (route === 'configure') {
      /* #configure is now a modal: show #agents underneath, then open it. */
      $$('.view').forEach(function (view) {
        view.classList.toggle('is-active', view.getAttribute('data-view') === 'agents');
      });
      enterConfigure();
    }
    if (route === 'plans') renderPlans();
    if (route === 'success') renderSuccess();
    if (route === 'scraper-results') renderScraperResults();

    renderScraperCardStatus();
    if (route === 'agents') ensureScraperRunning();

    if ((route === 'agents' || route === 'scraper-results') &&
        state.scraperJob && state.scraperJob.status === 'completed' &&
        state.scraperJob.email_sent !== true && state.scraperJob.mode === 'live') {
      startEmailTrail();
    }

    document.title = TITLES[route] || TITLES.home;
    window.scrollTo(0, 0);
  }

  /* ======================= E. CREDIT UI / SUBSCRIBE ======================= */
  let lastRenderedCredits = null;

  /* Brief scale/glow when a required-credit total changes. */
  function pulseCredit(el) {
    if (!el) return;
    el.classList.remove('credit-pulse');
    void el.offsetWidth;
    el.classList.add('credit-pulse');
  }

  /* Floating +N / -N badge on the wallet pill. */
  function showCreditDelta(delta) {
    const pill = $('.credit-pill');
    if (!pill || !delta) return;
    const badge = document.createElement('span');
    badge.className = 'credit-delta ' + (delta > 0 ? 'is-up' : 'is-down');
    badge.textContent = (delta > 0 ? '+' : '') + delta;
    pill.appendChild(badge);
    window.setTimeout(function () {
      if (badge.parentNode) badge.parentNode.removeChild(badge);
    }, 1400);
  }

  function syncCreditUI() {
    $$('[data-credit-count]').forEach(function (el) {
      el.textContent = String(state.credits);
    });
    updateSubscribeButton();
    updateScraperButton();
    renderWalletSubs();

    const delta = lastRenderedCredits !== null ? state.credits - lastRenderedCredits : 0;
    if (delta) {
      showCreditDelta(delta);
      const navBadge = $('#navCreditBadge');
      if (navBadge) pulseCredit(navBadge);
    }
    lastRenderedCredits = state.credits;

    /* Safe no-op when neither config modal is open. */
    renderConfigure();
    renderScraperCardStatus();
  }

  /* Second live agent — logged-out visitors can click, then sign up for credits. */
  function updateScraperButton() {
    const btn = $('#scraperSubscribeBtn');
    if (!btn) return;
    const caption = $('#scraperSubscribeCaption');
    const signedIn = isLoggedIn();
    const enough = signedIn && Number(state.credits) >= LEAD_MIN_CREDITS;
    const locked = signedIn && !enough;

    if (locked) {
      btn.disabled = true;
      btn.setAttribute('disabled', 'disabled');
    } else {
      btn.disabled = false;
      btn.removeAttribute('disabled');
    }

    btn.classList.toggle('is-disabled', locked);
    btn.classList.toggle('is-ready', enough || !signedIn);
    btn.setAttribute('aria-disabled', locked ? 'true' : 'false');
    btn.textContent = 'Subscribe';

    if (caption) {
      caption.hidden = enough;
      if (!signedIn) {
        caption.innerHTML =
          'Log in or sign up to get <strong>' + FREE_SIGNUP_CREDITS +
          ' free credits</strong> and launch this agent.';
      } else if (!enough) {
        caption.innerHTML =
          'Needs at least ' + LEAD_MIN_CREDITS +
          ' credits (1 term · ' + LEAD_LEADS_PER_TERM +
          ' leads). <a href="#plans">Top up in Manage My Plan</a>.';
      } else {
        caption.innerHTML = '';
      }
    }
  }

  function updateSubscribeButton() {
    const btn = $('#subscribeBtn');
    if (!btn) return;
    const caption = $('#subscribeCaption');
    const signedIn = isLoggedIn();
    const enough = signedIn && Number(state.credits) >= CREDITS_PER_STOCK;
    const locked = signedIn && !enough;

    if (locked) {
      btn.disabled = true;
      btn.setAttribute('disabled', 'disabled');
    } else {
      btn.disabled = false;
      btn.removeAttribute('disabled');
    }

    btn.classList.toggle('is-disabled', locked);
    btn.classList.toggle('is-ready', enough || !signedIn);
    btn.setAttribute('aria-disabled', locked ? 'true' : 'false');
    btn.textContent = 'Subscribe';

    if (caption) {
      caption.hidden = enough;
      if (!signedIn) {
        caption.innerHTML =
          'Log in or sign up to get <strong>' + FREE_SIGNUP_CREDITS +
          ' free credits</strong> and subscribe.';
      } else if (!enough) {
        caption.innerHTML =
          'Requires at least ' + CREDITS_PER_STOCK + ' credits for ' +
          SUB_DAYS + ' days (1 stock). <a href="#plans">Top up in Manage My Plan</a>.';
      } else {
        caption.innerHTML = '';
      }
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

    if (!requireAuth({ action: 'checkout', packId: packId })) return;

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
        '    <p class="demo-note">Demo checkout — no payment is processed. Credits are added to this session only until billing is connected.</p>' +
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

  let stockModalOpen = false;
  let lastStockCost = null;

  /* Stock configuration is a modal with the same shell as the scraper modal. */
  function openStockModal() {
    if (!requireAuth({ action: 'stock' })) return;

    openModal(
      '<h2 class="modal-title" id="modalTitle">Stock Market News Agent</h2>' +
        '<p class="modal-sub">07:00 MYT delivery · ' + CREDITS_PER_STOCK + ' credits per stock · ' +
        SUB_DAYS + '-day access</p>' +
        '<div class="notice notice-warn" id="configureLocked" hidden>' +
        '<strong>You need at least ' + CREDITS_PER_STOCK + ' credits for a 7-day subscription.</strong>' +
        '<p>Your balance is <span data-credit-count>' + state.credits +
        '</span> credits. A $5 top-up buys one stock for a week.</p>' +
        '<a class="btn btn-primary btn-sm" href="#plans">Top up in Manage My Plan</a>' +
        '</div>' +
        '<div id="configureBody">' +
        '<div class="calc-card modal-calc"><div class="calc-grid">' +
        '<div class="calc-cell"><span class="calc-label">Available</span>' +
        '<span class="calc-value" id="calcAvailable">0 Credits</span></div>' +
        '<div class="calc-cell"><span class="calc-label">Selected</span>' +
        '<span class="calc-value" id="calcSelected">0</span></div>' +
        '<div class="calc-cell"><span class="calc-label">Duration</span>' +
        '<span class="calc-value" id="calcDuration">' + SUB_DAYS + ' Days</span></div>' +
        '<div class="calc-cell calc-cell-total"><span class="calc-label">Total cost</span>' +
        '<span class="calc-value" id="calcCost">' + CREDITS_PER_STOCK + ' Credits</span>' +
        '<span class="calc-sub" id="calcRemaining"></span></div>' +
        '</div></div>' +
        '<div class="modal-section"><h3>1. Select stocks</h3>' +
        '<span class="pill-note" id="stockQuotePill"></span></div>' +
        '<div class="stock-grid" id="stockGrid" role="group" aria-label="Select stocks to monitor"></div>' +
        '<p class="fine" id="stockGridHint"></p>' +
        '<div class="modal-section"><h3>2. Delivery details</h3>' +
        '<span class="fine">Email only</span></div>' +
        '<form id="configureForm" class="config-form stock-modal-form" novalidate>' +
        '<div class="form-two">' +
        '<div class="field"><label for="fullName">Full name <span class="req">*</span></label>' +
        '<input type="text" id="fullName" name="fullName" placeholder="Alex Tan" autocomplete="name" required />' +
        '<span class="field-error" id="nameError" role="alert"></span></div>' +
        '<div class="field"><label for="email">Delivery email <span class="req">*</span></label>' +
        '<input type="email" id="email" name="email" placeholder="you@example.com" autocomplete="email" inputmode="email" required />' +
        '<span class="field-error" id="emailError" role="alert"></span></div>' +
        '</div>' +
        '<div class="config-summary" id="configSummary"></div>' +
        '<button type="submit" class="btn btn-activate" id="activateBtn">Confirm & Spend ' +
        CREDITS_PER_STOCK + ' Credits (' + SUB_DAYS + ' Days)</button>' +
        '<p class="fine">First brief arrives tomorrow at 07:00 MYT.</p>' +
        '</form>' +
        '</div>',
      true
    );

    stockModalOpen = true;
    lastStockCost = null;

    buildStockGrid();

    const form = $('#configureForm');
    if (form) form.addEventListener('submit', handleActivate);
    $$('#configureForm input').forEach(function (input) {
      input.addEventListener('input', function () { clearFieldError(input); });
    });

    prepareStockConfig();
  }

  function prepareStockConfig() {
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

  function enterConfigure() {
    if (!isLoggedIn()) {
      if (auth.token) {
        refreshSession().then(function (ok) {
          if (ok) openStockModal();
          else requireAuth({ action: 'stock' });
        });
        return;
      }
      requireAuth({ action: 'stock' });
      return;
    }
    openStockModal();
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
    setText('#calcRemaining', 'Remaining after activation: ' + remaining + ' credits');

    /* Pulse the total when the user adds/removes a ticker. */
    const costEl = $('#calcCost');
    if (costEl) {
      if (lastStockCost !== null && lastStockCost !== cost) pulseCredit(costEl);
      costEl.textContent = cost + ' Credits';
    }
    lastStockCost = cost;

    const quotePill = $('#stockQuotePill');
    if (quotePill) {
      quotePill.textContent =
        selectedStocks.length + ' stock' + (selectedStocks.length === 1 ? '' : 's') +
        ' · ' + cost + ' credits';
    }

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

    if (!isLoggedIn()) {
      requireAuth({ action: 'stock' });
      return;
    }

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

    const activateBtn = $('#activateBtn');
    if (activateBtn) {
      activateBtn.disabled = true;
      activateBtn.classList.add('is-busy');
    }

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

    const payload = {
      event: 'subscriber.activated',
      agent_id: AGENT_ID,
      name: name,
      email: email,
      watchlist: subscription.watchlist,
      duration_days: SUB_DAYS,
      credits_spent: cost,
      remaining_credits: Math.max(0, state.credits - cost),
      timezone: TIMEZONE,
      subscribed_at: subscription.startedAt,
      expires_at: subscription.expiresAt
    };

    console.log('[Agentic] subscriber.activated → ' + (CFG.WEBHOOK_URL || '(no webhook configured)'));
    console.log('[Agentic] webhook payload:', JSON.stringify(payload, null, 2));

    postAgentWebhook(payload).then(function (result) {
      pendingWebhook = false;

      if (result.kind === 'unauthorized') {
        lastWebhookResult = { status: 'fail', code: 401 };
        handleAuthExpired(
          'Your session expired. Log in again to finish this subscription.',
          { action: 'stock' }
        );
        return;
      }

      if (result.kind === 'insufficient') {
        if (result.remaining !== null && Number.isFinite(result.remaining)) {
          state.credits = result.remaining;
        }
        syncCreditUI();
        toast(
          'Insufficient credits — you need ' + cost + ' credits for this activation.',
          'warn'
        );
        if (activateBtn) {
          activateBtn.disabled = false;
          activateBtn.classList.remove('is-busy');
        }
        renderConfigure();
        return;
      }

      /* Server is authoritative when it returns a live balance. */
      state.credits =
        result.remaining !== null && Number.isFinite(result.remaining)
          ? Math.max(0, Math.floor(result.remaining))
          : Math.max(0, state.credits - cost);
      state.name = name;
      state.email = email;
      state.subscriptions = [subscription].concat(state.subscriptions || []);
      state.lastSubscription = subscription;
      saveState();

      lastWebhookResult =
        result.kind === 'ok'
          ? { status: 'ok', code: result.status, body: result.body }
          : {
              status: 'fail',
              code: result.status || 0,
              reason: result.reason || 'http-error',
              body: result.body
            };

      if (result.kind === 'ok') {
        setWebhookBadge('ok', 'Synced with 07:00 MYT Agent');
      } else {
        setWebhookBadge(
          'fail',
          'Webhook not reachable — activation saved locally, payload logged.'
        );
      }

      syncCreditUI();
      pulsePill();
      window.location.hash = '#success';
    });
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

  /* Authenticated agent webhook call. Returns a structured outcome so the UI
     can distinguish expired sessions (401) from insufficient credits (402). */
  function postAgentWebhook(payload) {
    const url = CFG.WEBHOOK_URL;

    if (!url || !/^https?:\/\//i.test(url)) {
      return Promise.resolve({ kind: 'offline', reason: 'not-configured', remaining: null });
    }

    pendingWebhook = true;
    lastWebhookResult = { status: 'pending' };
    setWebhookBadge('pending', 'Syncing subscriber to the n8n webhook…');

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? window.setTimeout(function () { controller.abort(); }, 12000) : null;

    return fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) {
        if (timer) window.clearTimeout(timer);
        return readJson(response).then(function (body) {
          const remaining = extractRemaining(body);
          if (response.status === 401) {
            return { kind: 'unauthorized', status: 401, body: body, remaining: remaining };
          }
          if (response.status === 402) {
            return { kind: 'insufficient', status: 402, body: body, remaining: remaining };
          }
          if (!response.ok) {
            return { kind: 'error', status: response.status, body: body, remaining: remaining };
          }
          if (body && body.ok === false) {
            return { kind: 'error', status: response.status, body: body, remaining: remaining };
          }
          return { kind: 'ok', status: response.status, body: body, remaining: remaining };
        });
      })
      .catch(function (err) {
        if (timer) window.clearTimeout(timer);
        console.warn(
          '[Agentic] Agent webhook unreachable — keeping the local activation.',
          err && err.message ? err.message : err
        );
        return { kind: 'offline', reason: 'network', error: err, remaining: null };
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

    stockModalOpen = false;
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

  function logoutUser() {
    stopScraperTimers();
    stopEmailTrail();
    pendingGate = null;
    selectedStocks = [];
    lastWebhookResult = null;
    pendingWebhook = false;

    /* Local job/subscription history belongs to the signed-in account. */
    state.subscriptions = [];
    state.lastSubscription = null;
    state.scraperJob = null;
    saveState();

    clearAuthSession();
    renderPlans();
    renderSuccess();
    renderScraperResults();
    closeWallet();
    closeMobileNav();
    toast('Logged out. Your credits stay safe on the server.', 'info');
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

    /* Auth: login/signup triggers, account settings and logout */
    $$('[data-auth-open]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openAuthModal(btn.getAttribute('data-auth-open'));
      });
    });

    $$('[data-open-account]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.preventDefault();
        openAccountModal();
      });
    });

    const accountPill = $('#accountPill');
    if (accountPill) {
      accountPill.addEventListener('click', function (event) {
        event.stopPropagation();
        openAccountModal();
      });
    }

    const logoutBtn = $('#logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        logoutUser();
      });
    }

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

    /* Home: switch between the two live-agent output previews */
    $$('[data-home-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const name = btn.getAttribute('data-home-tab');
        $$('[data-home-tab]').forEach(function (b) {
          const on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-selected', String(on));
        });
        $$('[data-home-pane]').forEach(function (pane) {
          pane.hidden = pane.getAttribute('data-home-pane') !== name;
        });
      });
    });

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

    /* Subscribe → auth gate → configuration modal */
    const subscribeBtn = $('#subscribeBtn');
    if (subscribeBtn) {
      subscribeBtn.addEventListener('click', function () {
        if (!isLoggedIn()) {
          requireAuth({ action: 'stock' });
          return;
        }
        if (state.credits < CREDITS_PER_STOCK) {
          toast('You need at least ' + CREDITS_PER_STOCK + ' credits to subscribe.', 'warn');
          return;
        }
        openStockModal();
      });
    }

    /* Lead Scraper: auth gate → configuration modal */
    const scraperBtn = $('#scraperSubscribeBtn');
    if (scraperBtn) {
      scraperBtn.addEventListener('click', function () {
        if (!isLoggedIn()) {
          requireAuth({ action: 'scraper' });
          return;
        }
        if (state.credits < LEAD_MIN_CREDITS) {
          toast('Needs at least ' + LEAD_MIN_CREDITS + ' credits (1 term · ' + LEAD_LEADS_PER_TERM + ' leads).', 'warn');
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

  /* ----- state helpers ----- */
  function getSelectedColumns(job) {
    const ids =
      job && Array.isArray(job.selected_columns) && job.selected_columns.length
        ? job.selected_columns
        : LEAD_REQUIRED_COLUMNS.map(function (c) { return c.id; });
    return ids.filter(function (id) { return LEAD_COLUMN_LABELS[id]; });
  }

  let emailTrailTimer = null;
  let emailTrailTries = 0;

  function stopScraperTimers() {
    if (scraperPollTimer) {
      window.clearInterval(scraperPollTimer);
      scraperPollTimer = null;
    }
  }

  function scraperPageActive() {
    const route = currentRoute();
    return route === 'scraper-results' || route === 'agents';
  }

  function stopEmailTrail() {
    if (emailTrailTimer) {
      window.clearInterval(emailTrailTimer);
      emailTrailTimer = null;
    }
    emailTrailTries = 0;
  }

  /* After completion, poll up to 3× more (3s apart) for the SMTP flag. */
  function startEmailTrail() {
    if (emailTrailTimer) return;
    const job = state.scraperJob;
    if (!job || job.mode === 'demo' || job.email_sent === true) return;

    emailTrailTries = 0;
    emailTrailTimer = window.setInterval(function () {
      const current = state.scraperJob;
      if (!current || current.email_sent === true || emailTrailTries >= 3) {
        stopEmailTrail();
        return;
      }
      emailTrailTries += 1;
      pollScraperStatus(true);
    }, 3000);
  }

  /* Compact live/finished status on the B2B agent card in #agents. */
  function renderScraperCardStatus() {
    const wrap = $('#scraperCardStatus');
    if (!wrap) return;

    const job = state.scraperJob;
    if (!job) {
      wrap.hidden = true;
      wrap.innerHTML = '';
      return;
    }

    const target = scraperTarget(job);
    const scraped = clamp(Math.floor(Number(job.scraped_rows) || 0), 0, target);
    const percent = scraperIsComplete(job)
      ? 100
      : Math.min(99, Math.floor(scraperPercent(job)));
    const status = String(job.status || '').toLowerCase();

    if (scraperIsComplete(job)) {
      wrap.hidden = false;
      wrap.innerHTML =
        '<div class="card-job-done"><a class="card-job-ready" href="#scraper-results">' +
        '✓ Latest Run Ready (' + target.toLocaleString('en-US') + ' leads)</a></div>';
      return;
    }

    if (status === 'completed') {
      wrap.hidden = false;
      wrap.innerHTML =
        '<div class="card-job-live">' +
        '<span class="card-job-pill"><span class="job-live-dot"></span>Finalizing Excel…</span>' +
        '<a class="btn btn-ghost btn-sm" href="#scraper-results">View Live Progress</a>' +
        '</div>';
      return;
    }

    if (status === 'queued' || status === 'pending') {
      wrap.hidden = false;
      wrap.innerHTML =
        '<div class="card-job-live">' +
        '<span class="card-job-pill"><span class="job-live-dot"></span>Queued · Waiting for worker...</span>' +
        '<a class="btn btn-ghost btn-sm" href="#scraper-results">View Live Progress</a>' +
        '</div>';
      return;
    }

    if (status === 'running' || status === 'processing' || status === 'waiting') {
      wrap.hidden = false;
      wrap.innerHTML =
        '<div class="card-job-live">' +
        '<span class="card-job-pill"><span class="job-live-dot"></span>Running · ' +
        scraped.toLocaleString('en-US') + ' / ' + target.toLocaleString('en-US') +
        ' leads (' + percent + '%)</span>' +
        '<a class="btn btn-ghost btn-sm" href="#scraper-results">View Live Progress</a>' +
        '</div>';
      return;
    }

    wrap.hidden = true;
    wrap.innerHTML = '';
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

    if (scraperIsComplete(job)) {
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
        '<div class="summary-row"><dt>Target leads</dt><dd><strong>' + scraperTarget(job) + '</strong></dd></div>' +
        '<div class="summary-row"><dt>Credits spent</dt><dd><strong>' + (job.credits_spent || 0) + '</strong></dd></div>' +
        '<div class="summary-row"><dt>Columns</dt><dd>' + cols.length + '</dd></div>' +
        '<div class="summary-row"><dt>Started</dt><dd>' + escapeHtml(fmtMYT(job.started_at)) + '</dd></div>' +
        '<div class="summary-row"><dt>Job ID</dt><dd><code>' + escapeHtml(job.job_id) + '</code></dd></div>';
    }
  }

  /* Every job carries its own target; the backend can override it live. */
  function scraperTarget(job) {
    return Math.max(
      1,
      Number(job && job.target_count) || Number(job && job.target_rows) || LEAD_MAX_TARGET
    );
  }

  function scraperPercent(job) {
    const target = scraperTarget(job);
    let percent = Number(job && job.percent);
    if (!Number.isFinite(percent)) {
      const scraped = Number(job && job.scraped_rows) || 0;
      percent = target ? (scraped / target) * 100 : 0;
    }
    return clamp(percent, 0, 100);
  }

  function scraperIsComplete(job) {
    return (
      !!job &&
      String(job.status || '').toLowerCase() === 'completed' &&
      job.download_ready === true
    );
  }

  function updateScraperProgress() {
    const job = state.scraperJob;
    if (!job) return;

    const target = scraperTarget(job);
    const scraped = clamp(Math.floor(Number(job.scraped_rows) || 0), 0, target);
    const filled = clamp(Math.floor(Number(job.filled_rows) || 0), 0, target);
    const complete = scraperIsComplete(job);

    /* Never show 100% until the backend confirms completed + download_ready. */
    const percent = complete ? 100 : Math.min(99, Math.floor(scraperPercent(job)));
    const fill = $('#ringFill');

    if (fill) {
      fill.style.strokeDashoffset = String(RING_LENGTH - (RING_LENGTH * percent) / 100);
    }

    const percentEl = $('#ringPercent');
    if (percentEl) percentEl.textContent = percent + '%';

    const countEl = $('#ringCount');
    if (countEl) {
      countEl.textContent =
        scraped.toLocaleString('en-US') + ' / ' + target.toLocaleString('en-US') +
        ' leads scraped · ' + filled.toLocaleString('en-US') + ' / ' +
        target.toLocaleString('en-US') + ' filled';
    }

    const card = $('#ringCard');
    if (card) card.classList.toggle('is-complete', complete);

    const downloadBtn = $('#downloadBtn');
    if (downloadBtn) downloadBtn.disabled = !complete;

    const downloadTitle = $('#downloadTitle');
    if (downloadTitle) {
      downloadTitle.textContent = complete
        ? 'Excel (.xlsx) · ' + target.toLocaleString('en-US') + ' leads'
        : 'Excel (.xlsx)';
    }

    const downloadSub = $('#downloadSub');
    if (downloadSub) {
      if (complete) downloadSub.textContent = 'Ready to download';
      else if (String(job.status || '').toLowerCase() === 'completed') {
        downloadSub.textContent = 'Finalizing Excel…';
      } else {
        downloadSub.textContent = 'Live progress from the scraper backend';
      }
    }

    const terms = (job.search_terms || []).length;
    const rule = $('#ringRule');
    if (rule) {
      rule.textContent =
        target.toLocaleString('en-US') + ' leads target · ' +
        terms + ' term' + (terms === 1 ? '' : 's');
    }

    const emailNote = $('#scraperEmailNote');
    if (emailNote) {
      const email = job.email || 'your delivery email';
      const sent = complete && job.email_sent === true;
      emailNote.textContent = sent
        ? '✓ Excel (.xlsx) emailed to ' + email + ' & ready to download below.'
        : 'Excel (.xlsx) will also be emailed to ' + email +
          ' when the backend marks it ready — safe to close this tab.';
      emailNote.classList.toggle('is-sent', sent);
    }

    const tableMeta = $('#tableMeta');
    if (tableMeta) {
      tableMeta.textContent =
        'First 25 rows · ' + scraped.toLocaleString('en-US') + ' of ' +
        target.toLocaleString('en-US') + ' scraped · ' + filled.toLocaleString('en-US') +
        ' filled · ' + getSelectedColumns(job).length + ' columns';
    }

    /* Keep the #agents card badge in sync with every tick. */
    renderScraperCardStatus();
  }

  function currentPreviewRows(job) {
    if (job && Array.isArray(job.preview_rows) && job.preview_rows.length) {
      return job.preview_rows.slice(0, 25);
    }
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
          job.status === 'completed'
            ? 'Preview unavailable — download the .xlsx for every lead.'
            : 'Waiting for the first rows from the scraper backend…';
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

    const target = scraperTarget(job);
    job.status = 'completed';
    job.download_ready = true;
    job.target_count = target;
    job.scraped_rows = Math.max(0, Math.floor(Number(job.scraped_rows) || 0));
    job.filled_rows = Math.max(0, Math.floor(Number(job.filled_rows) || 0));
    job.collected_count = job.scraped_rows;
    job.percent = 100;
    stopScraperTimers();
    saveState();

    updateScraperProgress();
    renderLeadsTable();
    setScraperBadge('ok', 'Completed · .xlsx ready');

    const btn = $('#downloadBtn');
    if (btn) btn.disabled = false;

    /* SMTP may land a few seconds after the scrape — trail it briefly. */
    if (job.email_sent === true) stopEmailTrail();
    else startEmailTrail();

    if (!silent) toast('Lead list complete — Excel download ready.', 'success');
  }

  function failScraperJob(reason) {
    const job = state.scraperJob;
    if (!job) return;
    job.status = 'failed';
    stopScraperTimers();
    stopEmailTrail();
    saveState();
    renderScraperCardStatus();
    setScraperBadge('fail', reason ? 'Job failed · ' + reason : 'Job failed');
    toast('The scrape could not finish. Start a new run.', 'warn');
  }

  /* ----- live backend: POST start, then poll every 2.5s ----- */
  function ensureScraperRunning() {
    const job = state.scraperJob;
    if (!job || job.status === 'failed' || scraperIsComplete(job)) return;
    if (!isLoggedIn()) return;

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
      revertScraperStart(job, true);
      toast('Lead Scraper backend is not configured. No credits were spent.', 'warn');
      return;
    }

    if (!isLoggedIn()) {
      revertScraperStart(job, true);
      return;
    }

    setScraperBadge('pending', 'Starting cloud scrape…');

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? window.setTimeout(function () { controller.abort(); }, 9000) : null;

    fetch(LEAD_START_URL, {
      method: 'POST',
      mode: 'cors',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({
        job_id: job.job_id,
        agent_id: LEAD_AGENT_ID,
        name: job.name,
        email: job.email,
        country: job.country,
        search_terms: job.search_terms,
        selected_columns: job.selected_columns,
        target_rows: scraperTarget(job),
        credits_spent: job.credits_spent,
        remaining_credits: Math.max(0, state.credits)
      }),
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) {
        if (timer) window.clearTimeout(timer);

        if (response.status === 401) {
          revertScraperStart(job, true);
          handleAuthExpired(
            'Your session expired. Log in again to launch the Lead Scraper.',
            { action: 'scraper' }
          );
          return null;
        }
        if (response.status === 402) {
          revertScraperStart(job, true);
          toast('Insufficient credits for this scrape. Top up and try again.', 'warn');
          return null;
        }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json().catch(function () { return null; });
      })
      .then(function (body) {
        if (!body) return;
        if (body.ok === false) throw new Error(body.error || 'rejected');

        const remaining = extractRemaining(body);
        if (remaining !== null) {
          state.credits = remaining;
          syncCreditUI();
        }

        if (body.job_id && String(body.job_id) !== String(job.job_id)) {
          job.job_id = String(body.job_id);
          saveState();
        }
        if (body.mode === 'demo' || body.status === 'demo') {
          revertScraperStart(job, true);
          toast('The scraper backend is not returning live progress. No credits were spent.', 'warn');
          return;
        }
        startLivePolling(job);
      })
      .catch(function (err) {
        if (timer) window.clearTimeout(timer);
        console.warn(
          '[Agentic] Lead scraper start response unavailable — waiting for live status.',
          err && err.message ? err.message : err
        );
        if (!job.start_warned) {
          job.start_warned = true;
          saveState();
          toast('Scraper backend unreachable — waiting for live status.', 'warn');
        }
        startLivePolling(job);
      });
  }

  /* Undo an optimistic credit deduction when the server refuses a start. */
  function revertScraperStart(job, clearJob) {
    stopScraperTimers();
    stopEmailTrail();
    if (job && Number(job.credits_spent)) {
      state.credits += Number(job.credits_spent);
    }
    if (clearJob) state.scraperJob = null;
    saveState();
    syncCreditUI();
    renderScraperResults();
  }

  function startLivePolling(job) {
    if (scraperPollTimer) return;
    if (!scraperPageActive()) return;
    setScraperBadge('pending', 'Live extraction in progress…');
    pollScraperStatus();
    scraperPollTimer = window.setInterval(pollScraperStatus, LEAD_POLL_MS);
  }

  function pollScraperStatus(force) {
    const job = state.scraperJob;
    if (!job || !LEAD_STATUS_URL) return;
    if (job.status === 'failed') return;
    if (scraperIsComplete(job) && !force) return;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? window.setTimeout(function () { controller.abort(); }, 8000) : null;

    fetch(LEAD_STATUS_URL + '?job_id=' + encodeURIComponent(job.job_id), {
      mode: 'cors',
      headers: authHeaders(),
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) {
        if (timer) window.clearTimeout(timer);
        if (response.status === 401) {
          stopScraperTimers();
          handleAuthExpired(
            'Your session expired. Log in again to check this scrape.',
            null
          );
          return null;
        }
        if (response.status === 402) {
          failScraperJob('Insufficient credits');
          return null;
        }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data) return;
        if (typeof data !== 'object') throw new Error('Empty status response');

        const remaining = extractRemaining(data);
        if (remaining !== null && remaining !== state.credits) {
          state.credits = remaining;
          syncCreditUI();
        }

        const toNumber = function (value) {
          if (value === null || value === undefined || value === '') return null;
          const n = Number(value);
          return Number.isFinite(n) ? n : null;
        };

        const targetCount = toNumber(data.target_count);
        if (targetCount !== null && targetCount > 0) {
          job.target_count = Math.floor(targetCount);
        }
        const target = scraperTarget(job);

        const scraped =
          toNumber(data.scraped_rows) !== null
            ? toNumber(data.scraped_rows)
            : toNumber(data.collected_count) !== null
            ? toNumber(data.collected_count)
            : toNumber(data.leads_collected) !== null
            ? toNumber(data.leads_collected)
            : toNumber(data.count);
        if (scraped !== null) {
          job.scraped_rows = clamp(Math.floor(scraped), 0, target);
          job.collected_count = job.scraped_rows;
        }

        const filled =
          toNumber(data.filled_rows) !== null
            ? toNumber(data.filled_rows)
            : toNumber(data.filled) !== null
            ? toNumber(data.filled)
            : toNumber(data.rows_filled);
        if (filled !== null) {
          job.filled_rows = clamp(Math.floor(filled), 0, target);
        }

        const backendPercent = toNumber(data.percent);
        if (backendPercent !== null) {
          job.percent = clamp(backendPercent, 0, 100);
        } else {
          job.percent = target ? ((Number(job.scraped_rows) || 0) / target) * 100 : 0;
        }

        if (data.download_ready != null) {
          job.download_ready =
            data.download_ready === true ||
            data.download_ready === 'true' ||
            data.download_ready === 1;
        }

        if (Array.isArray(data.preview_rows) && data.preview_rows.length) {
          job.preview_rows = data.preview_rows.slice(0, 25);
        }

        if (data.email_sent != null) {
          job.email_sent = data.email_sent === true || data.email_sent === 'true';
        }

        const status = String(data.status || job.status || 'running').toLowerCase();
        job.status = status;
        job.status_warned = false;

        if (['failed', 'error', 'cancelled', 'canceled'].indexOf(status) !== -1) {
          failScraperJob(data.error ? String(data.error) : '');
          return;
        }

        if (status === 'completed' || status === 'complete' || status === 'success' || status === 'done') {
          if (job.download_ready === true) {
            completeScraperJob(true);
          } else {
            setScraperBadge('pending', 'Completed — finalizing Excel…');
            saveState();
            updateScraperProgress();
            renderLeadsTable();
          }
          return;
        }

        if (status === 'queued' || status === 'pending') {
          setScraperBadge('pending', 'Queued — waiting for worker slot…');
        } else {
          setScraperBadge(
            'pending',
            'Live extraction · ' + Math.floor(clamp(Number(job.percent) || 0, 0, 100)) + '%'
          );
        }

        saveState();
        updateScraperProgress();
        renderLeadsTable();
      })
      .catch(function (err) {
        if (timer) window.clearTimeout(timer);
        console.warn(
          '[Agentic] Lead scraper status check failed — retrying live status.',
          err && err.message ? err.message : err
        );
        if (job && !job.status_warned) {
          job.status_warned = true;
          saveState();
          setScraperBadge('pending', 'Live status unavailable — retrying…');
        }
        updateScraperProgress();
      });
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
    job.scraped_rows = 0;
    job.filled_rows = 0;
    job.percent = 0;
    job.download_ready = false;
    job.collected_count = 0;
    job.status_warned = false;
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

    if (LEAD_DOWNLOAD_URL) {
      const url = LEAD_DOWNLOAD_URL + '?job_id=' + encodeURIComponent(job.job_id);
      toast('Requesting your .xlsx from the cloud…', 'info');

      fetch(url, { mode: 'cors', headers: authHeaders() })
        .then(function (response) {
          if (response.status === 401) {
            handleAuthExpired(
              'Your session expired. Log in again to download your leads.',
              null
            );
            return null;
          }
          if (response.status === 402) {
            toast('Insufficient credits for this download.', 'warn');
            return null;
          }
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.blob();
        })
        .then(function (blob) {
          if (!blob) return;
          const objectUrl = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = objectUrl;
          anchor.download =
            'agentic-leads-' + slug(job.country || 'global') + '-' + job.job_id + '.xlsx';
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
          window.setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 4000);
          toast('Excel download ready.', 'success');
        })
        .catch(function (err) {
          console.warn('[Agentic] Authenticated download failed.', err);
          toast('Could not download the Excel file. Please try again.', 'warn');
        });
      return;
    }

    toast('Download unlocks when the backend marks the Excel ready.', 'warn');
  }

  /* ----- configuration modal ----- */
  let lastScraperRequired = null;
  let scraperEmailTouched = false;

  /* Live quote: filled terms × 3 credits = terms × 50 leads. */
  function scraperQuote() {
    const terms = $$('.term-field input')
      .map(function (input) { return input.value.trim(); })
      .filter(Boolean)
      .slice(0, LEAD_MAX_TERMS);
    const filled = terms.length;

    return {
      terms: terms,
      filled: filled,
      required: filled * LEAD_CREDITS_PER_TERM,
      target: filled * LEAD_LEADS_PER_TERM
    };
  }

  function updateScraperQuote() {
    const quote = scraperQuote();

    const pill = $('#scraperQuotePill');
    if (pill) {
      pill.textContent =
        quote.filled === 0
          ? 'Enter at least 1 search term (' + LEAD_LEADS_PER_TERM + ' leads · ' +
            LEAD_CREDITS_PER_TERM + ' credits each)'
          : 'Stops automatically at ' + quote.target + ' unique leads (' +
            quote.filled + ' term' + (quote.filled === 1 ? '' : 's') + ')';
    }

    const total = $('#scraperCreditTotal');
    if (total) {
      if (lastScraperRequired !== null && lastScraperRequired !== quote.required) {
        pulseCredit(total);
      }
      total.textContent = quote.required + ' credits';
      total.classList.toggle('is-zero', quote.required === 0);
    }
    lastScraperRequired = quote.required;

    const shortfall = Math.max(0, quote.required - state.credits);
    const shortEl = $('#scraperShortfall');
    if (shortEl) {
      shortEl.hidden = shortfall === 0;
      shortEl.textContent = shortfall > 0 ? 'Need ' + shortfall + ' more credits' : '';
    }

    /* Delivery email gate: valid address required before Confirm enables. */
    const emailInput = $('#scraperEmail');
    const emailValue = emailInput ? emailInput.value.trim() : '';
    const emailValid = isValidEmail(emailValue);
    const emailErr = $('#scraperEmailError');
    if (emailErr) {
      if (!emailValue) {
        emailErr.textContent = scraperEmailTouched ? 'Delivery email is required.' : '';
      } else if (!emailValid) {
        emailErr.textContent = 'Enter a valid email (e.g. you@company.com).';
      } else {
        emailErr.textContent = '';
      }
      const emailField = emailInput ? emailInput.closest('.field') : null;
      if (emailField) emailField.classList.toggle('has-error', !!emailErr.textContent);
    }

    const btn = $('#scraperStartBtn');
    if (btn) {
      btn.textContent =
        'Confirm & Spend ' + quote.required + ' Credits · Scrape ' + quote.target + ' Leads';
      btn.disabled = quote.filled === 0 || shortfall > 0 || !emailValid;
    }

    return quote;
  }

  function openScraperModal() {
    if (!requireAuth({ action: 'scraper' })) return;
    if (state.credits < LEAD_MIN_CREDITS) {
      toast('Needs at least ' + LEAD_MIN_CREDITS + ' credits (1 term · ' + LEAD_LEADS_PER_TERM + ' leads).', 'warn');
      return;
    }

    const countryOptions = LEAD_COUNTRIES.map(function (country) {
      const selected = country === 'Malaysia' ? ' selected' : '';
      return '<option value="' + escapeHtml(country) + '"' + selected + '>' + escapeHtml(country) + '</option>';
    }).join('');

    const terms = [];
    for (let i = 0; i < LEAD_MAX_TERMS; i += 1) {
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
      '<p class="modal-sub">1 term = ' + LEAD_LEADS_PER_TERM + ' leads = ' +
      LEAD_CREDITS_PER_TERM + ' credits · max ' + LEAD_MAX_TERMS + ' terms</p>' +
        '<form class="scraper-form" id="scraperForm" novalidate>' +
        '<div class="form-two">' +
        '<div class="field"><label for="scraperName">Full name <span class="req">*</span></label>' +
        '<input type="text" id="scraperName" autocomplete="name" placeholder="Alex Tan" value="' +
        escapeHtml(state.name || '') + '" /></div>' +
        '<div class="field"><label for="scraperEmail">Delivery Email ' +
        '<span class="label-note">(Excel .xlsx sent here)</span> <span class="req">*</span></label>' +
        '<input type="email" id="scraperEmail" autocomplete="email" inputmode="email" placeholder="you@company.com" value="' +
        escapeHtml(state.email || '') + '" />' +
        '<span class="field-hint">Your finished .xlsx file will be emailed here automatically when ready.</span>' +
        '<span class="field-error" id="scraperEmailError" role="alert"></span></div>' +
        '</div>' +
        '<div class="field"><label for="scraperCountry">Target country</label>' +
        '<select id="scraperCountry">' + countryOptions + '</select></div>' +
        '<div class="field" id="customCountryField" hidden>' +
        '<label for="scraperCustomCountry">Custom country</label>' +
        '<input type="text" id="scraperCustomCountry" placeholder="e.g. New Zealand" /></div>' +
        '<div class="modal-section"><h3>10 search terms</h3>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="fillTermsBtn">Fill Sample B2B Terms</button></div>' +
        '<div class="term-grid">' + terms.join('') + '</div>' +
        '<div class="scraper-quote">' +
        '<p class="pill-note" id="scraperQuotePill">Enter at least 1 search term (' +
        LEAD_LEADS_PER_TERM + ' leads · ' + LEAD_CREDITS_PER_TERM + ' credits each)</p>' +
        '<span class="modal-credit-total is-zero" id="scraperCreditTotal">0 credits</span>' +
        '</div>' +
        '<div class="modal-section"><h3>Excel columns</h3>' +
        '<span class="fine">Company, email and phone always included</span></div>' +
        '<div class="column-group">' +
        '<div class="column-locked">' + lockedColumns + '</div>' +
        '<p class="col-group-label">Optional columns</p>' +
        optionalColumns +
        '</div>' +
        '<div class="modal-actions">' +
        '<div class="scraper-modal-error" id="scraperFormError" role="alert"></div>' +
        '<p class="scraper-shortfall" id="scraperShortfall" hidden></p>' +
        '<button type="submit" class="btn btn-activate" id="scraperStartBtn" disabled>Confirm & Spend 0 Credits · Scrape 0 Leads</button>' +
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
        updateScraperQuote();
        toast('Sample B2B terms filled.', 'info');
      });
    }

    $$('.term-field input').forEach(function (input) {
      input.addEventListener('input', updateScraperQuote);
    });

    const scraperEmailEl = $('#scraperEmail');
    if (scraperEmailEl) {
      scraperEmailEl.addEventListener('input', function () {
        scraperEmailTouched = true;
        updateScraperQuote();
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

    lastScraperRequired = null;
    scraperEmailTouched = false;
    updateScraperQuote();

    const nameEl = $('#scraperName');
    if (nameEl) nameEl.focus();
  }

  function handleScraperStart(event) {
    event.preventDefault();

    if (!isLoggedIn()) {
      requireAuth({ action: 'scraper' });
      return;
    }

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

    const quote = scraperQuote();
    const terms = quote.terms;

    const optionalChosen = LEAD_OPTIONAL_COLUMNS.filter(function (col) {
      const box = $('input[name="scraperCol"][value="' + col.id + '"]');
      return box && box.checked;
    }).map(function (col) { return col.id; });

    const columns = LEAD_REQUIRED_COLUMNS.map(function (col) { return col.id; }).concat(optionalChosen);

    scraperEmailTouched = true;

    const problems = [];
    if (name.length < 2) problems.push('Full name is required.');
    if (!isValidEmail(email)) {
      setFieldError(emailEl, 'Enter a valid delivery email (e.g. you@company.com).');
      problems.push('A valid delivery email is required.');
    } else {
      clearFieldError(emailEl);
    }
    if (!country) problems.push('Choose a target country.');
    if (!terms.length) problems.push('Add at least one search term.');
    if (state.credits < quote.required) {
      problems.push('Need ' + (quote.required - state.credits) + ' more credits.');
    }

    if (problems.length) {
      if (errorEl) errorEl.textContent = problems.join(' ');
      return;
    }

    /* A new run replaces the previous one — clear its pollers first. */
    stopScraperTimers();
    stopEmailTrail();

    const job = {
      job_id: 'lead_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      agent_id: LEAD_AGENT_ID,
      name: name,
      email: email,
      country: country,
      search_terms: terms,
      selected_columns: columns,
      target_rows: quote.target,
      target_count: quote.target,
      scraped_rows: 0,
      filled_rows: 0,
      percent: 0,
      download_ready: false,
      credits_spent: quote.required,
      started_at: new Date().toISOString(),
      status: 'running',
      mode: 'live',
      posted: false,
      collected_count: 0,
      email_sent: false
    };

    state.credits -= quote.required;
    state.name = name;
    state.email = email;
    state.scraperJob = job;
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
    renderAuthUI();

    /* Live profile + credits from GET /auth/me when a token exists. */
    refreshSession();

    window.addEventListener('hashchange', onRouteChange);
    onRouteChange();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
