/* ============================================================================
   LiteWork — Worker #9 · Dividend & Ex-Date Radar (MY / SG / US)
   ----------------------------------------------------------------------------
   Standalone vanilla JS module. Loaded with <script defer> AFTER app.js, so it
   never bloats app.js. It owns everything for the DIV-#### worker:

     · window.openDividendModal()          — configuration modal
     · window.renderDividendResults(data)  — full-page #view-dividend-results
     · window.downloadDividendCalendar()   — Bearer-authenticated .xlsx download
     · window.openDividendHistoryJob(ref)  — open a radar from My Activity

   app.js only registers the #dividend-results route, renders the history card
   markup and forwards clicks through safe window.* lookups — so a missing or
   late-loading worker can never throw `Can't find variable` again.
   ========================================================================== */
(function () {
  'use strict';

  /* ======================= A. CONFIG / CONSTANTS ========================== */

  var CFG = window.CONFIG || {};

  var API_BASE = String(
    CFG.API_BASE || 'https://n8n.20.205.96.122.sslip.io/webhook'
  ).replace(/\/+$/, '');
  var TOKEN_KEY = CFG.AUTH_TOKEN_KEY || 'aaas_token';

  var AGENT_ID = CFG.DIVIDEND_RADAR_AGENT_ID || 'dividend-radar';
  var AGENT_NAME =
    CFG.DIVIDEND_RADAR_AGENT_NAME || 'Dividend & Ex-Date Radar (MY / SG / US)';

  var START_URL = String(CFG.dividendRadarStartUrl || API_BASE + '/dividend-radar-start');
  var DOWNLOAD_URL = String(
    CFG.dividendCalendarDownloadUrl || API_BASE + '/download-dividend-calendar'
  );
  var HISTORY_URL = API_BASE + '/account/history';
  var ME_URL = API_BASE + '/auth/me';

  var DIV_DAYS = Number(CFG.DIVIDEND_RADAR_DAYS) > 0 ? Number(CFG.DIVIDEND_RADAR_DAYS) : 30;
  var DIV_MAX_STOCKS =
    Number(CFG.DIVIDEND_RADAR_MAX_STOCKS) > 0 ? Number(CFG.DIVIDEND_RADAR_MAX_STOCKS) : 15;

  var JOB_KEY = 'lw_div_job_v1';
  var JOBS_KEY = 'lw_div_jobs_v1';

  var LEAD_OPTIONS = [
    { days: 2, label: '2 days', note: 'Email 2 days before' },
    { days: 3, label: '3 days', note: 'Recommended' },
    { days: 5, label: '5 days', note: 'Email 5 days before' }
  ];

  /* ============================ B. STATE ================================= */

  var activeRegionId = 'my';
  var searchQuery = '';
  var selected = {}; /* symbol -> { symbol, name, tag, region, regionLabel, shares } */
  var leadDays = 3;
  var availableCredits = null;
  var accountEmail = '';
  var inFlight = false;
  var lastOpenAt = 0;
  var lastDownloadAt = 0;
  var downloadInFlight = false;
  var dividerCache = [];

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
        /* fall through to the local escaper */
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

  function divRef(job) {
    if (!job) return 'DIV-1001';
    var raw = String(
      job.display_id || job.displayId || job.public_id || job.radar_id || job.job_id || job.id || ''
    );
    var match = raw.match(/DIV[-\s]?0*(\d+)/i);
    if (match) return 'DIV-' + pad4(match[1]);
    if (/^\d+$/.test(raw)) return 'DIV-' + pad4(raw);
    var digits = raw.replace(/\D/g, '');
    if (digits) return 'DIV-' + pad4(digits.slice(-4));
    var sum = 0;
    for (var i = 0; i < raw.length; i += 1) {
      sum = (sum * 31 + raw.charCodeAt(i)) % 10000;
    }
    return 'DIV-' + pad4(String(1001 + (sum % 8999)));
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
      /* private mode — keep working in memory */
    }
  }

  function toast(message, tone) {
    var LW = window.__LW;
    if (LW && typeof LW.toast === 'function') {
      try {
        LW.toast(message, tone);
        return;
      } catch (err) {
        /* fall through to a local toast */
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

  function formatNumber(value, digits) {
    var n = num(value);
    if (n === null) return '—';
    return n.toLocaleString('en-US', {
      minimumFractionDigits: digits == null ? 2 : digits,
      maximumFractionDigits: digits == null ? 2 : digits
    });
  }

  function formatPercent(value) {
    var n = num(value);
    if (n === null) return '—';
    var pct = n > 1 ? n : n * 100;
    return pct.toFixed(2) + '%';
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

  function costFor(count) {
    return Number(count) > 5 ? 10 : 5;
  }

  function stockRegions() {
    var LW = window.__LW;
    var regions =
      (LW && Array.isArray(LW.STOCK_REGIONS) && LW.STOCK_REGIONS) ||
      (Array.isArray(CFG.STOCK_REGIONS) && CFG.STOCK_REGIONS) ||
      [];

    var normalized = regions
      .filter(function (region) {
        return region && region.id && Array.isArray(region.stocks) && region.stocks.length;
      })
      .map(function (region) {
        return {
          id: String(region.id).toLowerCase(),
          label: String(region.label || region.id),
          flag: String(region.flag || ''),
          markets: String(region.markets || ''),
          stocks: region.stocks.map(function (stock) {
            return {
              symbol: String(stock.symbol || stock.ticker || ''),
              name: String(stock.name || stock.company || ''),
              tag: String(stock.tag || stock.sector || '')
            };
          })
        };
      });

    /* Prefer the MY · SG · US order the radar advertises. */
    var order = ['my', 'sg', 'us'];
    normalized.sort(function (a, b) {
      var ai = order.indexOf(a.id);
      var bi = order.indexOf(b.id);
      if (ai === -1) ai = 99;
      if (bi === -1) bi = 99;
      return ai - bi;
    });
    return normalized;
  }

  var REGIONS = stockRegions();

  function regionById(id) {
    var code = String(id || '').toLowerCase();
    for (var i = 0; i < REGIONS.length; i += 1) {
      if (REGIONS[i].id === code) return REGIONS[i];
    }
    return null;
  }

  function selectedList() {
    return Object.keys(selected).map(function (symbol) {
      return selected[symbol];
    });
  }

  function selectedSymbols() {
    return selectedList().map(function (item) {
      return item.symbol;
    });
  }

  /* ==================== D. MODAL — openDividendModal() =================== */

  function showModal(html) {
    var LW = window.__LW;
    if (LW && typeof LW.openModal === 'function') {
      try {
        LW.openModal(html, true);
        return $('#modalRoot');
      } catch (err) {
        /* fall through to manual mount */
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

  function closeDivModal() {
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
    toast(message || 'Log in or sign up to activate the Dividend Radar.', 'warn');
    var LW = window.__LW;
    if (LW && typeof LW.openAuthModal === 'function') {
      LW.openAuthModal('login', message);
      return;
    }
    var trigger = $('[data-auth-open="login"]');
    if (trigger) trigger.click();
    else window.location.hash = '#plans';
  }

  function leadPillHtml(option) {
    var on = option.days === leadDays;
    return (
      '<button type="button" class="gold-duration' + (on ? ' is-active' : '') + '"' +
      ' data-div-lead="' + option.days + '" role="radio" aria-checked="' + (on ? 'true' : 'false') + '">' +
      '<strong>' + esc(option.label) + '</strong>' +
      '<span>' + esc(option.note) + '</span>' +
      '</button>'
    );
  }

  function modalHtml() {
    var cost = costFor(Object.keys(selected).length || 1);
    return (
      '<h2 class="modal-title" id="modalTitle">' + esc(AGENT_NAME) + '</h2>' +
      '<p class="modal-sub">12-month Dividend Calendar (.xlsx) · ' + DIV_DAYS +
      '-day radar · Ex-Date email alerts</p>' +
      '<div class="calc-card modal-calc"><div class="calc-grid">' +
      '<div class="calc-cell"><span class="calc-label">Available</span>' +
      '<span class="calc-value" id="divAvailableValue">— Credits</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Selected</span>' +
      '<span class="calc-value" id="divSelectedValue">0</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Duration</span>' +
      '<span class="calc-value">' + DIV_DAYS + ' Days</span></div>' +
      '<div class="calc-cell calc-cell-total"><span class="calc-label">Total cost</span>' +
      '<span class="calc-value" id="divCostValue">' + cost + ' Credits</span>' +
      '<span class="calc-sub" id="divRemainingValue"></span></div>' +
      '</div></div>' +
      '<form class="gold-form" id="dividendForm" novalidate>' +
      '<div class="modal-section"><h3>1. Select stocks</h3>' +
      '<span class="fine">Select 1–' + DIV_MAX_STOCKS + ' across MY, SG & US</span></div>' +
      '<div class="field div-search-field"><label for="divStockSearch">Find a stock</label>' +
      '<input type="search" id="divStockSearch" placeholder="Search ticker or company…" autocomplete="off" value="' +
      esc(searchQuery) + '" /></div>' +
      '<div class="stock-region-tabs" id="divRegionTabs" role="tablist" aria-label="Market region"></div>' +
      '<div class="stock-grid" id="divStockGrid" role="group" aria-label="Select dividend stocks"></div>' +
      '<div class="modal-section"><h3>2. Selected holdings</h3>' +
      '<span class="fine">Shares are optional — add them for estimated cash payouts</span></div>' +
      '<div class="div-selected-list" id="divSelected"></div>' +
      '<div class="modal-section"><h3>3. Ex-Date alert lead time</h3>' +
      '<span class="fine">Email reminder before every Ex-Dividend Date</span></div>' +
      '<div class="gold-durations" id="divLeadPills" role="radiogroup" aria-label="Alert lead time">' +
      LEAD_OPTIONS.map(leadPillHtml).join('') +
      '</div>' +
      '<div class="modal-section"><h3>4. Delivery details</h3>' +
      '<span class="fine">Email only</span></div>' +
      '<div class="field"><label for="divEmail">Delivery email</label>' +
      '<input type="email" id="divEmail" class="is-locked" value="' + esc(accountEmail) + '" ' +
      'placeholder="Loading your account email…" disabled tabindex="-1" /></div>' +
      '<div class="modal-actions">' +
      '<div class="scraper-modal-error" id="divFormError" role="alert"></div>' +
      '<p class="scraper-shortfall" id="divShortfall" hidden></p>' +
      '<button type="submit" class="btn btn-activate" id="divStartBtn">Confirm & Spend ' +
      cost + ' Credits (' + DIV_DAYS + '-Day Radar)</button>' +
      '<p class="fine">Your 12-month Dividend Calendar is generated instantly. ' +
      '5 credits for 1–5 stocks · 10 credits for 6–15 stocks. Deducted immediately.</p>' +
      '</div>' +
      '</form>'
    );
  }

  function regionTabHtml(region) {
    var on = region.id === activeRegionId;
    return (
      '<button type="button" class="region-tab' + (on ? ' is-active' : '') + '"' +
      ' data-div-region="' + esc(region.id) + '" role="tab" aria-selected="' + (on ? 'true' : 'false') + '">' +
      (region.flag ? '<span class="region-flag" aria-hidden="true">' + region.flag + '</span>' : '') +
      '<span class="region-label">' + esc(region.label) + '</span>' +
      '<span class="region-count">' + region.stocks.length + '</span>' +
      '</button>'
    );
  }

  function stockCardHtml(stock, region) {
    var on = !!selected[stock.symbol];
    return (
      '<button type="button" class="stock-card' + (on ? ' is-selected' : '') + '"' +
      ' data-div-ticker="' + esc(stock.symbol) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      '<span class="stock-check" aria-hidden="true">' +
      '<svg viewBox="0 0 20 20" width="12" height="12"><path d="M4.5 10.5l3.4 3.4 7.6-7.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</span>' +
      '<span class="stock-symbol">' + esc(stock.symbol) + '</span>' +
      '<span class="stock-name">' + esc(stock.name) + '</span>' +
      '<span class="stock-tag">' + esc(stock.tag || (region ? region.id.toUpperCase() : '')) + '</span>' +
      '</button>'
    );
  }

  function renderRegionTabs() {
    var wrap = $('#divRegionTabs');
    if (!wrap) return;
    wrap.innerHTML = REGIONS.map(regionTabHtml).join('');
  }

  function stocksForView() {
    var query = searchQuery.trim().toLowerCase();
    if (query) {
      var out = [];
      REGIONS.forEach(function (region) {
        region.stocks.forEach(function (stock) {
          if (
            stock.symbol.toLowerCase().indexOf(query) !== -1 ||
            stock.name.toLowerCase().indexOf(query) !== -1
          ) {
            out.push({ stock: stock, region: region });
          }
        });
      });
      return out;
    }
    var region = regionById(activeRegionId) || REGIONS[0];
    if (!region) return [];
    return region.stocks.map(function (stock) {
      return { stock: stock, region: region };
    });
  }

  function renderStockGrid() {
    var grid = $('#divStockGrid');
    if (!grid) return;
    var list = stocksForView();
    grid.innerHTML = list.length
      ? list
          .map(function (row) {
            return stockCardHtml(row.stock, row.region);
          })
          .join('')
      : '<p class="fine div-empty-sel">No stocks match "' + esc(searchQuery) + '".</p>';
  }

  function holdingRowHtml(item) {
    return (
      '<div class="div-holding-row" data-div-holding="' + esc(item.symbol) + '">' +
      '<div class="div-holding-info">' +
      '<span class="div-region-tag">' + esc(item.region) + '</span>' +
      '<strong>' + esc(item.symbol) + '</strong>' +
      '<span>' + esc(item.name) + '</span>' +
      '</div>' +
      '<div class="div-holding-controls">' +
      '<input type="number" class="div-shares-input" data-div-shares="' + esc(item.symbol) + '"' +
      ' min="0" step="1" placeholder="Shares (opt.)" value="' +
      (item.shares ? esc(item.shares) : '') + '" />' +
      '<button type="button" class="stock-chip-x" data-div-remove="' + esc(item.symbol) + '"' +
      ' aria-label="Remove ' + esc(item.symbol) + '">×</button>' +
      '</div>' +
      '</div>'
    );
  }

  function renderSelected() {
    var wrap = $('#divSelected');
    if (!wrap) return;
    var list = selectedList();
    wrap.innerHTML = list.length
      ? list.map(holdingRowHtml).join('')
      : '<p class="fine div-empty-sel">No stocks selected yet — tap any card above (1–' + DIV_MAX_STOCKS + ').</p>';
  }

  function setFormError(message) {
    var el = $('#divFormError');
    if (el) el.textContent = message || '';
  }

  function setShortfall(message) {
    var el = $('#divShortfall');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }

  function syncModalState() {
    var count = selectedList().length;
    var cost = costFor(count || 1);

    var setText = function (selector, text) {
      var el = $(selector);
      if (el) el.textContent = text;
    };

    setText(
      '#divAvailableValue',
      (availableCredits === null ? '—' : availableCredits) + ' Credits'
    );
    setText('#divSelectedValue', String(count));
    setText('#divCostValue', cost + ' Credits');

    var remaining =
      availableCredits === null ? null : Math.max(0, availableCredits - cost);
    setText(
      '#divRemainingValue',
      remaining === null ? '' : 'Remaining after activation: ' + remaining + ' credits'
    );

    var startBtn = $('#divStartBtn');
    if (startBtn && !inFlight) {
      startBtn.textContent =
        'Confirm & Spend ' + cost + ' Credits (' + DIV_DAYS + '-Day Radar)';
    }

    $$('[data-div-lead]').forEach(function (pill) {
      var on = Number(pill.getAttribute('data-div-lead')) === leadDays;
      pill.classList.toggle('is-active', on);
      pill.setAttribute('aria-checked', String(on));
    });

    if (availableCredits !== null) {
      var shortfall = cost - availableCredits;
      setShortfall(
        shortfall > 0
          ? 'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
            ' for this radar. Top up credits to continue.'
          : ''
      );
    }
  }

  function closeAndRender(job) {
    rememberJob(job);
    closeDivModal();
    toast('Dividend Radar activated — your calendar is ready.', 'success');
    if (currentRoute() === 'dividend-results') {
      renderDividendResults(job);
    } else {
      window.location.hash = '#dividend-results';
    }
  }

  function submitDividend(event) {
    event.preventDefault();
    if (inFlight) return;

    if (!readToken()) {
      closeDivModal();
      openSignIn('Log in or sign up to activate the Dividend Radar.');
      return;
    }

    var list = selectedList();
    if (!list.length) {
      setFormError('Select at least one stock to continue.');
      return;
    }
    if (list.length > DIV_MAX_STOCKS) {
      setFormError('You can select up to ' + DIV_MAX_STOCKS + ' stocks.');
      return;
    }

    var cost = costFor(list.length);
    if (availableCredits !== null && availableCredits < cost) {
      var shortfall = cost - availableCredits;
      setFormError(
        'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
        ' for this radar. Top up credits to continue.'
      );
      return;
    }

    setFormError('');
    setShortfall('');
    inFlight = true;

    var button = $('#divStartBtn');
    if (button) {
      button.disabled = true;
      button.classList.add('is-busy');
      button.textContent = 'Activating your radar…';
    }

    var body = {
      radar: 'dividend',
      agent: AGENT_ID,
      duration_days: DIV_DAYS,
      alert_days_before: leadDays,
      email: accountEmail || undefined,
      stocks: list.map(function (item) {
        return {
          symbol: item.symbol,
          region: String(item.region || '').toUpperCase(),
          name: item.name,
          shares: item.shares ? Number(item.shares) : undefined
        };
      }),
      tickers: list.map(function (item) {
        return item.symbol;
      })
    };

    var headers = { 'Content-Type': 'application/json' };
    var token = readToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    fetch(START_URL, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
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
          closeDivModal();
          openSignIn('Your session expired. Log in again to activate the radar.');
          return null;
        }
        if (result.status === 402) {
          inFlight = false;
          closeDivModal();
          toast('Not enough credits for this radar. Top up to continue.', 'warn');
          var LW = window.__LW;
          if (LW && typeof LW.openTopUpModal === 'function') LW.openTopUpModal();
          else window.location.hash = '#topup';
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
          list: list,
          alertDaysBefore: leadDays,
          credits: cost
        });

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
        closeAndRender(job);
        return job;
      })
      .catch(function (err) {
        inFlight = false;
        if (button) {
          button.disabled = false;
          button.classList.remove('is-busy');
        }
        syncModalState();
        setFormError(
          (err && err.message) ||
            'Could not activate the radar. Please try again in a moment.'
        );
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
    var email =
      pick(user, ['email']) || pick(data, ['email']) || pick(body, ['email']);
    if (!email && data && data.user) email = pick(data.user, ['email']);
    return String(email || '').trim();
  }

  function loadAccount() {
    var token = readToken();
    if (!token) return;
    var headers = { Authorization: 'Bearer ' + token };
    fetch(ME_URL, { method: 'GET', headers: headers })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (body) {
        var email = emailOf(body);
        if (email) {
          accountEmail = email;
          var input = $('#divEmail');
          if (input) input.value = email;
        }
        var credits = creditsOf(body);
        if (credits !== null) {
          availableCredits = credits;
          syncModalState();
        }
      })
      .catch(function () {
        /* offline / API unavailable — the modal stays usable */
      });
  }

  function openDividendConfigModal() {
    searchQuery = '';
    inFlight = false;

    var mounted = showModal(modalHtml());
    if (!mounted) return;

    var LW = window.__LW;
    if (LW && LW.state && LW.state.credits != null) {
      availableCredits = Number(LW.state.credits);
    }

    renderRegionTabs();
    renderStockGrid();
    renderSelected();
    syncModalState();

    /* Region tabs */
    var regionTabs = $('#divRegionTabs');
    if (regionTabs) {
      regionTabs.addEventListener('click', function (event) {
        var btn = event.target.closest ? event.target.closest('[data-div-region]') : null;
        if (!btn) return;
        activeRegionId = btn.getAttribute('data-div-region') || activeRegionId;
        searchQuery = '';
        var search = $('#divStockSearch');
        if (search) search.value = '';
        renderRegionTabs();
        renderStockGrid();
      });
    }

    /* Live search */
    var search = $('#divStockSearch');
    if (search) {
      search.addEventListener('input', function () {
        searchQuery = search.value || '';
        renderStockGrid();
      });
    }

    /* Stock selection (delegated) */
    var grid = $('#divStockGrid');
    if (grid) {
      grid.addEventListener('click', function (event) {
        var card = event.target.closest ? event.target.closest('[data-div-ticker]') : null;
        if (!card) return;
        var symbol = card.getAttribute('data-div-ticker');
        if (!symbol) return;

        if (selected[symbol]) {
          delete selected[symbol];
        } else {
          if (Object.keys(selected).length >= DIV_MAX_STOCKS) {
            setFormError('You can select up to ' + DIV_MAX_STOCKS + ' stocks.');
            return;
          }
          var region = regionById(activeRegionId) || REGIONS[0];
          var found = null;
          if (region) {
            for (var i = 0; i < region.stocks.length; i += 1) {
              if (region.stocks[i].symbol === symbol) {
                found = region.stocks[i];
                break;
              }
            }
          }
          if (!found) {
            for (var r = 0; r < REGIONS.length && !found; r += 1) {
              for (var s = 0; s < REGIONS[r].stocks.length; s += 1) {
                if (REGIONS[r].stocks[s].symbol === symbol) {
                  found = REGIONS[r].stocks[s];
                  region = REGIONS[r];
                  break;
                }
              }
            }
          }
          selected[symbol] = {
            symbol: symbol,
            name: found ? found.name : '',
            tag: found ? found.tag : '',
            region: region ? region.id.toUpperCase() : '',
            regionLabel: region ? region.label : '',
            shares: 0
          };
        }

        setFormError('');
        renderStockGrid();
        renderSelected();
        syncModalState();
      });
    }

    /* Selected holdings (delegated): shares input + remove */
    var selectedWrap = $('#divSelected');
    if (selectedWrap) {
      selectedWrap.addEventListener('input', function (event) {
        var input = event.target.closest ? event.target.closest('[data-div-shares]') : null;
        if (!input) return;
        var symbol = input.getAttribute('data-div-shares');
        if (selected[symbol]) {
          selected[symbol].shares = Math.max(0, Number(input.value) || 0);
        }
      });
      selectedWrap.addEventListener('click', function (event) {
        var btn = event.target.closest ? event.target.closest('[data-div-remove]') : null;
        if (!btn) return;
        var symbol = btn.getAttribute('data-div-remove');
        if (symbol && selected[symbol]) {
          delete selected[symbol];
          renderStockGrid();
          renderSelected();
          syncModalState();
        }
      });
    }

    /* Alert lead-time pills */
    var leadPills = $('#divLeadPills');
    if (leadPills) {
      leadPills.addEventListener('click', function (event) {
        var pill = event.target.closest ? event.target.closest('[data-div-lead]') : null;
        if (!pill) return;
        leadDays = Number(pill.getAttribute('data-div-lead')) || 3;
        syncModalState();
      });
    }

    /* Submit */
    var form = $('#dividendForm');
    if (form) form.addEventListener('submit', submitDividend);

    loadAccount();
  }

  window.openDividendModal = function () {
    var now = Date.now();
    if (now - lastOpenAt < 300) return; /* de-dupe app.js + delegated binding */
    lastOpenAt = now;
    openDividendConfigModal();
  };

  /* ======================= E. JOB NORMALISATION ========================== */

  function normalizeRows(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map(function (row) {
        if (!row || typeof row !== 'object') return null;
        var ticker = String(
          pick(row, ['symbol', 'ticker', 'code', 'stock']) || ''
        ).trim();
        if (!ticker) return null;
        return {
          ticker: ticker,
          name: String(pick(row, ['name', 'company', 'company_name']) || ''),
          region: String(pick(row, ['region', 'market', 'exchange']) || '').toUpperCase(),
          shares: num(pick(row, ['shares', 'qty', 'quantity'])),
          price: num(pick(row, ['price', 'last_price', 'close'])),
          ttmYield: num(pick(row, ['ttm_yield', 'yield', 'dividend_yield'])),
          nextExDate: String(pick(row, ['next_ex_date', 'ex_date', 'ex_dividend_date']) || ''),
          paymentDate: String(pick(row, ['payment_date', 'pay_date']) || ''),
          divPerShare: num(pick(row, ['div_per_share', 'dividend_per_share', 'dps'])),
          estPayout: num(pick(row, ['est_payout', 'estimated_payout', 'payout'])),
          source: String(pick(row, ['source', 'data_source']) || 'Yahoo Finance')
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
      pick(jobRaw, ['calendar', 'rows', 'holdings', 'stocks', 'results'], [])
    );

    if (!rows.length && Array.isArray(base.list)) {
      rows = base.list.map(function (item) {
        return {
          ticker: item.symbol,
          name: item.name || '',
          region: String(item.region || '').toUpperCase(),
          shares: item.shares ? Number(item.shares) : null,
          price: null,
          ttmYield: null,
          nextExDate: '',
          paymentDate: '',
          divPerShare: null,
          estPayout: null,
          source: 'Yahoo Finance'
        };
      });
    }

    var duration = num(pick(jobRaw, ['duration_days', 'days', 'total_days'])) || DIV_DAYS;
    var credits =
      num(pick(jobRaw, ['credits_spent', 'creditsSpent', 'credits', 'credits_used'])) ||
      base.credits ||
      costFor(rows.length);

    var expiresAt = String(pick(jobRaw, ['expires_at', 'expiresAt', 'end_date']) || '');
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
      statusRaw === 'completed' || statusRaw === 'expired' || daysLeft === 0
        ? 'completed'
        : 'active';

    var upcoming = num(pick(jobRaw, ['confirmed_upcoming_count', 'upcoming_count']));
    if (upcoming === null) {
      upcoming = rows.filter(function (row) {
        return !!row.nextExDate;
      }).length;
    }
    var nextRow =
      rows.filter(function (row) {
        return !!row.nextExDate;
      })[0] || null;

    return {
      job_id: String(pick(jobRaw, ['radar_id', 'job_id', 'id']) || ''),
      display_id: String(pick(jobRaw, ['display_id', 'displayId', 'public_id']) || ''),
      rows: rows,
      stocksCount:
        num(pick(jobRaw, ['stocks_count', 'holdings_count'])) ||
        rows.length ||
        1,
      confirmedUpcoming: upcoming,
      nextExCallout:
        String(pick(jobRaw, ['next_ex_date_summary', 'next_ex_callout']) || '') ||
        (nextRow ? nextRow.ticker + ' · ' + nextRow.nextExDate : ''),
      alertDaysBefore:
        num(pick(jobRaw, ['alert_days_before', 'lead_days'])) ||
        base.alertDaysBefore ||
        3,
      dataSources: String(
        pick(jobRaw, ['data_sources', 'sources']) || 'Yahoo Finance · Bursa · SGX'
      ),
      downloadUrl: String(pick(jobRaw, ['download_url', 'xlsx_url']) || ''),
      credits: credits,
      status: status,
      created: startedAt,
      expiresAt: expiresAt,
      durationDays: duration,
      daysLeft: daysLeft,
      percent: Math.max(0, Math.min(100, (daysLeft / duration) * 100)),
      email: String(pick(jobRaw, ['email']) || accountEmail || '')
    };
  }

  /* ================== F. RESULTS — renderDividendResults() ================ */

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
    var key = job.job_id || job.display_id || divRef(job);
    list = list.filter(function (item) {
      var itemKey = item && (item.job_id || item.display_id || divRef(item));
      return itemKey !== key;
    });
    list.unshift(job);
    writeJSON(JOBS_KEY, list.slice(0, 25));
    dividerCache = list.slice(0, 25);
  }

  function summaryRow(label, valueHtml) {
    return '<div class="summary-row"><dt>' + esc(label) + '</dt><dd>' + valueHtml + '</dd></div>';
  }

  function renderRowsTable(job) {
    var table = $('#divTable');
    if (!table) return;
    var tbody = table.querySelector('tbody');
    if (!tbody) return;

    if (!job.rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="8" class="empty-note">Your 12-month calendar is being prepared. ' +
        'Next Ex-Dates will appear here and in your emailed .xlsx.</td></tr>';
      return;
    }

    tbody.innerHTML = job.rows
      .map(function (row) {
        return (
          '<tr>' +
          '<td><strong>' + esc(row.ticker) + '</strong>' +
          (row.name ? '<br><span class="fine">' + esc(row.name) + '</span>' : '') +
          '</td>' +
          '<td>' + esc(formatNumber(row.price)) + '</td>' +
          '<td>' + esc(formatPercent(row.ttmYield)) + '</td>' +
          '<td>' + esc(row.nextExDate || '—') + '</td>' +
          '<td>' + esc(row.paymentDate || '—') + '</td>' +
          '<td>' + esc(formatNumber(row.divPerShare)) + '</td>' +
          '<td>' + esc(formatNumber(row.estPayout)) + '</td>' +
          '<td>' + esc(row.source || '—') + '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function wireDownloadButton() {
    var btn = $('#divDownloadBtn');
    if (!btn || btn.getAttribute('data-div-bound') === '1') return;
    btn.setAttribute('data-div-bound', '1');
    btn.addEventListener('click', function () {
      downloadDividendCalendar();
    });
  }

  function renderDividendResults(data) {
    var view = $('#view-dividend-results');
    if (!view) return;

    var job =
      data && typeof data === 'object'
        ? normalizeJob(
            data.data && data.data.job ? data.data.job : data.data && data.data.radar ? data.data.radar : data
          )
        : currentJob();

    var empty = $('#dividendEmpty');
    var main = $('#dividendMain');

    if (!job) {
      if (empty) empty.hidden = false;
      if (main) main.hidden = true;
      return;
    }

    if (empty) empty.hidden = true;
    if (main) main.hidden = false;

    var statusText =
      job.status === 'active'
        ? 'Active · ' + job.durationDays + ' days'
        : 'Completed · ' + formatDate(job.expiresAt);

    var headerId = $('#divHeaderId');
    if (headerId) headerId.textContent = divRef(job);

    var headerStatus = $('#divHeaderStatus');
    if (headerStatus) {
      headerStatus.textContent = statusText;
      headerStatus.className = 'hist-badge ' + (job.status === 'active' ? 'ok' : 'muted');
    }

    var statusBadge = $('#divStatusBadge');
    if (statusBadge) {
      statusBadge.classList.toggle('is-ok', job.status === 'active');
      var badgeText = statusBadge.querySelector('.webhook-text');
      if (badgeText) {
        badgeText.textContent =
          job.status === 'active'
            ? 'Active · ' + job.durationDays + ' days · Ex-Date Alerts On'
            : 'Completed · ' + formatDate(job.expiresAt);
      }
    }

    var ringCount = $('#divRingCount');
    if (ringCount) ringCount.textContent = String(job.confirmedUpcoming || 0);
    var ringLabel = $('#divRingLabel');
    if (ringLabel) ringLabel.textContent = 'Upcoming Ex-Dates';

    var ringFill = $('#divRingFill');
    if (ringFill) {
      var circumference = 364.42;
      var pct = Math.max(2, Math.min(100, Number(job.percent) || 2));
      ringFill.style.strokeDasharray = String(circumference);
      ringFill.style.strokeDashoffset = String(circumference * (1 - pct / 100));
    }

    var ringCard = $('#divRingCard');
    if (ringCard) {
      ringCard.classList.toggle('is-complete', job.status === 'active');
      ringCard.classList.toggle('is-warning', job.status !== 'active');
    }

    var emailNote = $('#divEmailNote');
    if (emailNote && job.email) {
      emailNote.textContent =
        'Ex-Date reminders are emailed to ' + job.email + ' before each upcoming Ex-Dividend Date.';
    }

    var meta = $('#divJobMeta');
    if (meta) {
      meta.textContent =
        job.stocksCount +
        ' stock' + (job.stocksCount === 1 ? '' : 's') + ' · ' +
        job.durationDays + '-day radar · ' + job.daysLeft + ' / ' + job.durationDays +
        ' days left';
    }

    var summary = $('#divJobSummary');
    if (summary) {
      summary.innerHTML =
        summaryRow('Radar ID', '<code>' + esc(divRef(job)) + '</code>') +
        summaryRow('Stocks', '<strong>' + esc(job.stocksCount) + '</strong>') +
        summaryRow('Alert Lead Time', '<strong>' + esc(job.alertDaysBefore) + ' day' +
          (Number(job.alertDaysBefore) === 1 ? '' : 's') + ' before</strong>') +
        summaryRow('Active Until', '<strong>' + esc(formatDate(job.expiresAt)) + '</strong>') +
        summaryRow('Credits Used', '<strong>' + esc(job.credits) + ' credit' +
          (Number(job.credits) === 1 ? '' : 's') + '</strong>') +
        summaryRow('Data Sources', esc(job.dataSources));
    }

    var previewPill = $('#divPreviewPill');
    if (previewPill) {
      previewPill.textContent = job.stocksCount + ' stock' + (job.stocksCount === 1 ? '' : 's');
    }
    var tableMeta = $('#divTableMeta');
    if (tableMeta) {
      tableMeta.textContent = job.confirmedUpcoming
        ? job.confirmedUpcoming + ' upcoming Ex-Date' + (job.confirmedUpcoming === 1 ? '' : 's') +
          ' · ' + job.nextExCallout
        : 'Next Ex-Dates, payment schedules & estimated cash payouts';
    }

    renderRowsTable(job);
    wireDownloadButton();
  }

  window.renderDividendResults = renderDividendResults;

  /* ====================== G. DOWNLOAD — .xlsx ============================= */

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

  function downloadDividendCalendar(jobId, displayId) {
    var now = Date.now();
    if (downloadInFlight || now - lastDownloadAt < 1000) return;
    lastDownloadAt = now;

    var job = currentJob();
    var id = String(jobId || (job && (job.job_id || job.id)) || '');
    var disp = String(displayId || (job && job.display_id) || '');
    var token = readToken();

    if (!token) {
      openSignIn('Log in again to download your Dividend Calendar.');
      return;
    }
    if (!id && !disp) {
      toast('Open a Dividend Radar first, then download its calendar.', 'warn');
      return;
    }

    var url = DOWNLOAD_URL + '?job_id=' + encodeURIComponent(id || disp);
    if (disp && id) url += '&display_id=' + encodeURIComponent(disp);

    downloadInFlight = true;
    toast('Preparing your Dividend Calendar…', 'info');

    fetch(url, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token }
    })
      .then(function (response) {
        if (response.status === 401) {
          downloadInFlight = false;
          openSignIn('Your session expired. Log in again to download the calendar.');
          return null;
        }
        if (response.status === 402) {
          downloadInFlight = false;
          toast('Insufficient credits for this download.', 'warn');
          return null;
        }
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        var disposition = response.headers.get('content-disposition');
        return response.blob().then(function (blob) {
          return { blob: blob, name: filenameFromDisposition(disposition, '') };
        });
      })
      .then(function (result) {
        downloadInFlight = false;
        if (!result) return;
        var name =
          result.name ||
          'Dividend-Calendar-' + divRef(job) + '.xlsx';
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
        toast('Dividend Calendar downloaded.', 'success');
      })
      .catch(function (err) {
        downloadInFlight = false;
        toast(
          (err && err.message) || 'Could not download the calendar. Please try again.',
          'warn'
        );
      });
  }

  window.downloadDividendCalendar = downloadDividendCalendar;

  /* ============ H. HISTORY — open a radar from My Activity =============== */

  function findCachedJob(ref) {
    var list = dividerCache.length ? dividerCache : readJSON(JOBS_KEY);
    if (!Array.isArray(list)) list = [];
    var key = String(ref || '');
    for (var i = 0; i < list.length; i += 1) {
      var job = list[i];
      if (!job) continue;
      var candidates = [job.job_id, job.display_id, job.id, divRef(job)];
      for (var c = 0; c < candidates.length; c += 1) {
        if (candidates[c] && String(candidates[c]) === key) return job;
      }
    }
    return null;
  }

  function extractDividendJobs(body) {
    if (!body || typeof body !== 'object') return [];
    var source =
      body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : body;
    var raw = Array.isArray(source.dividend_radar) ? source.dividend_radar : [];
    return raw.map(function (item) {
      return normalizeJob(item);
    });
  }

  function openDividendHistoryJob(ref) {
    var key = String(ref || '').trim();
    var cached = key ? findCachedJob(key) : null;
    if (cached) {
      rememberJob(cached);
      if (currentRoute() === 'dividend-results') renderDividendResults(cached);
      else window.location.hash = '#dividend-results';
      return;
    }

    var job = currentJob();
    if (job) {
      rememberJob(job);
      if (currentRoute() === 'dividend-results') renderDividendResults(job);
      else window.location.hash = '#dividend-results';
    } else {
      window.location.hash = '#dividend-results';
    }

    var token = readToken();
    if (!token || !key) return;
    fetch(HISTORY_URL, { method: 'GET', headers: { Authorization: 'Bearer ' + token } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (body) {
        var jobs = extractDividendJobs(body);
        var match = null;
        for (var i = 0; i < jobs.length; i += 1) {
          var item = jobs[i];
          if (
            String(item.job_id) === key ||
            String(item.display_id) === key ||
            divRef(item) === key
          ) {
            match = item;
            break;
          }
        }
        if (match) {
          rememberJob(match);
          renderDividendResults(match);
        }
      })
      .catch(function () {
        /* keep the cached/current radar on screen */
      });
  }

  window.openDividendHistoryJob = openDividendHistoryJob;

  /* ======================= I. ROUTING & LISTENERS ======================== */

  function currentRoute() {
    return String(window.location.hash || '')
      .replace(/^#\/?/, '')
      .split('?')[0]
      .toLowerCase();
  }

  function delegatedClick(event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    /* Belt-and-suspenders: the #dividendAgentCard CTA always opens the modal,
       even if app.js' binding never ran (e.g. script order / hot reload). */
    var card = target.closest('#dividendAgentCard');
    if (card && (target.closest('[data-open-dividend]') || target.closest('.btn-subscribe'))) {
      event.preventDefault();
      window.openDividendModal();
      return;
    }

    var historyRetry = target.closest('[data-div-history-retry]');
    if (historyRetry) {
      event.preventDefault();
      renderDividendResults();
    }
  }

  function onRoute() {
    if (currentRoute() === 'dividend-results') renderDividendResults();
  }

  function init() {
    if (Array.isArray(readJSON(JOBS_KEY))) dividerCache = readJSON(JOBS_KEY);
    document.addEventListener('click', delegatedClick, false);
    window.addEventListener('hashchange', onRoute, false);
    /* Make sure the current radar renders if the page is deep-linked. */
    onRoute();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
