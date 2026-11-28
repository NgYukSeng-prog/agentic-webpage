/* ============================================================================
   LiteWork — Worker #11 · Audio-to-Intel: Voice & Meeting-to-Excel
   ----------------------------------------------------------------------------
   Standalone vanilla JS module. Loaded with <script defer> AFTER app.js, so it
   never bloats app.js. It owns everything for the AUD-#### worker:

     · window.openAudioIntelModal()        — upload + template configuration
     · window.renderAudioIntelResults()    — full-page #view-audio-results
     · window.downloadAudioIntel()         — Bearer-auth .xlsx download
     · window.renderAudioIntelHistory()    — #plans "Audio-to-Intel" pane
     · window.openAudioIntelHistoryJob()   — open a batch from My Activity

   Reuses the canonical LiteWork modal classes (calc-card / invoice dropzone /
   inv-filelist / btn-activate) and the results classes (scraper-grid,
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

  var AGENT_ID = CFG.AUDIO_INTEL_AGENT_ID || 'audio-intel';
  var AGENT_NAME =
    CFG.AUDIO_INTEL_AGENT_NAME || 'Audio-to-Intel: Voice & Meeting-to-Excel';

  var START_URL = String(CFG.audioIntelStartUrl || API_BASE + '/audio-intel-start');
  var DOWNLOAD_URL = String(
    CFG.audioIntelDownloadUrl || API_BASE + '/download-audio-intel'
  );
  var HISTORY_URL = API_BASE + '/account/history';
  var ME_URL = API_BASE + '/auth/me';

  var MAX_FILES = Number(CFG.AUDIO_INTEL_MAX_FILES) > 0 ? Number(CFG.AUDIO_INTEL_MAX_FILES) : 10;
  var MAX_FILE_BYTES = 100 * 1024 * 1024;

  var JOB_KEY = 'lw_audio_job_v1';
  var JOBS_KEY = 'lw_audio_jobs_v1';

  var ACCEPT = '.mp3,.m4a,.wav,.ogg,.webm';
  var ALLOWED_EXTS = ['mp3', 'm4a', 'wav', 'ogg', 'webm'];

  var TEMPLATES = [
    {
      id: 'sourcing',
      label: 'Trade-Show / Supplier Sourcing',
      note: 'Compare suppliers by price, MOQ & lead time'
    },
    {
      id: 'sales',
      label: 'Sales / Client Call',
      note: 'Objections, next steps & deal value'
    },
    {
      id: 'meeting',
      label: 'General Meeting / Site Visit',
      note: 'Decisions, owners & action items'
    }
  ];

  var COLUMNS = [
    'Supplier / Contact',
    'Item / Product',
    'Unit Price',
    'MOQ',
    'Lead Time',
    'Action Item',
    'Source'
  ];

  /* ============================ B. STATE ================================= */

  var templateId = 'sourcing';
  var files = [];
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

  function audRef(job) {
    if (!job) return 'AUD-1001';
    var raw = String(
      job.display_id || job.displayId || job.public_id || job.job_id || job.id || ''
    );
    var match = raw.match(/AUD[-\s]?0*(\d+)/i);
    if (match) return 'AUD-' + pad4(match[1]);
    if (/^\d+$/.test(raw)) return 'AUD-' + pad4(raw);
    var digits = raw.replace(/\D/g, '');
    if (digits) return 'AUD-' + pad4(digits.slice(-4));
    var sum = 0;
    for (var i = 0; i < raw.length; i += 1) {
      sum = (sum * 31 + raw.charCodeAt(i)) % 10000;
    }
    return 'AUD-' + pad4(String(1001 + (sum % 8999)));
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
    return n > 5 ? 10 : 5;
  }

  function tierLabel(count) {
    var n = Number(count) || 0;
    if (!n) return 'No files';
    return n > 5 ? '6–10 files · 10 credits' : '1–5 files · 5 credits';
  }

  function extOf(name) {
    var m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  function templateById(id) {
    var code = String(id || '').toLowerCase();
    for (var i = 0; i < TEMPLATES.length; i += 1) {
      if (TEMPLATES[i].id === code) return TEMPLATES[i];
    }
    return TEMPLATES[0];
  }

  function templateLabel(id) {
    return templateById(id).label;
  }

  function currentRoute() {
    return String(window.location.hash || '')
      .replace(/^#\/?/, '')
      .split('?')[0]
      .toLowerCase();
  }

  /* ==================== D. MODAL — openAudioIntelModal() ================= */

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
    toast(message || 'Log in or sign up to launch Audio-to-Intel.', 'warn');
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

  function templatePillHtml(tpl) {
    var on = tpl.id === templateId;
    return (
      '<button type="button" class="lead-mode-pill' + (on ? ' is-active' : '') + '"' +
      ' data-aud-template="' + esc(tpl.id) + '" role="tab" aria-selected="' +
      (on ? 'true' : 'false') + '">' +
      '<span class="lead-mode-title">' + esc(tpl.label) + '</span>' +
      '<span class="lead-mode-note">' + esc(tpl.note) + '</span>' +
      '</button>'
    );
  }

  function modalHtml() {
    return (
      '<h2 class="modal-title" id="modalTitle">' + esc(AGENT_NAME) + '</h2>' +
      '<p class="modal-sub">Turn recordings into a side-by-side comparison Excel · ' +
      '5 credits (1–5 files) · 10 credits (6–10 files)</p>' +
      '<div class="calc-card modal-calc"><div class="calc-grid">' +
      '<div class="calc-cell"><span class="calc-label">Available</span>' +
      '<span class="calc-value" id="audAvailable">— Credits</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Files selected</span>' +
      '<span class="calc-value" id="audFileCount">0 / ' + MAX_FILES + '</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Tier</span>' +
      '<span class="calc-value" id="audTier">No files</span></div>' +
      '<div class="calc-cell calc-cell-total"><span class="calc-label">Total cost</span>' +
      '<span class="calc-value" id="audCost">0 Credits</span>' +
      '<span class="calc-sub" id="audAfterRun"></span></div>' +
      '</div></div>' +
      '<form class="invoice-form" id="audioForm" novalidate>' +
      '<div class="modal-section"><h3>1. Choose template</h3>' +
      '<span class="fine">Shapes the extracted comparison columns</span></div>' +
      '<div class="lead-mode" id="audTemplates" role="tablist" aria-label="Audio template">' +
      TEMPLATES.map(templatePillHtml).join('') +
      '</div>' +
      '<div class="modal-section"><h3>2. Upload audio</h3>' +
      '<span class="fine">1–' + MAX_FILES + ' files · EN / ZH / BM</span></div>' +
      '<label class="inv-drop" id="audDrop" for="audFileInput">' +
      '<span class="inv-drop-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#6366F1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 16V5" /><path d="m7 10 5-5 5 5" />' +
      '<path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />' +
      '</svg></span>' +
      '<strong>Drag & drop audio here</strong>' +
      '<span class="inv-drop-sub">or click to browse · up to ' + MAX_FILES +
      ' files · max ' + Math.round(MAX_FILE_BYTES / 1048576) + ' MB each</span>' +
      '<span class="inv-drop-types">MP3 · M4A · WAV · OGG · WEBM</span>' +
      '<span class="inv-drop-tip">Best for trade-show recordings, supplier calls and WhatsApp voice notes. Clear audio improves pricing and MOQ accuracy.</span>' +
      '</label>' +
      '<input type="file" id="audFileInput" class="inv-file-input" accept="' +
      esc(ACCEPT) + '" multiple />' +
      '<ul class="inv-filelist" id="audFileList"></ul>' +
      '<div class="modal-section"><h3>3. Delivery details</h3>' +
      '<span class="fine">Email only</span></div>' +
      '<div class="field"><label for="audEmail">Delivery email</label>' +
      '<input type="email" id="audEmail" class="is-locked" value="' + esc(accountEmail) + '" ' +
      'placeholder="Loading your account email…" disabled tabindex="-1" /></div>' +
      '<div class="modal-actions">' +
      '<div class="scraper-modal-error" id="audFormError" role="alert"></div>' +
      '<p class="scraper-shortfall" id="audShortfall" hidden></p>' +
      '<button type="submit" class="btn btn-activate" id="audStartBtn" disabled>' +
      'Confirm & Spend 0 Credits · Extract 0 Files</button>' +
      '<p class="fine">Credits are deducted immediately. Your comparison Excel (.xlsx) is emailed and downloadable — safe to close this tab.</p>' +
      '</div>' +
      '</form>'
    );
  }

  function setFormError(message) {
    var el = $('#audFormError');
    if (el) el.textContent = message || '';
  }

  function setShortfall(message) {
    var el = $('#audShortfall');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }

  function renderFiles() {
    var list = $('#audFileList');
    if (list) {
      list.innerHTML = files.length
        ? files
            .map(function (entry, index) {
              var ext = extOf(entry.name).toUpperCase() || 'AUDIO';
              return (
                '<li class="inv-file-row">' +
                '<span class="inv-file-badge">' + esc(ext) + '</span>' +
                '<span class="inv-file-meta"><strong>' + esc(entry.name) + '</strong>' +
                '<span>' + esc(formatBytes(entry.size)) + '</span></span>' +
                '<button type="button" class="inv-file-remove" data-aud-remove="' + index +
                '" aria-label="Remove ' + esc(entry.name) + '">×</button>' +
                '</li>'
              );
            })
            .join('')
        : '<li class="inv-file-empty">No audio queued yet — add up to ' + MAX_FILES + ' files.</li>';
    }
    updateQuote();
  }

  function addFiles(fileList) {
    var incoming = Array.prototype.slice.call(fileList || []);
    if (!incoming.length) return;
    var errors = [];

    incoming.forEach(function (file) {
      if (files.length >= MAX_FILES) {
        errors.push('Maximum ' + MAX_FILES + ' audio files per run.');
        return;
      }
      var ext = extOf(file.name);
      if (ALLOWED_EXTS.indexOf(ext) === -1) {
        errors.push(file.name + ' is not a supported audio type.');
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        errors.push(
          file.name + ' is larger than ' + Math.round(MAX_FILE_BYTES / 1048576) + ' MB.'
        );
        return;
      }
      var duplicate = files.some(function (entry) {
        return entry.name === file.name && entry.size === file.size;
      });
      if (duplicate) {
        errors.push(file.name + ' is already queued.');
        return;
      }
      files.push({ name: file.name, size: file.size, type: file.type || '', file: file });
    });

    setFormError(errors.join(' '));
    renderFiles();
  }

  function updateQuote() {
    var count = files.length;
    var cost = creditsFor(count);
    var setText = function (selector, text) {
      var el = $(selector);
      if (el) el.textContent = text;
    };

    setText('#audAvailable', (availableCredits === null ? '—' : availableCredits) + ' Credits');
    setText('#audFileCount', count + ' / ' + MAX_FILES);
    setText('#audTier', tierLabel(count));
    setText('#audCost', cost + ' Credits');
    setText(
      '#audAfterRun',
      availableCredits === null || !count
        ? ''
        : 'After run: ' + Math.max(0, availableCredits - cost) + ' credits'
    );

    var shortfall = availableCredits !== null && count ? cost - availableCredits : 0;
    setShortfall(
      shortfall > 0
        ? 'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
          ' for this batch. Top up credits to continue.'
        : ''
    );

    var btn = $('#audStartBtn');
    if (btn && !inFlight) {
      btn.textContent =
        'Confirm & Spend ' + cost + ' Credits · Extract ' + count + ' File' +
        (count === 1 ? '' : 's');
      btn.disabled = !count || shortfall > 0;
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
          var input = $('#audEmail');
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

  function openAudioConfigModal() {
    files = [];
    inFlight = false;

    var mounted = showModal(modalHtml());
    if (!mounted) return;

    var LW = window.__LW;
    if (LW && LW.state && LW.state.credits != null) {
      availableCredits = Number(LW.state.credits);
    }

    var drop = $('#audDrop');
    var input = $('#audFileInput');
    if (drop && input) {
      ['dragenter', 'dragover'].forEach(function (evt) {
        drop.addEventListener(evt, function (event) {
          event.preventDefault();
          drop.classList.add('is-drag');
        });
      });
      ['dragleave', 'dragend'].forEach(function (evt) {
        drop.addEventListener(evt, function () {
          drop.classList.remove('is-drag');
        });
      });
      drop.addEventListener('drop', function (event) {
        event.preventDefault();
        drop.classList.remove('is-drag');
        if (event.dataTransfer && event.dataTransfer.files) {
          addFiles(event.dataTransfer.files);
        }
      });
      input.addEventListener('change', function () {
        addFiles(input.files);
        input.value = '';
      });
    }

    var list = $('#audFileList');
    if (list) {
      list.addEventListener('click', function (event) {
        var btn = event.target.closest ? event.target.closest('[data-aud-remove]') : null;
        if (!btn) return;
        var index = Number(btn.getAttribute('data-aud-remove'));
        if (Number.isFinite(index)) {
          files.splice(index, 1);
          setFormError('');
          renderFiles();
        }
      });
    }

    var templates = $('#audTemplates');
    if (templates) {
      templates.addEventListener('click', function (event) {
        var pill = event.target.closest ? event.target.closest('[data-aud-template]') : null;
        if (!pill) return;
        templateId = pill.getAttribute('data-aud-template') || 'sourcing';
        $$('#audTemplates [data-aud-template]').forEach(function (btn) {
          var active = btn === pill;
          btn.classList.toggle('is-active', active);
          btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
      });
    }

    var form = $('#audioForm');
    if (form) form.addEventListener('submit', submitAudio);

    renderFiles();
    loadAccount();
  }

  window.openAudioIntelModal = function () {
    var now = Date.now();
    if (now - lastOpenAt < 300) return;
    lastOpenAt = now;

    if (!readToken()) {
      openSignIn('Log in or sign up to launch Audio-to-Intel.');
      waitForToken(function () {
        window.openAudioIntelModal();
      });
      return;
    }
    openAudioConfigModal();
  };

  function submitAudio(event) {
    event.preventDefault();
    if (inFlight) return;

    if (!readToken()) {
      closeModal();
      openSignIn('Your session expired. Log in again to launch Audio-to-Intel.');
      return;
    }

    var count = files.length;
    if (!count) {
      setFormError('Add at least one audio file to continue.');
      return;
    }
    if (count > MAX_FILES) {
      setFormError('Maximum ' + MAX_FILES + ' audio files per run.');
      return;
    }

    var cost = creditsFor(count);
    if (availableCredits !== null && availableCredits < cost) {
      setFormError(
        'You need ' + (cost - availableCredits) + ' more credit' +
        (cost - availableCredits === 1 ? '' : 's') + ' for this batch.'
      );
      return;
    }

    setFormError('');
    setShortfall('');
    inFlight = true;

    var button = $('#audStartBtn');
    if (button) {
      button.disabled = true;
      button.classList.add('is-busy');
      button.textContent = 'Extracting your comparison…';
    }

    var formData = new FormData();
    formData.append('email', accountEmail || '');
    formData.append('template', templateId);
    formData.append('file_count', String(count));
    formData.append('credits', String(cost));
    files.forEach(function (entry) {
      formData.append('files', entry.file, entry.name);
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
          openSignIn('Your session expired. Log in again to launch Audio-to-Intel.');
          return null;
        }
        if (result.status === 402) {
          inFlight = false;
          setFormError(
            (result.body && (result.body.error || result.body.message)) ||
              'Not enough credits for this audio batch. Top up credits to continue.'
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
            : result.body.data && result.body.data.batch
            ? result.body.data.batch
            : result.body;

        var job = normalizeJob(raw, {
          files: count,
          credits: cost,
          template: templateId,
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
        toast('Audio-to-Intel started — ' + count + ' file' + (count === 1 ? '' : 's') + ' queued.', 'success');

        if (currentRoute() === 'audio-results') {
          renderAudioIntelResults(job);
        } else {
          window.location.hash = '#audio-results';
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
            'Could not start Audio-to-Intel. Please try again in a moment.'
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
        var supplier = String(
          pick(row, ['supplier', 'vendor', 'company', 'contact', 'supplier_name']) || ''
        );
        var item = String(pick(row, ['item', 'product', 'sku', 'subject']) || '');
        if (!supplier && !item) return null;
        return {
          supplier: supplier || '—',
          item: item || '—',
          price: pick(row, ['price', 'unit_price', 'quote', 'cost'], ''),
          moq: pick(row, ['moq', 'min_order', 'minimum_order', 'min_qty'], ''),
          leadTime: pick(row, ['lead_time', 'leadtime', 'delivery_time', 'eta'], ''),
          action: pick(row, ['action', 'action_item', 'next_step', 'follow_up'], ''),
          source: String(
            pick(row, ['source', 'recording', 'file', 'audio_file', 'source_file']) || ''
          )
        };
      })
      .filter(function (row) {
        return !!row;
      });
  }

  function normalizeJob(raw, fallback) {
    var jobRaw = raw && typeof raw === 'object' ? raw : {};
    var base = fallback || {};

    var filesRaw = pick(
      jobRaw,
      ['files_count', 'total_files', 'file_count', 'files_total', 'files'],
      0
    );
    var fileCount =
      Array.isArray(filesRaw) ? filesRaw.length : Number(filesRaw) || base.files || 0;

    var rows = normalizeRows(
      pick(jobRaw, ['matrix', 'rows', 'comparisons', 'suppliers', 'results', 'items'], [])
    );

    var statusRaw = String(pick(jobRaw, ['status', 'state']) || 'completed').toLowerCase();
    var status =
      statusRaw === 'failed' || statusRaw === 'error'
        ? 'failed'
        : statusRaw === 'running' ||
          statusRaw === 'processing' ||
          statusRaw === 'queued' ||
          statusRaw === 'pending'
        ? 'processing'
        : 'completed';

    var processed =
      num(pick(jobRaw, ['files_processed', 'processed_files', 'completed_files'])) ||
      (status === 'completed' ? fileCount : 0);

    var percent = num(pick(jobRaw, ['percent', 'progress']));
    if (percent === null) {
      percent = fileCount ? Math.round((processed / fileCount) * 100) : status === 'completed' ? 100 : 0;
    }
    percent = Math.max(0, Math.min(100, percent));

    return {
      job_id: String(pick(jobRaw, ['job_id', 'id', 'jobId']) || ''),
      display_id: String(pick(jobRaw, ['display_id', 'displayId', 'public_id']) || ''),
      files: fileCount,
      processed: processed,
      credits:
        num(pick(jobRaw, ['credits_spent', 'creditsSpent', 'credits', 'credits_used'])) ||
        base.credits ||
        creditsFor(fileCount),
      template: String(
        pick(jobRaw, ['template', 'mode', 'template_id', 'use_case']) || base.template || 'sourcing'
      ),
      status: status,
      percent: percent,
      rows: rows,
      email: String(pick(jobRaw, ['email']) || base.email || accountEmail || ''),
      created: String(
        pick(jobRaw, ['created_at', 'createdAt', 'started_at', 'date']) || base.created || ''
      ),
      downloadReady:
        jobRaw.download_ready === undefined
          ? status === 'completed'
          : jobRaw.download_ready === true ||
            jobRaw.download_ready === 'true' ||
            jobRaw.download_ready === 1
    };
  }

  /* ================= F. RESULTS — renderAudioIntelResults() =============== */

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
    var key = job.job_id || job.display_id || audRef(job);
    list = list.filter(function (item) {
      var itemKey = item && (item.job_id || item.display_id || audRef(item));
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
    var table = $('#audTable');
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
        'Your comparison matrix is being prepared. Supplier quotes, pricing and MOQ ' +
        'will appear here and in your emailed .xlsx.</td></tr>';
      return;
    }

    tbody.innerHTML = job.rows
      .map(function (row) {
        return (
          '<tr>' +
          '<td><strong>' + esc(row.supplier) + '</strong></td>' +
          '<td>' + esc(row.item) + '</td>' +
          '<td>' + esc(row.price) + '</td>' +
          '<td>' + esc(row.moq) + '</td>' +
          '<td>' + esc(row.leadTime) + '</td>' +
          '<td>' + esc(row.action) + '</td>' +
          '<td>' + esc(row.source || '—') + '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function wireDownloadButton() {
    var btn = $('#audDownloadBtn');
    if (!btn || btn.getAttribute('data-aud-bound') === '1') return;
    btn.setAttribute('data-aud-bound', '1');
    btn.addEventListener('click', function () {
      downloadAudioIntel();
    });
  }

  function renderAudioIntelResults(data) {
    var view = $('#view-audio-results');
    if (!view) return;

    var job =
      data && typeof data === 'object'
        ? normalizeJob(
            data.data && data.data.job
              ? data.data.job
              : data.data && data.data.batch
              ? data.data.batch
              : data
          )
        : currentJob();

    var empty = $('#audioEmpty');
    var main = $('#audioMain');

    if (!job) {
      if (empty) empty.hidden = false;
      if (main) main.hidden = true;
      return;
    }

    if (empty) empty.hidden = true;
    if (main) main.hidden = false;

    var headerId = $('#audHeaderId');
    if (headerId) headerId.textContent = audRef(job);

    var headerStatus = $('#audHeaderStatus');
    if (headerStatus) {
      headerStatus.textContent =
        job.status === 'completed'
          ? 'Completed'
          : job.status === 'failed'
          ? 'Failed'
          : 'Processing';
      headerStatus.className =
        'hist-badge ' + (job.status === 'completed' ? 'ok' : job.status === 'failed' ? 'bad' : 'warn');
    }

    var statusBadge = $('#audStatusBadge');
    if (statusBadge) {
      statusBadge.classList.toggle('is-ok', job.status === 'completed');
      var badgeText = statusBadge.querySelector('.webhook-text');
      if (badgeText) {
        badgeText.textContent =
          job.status === 'completed'
            ? 'Complete · Excel Ready'
            : job.status === 'failed'
            ? 'Failed'
            : 'Processing…';
      }
    }

    var ringPercent = $('#audRingPercent');
    if (ringPercent) ringPercent.textContent = job.percent + '%';

    var ringCount = $('#audRingCount');
    if (ringCount) {
      ringCount.textContent = job.processed + ' / ' + job.files + ' files processed';
    }

    var ringFill = $('#audRingFill');
    if (ringFill) {
      var circumference = 364.42;
      ringFill.style.strokeDasharray = String(circumference);
      ringFill.style.strokeDashoffset = String(circumference * (1 - job.percent / 100));
    }

    var ringCard = $('#audRingCard');
    if (ringCard) {
      ringCard.classList.toggle('is-complete', job.status === 'completed');
      ringCard.classList.toggle('is-warning', job.status === 'processing');
      ringCard.classList.toggle('is-down', job.status === 'failed');
    }

    var emailNote = $('#audEmailNote');
    if (emailNote && job.email) {
      emailNote.textContent =
        'Excel (.xlsx) will also be emailed to ' + job.email + ' when complete.';
    }

    var meta = $('#audJobMeta');
    if (meta) {
      meta.textContent =
        job.files + ' file' + (job.files === 1 ? '' : 's') + ' · ' +
        templateLabel(job.template) + ' · ' + job.credits + ' credit' +
        (Number(job.credits) === 1 ? '' : 's');
    }

    var summary = $('#audJobSummary');
    if (summary) {
      summary.innerHTML =
        summaryRow('Batch ID', '<code>' + esc(audRef(job)) + '</code>') +
        summaryRow('Template', '<strong>' + esc(templateLabel(job.template)) + '</strong>') +
        summaryRow('Audio Files', '<strong>' + esc(job.files) + '</strong>') +
        summaryRow('Credits Used', '<strong>' + esc(job.credits) + ' credit' +
          (Number(job.credits) === 1 ? '' : 's') + '</strong>') +
        summaryRow('Status', esc(job.status === 'completed' ? 'Completed' : job.status === 'failed' ? 'Failed' : 'Processing')) +
        summaryRow('Delivery Email', esc(job.email || '—'));
    }

    var previewPill = $('#audPreviewPill');
    if (previewPill) {
      previewPill.textContent =
        job.rows.length + ' supplier' + (job.rows.length === 1 ? '' : 's');
    }
    var tableMeta = $('#audTableMeta');
    if (tableMeta) {
      tableMeta.textContent = job.rows.length
        ? job.rows.length + ' supplier quote' + (job.rows.length === 1 ? '' : 's') +
          ' · ' + templateLabel(job.template)
        : 'Supplier quotes, pricing, MOQ & action items';
    }

    var downloadSub = $('#audDownloadSub');
    if (downloadSub) {
      downloadSub.textContent = job.downloadReady
        ? 'Ready to download'
        : 'Processing — available when ready';
    }

    renderTable(job);
    wireDownloadButton();
  }

  window.renderAudioIntelResults = renderAudioIntelResults;

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

  function downloadAudioIntel(jobId, displayId) {
    var now = Date.now();
    if (downloadInFlight || now - lastDownloadAt < 1000) return;
    lastDownloadAt = now;

    var job = currentJob();
    var id = String(jobId || (job && (job.job_id || job.id)) || '');
    var disp = String(displayId || (job && job.display_id) || '');
    var token = readToken();

    if (!token) {
      openSignIn('Log in again to download your Audio-to-Intel Excel.');
      return;
    }
    if (!id && !disp) {
      toast('Open an Audio-to-Intel batch first, then download its Excel.', 'warn');
      return;
    }

    var url = DOWNLOAD_URL + '?job_id=' + encodeURIComponent(id || disp);
    if (disp && id) url += '&display_id=' + encodeURIComponent(disp);

    downloadInFlight = true;
    toast('Preparing your comparison Excel…', 'info');

    fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + token } })
      .then(function (response) {
        if (response.status === 401) {
          downloadInFlight = false;
          openSignIn('Your session expired. Log in again to download the Excel.');
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
        var name = result.name || 'Audio-Intel-' + audRef(job) + '.xlsx';
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
        toast('Comparison Excel downloaded.', 'success');
      })
      .catch(function (err) {
        downloadInFlight = false;
        toast(
          (err && err.message) || 'Could not download the Excel. Please try again.',
          'warn'
        );
      });
  }

  window.downloadAudioIntel = downloadAudioIntel;

  /* ================ H. HISTORY — #plans / #historyAudioIntel ============= */

  function extractJobs(body) {
    if (!body || typeof body !== 'object') return [];
    var source =
      body.data && typeof body.data === 'object' && !Array.isArray(body.data)
        ? body.data
        : body;
    var raw = Array.isArray(source.audio_intel) ? source.audio_intel : [];
    if (!raw.length && Array.isArray(body.audio_intel)) raw = body.audio_intel;
    return raw.map(function (item) {
      return normalizeJob(item);
    });
  }

  /* app.js re-paints every [data-hist-count] badge on each history render and
     zeroes unknown keys — keep the Audio-to-Intel badge truthful via a guard,
     exactly like the Gold Brief worker. */
  function paintHistoryCounts(count) {
    $$('[data-hist-count="audio"]').forEach(function (el) {
      var want = String(count);
      el.setAttribute('data-audio-count', want);
      el.textContent = want;
      if (el.getAttribute('data-audio-count-guard') === '1') return;
      if (!window.MutationObserver) return;
      el.setAttribute('data-audio-count-guard', '1');
      var observer = new window.MutationObserver(function () {
        var expected = readToken() ? el.getAttribute('data-audio-count') : '0';
        if (expected !== null && el.textContent !== expected) {
          el.textContent = expected;
        }
      });
      observer.observe(el, { childList: true, characterData: true, subtree: true });
    });
    $$('[data-hist-count-label="audio"]').forEach(function (el) {
      el.textContent = count + ' batch' + (count === 1 ? '' : 'es');
    });
  }

  function historyCardHtml(job) {
    var label =
      job.status === 'completed' ? 'Completed' : job.status === 'failed' ? 'Failed' : 'Processing';
    var tone =
      job.status === 'completed' ? 'ok' : job.status === 'failed' ? 'bad' : 'warn';
    var fileText = job.files ? job.files + ' file' + (job.files === 1 ? '' : 's') : '—';
    var creditText = job.credits + ' credit' + (job.credits === 1 ? '' : 's');
    var refId = job.job_id || job.display_id;

    return (
      '<article class="hist-card">' +
      '<div class="hist-card-top">' +
      '<strong>Audio-to-Intel</strong>' +
      '<span class="hist-id">' + esc(audRef(job)) + '</span>' +
      '<span class="hist-badge ' + tone + '">' + esc(label) + '</span>' +
      '</div>' +
      '<p class="hist-sub">' + esc(fileText) + ' · ' + esc(creditText) + ' · ' +
      esc(templateLabel(job.template)) + '</p>' +
      '<dl class="hist-meta">' +
      '<div><dt>Files</dt><dd>' + esc(fileText) + '</dd></div>' +
      '<div><dt>Credits spent</dt><dd>' + esc(creditText) + '</dd></div>' +
      '<div><dt>Batch ID</dt><dd><code>' + esc(audRef(job)) + '</code></dd></div>' +
      '<div><dt>Created</dt><dd>' + esc(job.created ? formatDate(job.created) : '—') + '</dd></div>' +
      '</dl>' +
      '<div class="hist-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-audio-view="' +
      esc(refId) + '">View Matrix</button>' +
      (job.downloadReady && refId
        ? '<button type="button" class="btn btn-primary btn-sm" data-audio-download="' +
          esc(refId) + '">Download .xlsx</button>'
        : '') +
      '</div>' +
      '</article>'
    );
  }

  function renderHistoryPane(jobs) {
    var pane = $('#historyAudioIntel');
    if (!pane) return;

    if (!readToken()) {
      pane.innerHTML =
        '<div class="hist-empty">' +
        '<p class="empty-note">Log in to view your audio batches.</p>' +
        '<button type="button" class="btn btn-primary btn-sm" data-history-login>Log in</button>' +
        '</div>';
      paintHistoryCounts(0);
      return;
    }

    if (!jobs.length) {
      pane.innerHTML =
        '<div class="hist-empty">' +
        '<p class="empty-note">No audio batches yet. Turn trade-show recordings, supplier calls or voice notes into a comparison Excel.</p>' +
        '<button type="button" class="btn btn-primary btn-sm" data-open-audio onclick="window.openAudioIntelModal && window.openAudioIntelModal(); return false;">Launch Audio-to-Intel →</button>' +
        '</div>';
      paintHistoryCounts(0);
      return;
    }

    pane.innerHTML =
      '<div class="hist-list">' + jobs.map(historyCardHtml).join('') + '</div>';
    paintHistoryCounts(jobs.length);
  }

  window.renderAudioIntelHistory = function (body) {
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
      var candidates = [job.job_id, job.display_id, job.id, audRef(job)];
      for (var c = 0; c < candidates.length; c += 1) {
        if (candidates[c] && String(candidates[c]) === key) return job;
      }
    }
    var current = currentJob();
    if (current) {
      var own = [current.job_id, current.display_id, audRef(current)];
      for (var o = 0; o < own.length; o += 1) {
        if (own[o] && String(own[o]) === key) return current;
      }
    }
    return null;
  }

  function openAudioHistoryJob(ref) {
    var job = findJobByRef(ref);
    if (job) {
      rememberJob(job);
      if (currentRoute() === 'audio-results') renderAudioIntelResults(job);
      else window.location.hash = '#audio-results';
      return;
    }

    var token = readToken();
    var fallback = currentJob();
    if (fallback) {
      rememberJob(fallback);
      if (currentRoute() === 'audio-results') renderAudioIntelResults(fallback);
      else window.location.hash = '#audio-results';
    } else {
      window.location.hash = '#audio-results';
    }
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
            audRef(item) === String(ref)
          ) {
            match = item;
            break;
          }
        }
        if (match) {
          rememberJob(match);
          renderAudioIntelResults(match);
        }
      })
      .catch(function () {
        /* keep cached view */
      });
  }

  window.openAudioIntelHistoryJob = openAudioHistoryJob;

  /* ======================= I. ROUTING & LISTENERS ======================== */

  function ensureHistory() {
    var pane = $('#historyAudioIntel');
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
    /* Give app.js' own /account/history fetch a moment to forward its payload. */
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
          window.renderAudioIntelHistory(body);
        })
        .catch(function () {
          historyLoading = false;
          if (!historyJobs.length) {
            pane.innerHTML =
              '<div class="hist-empty"><p class="empty-note">Could not load your audio batches right now. ' +
              '<button type="button" class="btn btn-ghost btn-sm" data-aud-history-retry>Try again</button></p></div>';
          }
        });
    }, 600);
  }

  function onRoute() {
    var route = currentRoute();
    if (route === 'audio-results') renderAudioIntelResults();
    if (route === 'plans') ensureHistory();
  }

  function onDocumentClick(event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    /* Belt-and-suspenders for the agent card CTA. */
    var card = target.closest('#audioIntelCard');
    if (card && (target.closest('[data-open-audio]') || target.closest('.btn-subscribe'))) {
      event.preventDefault();
      window.openAudioIntelModal();
      return;
    }

    var viewBtn = target.closest('[data-audio-view]');
    if (viewBtn) {
      event.preventDefault();
      openAudioHistoryJob(viewBtn.getAttribute('data-audio-view'));
      return;
    }

    var dlBtn = target.closest('[data-audio-download]');
    if (dlBtn) {
      event.preventDefault();
      downloadAudioIntel(dlBtn.getAttribute('data-audio-download'));
      return;
    }

    var retry = target.closest('[data-aud-history-retry]');
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
