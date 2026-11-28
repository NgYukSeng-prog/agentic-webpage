/* ============================================================================
   LiteWork — Worker #12 · Packaging & Shelf QC Sentinel
   ----------------------------------------------------------------------------
   Standalone vanilla JS module. Loaded with <script defer> AFTER app.js, so it
   never bloats app.js. It owns everything for the PQC-#### worker:

     · window.openPackagingQcModal()      — master + photos + focus config
     · window.renderPackagingQcResults()  — full-page #view-packaging-results
     · window.downloadPackagingQc()       — Bearer-auth .xlsx download
     · window.renderPackagingQcHistory()  — #plans "Packaging QC" pane
     · window.openPackagingQcHistoryJob() — open an audit from My Activity

   Reuses the canonical LiteWork modal classes (calc-card / inv-drop /
   inv-filelist / lead-mode-pill / btn-activate) and results classes
   (scraper-grid, ring-card, panel.job-card, summary-grid.compact,
   download-bar) with the shared hist-badge PASS / WARNING / FAIL tones.
   ========================================================================== */
(function () {
  'use strict';

  /* ======================= A. CONFIG / CONSTANTS ========================== */

  var CFG = window.CONFIG || {};
  var API_BASE = String(
    CFG.API_BASE || 'https://n8n.20.205.96.122.sslip.io/webhook'
  ).replace(/\/+$/, '');
  var TOKEN_KEY = CFG.AUTH_TOKEN_KEY || 'aaas_token';

  var AGENT_ID = CFG.PACKAGING_QC_AGENT_ID || 'packaging-qc';
  var AGENT_NAME = CFG.PACKAGING_QC_AGENT_NAME || 'Packaging & Shelf QC Sentinel';

  var START_URL = String(CFG.packagingQcStartUrl || API_BASE + '/packaging-qc-start');
  var DOWNLOAD_URL = String(
    CFG.packagingQcDownloadUrl || API_BASE + '/download-packaging-qc'
  );
  var HISTORY_URL = API_BASE + '/account/history';
  var ME_URL = API_BASE + '/auth/me';

  var MAX_PHOTOS =
    Number(CFG.PACKAGING_QC_MAX_PHOTOS) > 0 ? Number(CFG.PACKAGING_QC_MAX_PHOTOS) : 10;
  var MAX_FILE_BYTES = 25 * 1024 * 1024;

  var JOB_KEY = 'lw_packaging_job_v1';
  var JOBS_KEY = 'lw_packaging_jobs_v1';

  var ACCEPT = '.png,.jpg,.jpeg,.webp,.pdf';
  var ALLOWED_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'pdf'];
  var IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp'];

  var FOCUS = [
    { id: 'brand', label: 'Brand & Logo' },
    { id: 'weight', label: 'Net Weight / Volume' },
    { id: 'halal', label: 'Halal / Organic / MESTI Badges' },
    { id: 'barcode', label: 'Barcode Visibility' },
    { id: 'sticker', label: 'Sticker / Obstruction' },
    { id: 'ingredients', label: 'Ingredients & Expiry' }
  ];

  var COLUMNS = ['Photo', 'Inspection Check', 'Result', 'Finding', 'Action'];

  /* ============================ B. STATE ================================= */

  var master = null; /* { file, name, size, type, preview } */
  var photos = [];
  var focus = FOCUS.map(function (item) {
    return item.id;
  });
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

  function pqcRef(job) {
    if (!job) return 'PQC-1001';
    var raw = String(
      job.display_id || job.displayId || job.public_id || job.job_id || job.id || ''
    );
    var match = raw.match(/PQC[-\s]?0*(\d+)/i);
    if (match) return 'PQC-' + pad4(match[1]);
    if (/^\d+$/.test(raw)) return 'PQC-' + pad4(raw);
    var digits = raw.replace(/\D/g, '');
    if (digits) return 'PQC-' + pad4(digits.slice(-4));
    var sum = 0;
    for (var i = 0; i < raw.length; i += 1) {
      sum = (sum * 31 + raw.charCodeAt(i)) % 10000;
    }
    return 'PQC-' + pad4(String(1001 + (sum % 8999)));
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

  function formatBytes(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
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

  function creditsFor(count) {
    var n = Number(count) || 0;
    if (!n) return 0;
    return n > 5 ? 8 : 5;
  }

  function tierLabel(count) {
    var n = Number(count) || 0;
    if (!n) return 'No photos';
    return n > 5 ? '6–10 photos · 8 credits' : '1–5 photos · 5 credits';
  }

  function extOf(name) {
    var m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  function isImage(name) {
    return IMAGE_EXTS.indexOf(extOf(name)) !== -1;
  }

  function focusLabels(ids) {
    var list = Array.isArray(ids) ? ids : String(ids || '').split(/[,\s|]+/);
    var labels = [];
    for (var i = 0; i < FOCUS.length; i += 1) {
      if (list.indexOf(FOCUS[i].id) !== -1) labels.push(FOCUS[i].label);
    }
    return labels;
  }

  function currentRoute() {
    return String(window.location.hash || '')
      .replace(/^#\/?/, '')
      .split('?')[0]
      .toLowerCase();
  }

  /* ==================== D. MODAL — openPackagingQcModal() ================ */

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
    toast(message || 'Log in or sign up to launch Packaging QC.', 'warn');
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

  function focusPillHtml(item) {
    var on = focus.indexOf(item.id) !== -1;
    return (
      '<button type="button" class="lead-mode-pill' + (on ? ' is-active' : '') + '"' +
      ' data-pqc-focus="' + esc(item.id) + '" role="checkbox" aria-checked="' +
      (on ? 'true' : 'false') + '">' +
      '<span class="lead-mode-title">' + esc(item.label) + '</span>' +
      '<span class="lead-mode-note">' + (on ? 'Included in audit' : 'Skipped') + '</span>' +
      '</button>'
    );
  }

  function modalHtml() {
    return (
      '<h2 class="modal-title" id="modalTitle">' + esc(AGENT_NAME) + '</h2>' +
      '<p class="modal-sub">Compare master artwork with supplier proofs / shelf photos · ' +
      '5 credits (1–5 photos) · 8 credits (6–10 photos)</p>' +
      '<div class="calc-card modal-calc"><div class="calc-grid">' +
      '<div class="calc-cell"><span class="calc-label">Available</span>' +
      '<span class="calc-value" id="pqcAvailable">— Credits</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Photos selected</span>' +
      '<span class="calc-value" id="pqcPhotoCount">0 / ' + MAX_PHOTOS + '</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Inspection focus</span>' +
      '<span class="calc-value" id="pqcFocusCount">' + FOCUS.length + ' checks</span></div>' +
      '<div class="calc-cell calc-cell-total"><span class="calc-label">Total cost</span>' +
      '<span class="calc-value" id="pqcCost">0 Credits</span>' +
      '<span class="calc-sub" id="pqcAfterRun"></span></div>' +
      '</div></div>' +
      '<form class="invoice-form" id="pqcForm" novalidate>' +
      '<div class="modal-section"><h3>1. Reference master artwork</h3>' +
      '<span class="fine">1 file · PNG / JPG / WEBP / PDF</span></div>' +
      '<label class="inv-drop" id="pqcMasterDrop" for="pqcMasterInput">' +
      '<span class="inv-drop-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#6366F1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 16V5" /><path d="m7 10 5-5 5 5" />' +
      '<path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />' +
      '</svg></span>' +
      '<strong>Drop the approved master artwork</strong>' +
      '<span class="inv-drop-sub">or click to browse · 1 file · max ' +
      Math.round(MAX_FILE_BYTES / 1048576) + ' MB</span>' +
      '<span class="inv-drop-types">PNG · JPG · WEBP · PDF</span>' +
      '</label>' +
      '<input type="file" id="pqcMasterInput" class="inv-file-input" accept="' +
      esc(ACCEPT) + '" />' +
      '<ul class="inv-filelist" id="pqcMasterList"></ul>' +
      '<div class="modal-section"><h3>2. Inspection / shelf photos</h3>' +
      '<span class="fine">1–' + MAX_PHOTOS + ' files · supplier proofs or retail shelf shots</span></div>' +
      '<label class="inv-drop" id="pqcPhotoDrop" for="pqcPhotoInput">' +
      '<span class="inv-drop-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#6366F1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 16V5" /><path d="m7 10 5-5 5 5" />' +
      '<path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />' +
      '</svg></span>' +
      '<strong>Drag & drop inspection photos</strong>' +
      '<span class="inv-drop-sub">or click to browse · up to ' + MAX_PHOTOS +
      ' files · max ' + Math.round(MAX_FILE_BYTES / 1048576) + ' MB each</span>' +
      '<span class="inv-drop-types">PNG · JPG · WEBP · PDF</span>' +
      '<span class="inv-drop-tip">Use clear, well-lit photos of the front, back and any stickers so badges, weights and barcodes stay visible.</span>' +
      '</label>' +
      '<input type="file" id="pqcPhotoInput" class="inv-file-input" accept="' +
      esc(ACCEPT) + '" multiple />' +
      '<div class="stock-chips" id="pqcPhotoChips"></div>' +
      '<div class="modal-section"><h3>3. Inspection focus</h3>' +
      '<span class="fine">Toggle any check off to skip it</span></div>' +
      '<div class="lead-mode" id="pqcFocusGroup" role="group" aria-label="Inspection focus">' +
      FOCUS.map(focusPillHtml).join('') +
      '</div>' +
      '<div class="modal-section"><h3>4. Delivery details</h3>' +
      '<span class="fine">Email only</span></div>' +
      '<div class="field"><label for="pqcEmail">Delivery email</label>' +
      '<input type="email" id="pqcEmail" class="is-locked" value="' + esc(accountEmail) + '" ' +
      'placeholder="Loading your account email…" disabled tabindex="-1" /></div>' +
      '<div class="modal-actions">' +
      '<div class="scraper-modal-error" id="pqcFormError" role="alert"></div>' +
      '<p class="scraper-shortfall" id="pqcShortfall" hidden></p>' +
      '<button type="submit" class="btn btn-activate" id="pqcStartBtn" disabled>' +
      'Run Packaging QC Audit</button>' +
      '<p class="fine">Credits are deducted immediately. Your QC Report (.xlsx) is emailed and downloadable — safe to close this tab.</p>' +
      '</div>' +
      '</form>'
    );
  }

  function setFormError(message) {
    var el = $('#pqcFormError');
    if (el) el.textContent = message || '';
  }

  function setShortfall(message) {
    var el = $('#pqcShortfall');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }

  function renderMaster() {
    var list = $('#pqcMasterList');
    if (!list) return;
    if (!master) {
      list.innerHTML =
        '<li class="inv-file-empty">No master artwork selected yet — add 1 approved artwork file.</li>';
      updateQuote();
      return;
    }
    var ext = extOf(master.name).toUpperCase() || 'FILE';
    var thumb =
      master.preview && isImage(master.name)
        ? '<img src="' + esc(master.preview) + '" alt="" ' +
          'style="width:38px;height:38px;border-radius:8px;object-fit:cover;flex:0 0 auto" />'
        : '';
    list.innerHTML =
      '<li class="inv-file-row">' +
      thumb +
      '<span class="inv-file-badge">' + esc(ext) + '</span>' +
      '<span class="inv-file-meta"><strong>' + esc(master.name) + '</strong>' +
      '<span>' + esc(formatBytes(master.size)) + ' · Reference master</span></span>' +
      '<button type="button" class="inv-file-remove" data-pqc-master-remove="1" ' +
      'aria-label="Remove ' + esc(master.name) + '">×</button>' +
      '</li>';
    updateQuote();
  }

  function renderPhotos() {
    var wrap = $('#pqcPhotoChips');
    if (wrap) {
      wrap.innerHTML = photos.length
        ? photos
            .map(function (entry, index) {
              return (
                '<span class="stock-chip">' + esc(entry.name) +
                '<button type="button" class="stock-chip-x" data-pqc-remove="' + index +
                '" aria-label="Remove ' + esc(entry.name) + '">×</button></span>'
              );
            })
            .join('')
        : '<span class="stock-chips-empty">No inspection photos yet — add 1–' +
          MAX_PHOTOS + ' files.</span>';
    }
    updateQuote();
  }

  function readPreview(file, callback) {
    if (!file || !isImage(file.name) || typeof FileReader === 'undefined') {
      callback('');
      return;
    }
    try {
      var reader = new FileReader();
      reader.onload = function () {
        callback(String(reader.result || ''));
      };
      reader.onerror = function () {
        callback('');
      };
      reader.readAsDataURL(file);
    } catch (err) {
      callback('');
    }
  }

  function setMaster(file) {
    if (!file) return;
    var ext = extOf(file.name);
    if (ALLOWED_EXTS.indexOf(ext) === -1) {
      setFormError(file.name + ' is not a supported artwork type.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFormError(file.name + ' is larger than ' + Math.round(MAX_FILE_BYTES / 1048576) + ' MB.');
      return;
    }
    master = { file: file, name: file.name, size: file.size, type: file.type || '', preview: '' };
    setFormError('');
    renderMaster();
    readPreview(file, function (dataUrl) {
      if (master && master.file === file) {
        master.preview = dataUrl;
        renderMaster();
      }
    });
  }

  function addPhotos(fileList) {
    var incoming = Array.prototype.slice.call(fileList || []);
    if (!incoming.length) return;
    var errors = [];

    incoming.forEach(function (file) {
      if (photos.length >= MAX_PHOTOS) {
        errors.push('Maximum ' + MAX_PHOTOS + ' inspection photos per run.');
        return;
      }
      var ext = extOf(file.name);
      if (ALLOWED_EXTS.indexOf(ext) === -1) {
        errors.push(file.name + ' is not a supported photo type.');
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        errors.push(file.name + ' is larger than ' + Math.round(MAX_FILE_BYTES / 1048576) + ' MB.');
        return;
      }
      var duplicate = photos.some(function (entry) {
        return entry.name === file.name && entry.size === file.size;
      });
      if (duplicate) {
        errors.push(file.name + ' is already queued.');
        return;
      }
      photos.push({ name: file.name, size: file.size, type: file.type || '', file: file });
    });

    setFormError(errors.join(' '));
    renderPhotos();
  }

  function updateQuote() {
    var count = photos.length;
    var cost = creditsFor(count);
    var setText = function (selector, text) {
      var el = $(selector);
      if (el) el.textContent = text;
    };

    setText('#pqcAvailable', (availableCredits === null ? '—' : availableCredits) + ' Credits');
    setText('#pqcPhotoCount', count + ' / ' + MAX_PHOTOS);
    setText('#pqcFocusCount', focus.length + ' check' + (focus.length === 1 ? '' : 's'));
    setText('#pqcCost', cost + ' Credits');
    setText(
      '#pqcAfterRun',
      availableCredits === null || !count
        ? ''
        : 'After run: ' + Math.max(0, availableCredits - cost) + ' credits'
    );

    var shortfall = availableCredits !== null && count ? cost - availableCredits : 0;
    setShortfall(
      shortfall > 0
        ? 'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
          ' for this audit. Top up credits to continue.'
        : ''
    );

    var btn = $('#pqcStartBtn');
    if (btn && !inFlight) {
      btn.textContent = count
        ? 'Confirm & Spend ' + cost + ' Credits · Inspect ' + count + ' Photos'
        : 'Run Packaging QC Audit';
      btn.disabled = !master || !count || !focus.length || shortfall > 0;
    }
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
          var input = $('#pqcEmail');
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

  function wireDropzone(dropEl, inputEl, handler) {
    if (!dropEl || !inputEl) return;
    ['dragenter', 'dragover'].forEach(function (evt) {
      dropEl.addEventListener(evt, function (event) {
        event.preventDefault();
        dropEl.classList.add('is-drag');
      });
    });
    ['dragleave', 'dragend'].forEach(function (evt) {
      dropEl.addEventListener(evt, function () {
        dropEl.classList.remove('is-drag');
      });
    });
    dropEl.addEventListener('drop', function (event) {
      event.preventDefault();
      dropEl.classList.remove('is-drag');
      if (event.dataTransfer && event.dataTransfer.files) handler(event.dataTransfer.files);
    });
    inputEl.addEventListener('change', function () {
      handler(inputEl.files);
      inputEl.value = '';
    });
  }

  function openPackagingConfigModal() {
    master = null;
    photos = [];
    focus = FOCUS.map(function (item) {
      return item.id;
    });
    inFlight = false;

    var mounted = showModal(modalHtml());
    if (!mounted) return;

    var LW = window.__LW;
    if (LW && LW.state && LW.state.credits != null) {
      availableCredits = Number(LW.state.credits);
    }

    wireDropzone($('#pqcMasterDrop'), $('#pqcMasterInput'), function (fileList) {
      var list = Array.prototype.slice.call(fileList || []);
      if (list.length) setMaster(list[0]);
    });
    wireDropzone($('#pqcPhotoDrop'), $('#pqcPhotoInput'), addPhotos);

    var masterList = $('#pqcMasterList');
    if (masterList) {
      masterList.addEventListener('click', function (event) {
        var btn = event.target.closest ? event.target.closest('[data-pqc-master-remove]') : null;
        if (!btn) return;
        master = null;
        setFormError('');
        renderMaster();
      });
    }

    var chips = $('#pqcPhotoChips');
    if (chips) {
      chips.addEventListener('click', function (event) {
        var btn = event.target.closest ? event.target.closest('[data-pqc-remove]') : null;
        if (!btn) return;
        var index = Number(btn.getAttribute('data-pqc-remove'));
        if (Number.isFinite(index)) {
          photos.splice(index, 1);
          setFormError('');
          renderPhotos();
        }
      });
    }

    var focusGroup = $('#pqcFocusGroup');
    if (focusGroup) {
      focusGroup.addEventListener('click', function (event) {
        var pill = event.target.closest ? event.target.closest('[data-pqc-focus]') : null;
        if (!pill) return;
        var id = pill.getAttribute('data-pqc-focus');
        var index = focus.indexOf(id);
        if (index === -1) focus.push(id);
        else focus.splice(index, 1);
        var on = focus.indexOf(id) !== -1;
        pill.classList.toggle('is-active', on);
        pill.setAttribute('aria-checked', on ? 'true' : 'false');
        var note = pill.querySelector('.lead-mode-note');
        if (note) note.textContent = on ? 'Included in audit' : 'Skipped';
        updateQuote();
      });
    }

    var form = $('#pqcForm');
    if (form) form.addEventListener('submit', submitAudit);

    renderMaster();
    renderPhotos();
    loadAccount();
  }

  window.openPackagingQcModal = function () {
    var now = Date.now();
    if (now - lastOpenAt < 300) return;
    lastOpenAt = now;

    if (!readToken()) {
      openSignIn('Log in or sign up to launch Packaging QC.');
      waitForToken(function () {
        window.openPackagingQcModal();
      });
      return;
    }
    openPackagingConfigModal();
  };

  function submitAudit(event) {
    event.preventDefault();
    if (inFlight) return;

    if (!readToken()) {
      closeModal();
      openSignIn('Your session expired. Log in again to launch Packaging QC.');
      return;
    }
    if (!master) {
      setFormError('Add the reference master artwork to continue.');
      return;
    }
    if (!photos.length) {
      setFormError('Add at least one inspection photo to continue.');
      return;
    }
    if (!focus.length) {
      setFormError('Select at least one inspection focus check.');
      return;
    }

    var cost = creditsFor(photos.length);
    if (availableCredits !== null && availableCredits < cost) {
      setFormError(
        'You need ' + (cost - availableCredits) + ' more credit' +
        (cost - availableCredits === 1 ? '' : 's') + ' for this audit.'
      );
      return;
    }

    setFormError('');
    setShortfall('');
    inFlight = true;

    var button = $('#pqcStartBtn');
    if (button) {
      button.disabled = true;
      button.classList.add('is-busy');
      button.textContent = 'Running packaging QC…';
    }

    var formData = new FormData();
    formData.append('email', accountEmail || '');
    formData.append('focus', JSON.stringify(focus));
    formData.append('photo_count', String(photos.length));
    formData.append('credits', String(cost));
    formData.append('master', master.file, master.name);
    photos.forEach(function (entry) {
      formData.append('photos', entry.file, entry.name);
    });

    fetch(START_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + readToken() },
      body: formData
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
          openSignIn('Your session expired. Log in again to launch Packaging QC.');
          return null;
        }
        if (result.status === 402) {
          inFlight = false;
          setFormError(
            (result.body && (result.body.error || result.body.message)) ||
              'Not enough credits for this audit. Top up credits to continue.'
          );
          if (button) {
            button.disabled = false;
            button.classList.remove('is-busy');
          }
          updateQuote();
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
            : result.body.data && result.body.data.audit
            ? result.body.data.audit
            : result.body;

        var job = normalizeJob(raw, {
          photos: photos.length,
          credits: cost,
          focus: focus.slice(),
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
          'Packaging QC started — ' + photos.length + ' photo' +
          (photos.length === 1 ? '' : 's') + ' queued.',
          'success'
        );

        if (currentRoute() === 'packaging-results') {
          renderPackagingQcResults(job);
        } else {
          window.location.hash = '#packaging-results';
        }
        return job;
      })
      .catch(function (err) {
        inFlight = false;
        if (button) {
          button.disabled = false;
          button.classList.remove('is-busy');
        }
        setFormError(
          (err && err.message) ||
            'Could not start the packaging audit. Please try again in a moment.'
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

  function resultTone(result) {
    var value = String(result || '').toLowerCase();
    if (value === 'fail' || value === 'failed') return 'bad';
    if (value === 'warning' || value === 'warn' || value === 'review') return 'warn';
    return 'ok';
  }

  function normalizeRows(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map(function (row) {
        if (!row || typeof row !== 'object') return null;
        var photo = String(pick(row, ['photo', 'file', 'image', 'source', 'photo_name']) || '');
        var check = String(pick(row, ['check', 'focus', 'criterion', 'item']) || '');
        if (!photo && !check) return null;
        var result = String(pick(row, ['result', 'status', 'verdict']) || 'PASS').toUpperCase();
        return {
          photo: photo || '—',
          check: check || '—',
          result: result,
          finding: String(pick(row, ['finding', 'detail', 'message', 'issue', 'note']) || '—'),
          action: String(pick(row, ['action', 'recommendation', 'fix', 'next_step']) || '—')
        };
      })
      .filter(function (row) {
        return !!row;
      });
  }

  function normalizeJob(raw, fallback) {
    var jobRaw = raw && typeof raw === 'object' ? raw : {};
    var base = fallback || {};

    var photosRaw = pick(
      jobRaw,
      ['photo_count', 'photos_count', 'files_count', 'total_files', 'photos'],
      0
    );
    var photoCount =
      Array.isArray(photosRaw) ? photosRaw.length : Number(photosRaw) || base.photos || 0;

    var rows = normalizeRows(
      pick(jobRaw, ['findings', 'rows', 'results', 'checks', 'defects', 'items'], [])
    );

    var passCount = num(pick(jobRaw, ['passed', 'checks_passed', 'pass_count']));
    if (passCount === null) {
      passCount = rows.filter(function (row) {
        return resultTone(row.result) === 'ok';
      }).length;
    }
    var failCount = num(pick(jobRaw, ['failed', 'fail_count', 'failures']));
    if (failCount === null) {
      failCount = rows.filter(function (row) {
        return resultTone(row.result) === 'bad';
      }).length;
    }
    var warnCount = num(pick(jobRaw, ['warnings', 'warning_count']));
    if (warnCount === null) {
      warnCount = rows.filter(function (row) {
        return resultTone(row.result) === 'warn';
      }).length;
    }

    var totalChecks = num(pick(jobRaw, ['total_checks', 'checks_total'])) ||
      rows.length ||
      (passCount + failCount + warnCount);
    if (!totalChecks) totalChecks = 1;

    var passRate = num(pick(jobRaw, ['pass_rate', 'passRate', 'score']));
    if (passRate === null) {
      passRate = Math.round((passCount / totalChecks) * 100);
    }
    passRate = Math.max(0, Math.min(100, passRate));

    var statusRaw = String(pick(jobRaw, ['status', 'state', 'verdict']) || '').toLowerCase();
    var status =
      statusRaw === 'failed' || statusRaw === 'fail' || failCount > 0
        ? 'failed'
        : statusRaw === 'warning' || statusRaw === 'warnings' || warnCount > 0
        ? 'warning'
        : statusRaw === 'processing' || statusRaw === 'running' || statusRaw === 'queued'
        ? 'processing'
        : 'passed';
    if (passRate >= 90 && failCount === 0) status = 'passed';

    return {
      job_id: String(pick(jobRaw, ['job_id', 'id', 'jobId']) || ''),
      display_id: String(pick(jobRaw, ['display_id', 'displayId', 'public_id']) || ''),
      photos: photoCount,
      totalChecks: totalChecks,
      passed: passCount,
      failed: failCount,
      warnings: warnCount,
      passRate: passRate,
      credits:
        num(pick(jobRaw, ['credits_spent', 'creditsSpent', 'credits', 'credits_used'])) ||
        base.credits ||
        creditsFor(photoCount),
      focus: Array.isArray(pick(jobRaw, ['focus', 'inspection_focus']))
        ? pick(jobRaw, ['focus', 'inspection_focus'])
        : base.focus || FOCUS.map(function (item) {
            return item.id;
          }),
      status: status,
      rows: rows,
      email: String(pick(jobRaw, ['email']) || base.email || accountEmail || ''),
      created: String(
        pick(jobRaw, ['created_at', 'createdAt', 'started_at', 'date']) || base.created || ''
      ),
      downloadReady:
        jobRaw.download_ready === undefined
          ? status !== 'processing'
          : jobRaw.download_ready === true ||
            jobRaw.download_ready === 'true' ||
            jobRaw.download_ready === 1
    };
  }

  /* ================ F. RESULTS — renderPackagingQcResults() ============== */

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
    var key = job.job_id || job.display_id || pqcRef(job);
    list = list.filter(function (item) {
      var itemKey = item && (item.job_id || item.display_id || pqcRef(item));
      return itemKey !== key;
    });
    list.unshift(job);
    writeJSON(JOBS_KEY, list.slice(0, 25));
    historyJobs = list.slice(0, 25);
  }

  function summaryRow(label, valueHtml) {
    return '<div class="summary-row"><dt>' + esc(label) + '</dt><dd>' + valueHtml + '</dd></div>';
  }

  function resultBadge(result) {
    var tone = resultTone(result);
    var label = tone === 'bad' ? 'FAIL' : tone === 'warn' ? 'WARNING' : 'PASS';
    return '<span class="hist-badge ' + tone + '">' + label + '</span>';
  }

  function renderTable(job) {
    var table = $('#pqcTable');
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
        'Your QC report is being prepared. Photo-by-photo PASS / WARNING / FAIL ' +
        'results will appear here and in your emailed .xlsx.</td></tr>';
      return;
    }

    tbody.innerHTML = job.rows
      .map(function (row) {
        return (
          '<tr>' +
          '<td>' + esc(row.photo) + '</td>' +
          '<td><strong>' + esc(row.check) + '</strong></td>' +
          '<td>' + resultBadge(row.result) + '</td>' +
          '<td>' + esc(row.finding) + '</td>' +
          '<td>' + esc(row.action) + '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function wireDownloadButton() {
    var btn = $('#pqcDownloadBtn');
    if (!btn || btn.getAttribute('data-pqc-bound') === '1') return;
    btn.setAttribute('data-pqc-bound', '1');
    btn.addEventListener('click', function () {
      downloadPackagingQc();
    });
  }

  function renderPackagingQcResults(data) {
    var view = $('#view-packaging-results');
    if (!view) return;

    var job =
      data && typeof data === 'object'
        ? normalizeJob(
            data.data && data.data.job
              ? data.data.job
              : data.data && data.data.audit
              ? data.data.audit
              : data
          )
        : currentJob();

    var empty = $('#packagingEmpty');
    var main = $('#packagingMain');

    if (!job) {
      if (empty) empty.hidden = false;
      if (main) main.hidden = true;
      return;
    }

    if (empty) empty.hidden = true;
    if (main) main.hidden = false;

    var headerId = $('#pqcHeaderId');
    if (headerId) headerId.textContent = pqcRef(job);

    var statusMeta =
      job.status === 'passed'
        ? { label: 'Passed', tone: 'ok' }
        : job.status === 'failed'
        ? { label: 'Failed', tone: 'bad' }
        : job.status === 'warning'
        ? { label: 'Warnings', tone: 'warn' }
        : { label: 'Processing', tone: 'warn' };

    var headerStatus = $('#pqcHeaderStatus');
    if (headerStatus) {
      headerStatus.textContent = statusMeta.label;
      headerStatus.className = 'hist-badge ' + statusMeta.tone;
    }

    var statusBadge = $('#pqcStatusBadge');
    if (statusBadge) {
      statusBadge.classList.toggle('is-ok', job.status === 'passed');
      var badgeText = statusBadge.querySelector('.webhook-text');
      if (badgeText) {
        badgeText.textContent =
          job.status === 'passed'
            ? 'Passed · ' + job.passRate + '% pass rate'
            : job.status === 'failed'
            ? 'Failed · ' + job.failed + ' defect' + (job.failed === 1 ? '' : 's')
            : job.status === 'warning'
            ? 'Warnings · ' + job.warnings + ' to review'
            : 'Processing…';
      }
    }

    var ringPercent = $('#pqcRingPercent');
    if (ringPercent) ringPercent.textContent = job.passRate + '%';

    var ringCount = $('#pqcRingCount');
    if (ringCount) {
      ringCount.textContent =
        job.passed + ' / ' + job.totalChecks + ' checks passed';
    }

    var ringFill = $('#pqcRingFill');
    if (ringFill) {
      var circumference = 364.42;
      ringFill.style.strokeDasharray = String(circumference);
      ringFill.style.strokeDashoffset = String(circumference * (1 - job.passRate / 100));
    }

    var ringCard = $('#pqcRingCard');
    if (ringCard) {
      ringCard.classList.toggle('is-complete', job.status === 'passed');
      ringCard.classList.toggle('is-warning', job.status === 'warning' || job.status === 'processing');
      ringCard.classList.toggle('is-down', job.status === 'failed');
    }

    var emailNote = $('#pqcEmailNote');
    if (emailNote && job.email) {
      emailNote.textContent =
        'QC Report (.xlsx) will also be emailed to ' + job.email + ' when complete.';
    }

    var focusList = focusLabels(job.focus);
    var meta = $('#pqcJobMeta');
    if (meta) {
      meta.textContent =
        job.photos + ' photo' + (job.photos === 1 ? '' : 's') + ' · ' +
        focusList.length + ' checks · ' + job.credits + ' credit' +
        (Number(job.credits) === 1 ? '' : 's');
    }

    var summary = $('#pqcJobSummary');
    if (summary) {
      summary.innerHTML =
        summaryRow('Audit ID', '<code>' + esc(pqcRef(job)) + '</code>') +
        summaryRow('Photos Inspected', '<strong>' + esc(job.photos) + '</strong>') +
        summaryRow('Inspection Focus', esc(focusList.length ? focusList.join(' · ') : '—')) +
        summaryRow('Checks Passed', '<strong>' + esc(job.passed) + ' / ' + esc(job.totalChecks) + '</strong>') +
        summaryRow('Defects Found', '<strong>' + esc(job.failed + job.warnings) + '</strong>') +
        summaryRow('Credits Used', '<strong>' + esc(job.credits) + ' credit' +
          (Number(job.credits) === 1 ? '' : 's') + '</strong>');
    }

    var previewPill = $('#pqcPreviewPill');
    if (previewPill) {
      previewPill.textContent =
        job.photos + ' photo' + (job.photos === 1 ? '' : 's');
    }
    var tableMeta = $('#pqcTableMeta');
    if (tableMeta) {
      tableMeta.textContent = job.rows.length
        ? job.rows.length + ' check' + (job.rows.length === 1 ? '' : 's') +
          ' · ' + job.passed + ' passed · ' + job.warnings + ' warning' +
          (job.warnings === 1 ? '' : 's') + ' · ' + job.failed + ' failed'
        : 'Inspection checks per photo with PASS / WARNING / FAIL results';
    }

    var downloadSub = $('#pqcDownloadSub');
    if (downloadSub) {
      downloadSub.textContent = job.downloadReady
        ? 'Ready to download'
        : 'Processing — available when ready';
    }

    renderTable(job);
    wireDownloadButton();
  }

  window.renderPackagingQcResults = renderPackagingQcResults;

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

  function downloadPackagingQc(jobId, displayId) {
    var now = Date.now();
    if (downloadInFlight || now - lastDownloadAt < 1000) return;
    lastDownloadAt = now;

    var job = currentJob();
    var id = String(jobId || (job && (job.job_id || job.id)) || '');
    var disp = String(displayId || (job && job.display_id) || '');
    var token = readToken();

    if (!token) {
      openSignIn('Log in again to download your QC Report.');
      return;
    }
    if (!id && !disp) {
      toast('Open a Packaging QC audit first, then download its report.', 'warn');
      return;
    }

    var url = DOWNLOAD_URL + '?job_id=' + encodeURIComponent(id || disp);
    if (disp && id) url += '&display_id=' + encodeURIComponent(disp);

    downloadInFlight = true;
    toast('Preparing your QC Report…', 'info');

    fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + token } })
      .then(function (response) {
        if (response.status === 401) {
          downloadInFlight = false;
          openSignIn('Your session expired. Log in again to download the report.');
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
        var name = result.name || 'Packaging-QC-' + pqcRef(job) + '.xlsx';
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
        toast('QC Report downloaded.', 'success');
      })
      .catch(function (err) {
        downloadInFlight = false;
        toast(
          (err && err.message) || 'Could not download the report. Please try again.',
          'warn'
        );
      });
  }

  window.downloadPackagingQc = downloadPackagingQc;

  /* ============ H. HISTORY — #plans / #historyPackagingQc =============== */

  function extractJobs(body) {
    if (!body || typeof body !== 'object') return [];
    var source =
      body.data && typeof body.data === 'object' && !Array.isArray(body.data)
        ? body.data
        : body;
    var raw = Array.isArray(source.packaging_qc) ? source.packaging_qc : [];
    if (!raw.length && Array.isArray(body.packaging_qc)) raw = body.packaging_qc;
    return raw.map(function (item) {
      return normalizeJob(item);
    });
  }

  function paintHistoryCounts(count) {
    $$('[data-hist-count="packaging"]').forEach(function (el) {
      var want = String(count);
      el.setAttribute('data-packaging-count', want);
      el.textContent = want;
      if (el.getAttribute('data-packaging-count-guard') === '1') return;
      if (!window.MutationObserver) return;
      el.setAttribute('data-packaging-count-guard', '1');
      var observer = new window.MutationObserver(function () {
        var expected = readToken() ? el.getAttribute('data-packaging-count') : '0';
        if (expected !== null && el.textContent !== expected) {
          el.textContent = expected;
        }
      });
      observer.observe(el, { childList: true, characterData: true, subtree: true });
    });
    $$('[data-hist-count-label="packaging"]').forEach(function (el) {
      el.textContent = count + ' audit' + (count === 1 ? '' : 's');
    });
  }

  function historyCardHtml(job) {
    var statusMeta =
      job.status === 'passed'
        ? { label: 'Passed', tone: 'ok' }
        : job.status === 'failed'
        ? { label: 'Failed', tone: 'bad' }
        : job.status === 'warning'
        ? { label: 'Warnings', tone: 'warn' }
        : { label: 'Processing', tone: 'warn' };
    var photoText = job.photos + ' photo' + (job.photos === 1 ? '' : 's');
    var creditText = job.credits + ' credit' + (job.credits === 1 ? '' : 's');
    var refId = job.job_id || job.display_id;

    return (
      '<article class="hist-card">' +
      '<div class="hist-card-top">' +
      '<strong>Packaging & Shelf QC</strong>' +
      '<span class="hist-id">' + esc(pqcRef(job)) + '</span>' +
      '<span class="hist-badge ' + statusMeta.tone + '">' + esc(statusMeta.label) + '</span>' +
      '</div>' +
      '<p class="hist-sub">' + esc(photoText) + ' · ' + esc(creditText) + ' · ' +
      esc(job.passRate + '% pass rate') + '</p>' +
      '<dl class="hist-meta">' +
      '<div><dt>Photos</dt><dd>' + esc(photoText) + '</dd></div>' +
      '<div><dt>Pass rate</dt><dd>' + esc(job.passRate + '%') + '</dd></div>' +
      '<div><dt>Credits spent</dt><dd>' + esc(creditText) + '</dd></div>' +
      '<div><dt>Audit ID</dt><dd><code>' + esc(pqcRef(job)) + '</code></dd></div>' +
      '</dl>' +
      '<div class="hist-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-packaging-view="' +
      esc(refId) + '">View QC Log</button>' +
      (job.downloadReady && refId
        ? '<button type="button" class="btn btn-primary btn-sm" data-packaging-download="' +
          esc(refId) + '">Download .xlsx</button>'
        : '') +
      '</div>' +
      '</article>'
    );
  }

  function renderHistoryPane(jobs) {
    var pane = $('#historyPackagingQc');
    if (!pane) return;

    if (!readToken()) {
      pane.innerHTML =
        '<div class="hist-empty">' +
        '<p class="empty-note">Log in to view your packaging QC audits.</p>' +
        '<button type="button" class="btn btn-primary btn-sm" data-history-login>Log in</button>' +
        '</div>';
      paintHistoryCounts(0);
      return;
    }

    if (!jobs.length) {
      pane.innerHTML =
        '<div class="hist-empty">' +
        '<p class="empty-note">No packaging QC audits yet. Compare master artwork against supplier proofs or shelf photos to catch defects.</p>' +
        '<button type="button" class="btn btn-primary btn-sm" data-open-packaging onclick="window.openPackagingQcModal && window.openPackagingQcModal(); return false;">Launch Packaging QC →</button>' +
        '</div>';
      paintHistoryCounts(0);
      return;
    }

    pane.innerHTML =
      '<div class="hist-list">' + jobs.map(historyCardHtml).join('') + '</div>';
    paintHistoryCounts(jobs.length);
  }

  window.renderPackagingQcHistory = function (body) {
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
      var candidates = [job.job_id, job.display_id, job.id, pqcRef(job)];
      for (var c = 0; c < candidates.length; c += 1) {
        if (candidates[c] && String(candidates[c]) === key) return job;
      }
    }
    var current = currentJob();
    if (current) {
      var own = [current.job_id, current.display_id, pqcRef(current)];
      for (var o = 0; o < own.length; o += 1) {
        if (own[o] && String(own[o]) === key) return current;
      }
    }
    return null;
  }

  function openPackagingHistoryJob(ref) {
    var job = findJobByRef(ref);
    if (job) {
      rememberJob(job);
      if (currentRoute() === 'packaging-results') renderPackagingQcResults(job);
      else window.location.hash = '#packaging-results';
      return;
    }

    var fallback = currentJob();
    if (fallback) {
      rememberJob(fallback);
      if (currentRoute() === 'packaging-results') renderPackagingQcResults(fallback);
      else window.location.hash = '#packaging-results';
    } else {
      window.location.hash = '#packaging-results';
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
            pqcRef(item) === String(ref)
          ) {
            match = item;
            break;
          }
        }
        if (match) {
          rememberJob(match);
          renderPackagingQcResults(match);
        }
      })
      .catch(function () {
        /* keep cached view */
      });
  }

  window.openPackagingQcHistoryJob = openPackagingHistoryJob;

  /* ======================= I. ROUTING & LISTENERS ======================== */

  function ensureHistory() {
    var pane = $('#historyPackagingQc');
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
          window.renderPackagingQcHistory(body);
        })
        .catch(function () {
          historyLoading = false;
          if (!historyJobs.length) {
            pane.innerHTML =
              '<div class="hist-empty"><p class="empty-note">Could not load your packaging audits right now. ' +
              '<button type="button" class="btn btn-ghost btn-sm" data-pqc-history-retry>Try again</button></p></div>';
          }
        });
    }, 600);
  }

  function onRoute() {
    var route = currentRoute();
    if (route === 'packaging-results') renderPackagingQcResults();
    if (route === 'plans') ensureHistory();
  }

  function onDocumentClick(event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    var card = target.closest('#packagingQcAgentCard');
    if (card && (target.closest('[data-open-packaging]') || target.closest('.btn-subscribe'))) {
      event.preventDefault();
      window.openPackagingQcModal();
      return;
    }

    var viewBtn = target.closest('[data-packaging-view]');
    if (viewBtn) {
      event.preventDefault();
      openPackagingHistoryJob(viewBtn.getAttribute('data-packaging-view'));
      return;
    }

    var dlBtn = target.closest('[data-packaging-download]');
    if (dlBtn) {
      event.preventDefault();
      downloadPackagingQc(dlBtn.getAttribute('data-packaging-download'));
      return;
    }

    var retry = target.closest('[data-pqc-history-retry]');
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
