/* ============================================================================
   LiteWork — Worker #10 · Gold Price & News Brief (MY / SG / US / CN)
   ----------------------------------------------------------------------------
   Standalone vanilla JS module. Loaded with <script defer> AFTER app.js, so it
   never bloats app.js. It owns everything for the GLD-0001 worker:

     · window.openGoldModal()      — configuration modal (markets + duration)
     · window.renderGoldResults()  — full-page #gold-results view
     · window.renderGoldHistory()  — #plans "Gold Brief" tab + #historyGold

   app.js only: registers the #gold-results route, bumps the live-worker count
   and forwards the account-history payload (data.gold_tracker) to
   window.renderGoldHistory().
   ========================================================================== */
(function () {
  'use strict';

  /* ======================= A. CONFIG / CONSTANTS ========================== */

  var CFG = window.CONFIG || {};
  var API_BASE = String(CFG.API_BASE || '').replace(/\/+$/, '');
  var TOKEN_KEY = CFG.AUTH_TOKEN_KEY || 'aaas_token';
  var AGENT_ID = CFG.GOLD_TRACKER_AGENT_ID || 'gold-tracker';
  var AGENT_NAME =
    CFG.GOLD_TRACKER_AGENT_NAME || 'Gold Price & News Brief (MY / SG / US / CN)';
  var START_URL = CFG.goldTrackerStartUrl || API_BASE + '/gold-tracker-start';
  var HISTORY_URL = API_BASE + '/account/history';
  var ME_URL = API_BASE + '/auth/me';

  var JOB_KEY = 'lw_gold_job_v1';
  var JOBS_KEY = 'lw_gold_jobs_v1';
  var OUNCE_GRAMS = 31.1035;

  var COUNTRIES = [
    { id: 'MY', flag: '🇲🇾', name: 'Malaysia', label: 'Malaysia (MYR / g)', currency: 'MYR', symbol: 'RM' },
    { id: 'SG', flag: '🇸🇬', name: 'Singapore', label: 'Singapore (SGD / g)', currency: 'SGD', symbol: 'S$' },
    { id: 'US', flag: '🇺🇸', name: 'United States', label: 'United States (USD / g)', currency: 'USD', symbol: '$' },
    { id: 'CN', flag: '🇨🇳', name: 'China', label: 'China (CNY / g)', currency: 'CNY', symbol: '¥' }
  ];

  var DURATIONS = [
    { days: 7, credits: 5, label: '7 Days', note: '5 credits' },
    { days: 30, credits: 15, label: '30 Days', note: '15 credits' }
  ];

  /* ============================ B. STATE ================================= */

  var selectedCountries = ['MY', 'SG', 'US', 'CN'];
  var durationDays = 7;
  var availableCredits = null;
  var accountEmail = '';

  var goldHistory = [];
  var historyLoaded = false;
  var historyLoading = false;
  var inFlight = false;
  var signInPoll = null;

  /* ============================ C. HELPERS =============================== */

  function $(selector, scope) {
    return (scope || document).querySelector(selector);
  }

  function $$(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  var ENT_AMP = '&' + 'amp;';
  var ENT_LT = '&' + 'lt;';
  var ENT_GT = '&' + 'gt;';
  var ENT_QUOT = '&' + 'quot;';
  var ENT_APOS = '&' + '#39;';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, ENT_AMP)
      .replace(/</g, ENT_LT)
      .replace(/>/g, ENT_GT)
      .replace(/"/g, ENT_QUOT)
      .replace(/'/g, ENT_APOS);
  }

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function pick(obj, keys) {
    if (!obj || typeof obj !== 'object') return null;
    for (var i = 0; i < keys.length; i += 1) {
      var raw = obj[keys[i]];
      if (raw === null || raw === undefined || raw === '') continue;
      return raw;
    }
    return null;
  }

  function pad4(value) {
    var s = String(value == null ? '' : value).replace(/\D/g, '');
    if (!s) s = '1';
    while (s.length < 4) s = '0' + s;
    return s.slice(-4);
  }

  function briefRef(job) {
    var raw = String((job && (job.display || job.display_id || job.id)) || '');
    var match = raw.match(/GLD[-\s]?0*(\d+)/i);
    if (match) return 'GLD-' + pad4(match[1]);
    if (/^\d+$/.test(raw)) return 'GLD-' + pad4(raw);
    var digits = raw.replace(/\D/g, '');
    if (digits) return 'GLD-' + pad4(digits.slice(-4));
    var sum = 0;
    for (var i = 0; i < raw.length; i += 1) {
      sum = (sum * 31 + raw.charCodeAt(i)) % 10000;
    }
    return 'GLD-' + pad4(String(1001 + (sum % 8999)));
  }

  function readToken() {
    try {
      return window.localStorage.getItem(TOKEN_KEY) || '';
    } catch (err) {
      return '';
    }
  }

  function readJSON(key) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* private mode — keep working in memory */
    }
  }

  function toast(message, tone) {
    var root = $('#toastRoot');
    if (!root) return;
    var el = document.createElement('div');
    el.className = 'toast toast-' + (tone || 'info');
    el.innerHTML =
      '<span class="toast-dot" aria-hidden="true"></span><span>' +
      esc(message) +
      '</span>';
    root.appendChild(el);
    while (root.children.length > 3) root.removeChild(root.firstElementChild);
    window.setTimeout(function () {
      el.classList.add('is-out');
      window.setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 320);
    }, 3600);
  }

  function formatMoney(value, symbol) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return (
      symbol +
      ' ' +
      Number(value).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    );
  }

  function formatDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  function countryById(id) {
    var code = String(id || '').trim().toUpperCase();
    if (!code) return null;
    for (var i = 0; i < COUNTRIES.length; i += 1) {
      if (COUNTRIES[i].id === code) return COUNTRIES[i];
      if (COUNTRIES[i].name.toUpperCase() === code) return COUNTRIES[i];
      if (COUNTRIES[i].currency === code) return COUNTRIES[i];
    }
    return null;
  }

  function durationFor(days) {
    for (var i = 0; i < DURATIONS.length; i += 1) {
      if (DURATIONS[i].days === days) return DURATIONS[i];
    }
    return DURATIONS[0];
  }

  function normalizeCountryList(raw) {
    var list = [];
    if (Array.isArray(raw)) {
      raw.forEach(function (item) {
        var code = typeof item === 'string' ? item : pick(item, ['code', 'id', 'country', 'country_code']);
        var found = countryById(code);
        if (found && list.indexOf(found.id) === -1) list.push(found.id);
      });
    } else if (typeof raw === 'string') {
      raw.split(/[,\s/|]+/).forEach(function (part) {
        var found = countryById(part);
        if (found && list.indexOf(found.id) === -1) list.push(found.id);
      });
    }
    return list;
  }

  function domCredits() {
    var el = $('[data-credit-count]');
    if (!el) return null;
    var n = num(String(el.textContent || '').replace(/[^\d.-]/g, ''));
    return n;
  }

  function paintCredits(value) {
    if (value === null || value === undefined) return;
    $$('[data-credit-count]').forEach(function (el) {
      el.textContent = String(value);
    });
    var available = $('#goldAvailable');
    if (available) available.textContent = value + ' Credits';
  }

  function creditsOf(body) {
    if (!body || typeof body !== 'object') return null;
    var data = body.data && typeof body.data === 'object' ? body.data : null;
    var user = body.user && typeof body.user === 'object' ? body.user : null;
    var candidates = [
      body.remaining_credits,
      body.credits,
      body.balance,
      body.credit_balance,
      user ? user.credits : null,
      user ? user.remaining_credits : null,
      data ? data.credits : null,
      data ? data.remaining_credits : null,
      data && data.user ? data.user.credits : null
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      var n = num(candidates[i]);
      if (n !== null && n >= 0) return Math.floor(n);
    }
    return null;
  }

  function emailOf(body) {
    if (!body || typeof body !== 'object') return '';
    var data = body.data && typeof body.data === 'object' ? body.data : null;
    var user = body.user && typeof body.user === 'object' ? body.user : null;
    var email = pick(user, ['email']) || pick(data, ['email']) || pick(body, ['email']);
    if (!email && data && data.user) email = pick(data.user, ['email']);
    return String(email || '').trim();
  }

  function authHeaders() {
    var token = readToken();
    return {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token
    };
  }

  /* ==================== D. MODAL — openGoldModal() ======================= */

  function openSignIn(message) {
    toast(message || 'Sign in to activate the Gold Brief.', 'warn');
    var trigger = $('[data-auth-open="login"]');
    if (trigger) {
      trigger.click();
    } else {
      window.location.hash = '#plans';
    }
  }

  function waitForToken(callback) {
    if (signInPoll) window.clearInterval(signInPoll);
    var tries = 0;
    signInPoll = window.setInterval(function () {
      tries += 1;
      if (readToken()) {
        window.clearInterval(signInPoll);
        signInPoll = null;
        callback();
      } else if (tries > 150) {
        window.clearInterval(signInPoll);
        signInPoll = null;
      }
    }, 600);
  }

  function chipHtml(country) {
    var on = selectedCountries.indexOf(country.id) !== -1;
    return (
      '<button type="button" class="gold-chip' + (on ? ' is-active' : '') + '"' +
      ' data-gold-country="' + country.id + '" role="checkbox" aria-checked="' +
      (on ? 'true' : 'false') + '">' +
      '<span class="gold-chip-flag" aria-hidden="true">' + country.flag + '</span>' +
      '<span>' + esc(country.label) + '</span>' +
      '</button>'
    );
  }

  function durationHtml(duration) {
    var on = duration.days === durationDays;
    return (
      '<button type="button" class="gold-duration' + (on ? ' is-active' : '') + '"' +
      ' data-gold-days="' + duration.days + '" role="radio" aria-checked="' +
      (on ? 'true' : 'false') + '">' +
      '<strong>' + esc(duration.label) + '</strong>' +
      '<span>' + esc(duration.note) + '</span>' +
      '</button>'
    );
  }

  function modalHtml() {
    return (
      '<h2 class="modal-title" id="modalTitle">' + esc(AGENT_NAME) + '</h2>' +
      '<p class="modal-sub">Daily 07:00 MYT email · 24K & 916 prices per gram · grounded news bullets</p>' +
      '<div class="calc-card modal-calc"><div class="calc-grid">' +
      '<div class="calc-cell"><span class="calc-label">Available</span>' +
      '<span class="calc-value" id="goldAvailable">' +
      (availableCredits === null ? '—' : availableCredits) + ' Credits</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Markets</span>' +
      '<span class="calc-value" id="goldMarketCount">' + selectedCountries.length + ' / 4</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Duration</span>' +
      '<span class="calc-value" id="goldDurationValue">' + durationFor(durationDays).label + '</span></div>' +
      '<div class="calc-cell calc-cell-total"><span class="calc-label">Total cost</span>' +
      '<span class="calc-value" id="goldCost">' + durationFor(durationDays).credits + ' Credits</span>' +
      '<span class="calc-sub" id="goldRemaining"></span></div>' +
      '</div></div>' +
      '<form class="gold-form" id="goldForm" novalidate>' +
      '<div class="modal-section"><h3>Markets to track</h3>' +
      '<span class="fine">Select 1–4 markets · prices per gram in local currency</span></div>' +
      '<div class="gold-chips" id="goldChips" role="group" aria-label="Markets to track">' +
      COUNTRIES.map(chipHtml).join('') +
      '</div>' +
      '<div class="modal-section"><h3>Brief duration</h3>' +
      '<span class="fine">One email every morning at 07:00 MYT</span></div>' +
      '<div class="gold-durations" id="goldDurations" role="radiogroup" aria-label="Brief duration">' +
      DURATIONS.map(durationHtml).join('') +
      '</div>' +
      '<div class="field"><label for="goldEmail">Delivery email</label>' +
      '<input type="email" id="goldEmail" class="is-locked" value="' +
      esc(accountEmail || '') + '" placeholder="Loading your account email…" disabled tabindex="-1" />' +
      '</div>' +
      '<p class="gold-note">Instant Day-0 brief sent now + daily brief every morning at 7:00 AM MYT.</p>' +
      '<div class="modal-actions">' +
      '<div class="scraper-modal-error" id="goldFormError" role="alert"></div>' +
      '<p class="scraper-shortfall" id="goldShortfall" hidden></p>' +
      '<button type="submit" class="btn btn-activate" id="goldStartBtn">Activate Gold Brief</button>' +
      '<p class="fine">Credits are deducted immediately. Prices are indicative per-gram conversions of spot gold.</p>' +
      '</div>' +
      '</form>'
    );
  }

  function openGoldConfigModal() {
    var root = $('#modalRoot');
    var body = $('#modalBody');
    if (!root || !body) return;

    inFlight = false;
    availableCredits = domCredits();
    body.innerHTML = modalHtml();
    body.scrollTop = 0;
    root.hidden = false;
    document.body.classList.add('modal-open');

    var dialog = root.querySelector('.modal');
    if (dialog) {
      dialog.classList.add('modal-lg');
      window.requestAnimationFrame(function () {
        dialog.focus();
      });
    }

    $$('[data-gold-country]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var id = chip.getAttribute('data-gold-country');
        var index = selectedCountries.indexOf(id);
        if (index !== -1) {
          if (selectedCountries.length === 1) {
            setFormError('Keep at least one market selected.');
            return;
          }
          selectedCountries.splice(index, 1);
        } else {
          selectedCountries.push(id);
        }
        setFormError('');
        syncModalState();
      });
    });

    $$('[data-gold-days]').forEach(function (pill) {
      pill.addEventListener('click', function () {
        durationDays = Number(pill.getAttribute('data-gold-days')) || 7;
        setFormError('');
        syncModalState();
      });
    });

    var form = $('#goldForm');
    if (form) form.addEventListener('submit', submitGold);

    syncModalState();
    loadAccount();
  }

  window.openGoldModal = function () {
    if (!readToken()) {
      openSignIn('Log in or sign up to activate the Gold Brief.');
      waitForToken(function () {
        window.openGoldModal();
      });
      return;
    }
    openGoldConfigModal();
  };

  function setFormError(message) {
    var el = $('#goldFormError');
    if (el) el.textContent = message || '';
  }

  function setShortfall(message) {
    var el = $('#goldShortfall');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }

  function syncModalState() {
    $$('[data-gold-country]').forEach(function (chip) {
      var on = selectedCountries.indexOf(chip.getAttribute('data-gold-country')) !== -1;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-checked', String(on));
    });
    $$('[data-gold-days]').forEach(function (pill) {
      var on = Number(pill.getAttribute('data-gold-days')) === durationDays;
      pill.classList.toggle('is-active', on);
      pill.setAttribute('aria-checked', String(on));
    });

    var duration = durationFor(durationDays);
    var count = $('#goldMarketCount');
    var durationValue = $('#goldDurationValue');
    var cost = $('#goldCost');
    if (count) count.textContent = selectedCountries.length + ' / 4';
    if (durationValue) durationValue.textContent = duration.label;
    if (cost) cost.textContent = duration.credits + ' Credits';

    var remainingEl = $('#goldRemaining');
    if (remainingEl) {
      remainingEl.textContent =
        availableCredits === null
          ? ''
          : 'Remaining after activation: ' +
            Math.max(0, availableCredits - duration.credits) + ' credits';
    }

    if (availableCredits !== null) {
      var shortfall = duration.credits - availableCredits;
      setShortfall(
        shortfall > 0
          ? 'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
            ' for this brief. Top up credits to continue.'
          : ''
      );
    }
  }

  function closeGreetModal() {
    var root = $('#modalRoot');
    var body = $('#modalBody');
    if (root) root.hidden = true;
    if (body) body.innerHTML = '';
    document.body.classList.remove('modal-open');
  }

  function loadAccount() {
    var token = readToken();
    if (!token) return;
    fetch(ME_URL, { method: 'GET', headers: { Authorization: 'Bearer ' + token } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (body) {
        var email = emailOf(body);
        if (email) {
          accountEmail = email;
          var input = $('#goldEmail');
          if (input) input.value = email;
        }
        var credits = creditsOf(body);
        if (credits !== null) {
          availableCredits = credits;
          paintCredits(credits);
          syncModalState();
        }
      })
      .catch(function () {
        /* offline / API unavailable — the modal stays usable */
      });
  }

  function submitGold(event) {
    event.preventDefault();
    if (inFlight) return;

    if (!readToken()) {
      closeGreetModal();
      openSignIn('Your session expired. Log in again to activate the Gold Brief.');
      return;
    }
    if (!selectedCountries.length) {
      setFormError('Select at least one market to continue.');
      return;
    }

    var duration = durationFor(durationDays);
    if (availableCredits !== null && availableCredits < duration.credits) {
      var shortfall = duration.credits - availableCredits;
      setFormError(
        'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
        ' for this brief. Top up credits to continue.'
      );
      return;
    }

    setFormError('');
    setShortfall('');
    inFlight = true;
    var button = $('#goldStartBtn');
    if (button) {
      button.disabled = true;
      button.classList.add('is-busy');
      button.textContent = 'Activating your Gold Brief…';
    }

    fetch(START_URL, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        countries: selectedCountries.slice(),
        duration_days: durationDays
      })
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            return { status: response.status, ok: response.ok, body: body || {} };
          });
      })
      .then(function (result) {
        if (result.status === 401) {
          inFlight = false;
          closeGreetModal();
          openSignIn('Your session expired. Log in again to activate the Gold Brief.');
          return null;
        }
        if (result.status === 402) {
          inFlight = false;
          closeGreetModal();
          toast('Not enough credits for this Gold Brief. Top up to continue.', 'warn');
          window.location.hash = '#topup';
          return null;
        }
        if (!result.ok) {
          throw new Error(
            (result.body && (result.body.error || result.body.message)) ||
              'HTTP ' + result.status
          );
        }

        var payload =
          result.body.data && result.body.data.job
            ? result.body.data.job
            : result.body.data && result.body.data.brief
            ? result.body.data.brief
            : result.body;

        var job = normalizeJob(payload, {
          countries: selectedCountries.slice(),
          durationDays: durationDays,
          credits: duration.credits
        });
        rememberJob(job);

        var remaining = creditsOf(result.body);
        if (remaining !== null) {
          availableCredits = remaining;
          paintCredits(remaining);
        } else {
          var current = domCredits();
          if (current !== null) {
            availableCredits = Math.max(0, current - duration.credits);
            paintCredits(availableCredits);
          }
        }

        inFlight = false;
        closeGreetModal();
        toast('Gold Brief activated — your Day-0 brief is on the way.', 'success');

        if (window.location.hash.replace(/^#\/?/, '').split('?')[0].toLowerCase() === 'gold-results') {
          renderGoldResults();
        } else {
          window.location.hash = '#gold-results';
        }
        return job;
      })
      .catch(function (err) {
        inFlight = false;
        if (button) {
          button.disabled = false;
          button.classList.remove('is-busy');
          button.textContent = 'Activate Gold Brief';
        }
        setFormError(
          (err && err.message) ||
            'Could not activate the Gold Brief. Please try again in a moment.'
        );
        return null;
      });
  }

  /* ======================== E. JOB NORMALISATION ========================= */

  function normalizeJob(raw, fallback) {
    var jobRaw = raw && typeof raw === 'object' ? raw : {};
    var base = fallback || {};

    var countries = normalizeCountryList(
      pick(jobRaw, ['countries', 'markets', 'country_codes', 'country'])
    );
    if (!countries.length) countries = base.countries || ['MY', 'SG', 'US', 'CN'];

    var duration =
      num(pick(jobRaw, ['duration_days', 'days', 'duration', 'total_days'])) ||
      base.durationDays ||
      7;
    var credits =
      num(pick(jobRaw, ['credits_spent', 'creditsSpent', 'credits', 'credits_used'])) ||
      base.credits ||
      (duration >= 30 ? 15 : 5);

    var expiresAt = String(
      pick(jobRaw, ['expires_at', 'expiresAt', 'end_date', 'active_until']) || ''
    );
    var startedAt = String(
      pick(jobRaw, ['started_at', 'created_at', 'createdAt', 'date']) ||
        base.startedAt ||
        new Date().toISOString()
    );
    if (!expiresAt) {
      var expiry = new Date(startedAt || Date.now());
      if (!isNaN(expiry.getTime())) {
        expiry.setHours(expiry.getHours() + duration * 24);
        expiresAt = expiry.toISOString();
      }
    }

    var daysLeft = num(pick(jobRaw, ['days_remaining', 'days_left']));
    if (daysLeft === null && expiresAt) {
      var diff = new Date(expiresAt).getTime() - Date.now();
      if (!isNaN(diff)) daysLeft = Math.max(0, Math.ceil(diff / 86400000));
    }
    if (daysLeft === null) daysLeft = duration;
    daysLeft = Math.max(0, Math.min(duration, Math.round(daysLeft)));

    var statusRaw = String(pick(jobRaw, ['status', 'job_status']) || 'active').toLowerCase();
    var status =
      statusRaw === 'completed' ||
      statusRaw === 'expired' ||
      daysLeft === 0
        ? 'completed'
        : 'active';

    var snapshot =
      pick(jobRaw, ['snapshot', 'last_snapshot', 'brief', 'preview']) || null;

    return {
      id: String(
        pick(jobRaw, ['brief_id', 'display_id', 'displayId', 'public_id', 'job_id', 'id']) ||
          base.id ||
          ''
      ),
      display: String(
        pick(jobRaw, ['display_id', 'displayId', 'public_id', 'brief_id']) || base.display || ''
      ),
      status: status,
      countries: countries,
      durationDays: duration,
      daysLeft: daysLeft,
      credits: credits,
      startedAt: startedAt,
      expiresAt: expiresAt,
      snapshot: snapshot && typeof snapshot === 'object' ? snapshot : jobRaw
    };
  }

  function rememberJob(job) {
    writeJSON(JOB_KEY, job);
    var list = readJobsCache().filter(function (item) {
      return !(item.id && job.id && item.id === job.id);
    });
    list.unshift(job);
    writeJSON(JOBS_KEY, list.slice(0, 20));
    goldHistory = list;
    historyLoaded = true;
    paintHistoryCounts(list.length);
    renderHistoryPane(list);
  }

  function readJobsCache() {
    var list = readJSON(JOBS_KEY);
    return Array.isArray(list) ? list : [];
  }

  function currentJob() {
    var stored = readJSON(JOB_KEY);
    if (stored && typeof stored === 'object') return stored;
    var list = readJobsCache();
    return list.length ? list[0] : null;
  }

  /* ======================= F. RESULTS — #gold-results ==================== */

  function snapshotOf(job) {
    var snap = job && job.snapshot;
    return snap && typeof snap === 'object' ? snap : {};
  }

  function spotOf(snap) {
    return num(
      pick(snap, ['spot_price', 'spot', 'xau_usd', 'gold_usd', 'price_oz', 'price_per_oz'])
    );
  }

  function changeOf(raw) {
    if (raw === null || raw === undefined || raw === '') {
      return { label: '—', tone: '' };
    }
    if (typeof raw === 'string') {
      var text = raw.trim();
      var n = num(text.replace(/[^\d.-]/g, ''));
      var toneFromText = text.indexOf('-') === 0 ? 'is-down' : n !== null && n > 0 ? 'is-up' : '';
      return { label: text, tone: toneFromText };
    }
    var value = num(raw);
    if (value === null) return { label: '—', tone: '' };
    return {
      label: (value > 0 ? '+' : '') + value.toFixed(2) + '%',
      tone: value > 0 ? 'is-up' : value < 0 ? 'is-down' : ''
    };
  }

  function entryOf(snap, country) {
    var bag = pick(snap, ['countries', 'prices', 'markets', 'per_gram']);
    if (!bag || typeof bag !== 'object') return null;
    if (Array.isArray(bag)) {
      for (var i = 0; i < bag.length; i += 1) {
        var code = String(
          pick(bag[i], ['code', 'id', 'country', 'country_code', 'currency']) || ''
        ).toUpperCase();
        if (countryById(code) && countryById(code).id === country.id) return bag[i];
      }
      return null;
    }
    return (
      bag[country.id] ||
      bag[country.id.toLowerCase()] ||
      bag[country.name] ||
      bag[country.name.toLowerCase()] ||
      bag[country.currency] ||
      bag[country.currency.toLowerCase()] ||
      null
    );
  }

  function fxOf(snap, currency) {
    if (currency === 'USD') return 1;
    var bag = pick(snap, ['fx', 'fx_rates', 'rates', 'exchange_rates']);
    if (!bag || typeof bag !== 'object') return null;
    var rate = bag[currency] || bag[currency.toLowerCase()];
    return num(rate);
  }

  function priceOf(snap, country) {
    var entry = entryOf(snap, country);
    var data = entry && typeof entry === 'object' ? entry : entry != null ? { price: entry } : {};
    var code = country.id.toLowerCase();
    var ccy = country.currency.toLowerCase();

    var p24 = num(
      pick(data, ['price_24k', '24k', 'k24', 'price', 'gram_24k', 'per_gram', 'per_gram_24k']) ||
        pick(snap, [ccy + '_per_gram_24k', ccy + '_per_gram', code + '_per_gram_24k', code + '_per_gram'])
    );
    var p22 = num(
      pick(data, ['price_22k', '22k', 'k22', 'gram_22k', 'per_gram_22k']) ||
        pick(snap, [ccy + '_per_gram_22k', code + '_per_gram_22k'])
    );

    if (p24 === null) {
      var spot = spotOf(snap);
      var fx = fxOf(snap, country.currency);
      if (spot !== null && fx !== null) p24 = (spot * fx) / OUNCE_GRAMS;
    }
    if (p22 === null && p24 !== null) p22 = (p24 * 22) / 24;

    return {
      p24: p24,
      p22: p22,
      change: changeOf(
        pick(data, ['change_percent', 'change_pct', 'change_24h', 'change', 'day_change']) ||
          pick(snap, [ccy + '_change_percent', ccy + '_change_pct', code + '_change_percent'])
      ),
      low: num(pick(data, ['low_30d', 'range_low', 'min_30d', 'low'])),
      high: num(pick(data, ['high_30d', 'range_high', 'max_30d', 'high']))
    };
  }

  function bulletsOf(snap) {
    var raw = pick(snap, ['why_moved', 'news', 'headlines', 'reasons', 'bullets', 'news_bullets']);
    if (!Array.isArray(raw)) return [];
    return raw
      .map(function (item) {
        if (item == null) return null;
        if (typeof item === 'string') {
          return item.trim() ? { text: item.trim(), url: '', source: '' } : null;
        }
        if (typeof item !== 'object') return null;
        var text = pick(item, ['text', 'summary', 'title', 'bullet', 'headline', 'reason']);
        if (!text) return null;
        return {
          text: String(text).trim(),
          url: String(pick(item, ['url', 'link', 'source_url', 'href']) || ''),
          source: String(pick(item, ['source', 'source_name', 'publisher', 'site']) || '')
        };
      })
      .filter(function (item) {
        return !!item;
      })
      .slice(0, 5);
  }

  function renderGoldResults() {
    var view = $('#view-gold-results');
    if (!view) return;

    var job = currentJob();
    var empty = $('#goldEmpty');
    var main = $('#goldMain');

    if (!job) {
      if (empty) empty.hidden = false;
      if (main) main.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    if (main) main.hidden = false;

    var snap = snapshotOf(job);
    var countries = job.countries && job.countries.length ? job.countries : ['MY', 'SG', 'US', 'CN'];
    var statusText =
      job.status === 'active'
        ? 'Active · 07:00 MYT Daily'
        : 'Completed · ' + formatDate(job.expiresAt);

    var headerId = $('#goldHeaderId');
    if (headerId) headerId.textContent = briefRef(job);
    var headerStatus = $('#goldHeaderStatus');
    if (headerStatus) {
      headerStatus.textContent = statusText;
      headerStatus.className = 'hist-badge ' + (job.status === 'active' ? 'ok' : 'muted');
    }

    /* --- Spot hero -------------------------------------------------- */
    var spot = spotOf(snap);
    var heroPrice = $('#goldHeroPrice');
    if (heroPrice) {
      heroPrice.textContent = spot === null ? '—' : formatMoney(spot, '$');
    }
    var heroChange = $('#goldHeroChange');
    if (heroChange) {
      var heroChangeInfo = changeOf(
        pick(snap, ['change_percent', 'change_pct', 'price_change_percent', 'change_24h', 'day_change_pct'])
      );
      heroChange.textContent =
        heroChangeInfo.label === '—' ? '24h change unavailable' : heroChangeInfo.label + ' · 24h';
      heroChange.className = 'gold-change ' + heroChangeInfo.tone;
      heroChange.setAttribute(
        'aria-label',
        'Spot gold 24 hour change ' + heroChangeInfo.label
      );
    }
    var heroNote = $('#goldHeroNote');
    if (heroNote) {
      heroNote.textContent =
        pick(snap, ['spot_note', 'summary', 'commentary']) ||
        'Updated from your latest brief · 07:00 MYT.';
    }

    /* --- Summary rows ---------------------------------------------- */
    var summary = $('#goldJobSummary');
    if (summary) {
      var marketBadges = countries
        .map(function (id) {
          var c = countryById(id);
          return c
            ? '<span class="gold-mini-badge">' + c.flag + ' ' + esc(c.id) + '</span>'
            : '';
        })
        .join('');
      summary.innerHTML =
        '<div class="summary-row"><dt>Brief ID</dt><dd><code>' + esc(briefRef(job)) + '</code></dd></div>' +
        '<div class="summary-row"><dt>Markets</dt><dd>' + marketBadges + '</dd></div>' +
        '<div class="summary-row"><dt>Schedule</dt><dd>Daily 07:00 AM MYT</dd></div>' +
        '<div class="summary-row"><dt>Active Until</dt><dd><strong>' +
        esc(formatDate(job.expiresAt)) + '</strong></dd></div>' +
        '<div class="summary-row"><dt>Credits Used</dt><dd><strong>' +
        esc(job.credits) + ' credit' + (Number(job.credits) === 1 ? '' : 's') +
        '</strong></dd></div>';
    }
    var meta = $('#goldJobMeta');
    if (meta) {
      meta.textContent =
        countries.length +
        ' market' + (countries.length === 1 ? '' : 's') + ' · ' +
        job.durationDays + '-day brief · ' + job.daysLeft + ' / ' +
        job.durationDays + ' days left';
    }

    /* --- Per-gram price cards -------------------------------------- */
    var grid = $('#goldPriceGrid');
    if (grid) {
      grid.innerHTML = countries
        .map(function (id) {
          var country = countryById(id);
          if (!country) return '';
          var price = priceOf(snap, country);
          var rangeText =
            price.low !== null && price.high !== null
              ? formatMoney(price.low, country.symbol) + ' – ' + formatMoney(price.high, country.symbol)
              : '—';
          return (
            '<article class="gold-price-card">' +
            '<div class="gold-price-head">' +
            '<span class="gold-price-flag" aria-hidden="true">' + country.flag + '</span>' +
            '<strong>' + esc(country.name) + '</strong>' +
            '<span class="gold-price-ccy">' + esc(country.currency) + '</span>' +
            '</div>' +
            '<div class="gold-price-main">' +
            '<span class="gold-karat">24K (999)</span>' +
            '<strong>' + esc(formatMoney(price.p24, country.symbol)) + '</strong>' +
            '<span class="gold-per">/ gram</span>' +
            '</div>' +
            '<div class="gold-price-22k"><span>22K (916)</span><strong>' +
            esc(formatMoney(price.p22, country.symbol)) + ' / g</strong></div>' +
            '<div class="gold-price-meta">' +
            '<span class="gold-change ' + price.change.tone + '">' + esc(price.change.label) + '</span>' +
            '<span class="gold-range">30d: ' + esc(rangeText) + '</span>' +
            '</div>' +
            '</article>'
          );
        })
        .join('');
    }

    var marketsPill = $('#goldMarketsPill');
    if (marketsPill) {
      marketsPill.textContent =
        countries.length + ' market' + (countries.length === 1 ? '' : 's');
    }

    /* --- Why gold moved -------------------------------------------- */
    var bullets = bulletsOf(snap);
    var whyList = $('#goldWhyList');
    if (whyList) {
      whyList.innerHTML = bullets.length
        ? bullets
            .map(function (bullet) {
              var link = bullet.url
                ? ' <a class="gold-source-link" href="' + esc(bullet.url) +
                  '" target="_blank" rel="noopener noreferrer">[Source' +
                  (bullet.source ? ' · ' + esc(bullet.source) : '') + ']</a>'
                : '';
              return '<li>' + esc(bullet.text) + link + '</li>';
            })
            .join('')
        : '<li class="gold-why-empty">Your Day-0 brief is being generated. ' +
          'Grounded news bullets will appear here and in your 07:00 MYT email.</li>';
    }
    var whyPill = $('#goldWhyPill');
    if (whyPill) {
      whyPill.textContent =
        bullets.length + ' source' + (bullets.length === 1 ? '' : 's');
    }
  }

  window.renderGoldResults = renderGoldResults;

  /* ================== G. HISTORY — #plans / #historyGold ================= */

  function extractJobs(body) {
    if (!body || typeof body !== 'object') return [];
    var source =
      body.data && typeof body.data === 'object' && !Array.isArray(body.data)
        ? body.data
        : body;
    var keys = ['gold_tracker', 'gold_trackers', 'gold_briefs', 'gold_jobs', 'gold'];
    var list = [];
    for (var i = 0; i < keys.length; i += 1) {
      if (Array.isArray(source[keys[i]])) {
        list = source[keys[i]];
        break;
      }
    }
    if (!list.length && Array.isArray(body.gold_tracker)) list = body.gold_tracker;
    if (!list.length && Array.isArray(source.history)) {
      list = source.history.filter(function (item) {
        var kind = String(
          (item && (item.agent || item.agent_id || item.type || item.kind)) || ''
        ).toLowerCase();
        return kind.indexOf('gold') !== -1;
      });
    }
    return list.map(function (item) {
      return normalizeJob(item);
    });
  }

  function paintHistoryCounts(count) {
    $$('[data-hist-count="gold"]').forEach(function (el) {
      el.textContent = String(count);
    });
    $$('[data-hist-count-label="gold"]').forEach(function (el) {
      el.textContent = count + ' brief' + (count === 1 ? '' : 's');
    });
  }

  /* app.js re-paints every [data-hist-count] badge on each history render and
     zeroes unknown keys — keep the Gold Brief badge truthful without touching
     app.js' generic count loop. */
  function guardGoldCount() {
    var el = $('[data-hist-count="gold"]');
    if (!el) return;
    var want = String(goldHistory.length);
    if (goldHistory.length && el.textContent !== want) el.textContent = want;

    if (el.getAttribute('data-gold-count-guard') === '1') return;
    if (!window.MutationObserver) return;
    el.setAttribute('data-gold-count-guard', '1');
    var observer = new window.MutationObserver(function () {
      var expected = String(goldHistory.length);
      if (goldHistory.length && el.textContent !== expected) {
        el.textContent = expected;
      }
    });
    observer.observe(el, { childList: true, characterData: true, subtree: true });
  }

  function renderHistoryPane(jobs) {
    var pane = $('#historyGold');
    if (!pane) return;

    if (!readToken()) {
      pane.innerHTML =
        '<div class="hist-empty">' +
        '<p class="empty-note">Log in to view your gold briefs.</p>' +
        '<button type="button" class="btn btn-primary btn-sm" data-history-login>Log in</button>' +
        '</div>';
      paintHistoryCounts(0);
      return;
    }

    if (!jobs.length) {
      pane.innerHTML =
        '<div class="hist-empty">' +
        '<p class="empty-note">No gold briefs yet. Configure a daily 07:00 MYT Gold Price & News Brief for MY, SG, US or CN.</p>' +
        '<button type="button" class="btn btn-primary btn-sm" onclick="window.openGoldModal(); return false;">Configure Gold Brief →</button>' +
        '</div>';
      paintHistoryCounts(0);
      return;
    }

    pane.innerHTML =
      '<div class="hist-list">' + jobs.map(renderHistoryCard).join('') + '</div>';
    paintHistoryCounts(jobs.length);
    guardGoldCount();
  }

  function renderHistoryCard(job) {
    var active = job.status === 'active';
    var total = Number(job.durationDays) || 7;
    var daysLeft = Math.max(0, Math.min(total, Number(job.daysLeft) || 0));
    var percent = Math.max(2, Math.min(100, (daysLeft / total) * 100));
    var markets = (job.countries || [])
      .map(function (id) {
        var c = countryById(id);
        return c ? '<span class="gold-mini-badge">' + c.flag + ' ' + esc(c.id) + '</span>' : '';
      })
      .join('');
    var key = job.id || briefRef(job);

    return (
      '<article class="hist-card">' +
      '<div class="hist-card-top">' +
      '<strong>Gold Price & News Brief</strong>' +
      '<span class="hist-id">' + esc(briefRef(job)) + '</span>' +
      '<span class="hist-badge ' + (active ? 'ok' : 'muted') + '">' +
      (active ? 'Active' : 'Completed') + '</span>' +
      '</div>' +
      '<p class="hist-sub">' + job.credits + ' credit' + (Number(job.credits) === 1 ? '' : 's') +
      ' · MY / SG / US / CN · 07:00 MYT daily</p>' +
      '<div class="hist-trading">' +
      '<span class="hist-trading-label"><strong>' + daysLeft + ' / ' + total + '</strong> days left</span>' +
      '<span class="hist-badge ' + (active ? 'ok' : 'muted') + '">' +
      (active ? '07:00 MYT daily' : 'Ended ' + esc(formatDate(job.expiresAt))) + '</span>' +
      '</div>' +
      '<div class="watch-progress"><span style="width:' + percent + '%"></span></div>' +
      '<div class="gold-country-badges">' + markets + '</div>' +
      '<dl class="hist-meta">' +
      '<div><dt>Markets</dt><dd>' + (job.countries || []).join(' · ') + '</dd></div>' +
      '<div><dt>Active until</dt><dd>' + esc(formatDate(job.expiresAt)) + '</dd></div>' +
      '<div><dt>Credits used</dt><dd>' + job.credits + '</dd></div>' +
      '<div><dt>Brief ID</dt><dd><code>' + esc(briefRef(job)) + '</code></dd></div>' +
      '</dl>' +
      '<div class="hist-actions">' +
      '<button type="button" class="btn btn-primary btn-sm" data-gold-view="' +
      esc(key) + '">View Latest Brief</button>' +
      '</div>' +
      '</article>'
    );
  }

  window.renderGoldHistory = function (body) {
    historyLoading = false;
    historyLoaded = true;

    if (body === null || body === undefined) {
      renderHistoryPane([]);
      return;
    }

    var jobs = extractJobs(body);
    var cached = readJobsCache();
    cached.forEach(function (job) {
      var duplicate = jobs.some(function (item) {
        return item.id && job.id && item.id === job.id;
      });
      if (!duplicate) jobs.push(job);
    });
    jobs.sort(function (a, b) {
      return new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime();
    });

    goldHistory = jobs;
    renderHistoryPane(jobs);
  };

  function fetchGoldHistory() {
    if (historyLoading || historyLoaded) return;
    var token = readToken();
    if (!token) {
      renderHistoryPane([]);
      return;
    }
    historyLoading = true;
    fetch(HISTORY_URL, { method: 'GET', headers: { Authorization: 'Bearer ' + token } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (body) {
        window.renderGoldHistory(body);
      })
      .catch(function () {
        historyLoading = false;
        var pane = $('#historyGold');
        if (pane && !goldHistory.length) {
          pane.innerHTML =
            '<div class="hist-empty">' +
            '<p class="empty-note">Could not load your gold briefs right now. ' +
            '<button type="button" class="btn btn-ghost btn-sm" id="goldHistoryRetry">Try again</button></p>' +
            '</div>';
          var retry = $('#goldHistoryRetry');
          if (retry) {
            retry.addEventListener('click', function () {
              historyLoading = false;
              fetchGoldHistory();
            });
          }
        }
      });
  }

  function ensureHistory() {
    if (!readToken()) {
      renderHistoryPane([]);
      return;
    }
    if (historyLoaded) {
      renderHistoryPane(goldHistory);
      return;
    }
    if (historyLoading) return;
    /* Give app.js' own /account/history fetch a moment to forward its payload. */
    window.setTimeout(function () {
      if (!historyLoaded) fetchGoldHistory();
    }, 600);
  }

  /* ======================= H. ROUTING & LISTENERS ======================== */

  function currentRoute() {
    return String(window.location.hash || '')
      .replace(/^#\/?/, '')
      .split('?')[0]
      .toLowerCase();
  }

  function onRoute() {
    var route = currentRoute();
    if (route === 'gold-results') renderGoldResults();
    if (route === 'plans') ensureHistory();
  }

  function applyGoldFilter(name) {
    if (name !== 'gold') return;
    $$('[data-history-tab]').forEach(function (tab) {
      var on = tab.getAttribute('data-history-tab') === 'gold';
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', String(on));
    });
    $$('[data-hist-group]').forEach(function (group) {
      group.hidden = group.getAttribute('data-hist-group') !== 'gold';
    });
  }

  function findJobByKey(key) {
    var list = goldHistory.length ? goldHistory : readJobsCache();
    for (var i = 0; i < list.length; i += 1) {
      var job = list[i];
      if (job.id === key || briefRef(job) === key) return job;
    }
    var current = currentJob();
    if (current && (current.id === key || briefRef(current) === key)) return current;
    return null;
  }

  function onDocumentClick(event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    var tab = target.closest('[data-history-tab]');
    if (tab) {
      var name = tab.getAttribute('data-history-tab');
      window.setTimeout(function () {
        applyGoldFilter(name);
      }, 0);
      return;
    }

    var viewBtn = target.closest('[data-gold-view]');
    if (viewBtn) {
      var job = findJobByKey(viewBtn.getAttribute('data-gold-view'));
      if (job) {
        writeJSON(JOB_KEY, job);
        if (currentRoute() === 'gold-results') {
          renderGoldResults();
        } else {
          window.location.hash = '#gold-results';
        }
      }
      return;
    }
  }

  function init() {
    document.addEventListener('click', onDocumentClick, false);
    window.addEventListener('hashchange', onRoute, false);
    guardGoldCount();
    onRoute();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
