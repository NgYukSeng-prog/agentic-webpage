/* ============================================================================
   LiteWork — Worker #13 · Shopee Price & Deal Drop Radar (MY & SG)
   ----------------------------------------------------------------------------
   Standalone vanilla JS module. Loaded with <script defer> AFTER app.js, so it
   never bloats app.js. It owns everything for the SHP-#### worker:

     · window.openShopeeRadarModal()   — 1–8 product rows + drop threshold
     · window.renderShopeeResults()    — full-page #view-shopee-results
     · window.downloadShopeeHistory()  — Bearer-auth .xlsx download
     · window.renderShopeeHistory()    — #plans "Shopee Radar" pane
     · window.openShopeeHistoryJob()   — open a radar from My Activity

   Reuses the canonical LiteWork modal classes (calc-card / modal-section /
   lead-mode-pill / field / btn-activate) and results classes (scraper-grid,
   ring-card, panel.job-card, summary-grid.compact, download-bar).
   ========================================================================== */
(function () {
  'use strict';

  /* ======================= A. CONFIG / CONSTANTS ========================== */

  var CFG = window.CONFIG || {};
  var API_BASE = String(
    CFG.API_BASE || 'https://n8n.20.205.96.122.sslip.io/webhook'
  ).replace(/\/+$/, '');
  var TOKEN_KEY = CFG.AUTH_TOKEN_KEY || 'aaas_token';

  var AGENT_ID = CFG.SHOPEE_RADAR_AGENT_ID || 'shopee-radar';
  var AGENT_NAME =
    CFG.SHOPEE_RADAR_AGENT_NAME || 'Shopee Price & Deal Drop Radar (MY & SG)';

  var START_URL = String(CFG.shopeeRadarStartUrl || API_BASE + '/shopee-radar-start');
  var DOWNLOAD_URL = String(
    CFG.shopeeHistoryDownloadUrl || API_BASE + '/download-shopee-history'
  );
  var HISTORY_URL = API_BASE + '/account/history';
  var ME_URL = API_BASE + '/auth/me';

  var DAYS = Number(CFG.SHOPEE_RADAR_DAYS) > 0 ? Number(CFG.SHOPEE_RADAR_DAYS) : 30;
  var MAX_ITEMS =
    Number(CFG.SHOPEE_RADAR_MAX_ITEMS) > 0 ? Number(CFG.SHOPEE_RADAR_MAX_ITEMS) : 8;

  var JOB_KEY = 'lw_shopee_job_v1';
  var JOBS_KEY = 'lw_shopee_jobs_v1';

  var THRESHOLDS = [
    { pct: 5, label: '5%', note: 'Below 30-day median' },
    { pct: 10, label: '10%', note: 'Recommended' },
    { pct: 15, label: '15%', note: 'Below 30-day median' },
    { pct: 20, label: '20%', note: 'Below 30-day median' }
  ];

  var COLUMNS = [
    'Product',
    'Shop / Mall',
    'Listed Price',
    'Public Voucher',
    'Effective Price',
    'Target Price',
    'Stock Status',
    'Link'
  ];

  var URL_RE = /^https?:\/\/([a-z0-9-]+\.)?shopee\.(com\.my|sg)([\/?#]|$)/i;

  /* ============================ B. STATE ================================= */

  var items = [{ url: '', target: '', nickname: '' }];
  var threshold = 10;
  var availableCredits = null;
  var accountEmail = '';
  var inFlight = false;
  var lastOpenAt = 0;
  var lastDownloadAt = 0;
  var downloadInFlight = false;
  var historyJobs = [];
  var historyLoaded = false;
  var historyLoading = false;
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
    var LW = window.__LW;
    if (LW && typeof LW.escapeHtml === 'function') {
      try {
        return LW.escapeHtml(value);
      } catch (err) {
        /* fall through */
      }
    }
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

  function shpRef(job) {
    if (!job) return 'SHP-1001';
    var raw = String(
      job.display_id || job.displayId || job.public_id || job.job_id || job.id || ''
    );
    var match = raw.match(/SHP[-\s]?0*(\d+)/i);
    if (match) return 'SHP-' + pad4(match[1]);
    if (/^\d+$/.test(raw)) return 'SHP-' + pad4(raw);
    var digits = raw.replace(/\D/g, '');
    if (digits) return 'SHP-' + pad4(digits.slice(-4));
    var sum = 0;
    for (var i = 0; i < raw.length; i += 1) {
      sum = (sum * 31 + raw.charCodeAt(i)) % 10000;
    }
    return 'SHP-' + pad4(String(1001 + (sum % 8999)));
  }

  function readToken() {
    var LW = window.__LW;
    if (LW && typeof LW.getToken === 'function') {
      try {
        return LW.getToken() || '';
      } catch (err) {
        /* fall through */
      }
    }
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
      /* private mode */
    }
  }

  function toast(message, tone) {
    var LW = window.__LW;
    if (LW && typeof LW.toast === 'function') {
      try {
        LW.toast(message, tone);
        return;
      } catch (err) {
        /* fall through */
      }
    }
    var root = $('#toastRoot');
    if (!root) return;
    var el = document.createElement('div');
    el.className = 'toast toast-' + (tone || 'info');
    el.innerHTML =
      '<span class="toast-dot" aria-hidden="true"></span><span>' + esc(message) + '</span>';
    root.appendChild(el);
    window.setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 3600);
  }

  function formatDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  function currencyOf(url) {
    var text = String(url || '').toLowerCase();
    if (text.indexOf('shopee.sg') !== -1) return 'SGD';
    if (text.indexOf('shopee.com.my') !== -1) return 'MYR';
    return '';
  }

  function symbolOf(currency) {
    if (currency === 'SGD') return 'S$';
    if (currency === 'MYR') return 'RM';
    return '';
  }

  function money(value, currency) {
    var n = num(value);
    if (n === null) return '—';
    var symbol = symbolOf(currency);
    return (symbol ? symbol + ' ' : '') + n.toFixed(2);
  }

  function creditsFor(count) {
    var n = Number(count) || 0;
    if (!n) return 0;
    return n > 3 ? 10 : 5;
  }

  function tierLabel(count) {
    var n = Number(count) || 0;
    if (!n) return 'No links';
    return n > 3 ? '4–8 links · 10 credits' : '1–3 links · 5 credits';
  }

  function validShopeeUrl(url) {
    return URL_RE.test(String(url || '').trim());
  }

  function currentRoute() {
    return String(window.location.hash || '')
      .replace(/^#\/?/, '')
      .split('?')[0]
      .toLowerCase();
  }

  /* ==================== D. MODAL — openShopeeRadarModal() ================ */

  function showModal(html) {
    var LW = window.__LW;
    if (LW && typeof LW.openModal === 'function') {
      try {
        LW.openModal(html, true);
        return $('#modalRoot');
      } catch (err) {
        /* fall through */
      }
    }
    var root = $('#modalRoot');
    var body = $('#modalBody');
    if (!root || !body) return null;
    body.innerHTML = html;
    body.scrollTop = 0;
    root.hidden = false;
    document.body.classList.add('modal-open');
    var dialog = root.querySelector('.modal');
    if (dialog) dialog.classList.add('modal-lg');
    return root;
  }

  function closeModal() {
    var LW = window.__LW;
    if (LW && typeof LW.closeModal === 'function') {
      try {
        LW.closeModal(false);
        return;
      } catch (err) {
        /* fall through */
      }
    }
    var root = $('#modalRoot');
    var body = $('#modalBody');
    if (root) root.hidden = true;
    if (body) body.innerHTML = '';
    document.body.classList.remove('modal-open');
  }

  function openSignIn(message) {
    toast(message || 'Log in or sign up to activate the Shopee Radar.', 'warn');
    var LW = window.__LW;
    if (LW && typeof LW.openAuthModal === 'function') {
      LW.openAuthModal('login', message);
      return;
    }
    var trigger = $('[data-auth-open="login"]');
    if (trigger) trigger.click();
    else window.location.hash = '#plans';
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

  function thresholdPillHtml(option) {
    var on = option.pct === threshold;
    return (
      '<button type="button" class="lead-mode-pill' + (on ? ' is-active' : '') + '"' +
      ' data-shp-threshold="' + option.pct + '" role="radio" aria-checked="' +
      (on ? 'true' : 'false') + '">' +
      '<span class="lead-mode-title">' + esc(option.label) + '</span>' +
      '<span class="lead-mode-note">' + esc(option.note) + '</span>' +
      '</button>'
    );
  }

  function itemRowHtml(item, index) {
    var currency = currencyOf(item.url);
    var symbol = symbolOf(currency);
    var placeholder = symbol
      ? symbol + ' 99.00'
      : 'Price after voucher';
    var targetValue = item.target === '' || item.target === null ? '' : item.target;

    return (
      '<div class="modal-section"><h3>Product ' + (index + 1) + '</h3>' +
      (items.length > 1
        ? '<button type="button" class="btn btn-ghost btn-sm" data-shp-remove="' + index +
          '">Remove</button>'
        : '<span class="div-region-tag" data-shp-region="' + index + '">' +
          (currency === 'SGD' ? 'SG' : currency === 'MYR' ? 'MY' : 'MY / SG') + '</span>') +
      '</div>' +
      '<div class="field"><label for="shpUrl' + index + '">Shopee Product URL</label>' +
      '<input type="url" id="shpUrl' + index + '" data-shp-url="' + index + '" ' +
      'placeholder="https://shopee.com.my/product-name-i.123456.789" ' +
      'value="' + esc(item.url) + '" autocomplete="off" spellcheck="false" />' +
      '<span class="field-error" id="shpUrlError' + index + '" role="alert"></span></div>' +
      '<div class="form-two">' +
      '<div class="field"><label for="shpTarget' + index + '">Target Price (opt.) ' +
      '<span class="fine" data-shp-currency="' + index + '">' +
      esc(symbol || 'auto') + '</span></label>' +
      '<input type="number" min="0" step="0.01" id="shpTarget' + index + '" ' +
      'data-shp-target="' + index + '" placeholder="' + esc(placeholder) + '" ' +
      'value="' + esc(targetValue) + '" /></div>' +
      '<div class="field"><label for="shpNick' + index + '">Nickname (opt.)</label>' +
      '<input type="text" id="shpNick' + index + '" data-shp-nick="' + index + '" ' +
      'maxlength="40" placeholder="e.g. Office chair" value="' + esc(item.nickname) + '" />' +
      '</div></div>'
    );
  }

  function modalHtml() {
    return (
      '<h2 class="modal-title" id="modalTitle">' + esc(AGENT_NAME) + '</h2>' +
      '<p class="modal-sub">Daily effective-price tracking after public vouchers · ' +
      '5 credits (1–3 links) · 10 credits (4–8 links) · ' + DAYS + ' days</p>' +
      '<div class="calc-card modal-calc"><div class="calc-grid">' +
      '<div class="calc-cell"><span class="calc-label">Available</span>' +
      '<span class="calc-value" id="shpAvailable">— Credits</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Products</span>' +
      '<span class="calc-value" id="shpItemCount">1 / ' + MAX_ITEMS + '</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Drop threshold</span>' +
      '<span class="calc-value" id="shpThresholdValue">' + threshold + '% below median</span></div>' +
      '<div class="calc-cell calc-cell-total"><span class="calc-label">Total cost</span>' +
      '<span class="calc-value" id="shpCost">5 Credits</span>' +
      '<span class="calc-sub" id="shpAfterRun"></span></div>' +
      '</div></div>' +
      '<form class="invoice-form" id="shopeeForm" novalidate>' +
      '<div class="modal-section"><h3>1. Shopee products</h3>' +
      '<span class="fine">1–' + MAX_ITEMS + ' links · Shopee MY & SG</span></div>' +
      '<div id="shpItems"></div>' +
      '<div class="modal-section"><h3></h3>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="shpAddBtn">+ Add Shopee Product</button>' +
      '</div>' +
      '<div class="modal-section"><h3>2. Auto-drop threshold</h3>' +
      '<span class="fine">Alert when effective price falls below the 30-day median</span></div>' +
      '<div class="lead-mode" id="shpThresholdGroup" role="radiogroup" aria-label="Drop threshold">' +
      THRESHOLDS.map(thresholdPillHtml).join('') +
      '</div>' +
      '<div class="modal-section"><h3>3. Delivery details</h3>' +
      '<span class="fine">Email only</span></div>' +
      '<div class="field"><label for="shpEmail">Delivery email</label>' +
      '<input type="email" id="shpEmail" class="is-locked" value="' + esc(accountEmail) + '" ' +
      'placeholder="Loading your account email…" disabled tabindex="-1" /></div>' +
      '<div class="modal-actions">' +
      '<div class="scraper-modal-error" id="shpFormError" role="alert"></div>' +
      '<p class="scraper-shortfall" id="shpShortfall" hidden></p>' +
      '<button type="submit" class="btn btn-activate" id="shpStartBtn" disabled>' +
      'Activate Shopee Radar</button>' +
      '<p class="fine">Credits are deducted immediately. Fake countdowns are ignored — only real drops against the 30-day median trigger an alert.</p>' +
      '</div>' +
      '</form>'
    );
  }

  function setFormError(message) {
    var el = $('#shpFormError');
    if (el) el.textContent = message || '';
  }

  function setShortfall(message) {
    var el = $('#shpShortfall');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }

  function renderItems() {
    var wrap = $('#shpItems');
    if (wrap) {
      wrap.innerHTML = items
        .map(function (item, index) {
          return itemRowHtml(item, index);
        })
        .join('');
    }
    var addBtn = $('#shpAddBtn');
    if (addBtn) addBtn.disabled = items.length >= MAX_ITEMS;
    updateQuote();
  }

  function syncItemInputs() {
    $$('[data-shp-url]').forEach(function (input) {
      input.addEventListener('input', function () {
        var index = Number(input.getAttribute('data-shp-url'));
        if (!items[index]) return;
        items[index].url = input.value;
        var currency = currencyOf(input.value);
        var label = $('[data-shp-currency="' + index + '"]');
        if (label) label.textContent = symbolOf(currency) || 'auto';
        var target = $('#shpTarget' + index);
        if (target) {
          target.placeholder = symbolOf(currency)
            ? symbolOf(currency) + ' 99.00'
            : 'Price after voucher';
        }
        updateQuote();
      });
    });
    $$('[data-shp-target]').forEach(function (input) {
      input.addEventListener('input', function () {
        var index = Number(input.getAttribute('data-shp-target'));
        if (items[index]) items[index].target = input.value;
      });
    });
    $$('[data-shp-nick]').forEach(function (input) {
      input.addEventListener('input', function () {
        var index = Number(input.getAttribute('data-shp-nick'));
        if (items[index]) items[index].nickname = input.value;
      });
    });
  }

  function updateQuote() {
    var count = items.length;
    var cost = creditsFor(count);
    var setText = function (selector, text) {
      var el = $(selector);
      if (el) el.textContent = text;
    };

    setText('#shpAvailable', (availableCredits === null ? '—' : availableCredits) + ' Credits');
    setText('#shpItemCount', count + ' / ' + MAX_ITEMS);
    setText('#shpThresholdValue', threshold + '% below median');
    setText('#shpCost', cost + ' Credits');
    setText(
      '#shpAfterRun',
      availableCredits === null
        ? ''
        : 'After run: ' + Math.max(0, availableCredits - cost) + ' credits'
    );

    var shortfall = availableCredits !== null ? cost - availableCredits : 0;
    setShortfall(
      shortfall > 0
        ? 'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
          ' for this radar. Top up credits to continue.'
        : ''
    );

    var btn = $('#shpStartBtn');
    if (btn && !inFlight) btn.disabled = shortfall > 0;
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
          var input = $('#shpEmail');
          if (input) input.value = email;
        }
        var credits = creditsOf(body);
        if (credits !== null) {
          availableCredits = credits;
          updateQuote();
        }
      })
      .catch(function () {
        /* offline — modal stays usable */
      });
  }

  function openShopeeConfigModal() {
    items = [{ url: '', target: '', nickname: '' }];
    threshold = 10;
    inFlight = false;

    var mounted = showModal(modalHtml());
    if (!mounted) return;

    var LW = window.__LW;
    if (LW && LW.state && LW.state.credits != null) {
      availableCredits = Number(LW.state.credits);
    }

    renderItems();
    syncItemInputs();

    var wrap = $('#shpItems');
    if (wrap) {
      wrap.addEventListener('click', function (event) {
        var btn = event.target.closest ? event.target.closest('[data-shp-remove]') : null;
        if (!btn) return;
        var index = Number(btn.getAttribute('data-shp-remove'));
        if (Number.isFinite(index) && items.length > 1) {
          items.splice(index, 1);
          setFormError('');
          renderItems();
          syncItemInputs();
        }
      });
    }

    var addBtn = $('#shpAddBtn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        if (items.length >= MAX_ITEMS) return;
        items.push({ url: '', target: '', nickname: '' });
        setFormError('');
        renderItems();
        syncItemInputs();
      });
    }

    var group = $('#shpThresholdGroup');
    if (group) {
      group.addEventListener('click', function (event) {
        var pill = event.target.closest ? event.target.closest('[data-shp-threshold]') : null;
        if (!pill) return;
        threshold = Number(pill.getAttribute('data-shp-threshold')) || 10;
        $$('#shpThresholdGroup [data-shp-threshold]').forEach(function (btn) {
          var on = Number(btn.getAttribute('data-shp-threshold')) === threshold;
          btn.classList.toggle('is-active', on);
          btn.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        updateQuote();
      });
    }

    var form = $('#shopeeForm');
    if (form) form.addEventListener('submit', submitRadar);

    loadAccount();
  }

  window.openShopeeRadarModal = function () {
    var now = Date.now();
    if (now - lastOpenAt < 300) return;
    lastOpenAt = now;

    if (!readToken()) {
      openSignIn('Log in or sign up to activate the Shopee Radar.');
      waitForToken(function () {
        window.openShopeeRadarModal();
      });
      return;
    }
    openShopeeConfigModal();
  };

  function submitRadar(event) {
    event.preventDefault();
    if (inFlight) return;

    if (!readToken()) {
      closeModal();
      openSignIn('Your session expired. Log in again to activate the Shopee Radar.');
      return;
    }

    var payloadItems = [];
    var invalid = false;
    items.forEach(function (item, index) {
      var url = String(item.url || '').trim();
      if (!url) {
        invalid = true;
        var input = $('#shpUrl' + index);
        if (input) input.classList.add('is-invalid');
        return;
      }
      if (!validShopeeUrl(url)) {
        invalid = true;
        var err = $('#shpUrlError' + index);
        if (err) err.textContent = 'Use a https://shopee.com.my/… or https://shopee.sg/… link.';
        var bad = $('#shpUrl' + index);
        if (bad) bad.classList.add('is-invalid');
        return;
      }
      payloadItems.push({
        url: url,
        target_price: num(item.target),
        nickname: String(item.nickname || '').trim(),
        currency: currencyOf(url)
      });
    });

    if (invalid || !payloadItems.length) {
      setFormError('Add at least one valid Shopee MY/SG product link.');
      return;
    }

    var cost = creditsFor(payloadItems.length);
    if (availableCredits !== null && availableCredits < cost) {
      setFormError(
        'You need ' + (cost - availableCredits) + ' more credit' +
        (cost - availableCredits === 1 ? '' : 's') + ' for this radar.'
      );
      return;
    }

    setFormError('');
    setShortfall('');
    $$('[data-shp-url]').forEach(function (input) {
      input.classList.remove('is-invalid');
    });
    $$('.field-error').forEach(function (el) {
      el.textContent = '';
    });
    inFlight = true;

    var button = $('#shpStartBtn');
    if (button) {
      button.disabled = true;
      button.classList.add('is-busy');
      button.textContent = 'Activating your radar…';
    }

    fetch(START_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + readToken()
      },
      body: JSON.stringify({
        items: payloadItems,
        drop_threshold_pct: threshold
      })
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (payload) {
            return { status: response.status, ok: response.ok, body: payload || {} };
          });
      })
      .then(function (result) {
        if (result.status === 401) {
          inFlight = false;
          closeModal();
          openSignIn('Your session expired. Log in again to activate the Shopee Radar.');
          return null;
        }
        if (result.status === 402) {
          inFlight = false;
          setFormError(
            (result.body && (result.body.error || result.body.message)) ||
              'Not enough credits for this radar. Top up credits to continue.'
          );
          if (button) {
            button.disabled = false;
            button.classList.remove('is-busy');
            button.textContent = 'Activate Shopee Radar';
          }
          var LW = window.__LW;
          if (LW && typeof LW.openTopUpModal === 'function') LW.openTopUpModal();
          return null;
        }
        if (!result.ok) {
          throw new Error(
            (result.body && (result.body.error || result.body.message)) ||
              'HTTP ' + result.status
          );
        }

        var raw =
          result.body.data && result.body.data.job
            ? result.body.data.job
            : result.body.data && result.body.data.radar
            ? result.body.data.radar
            : result.body;

        var job = normalizeJob(raw, {
          items: payloadItems,
          threshold: threshold,
          credits: cost,
          email: accountEmail
        });

        rememberJob(job);
        var remaining = creditsOf(result.body);
        if (remaining !== null) {
          availableCredits = remaining;
          if (window.__LW && window.__LW.updateCreditsDisplay) {
            window.__LW.updateCreditsDisplay(remaining);
          }
        } else if (availableCredits !== null) {
          availableCredits = Math.max(0, availableCredits - cost);
          if (window.__LW && window.__LW.updateCreditsDisplay) {
            window.__LW.updateCreditsDisplay(availableCredits);
          }
        }

        inFlight = false;
        closeModal();
        toast(
          'Shopee Radar activated — ' + payloadItems.length + ' product' +
          (payloadItems.length === 1 ? '' : 's') + ' tracked for ' + DAYS + ' days.',
          'success'
        );

        if (currentRoute() === 'shopee-results') {
          renderShopeeResults(job);
        } else {
          window.location.hash = '#shopee-results';
        }
        return job;
      })
      .catch(function (err) {
        inFlight = false;
        if (button) {
          button.disabled = false;
          button.classList.remove('is-busy');
          button.textContent = 'Activate Shopee Radar';
        }
        setFormError(
          (err && err.message) ||
            'Could not activate the radar. Please try again in a moment.'
        );
        updateQuote();
        return null;
      });
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

  /* ======================= E. JOB NORMALISATION ========================== */

  function normalizeRows(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map(function (row) {
        if (!row || typeof row !== 'object') return null;
        var url = String(pick(row, ['url', 'product_url', 'link', 'href']) || '');
        var nickname = String(
          pick(row, ['nickname', 'name', 'product', 'title', 'item_name']) || ''
        );
        if (!url && !nickname) return null;
        var currency = String(
          pick(row, ['currency']) || currencyOf(url) || ''
        ).toUpperCase();
        return {
          nickname: nickname || 'Shopee item',
          url: url,
          mall: String(pick(row, ['shop_type', 'seller_type', 'mall', 'shop']) || ''),
          shop: String(pick(row, ['shop_name', 'seller', 'shop']) || ''),
          currency: currency === 'MYR' || currency === 'SGD' ? currency : currencyOf(url),
          listed: num(pick(row, ['listed_price', 'price', 'original_price'])),
          voucher: num(pick(row, ['voucher', 'public_voucher', 'voucher_amount', 'discount'])),
          effective: num(
            pick(row, ['effective_price', 'final_price', 'price_after_voucher', 'current_price'])
          ),
          target: num(pick(row, ['target_price', 'target'])),
          stock: String(pick(row, ['stock_status', 'stock', 'availability']) || ''),
          inStock:
            pick(row, ['in_stock']) === false ||
            String(pick(row, ['stock_status', 'stock', 'availability']) || '').toLowerCase() ===
              'out of stock'
              ? false
              : true
        };
      })
      .filter(function (row) {
        return !!row;
      });
  }

  function normalizeJob(raw, fallback) {
    var jobRaw = raw && typeof raw === 'object' ? raw : {};
    var base = fallback || {};

    var rows = normalizeRows(
      pick(jobRaw, ['products', 'items', 'trackers', 'rows', 'results'], [])
    );

    if (!rows.length && Array.isArray(base.items)) {
      rows = base.items.map(function (item) {
        return {
          nickname: item.nickname || 'Shopee item',
          url: item.url,
          mall: '',
          shop: '',
          currency: item.currency || currencyOf(item.url),
          listed: null,
          voucher: null,
          effective: null,
          target: num(item.target),
          stock: 'Tracking',
          inStock: true
        };
      });
    }

    var startedAt = String(
      pick(jobRaw, ['started_at', 'created_at', 'createdAt', 'date']) ||
        base.startedAt ||
        new Date().toISOString()
    );
    var expiresAt = String(pick(jobRaw, ['expires_at', 'expiresAt', 'end_date']) || '');
    if (!expiresAt) {
      var expiry = new Date(startedAt || Date.now());
      if (!isNaN(expiry.getTime())) {
        expiry.setHours(expiry.getHours() + DAYS * 24);
        expiresAt = expiry.toISOString();
      }
    }

    var daysLeft = num(pick(jobRaw, ['days_remaining', 'days_left']));
    if (daysLeft === null && expiresAt) {
      var diff = new Date(expiresAt).getTime() - Date.now();
      if (!isNaN(diff)) daysLeft = Math.max(0, Math.ceil(diff / 86400000));
    }
    if (daysLeft === null) daysLeft = DAYS;
    daysLeft = Math.max(0, Math.min(DAYS, Math.round(daysLeft)));

    var statusRaw = String(pick(jobRaw, ['status', 'job_status']) || 'active').toLowerCase();
    var status =
      statusRaw === 'completed' || statusRaw === 'expired' || daysLeft === 0
        ? 'completed'
        : statusRaw === 'failed' || statusRaw === 'error'
        ? 'failed'
        : 'active';

    var credits =
      num(pick(jobRaw, ['credits_spent', 'creditsSpent', 'credits', 'credits_used'])) ||
      base.credits ||
      creditsFor(rows.length);

    return {
      job_id: String(pick(jobRaw, ['radar_id', 'job_id', 'id']) || ''),
      display_id: String(pick(jobRaw, ['display_id', 'displayId', 'public_id']) || ''),
      products: num(pick(jobRaw, ['products_count', 'items_count', 'tracked_count'])) ||
        rows.length ||
        1,
      threshold:
        num(pick(jobRaw, ['drop_threshold_pct', 'threshold_pct', 'drop_threshold'])) ||
        base.threshold ||
        10,
      credits: credits,
      status: status,
      daysLeft: daysLeft,
      percent: Math.max(0, Math.min(100, (daysLeft / DAYS) * 100)),
      rows: rows,
      email: String(pick(jobRaw, ['email']) || base.email || accountEmail || ''),
      created: startedAt,
      expiresAt: expiresAt,
      downloadReady: status !== 'failed'
    };
  }

  /* ================== F. RESULTS — renderShopeeResults() ================= */

  function currentJob() {
    var job = readJSON(JOB_KEY);
    if (job && typeof job === 'object') return job;
    var list = readJSON(JOBS_KEY);
    if (Array.isArray(list) && list.length) return list[0];
    return null;
  }

  function rememberJob(job) {
    if (!job) return;
    writeJSON(JOB_KEY, job);
    var list = readJSON(JOBS_KEY);
    if (!Array.isArray(list)) list = [];
    var key = job.job_id || job.display_id || shpRef(job);
    list = list.filter(function (item) {
      var itemKey = item && (item.job_id || item.display_id || shpRef(item));
      return itemKey !== key;
    });
    list.unshift(job);
    writeJSON(JOBS_KEY, list.slice(0, 25));
    historyJobs = list.slice(0, 25);
  }

  function summaryRow(label, valueHtml) {
    return '<div class="summary-row"><dt>' + esc(label) + '</dt><dd>' + valueHtml + '</dd></div>';
  }

  function renderTable(job) {
    var table = $('#shpTable');
    if (!table) return;
    var thead = table.querySelector('thead');
    var tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;

    thead.innerHTML =
      '<tr>' + COLUMNS.map(function (col) {
        return '<th>' + esc(col) + '</th>';
      }).join('') + '</tr>';

    if (!job.rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="' + COLUMNS.length + '" class="empty-note">' +
        'Your tracked products will appear here after the first daily price check.</td></tr>';
      return;
    }

    tbody.innerHTML = job.rows
      .map(function (row) {
        var mallBadge = /mall/i.test(row.mall)
          ? '<span class="hist-badge ok">Mall</span>'
          : row.mall
          ? '<span class="hist-badge muted">' + esc(row.mall) + '</span>'
          : '<span class="hist-badge muted">Shop</span>';
        var stockBadge = row.inStock
          ? '<span class="hist-badge ok">In stock</span>'
          : '<span class="hist-badge bad">Out of stock</span>';
        var link = row.url
          ? '<a href="' + esc(row.url) + '" target="_blank" rel="noopener noreferrer">Open ↗</a>'
          : '—';
        return (
          '<tr>' +
          '<td><strong>' + esc(row.nickname) + '</strong>' +
          (row.shop ? '<br><span class="fine">' + esc(row.shop) + '</span>' : '') +
          '</td>' +
          '<td>' + mallBadge + '</td>' +
          '<td>' + esc(money(row.listed, row.currency)) + '</td>' +
          '<td>' + esc(row.voucher ? '− ' + money(row.voucher, row.currency) : '—') + '</td>' +
          '<td><strong>' + esc(money(row.effective, row.currency)) + '</strong></td>' +
          '<td>' + esc(row.target !== null ? money(row.target, row.currency) : '—') + '</td>' +
          '<td>' + stockBadge + '</td>' +
          '<td>' + link + '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function wireDownloadButton() {
    var btn = $('#shpDownloadBtn');
    if (!btn || btn.getAttribute('data-shp-bound') === '1') return;
    btn.setAttribute('data-shp-bound', '1');
    btn.addEventListener('click', function () {
      downloadShopeeHistory();
    });
  }

  function renderShopeeResults(data) {
    var view = $('#view-shopee-results');
    if (!view) return;

    var job =
      data && typeof data === 'object'
        ? normalizeJob(
            data.data && data.data.job
              ? data.data.job
              : data.data && data.data.radar
              ? data.data.radar
              : data
          )
        : currentJob();

    var empty = $('#shopeeEmpty');
    var main = $('#shopeeMain');

    if (!job) {
      if (empty) empty.hidden = false;
      if (main) main.hidden = true;
      return;
    }

    if (empty) empty.hidden = true;
    if (main) main.hidden = false;

    var headerId = $('#shpHeaderId');
    if (headerId) headerId.textContent = shpRef(job);

    var headerStatus = $('#shpHeaderStatus');
    if (headerStatus) {
      headerStatus.textContent =
        job.status === 'active'
          ? 'Active · ' + DAYS + ' days'
          : job.status === 'failed'
          ? 'Failed'
          : 'Completed · ' + formatDate(job.expiresAt);
      headerStatus.className =
        'hist-badge ' + (job.status === 'active' ? 'ok' : job.status === 'failed' ? 'bad' : 'muted');
    }

    var statusBadge = $('#shpStatusBadge');
    if (statusBadge) {
      statusBadge.classList.toggle('is-ok', job.status === 'active');
      var badgeText = statusBadge.querySelector('.webhook-text');
      if (badgeText) {
        badgeText.textContent =
          job.status === 'active'
            ? 'Active · Daily price check'
            : job.status === 'failed'
            ? 'Failed'
            : 'Completed · ' + formatDate(job.expiresAt);
      }
    }

    var ringPercent = $('#shpRingPercent');
    if (ringPercent) ringPercent.textContent = String(job.daysLeft);

    var ringCount = $('#shpRingCount');
    if (ringCount) {
      ringCount.textContent =
        'days left · ' + job.products + ' product' + (job.products === 1 ? '' : 's');
    }

    var ringFill = $('#shpRingFill');
    if (ringFill) {
      var circumference = 364.42;
      ringFill.style.strokeDasharray = String(circumference);
      ringFill.style.strokeDashoffset = String(circumference * (1 - job.percent / 100));
    }

    var ringCard = $('#shpRingCard');
    if (ringCard) {
      ringCard.classList.toggle('is-complete', job.status === 'active');
      ringCard.classList.toggle('is-warning', job.status === 'failed');
      ringCard.classList.toggle('is-down', job.status === 'failed');
    }

    var emailNote = $('#shpEmailNote');
    if (emailNote && job.email) {
      emailNote.textContent =
        'Price-drop alerts and the .xlsx history are emailed to ' + job.email + '.';
    }

    var meta = $('#shpJobMeta');
    if (meta) {
      meta.textContent =
        job.products + ' product' + (job.products === 1 ? '' : 's') + ' · ' +
        job.threshold + '% below median · ' + job.daysLeft + ' / ' + DAYS +
        ' days left';
    }

    var summary = $('#shpJobSummary');
    if (summary) {
      summary.innerHTML =
        summaryRow('Radar ID', '<code>' + esc(shpRef(job)) + '</code>') +
        summaryRow('Products', '<strong>' + esc(job.products) + '</strong>') +
        summaryRow('Drop Threshold', '<strong>' + esc(job.threshold) + '% below median</strong>') +
        summaryRow('Active Until', '<strong>' + esc(formatDate(job.expiresAt)) + '</strong>') +
        summaryRow('Credits Used', '<strong>' + esc(job.credits) + ' credit' +
          (Number(job.credits) === 1 ? '' : 's') + '</strong>') +
        summaryRow('Delivery Email', esc(job.email || '—'));
    }

    var previewPill = $('#shpPreviewPill');
    if (previewPill) {
      previewPill.textContent =
        job.products + ' product' + (job.products === 1 ? '' : 's');
    }
    var tableMeta = $('#shpTableMeta');
    if (tableMeta) {
      tableMeta.textContent = job.rows.length
        ? job.rows.length + ' tracked link' + (job.rows.length === 1 ? '' : 's') +
          ' · ' + job.threshold + '% drop alert'
        : 'Listed vs effective price after public vouchers';
    }

    var downloadSub = $('#shpDownloadSub');
    if (downloadSub) {
      downloadSub.textContent = job.downloadReady
        ? 'Ready to download'
        : 'Preparing history…';
    }

    renderTable(job);
    wireDownloadButton();
  }

  window.renderShopeeResults = renderShopeeResults;

  /* ====================== G. DOWNLOAD — .xlsx ============================ */

  function filenameFromDisposition(header, fallback) {
    if (!header) return fallback;
    var match = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(header);
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1].trim());
      } catch (err) {
        return match[1].trim();
      }
    }
    return fallback;
  }

  function downloadShopeeHistory(jobId, displayId) {
    var now = Date.now();
    if (downloadInFlight || now - lastDownloadAt < 1000) return;
    lastDownloadAt = now;

    var job = currentJob();
    var id = String(jobId || (job && (job.job_id || job.id)) || '');
    var disp = String(displayId || (job && job.display_id) || '');
    var token = readToken();

    if (!token) {
      openSignIn('Log in again to download your Shopee price history.');
      return;
    }
    if (!id && !disp) {
      toast('Open a Shopee Radar first, then download its price history.', 'warn');
      return;
    }

    var url = DOWNLOAD_URL + '?job_id=' + encodeURIComponent(id || disp);
    if (disp && id) url += '&display_id=' + encodeURIComponent(disp);

    downloadInFlight = true;
    toast('Preparing your price history…', 'info');

    fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + token } })
      .then(function (response) {
        if (response.status === 401) {
          downloadInFlight = false;
          openSignIn('Your session expired. Log in again to download the history.');
          return null;
        }
        if (response.status === 402) {
          downloadInFlight = false;
          toast('Insufficient credits for this download.', 'warn');
          return null;
        }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        var disposition = response.headers.get('content-disposition');
        return response.blob().then(function (blob) {
          return { blob: blob, name: filenameFromDisposition(disposition, '') };
        });
      })
      .then(function (result) {
        downloadInFlight = false;
        if (!result) return;
        var name = result.name || 'Shopee-Price-History-' + shpRef(job) + '.xlsx';
        var objectUrl = URL.createObjectURL(result.blob);
        var anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = name;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.setTimeout(function () {
          URL.revokeObjectURL(objectUrl);
        }, 4000);
        toast('Price history downloaded.', 'success');
      })
      .catch(function (err) {
        downloadInFlight = false;
        toast(
          (err && err.message) || 'Could not download the history. Please try again.',
          'warn'
        );
      });
  }

  window.downloadShopeeHistory = downloadShopeeHistory;

  /* ============= H. HISTORY — #plans / #historyShopee =================== */

  function extractJobs(body) {
    if (!body || typeof body !== 'object') return [];
    var source =
      body.data && typeof body.data === 'object' && !Array.isArray(body.data)
        ? body.data
        : body;
    var raw = Array.isArray(source.shopee_radar) ? source.shopee_radar : [];
    if (!raw.length && Array.isArray(body.shopee_radar)) raw = body.shopee_radar;
    return raw.map(function (item) {
      return normalizeJob(item);
    });
  }

  function paintHistoryCounts(count) {
    $$('[data-hist-count="shopee"]').forEach(function (el) {
      var want = String(count);
      el.setAttribute('data-shopee-count', want);
      el.textContent = want;
      if (el.getAttribute('data-shopee-count-guard') === '1') return;
      if (!window.MutationObserver) return;
      el.setAttribute('data-shopee-count-guard', '1');
      var observer = new window.MutationObserver(function () {
        var expected = readToken() ? el.getAttribute('data-shopee-count') : '0';
        if (expected !== null && el.textContent !== expected) {
          el.textContent = expected;
        }
      });
      observer.observe(el, { childList: true, characterData: true, subtree: true });
    });
    $$('[data-hist-count-label="shopee"]').forEach(function (el) {
      el.textContent = count + ' radar' + (count === 1 ? '' : 's');
    });
  }

  function historyCardHtml(job) {
    var active = job.status === 'active';
    var daysPill = active
      ? '<span class="hist-badge ok">' + job.daysLeft + ' / ' + DAYS + ' days left</span>'
      : '<span class="hist-badge muted">Ended ' + esc(formatDate(job.expiresAt)) + '</span>';
    var productText = job.products + ' product' + (job.products === 1 ? '' : 's');
    var creditText = job.credits + ' credit' + (job.credits === 1 ? '' : 's');
    var refId = job.job_id || job.display_id;

    return (
      '<article class="hist-card">' +
      '<div class="hist-card-top">' +
      '<strong>Shopee Price Radar</strong>' +
      '<span class="hist-id">' + esc(shpRef(job)) + '</span>' +
      '<span class="hist-badge ' + (active ? 'ok' : 'muted') + '">' +
      (active ? 'Active' : 'Completed') + '</span>' +
      '</div>' +
      '<p class="hist-sub">' + esc(productText) + ' · ' + esc(creditText) + ' · ' +
      esc(job.threshold + '% drop alert') + '</p>' +
      '<div class="hist-trading">' +
      '<span class="hist-trading-label"><strong>' + job.daysLeft + ' / ' + DAYS +
      '</strong> days left</span>' +
      daysPill +
      '</div>' +
      '<div class="watch-progress"><span style="width:' +
      Math.max(2, Math.min(100, job.percent)) + '%"></span></div>' +
      '<dl class="hist-meta">' +
      '<div><dt>Products</dt><dd>' + esc(productText) + '</dd></div>' +
      '<div><dt>Threshold</dt><dd>' + esc(job.threshold + '% below median') + '</dd></div>' +
      '<div><dt>Credits spent</dt><dd>' + esc(creditText) + '</dd></div>' +
      '<div><dt>Radar ID</dt><dd><code>' + esc(shpRef(job)) + '</code></dd></div>' +
      '</dl>' +
      '<div class="hist-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-shopee-view="' +
      esc(refId) + '">View Tracker</button>' +
      (job.downloadReady && refId
        ? '<button type="button" class="btn btn-primary btn-sm" data-shopee-download="' +
          esc(refId) + '">Download .xlsx</button>'
        : '') +
      '</div>' +
      '</article>'
    );
  }

  function renderHistoryPane(jobs) {
    var pane = $('#historyShopee');
    if (!pane) return;

    if (!readToken()) {
      pane.innerHTML =
        '<div class="hist-empty">' +
        '<p class="empty-note">Log in to view your Shopee price radars.</p>' +
        '<button type="button" class="btn btn-primary btn-sm" data-history-login>Log in</button>' +
        '</div>';
      paintHistoryCounts(0);
      return;
    }

    if (!jobs.length) {
      pane.innerHTML =
        '<div class="hist-empty">' +
        '<p class="empty-note">No Shopee radars yet. Track 1–8 Shopee MY/SG links for 30 days and get real price-drop alerts.</p>' +
        '<button type="button" class="btn btn-primary btn-sm" data-open-shopee onclick="window.openShopeeRadarModal && window.openShopeeRadarModal(); return false;">Configure Shopee Radar →</button>' +
        '</div>';
      paintHistoryCounts(0);
      return;
    }

    pane.innerHTML =
      '<div class="hist-list">' + jobs.map(historyCardHtml).join('') + '</div>';
    paintHistoryCounts(jobs.length);
  }

  window.renderShopeeHistory = function (body) {
    historyLoading = false;
    historyLoaded = true;

    if (body === null || body === undefined) {
      renderHistoryPane([]);
      return;
    }

    var jobs = extractJobs(body);
    var cached = readJSON(JOBS_KEY);
    if (Array.isArray(cached)) {
      cached.forEach(function (job) {
        var duplicate = jobs.some(function (item) {
          return item.job_id && job.job_id && item.job_id === job.job_id;
        });
        if (!duplicate) jobs.push(normalizeJob(job));
      });
    }
    jobs.sort(function (a, b) {
      return new Date(b.created || 0).getTime() - new Date(a.created || 0).getTime();
    });

    historyJobs = jobs;
    renderHistoryPane(jobs);
  };

  function findJobByRef(ref) {
    var key = String(ref || '');
    var list = historyJobs.length ? historyJobs : readJSON(JOBS_KEY);
    if (!Array.isArray(list)) list = [];
    for (var i = 0; i < list.length; i += 1) {
      var job = list[i];
      if (!job) continue;
      var candidates = [job.job_id, job.display_id, job.id, shpRef(job)];
      for (var c = 0; c < candidates.length; c += 1) {
        if (candidates[c] && String(candidates[c]) === key) return job;
      }
    }
    var current = currentJob();
    if (current) {
      var own = [current.job_id, current.display_id, shpRef(current)];
      for (var o = 0; o < own.length; o += 1) {
        if (own[o] && String(own[o]) === key) return current;
      }
    }
    return null;
  }

  function openShopeeHistoryJob(ref) {
    var job = findJobByRef(ref);
    if (job) {
      rememberJob(job);
      if (currentRoute() === 'shopee-results') renderShopeeResults(job);
      else window.location.hash = '#shopee-results';
      return;
    }

    var fallback = currentJob();
    if (fallback) {
      rememberJob(fallback);
      if (currentRoute() === 'shopee-results') renderShopeeResults(fallback);
      else window.location.hash = '#shopee-results';
    } else {
      window.location.hash = '#shopee-results';
    }

    var token = readToken();
    if (!token) return;
    fetch(HISTORY_URL, { method: 'GET', headers: { Authorization: 'Bearer ' + token } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (body) {
        var jobs = extractJobs(body);
        var match = null;
        for (var i = 0; i < jobs.length; i += 1) {
          var item = jobs[i];
          if (
            String(item.job_id) === String(ref) ||
            String(item.display_id) === String(ref) ||
            shpRef(item) === String(ref)
          ) {
            match = item;
            break;
          }
        }
        if (match) {
          rememberJob(match);
          renderShopeeResults(match);
        }
      })
      .catch(function () {
        /* keep cached view */
      });
  }

  window.openShopeeHistoryJob = openShopeeHistoryJob;

  /* ======================= I. ROUTING & LISTENERS ======================== */

  function ensureHistory() {
    var pane = $('#historyShopee');
    if (!pane) return;
    if (!readToken()) {
      renderHistoryPane([]);
      return;
    }
    if (historyLoaded) {
      renderHistoryPane(historyJobs);
      return;
    }
    if (historyLoading) return;
    window.setTimeout(function () {
      if (historyLoaded || historyLoading) return;
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
          window.renderShopeeHistory(body);
        })
        .catch(function () {
          historyLoading = false;
          if (!historyJobs.length) {
            pane.innerHTML =
              '<div class="hist-empty"><p class="empty-note">Could not load your Shopee radars right now. ' +
              '<button type="button" class="btn btn-ghost btn-sm" data-shopee-history-retry>Try again</button></p></div>';
          }
        });
    }, 600);
  }

  function onRoute() {
    var route = currentRoute();
    if (route === 'shopee-results') renderShopeeResults();
    if (route === 'plans') ensureHistory();
  }

  function onDocumentClick(event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    var card = target.closest('#shopeeRadarAgentCard');
    if (card && (target.closest('[data-open-shopee]') || target.closest('.btn-subscribe'))) {
      event.preventDefault();
      window.openShopeeRadarModal();
      return;
    }

    var viewBtn = target.closest('[data-shopee-view]');
    if (viewBtn) {
      event.preventDefault();
      openShopeeHistoryJob(viewBtn.getAttribute('data-shopee-view'));
      return;
    }

    var dlBtn = target.closest('[data-shopee-download]');
    if (dlBtn) {
      event.preventDefault();
      downloadShopeeHistory(dlBtn.getAttribute('data-shopee-download'));
      return;
    }

    var retry = target.closest('[data-shopee-history-retry]');
    if (retry) {
      event.preventDefault();
      historyLoading = false;
      historyLoaded = false;
      ensureHistory();
    }
  }

  function init() {
    var cached = readJSON(JOBS_KEY);
    if (Array.isArray(cached)) historyJobs = cached;
    document.addEventListener('click', onDocumentClick, false);
    window.addEventListener('hashchange', onRoute, false);
    onRoute();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
