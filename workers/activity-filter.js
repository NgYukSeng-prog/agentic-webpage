/* ============================================================================
   LiteWork — My Activity compact toolbar (search · worker · status · collapse)
   ----------------------------------------------------------------------------
   Standalone helper loaded with <script defer> AFTER app.js and the worker
   modules. It only reads the already-rendered history DOM and toggles
   visibility, so all data loading, View and Download actions keep working
   exactly as before.

     · #historySearchInput     live keyword filter across every card
     · #historyWorkerSelect    worker dropdown, live counts, zeros sorted last
     · #historyStatusFilter    All / Active / Past segmented toggle
     · Auto-hide empty worker sections in the "All Workers" view
     · Collapse >3 runs per section behind "Show all N runs ▾"
     · Single "No matching activity found" card with Reset filters
   ========================================================================== */
(function () {
  'use strict';

  var CFG = window.CONFIG || {};
  var TOKEN_KEY = CFG.AUTH_TOKEN_KEY || 'aaas_token';
  var ITEMS_PER_PAGE = 5;

  var panes = null;
  var searchInput = null;
  var workerSelect = null;
  var statusWrap = null;
  var toolbar = null;

  var state = {
    worker: 'all',
    status: 'all',
    query: '',
    pages: {}
  };

  var lastSignature = '';
  var lastSelectSignature = '';
  var observer = null;
  var debounceTimer = null;

  /* ------------------------------- helpers ------------------------------- */

  function $(selector, scope) {
    return (scope || document).querySelector(selector);
  }

  function $$(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
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

  function currentRoute() {
    return String(window.location.hash || '')
      .replace(/^#\/?/, '')
      .split('?')[0]
      .toLowerCase();
  }

  function groupKey(group) {
    return group.getAttribute('data-hist-group') || '';
  }

  function groupName(group) {
    var h3 = group.querySelector('.hist-group-head h3');
    return h3 ? h3.textContent.replace(/\s+/g, ' ').trim() : groupKey(group);
  }

  function paneOf(group) {
    var head = group.querySelector('.hist-group-head');
    return head ? head.nextElementSibling : null;
  }

  function cardsOf(group) {
    return $$('.hist-card', group);
  }

  function isActiveCard(card) {
    if (!card || card.classList.contains('is-expired')) return false;
    var badges = $$('.hist-badge', card)
      .map(function (badge) {
        return String(badge.textContent || '').trim().toLowerCase();
      })
      .join(' ');
    if (/expired|completed|ended|failed|cancelled|canceled|\bdone\b/.test(badges)) {
      return false;
    }
    if (/active|running|processing|queued|healthy|warning|\bdown\b|live|tracking/.test(badges)) {
      return true;
    }
    return false;
  }

  function cardMatches(card, query, status) {
    if (status !== 'all') {
      var active = isActiveCard(card);
      if (status === 'active' && !active) return false;
      if (status === 'past' && active) return false;
    }
    if (query) {
      var text = String(card.textContent || '').toLowerCase();
      if (text.indexOf(query) === -1) return false;
    }
    return true;
  }

  /* ---------------------------- dropdown build --------------------------- */

  function buildWorkerSelect() {
    if (!workerSelect || !panes) return;
    var entries = $$('.hist-group', panes).map(function (group) {
      return {
        key: groupKey(group),
        name: groupName(group),
        count: cardsOf(group).length
      };
    });

    var positive = entries
      .filter(function (entry) {
        return entry.count > 0;
      })
      .sort(function (a, b) {
        if (b.count !== a.count) return b.count - a.count;
        return a.name.localeCompare(b.name);
      });
    var zero = entries
      .filter(function (entry) {
        return entry.count === 0;
      })
      .sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });

    var total = entries.reduce(function (sum, entry) {
      return sum + entry.count;
    }, 0);

    var signature = JSON.stringify(
      entries.map(function (entry) {
        return [entry.key, entry.name, entry.count];
      })
    );
    if (signature === lastSelectSignature) {
      if (state.worker !== 'all' && !entries.some(function (e) { return e.key === state.worker; })) {
        state.worker = 'all';
        workerSelect.value = 'all';
      }
      return;
    }
    lastSelectSignature = signature;

    var frag = document.createDocumentFragment();
    var allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All Workers (' + total + ')';
    frag.appendChild(allOption);

    positive.concat(zero).forEach(function (entry) {
      var option = document.createElement('option');
      option.value = entry.key;
      option.textContent = entry.name + ' (' + entry.count + ')';
      if (!entry.count) {
        option.textContent = '— ' + option.textContent;
        option.style.color = '#94a3b8';
      }
      frag.appendChild(option);
    });

    workerSelect.innerHTML = '';
    workerSelect.appendChild(frag);

    if (state.worker !== 'all' && !entries.some(function (e) { return e.key === state.worker; })) {
      state.worker = 'all';
    }
    workerSelect.value = state.worker;
  }

  /* ------------------------------ apply view ----------------------------- */

  function removeInjected() {
    $$('.af-toggle, .af-pager, .af-group-empty, [data-af-empty]', panes).forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  }

  function pageNumbers(current, pages) {
    var out = [];
    if (pages <= 7) {
      for (var i = 1; i <= pages; i += 1) out.push(i);
      return out;
    }
    var wanted = [1, current - 1, current, current + 1, pages]
      .filter(function (n) {
        return n >= 1 && n <= pages;
      })
      .sort(function (a, b) { return a - b; });
    var unique = [];
    wanted.forEach(function (n) {
      if (unique.indexOf(n) === -1) unique.push(n);
    });
    var rendered = [];
    unique.forEach(function (n) {
      if (rendered.length && n - rendered[rendered.length - 1] > 1) rendered.push('…');
      rendered.push(n);
    });
    return rendered;
  }

  function pagerHtml(key, page, pages, total) {
    var start = (page - 1) * ITEMS_PER_PAGE + 1;
    var end = Math.min(page * ITEMS_PER_PAGE, total);
    var nums = pageNumbers(page, pages)
      .map(function (item) {
        if (item === '…') return '<span class="af-pager-gap" aria-hidden="true">…</span>';
        var active = item === page;
        return (
          '<button type="button" class="af-page-num' + (active ? ' is-active' : '') + '"' +
          ' data-af-page="' + item + '" data-af-group="' + key + '"' +
          ' aria-label="Page ' + item + '"' +
          (active ? ' aria-current="page"' : '') + '>' + item + '</button>'
        );
      })
      .join('');

    return (
      '<div class="af-pager" data-af-pager="' + key + '">' +
      '<span class="af-pager-info">Showing ' + start + '–' + end + ' of ' + total + '</span>' +
      '<div class="af-pager-controls">' +
      '<button type="button" class="af-page-btn" data-af-page="prev" data-af-group="' + key + '"' +
      (page <= 1 ? ' disabled' : '') + '>← Prev</button>' +
      '<div class="af-pager-nums">' + nums + '</div>' +
      '<button type="button" class="af-page-btn" data-af-page="next" data-af-group="' + key + '"' +
      (page >= pages ? ' disabled' : '') + '>Next →</button>' +
      '</div>' +
      '</div>'
    );
  }

  function showEmptyCard() {
    var card = document.createElement('div');
    card.className = 'af-empty';
    card.setAttribute('data-af-empty', '1');
    card.innerHTML =
      '<strong>No matching activity found</strong>' +
      '<span>Try a different search or reset the filters to see all runs.</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-af-reset>Reset filters</button>';
    panes.appendChild(card);
  }

  function apply() {
    if (!panes) return;
    var groups = $$('.hist-group', panes);
    if (!groups.length) return;

    var query = String(state.query || '').trim().toLowerCase();
    var loggedIn = !!readToken();
    var totalCards = groups.reduce(function (sum, group) {
      return sum + cardsOf(group).length;
    }, 0);

    /* While the account history is still loading, leave the panes alone. */
    var loadingText = String(panes.textContent || '');
    if (
      !loggedIn ||
      (totalCards === 0 && /loading your|log in to load/i.test(loadingText))
    ) {
      groups.forEach(function (group) {
        group.hidden = false;
      });
      removeInjected();
      if (workerSelect) workerSelect.value = 'all';
      return;
    }

    var plan = groups.map(function (group) {
      var cards = cardsOf(group);
      var matched = cards.filter(function (card) {
        return cardMatches(card, query, state.status);
      });
      return { group: group, key: groupKey(group), cards: cards, matched: matched };
    });

    var totalMatched = plan.reduce(function (sum, entry) {
      return sum + entry.matched.length;
    }, 0);

    var signature = JSON.stringify({
      worker: state.worker,
      status: state.status,
      query: query,
      pages: state.pages,
      plan: plan.map(function (entry) {
        return [entry.key, entry.cards.length, entry.matched.length];
      })
    });
    if (signature === lastSignature) {
      buildWorkerSelect();
      return;
    }
    lastSignature = signature;

    removeInjected();

    var selectedEntry =
      state.worker === 'all'
        ? null
        : plan.filter(function (entry) {
            return entry.key === state.worker;
          })[0] || null;

    /* Specific worker with no runs at all → show its normal empty state. */
    var showNormalEmpty = selectedEntry && selectedEntry.cards.length === 0;

    plan.forEach(function (entry) {
      var visible;
      if (state.worker !== 'all') {
        visible = entry.key === state.worker;
      } else {
        visible = entry.matched.length > 0;
      }
      entry.group.hidden = !visible;
      entry.cards.forEach(function (card) {
        card.style.display = '';
      });
    });

    if (totalMatched === 0 && !showNormalEmpty) {
      plan.forEach(function (entry) {
        entry.group.hidden = true;
      });
      showEmptyCard();
      buildWorkerSelect();
      return;
    }

    /* Paginate each visible section at ITEMS_PER_PAGE matching cards. */
    plan.forEach(function (entry) {
      if (entry.group.hidden) return;
      entry.cards.forEach(function (card) {
        card.style.display = 'none';
      });
      if (totalMatched === 0 || !entry.matched.length) return;

      var pages = Math.max(1, Math.ceil(entry.matched.length / ITEMS_PER_PAGE));
      var current = Number(state.pages[entry.key]) || 1;
      current = Math.max(1, Math.min(pages, current));
      state.pages[entry.key] = current;

      var start = (current - 1) * ITEMS_PER_PAGE;
      entry.matched
        .slice(start, start + ITEMS_PER_PAGE)
        .forEach(function (card) {
          card.style.display = '';
        });

      if (entry.matched.length > ITEMS_PER_PAGE) {
        var pane = paneOf(entry.group);
        if (pane) {
          pane.insertAdjacentHTML(
            'beforeend',
            pagerHtml(entry.key, current, pages, entry.matched.length)
          );
        }
      }
    });

    buildWorkerSelect();
  }

  function scheduleApply(delay) {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(function () {
      debounceTimer = null;
      apply();
    }, typeof delay === 'number' ? delay : 80);
  }

  function resetFilters() {
    state.worker = 'all';
    state.status = 'all';
    state.query = '';
    state.pages = {};
    lastSignature = '';
    if (searchInput) searchInput.value = '';
    if (workerSelect) workerSelect.value = 'all';
    if (statusWrap) {
      $$('[data-af-status]', statusWrap).forEach(function (btn) {
        var on = btn.getAttribute('data-af-status') === 'all';
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    apply();
  }

  /* ------------------------------- events -------------------------------- */

  function onPanesClick(event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    var pageBtn = target.closest('[data-af-page]');
    if (pageBtn) {
      event.preventDefault();
      var key = pageBtn.getAttribute('data-af-group');
      var action = pageBtn.getAttribute('data-af-page');
      var group = key
        ? panes.querySelector('[data-hist-group="' + key + '"]')
        : null;
      if (!group) return;

      var query = String(state.query || '').trim().toLowerCase();
      var matched = cardsOf(group).filter(function (card) {
        return cardMatches(card, query, state.status);
      });
      var pages = Math.max(1, Math.ceil(matched.length / ITEMS_PER_PAGE));
      var current = Number(state.pages[key]) || 1;
      if (action === 'prev') current -= 1;
      else if (action === 'next') current += 1;
      else current = Number(action) || 1;
      state.pages[key] = Math.max(1, Math.min(pages, current));
      lastSignature = '';
      apply();

      var head = group.querySelector('.hist-group-head') || group;
      if (head.scrollIntoView) {
        try {
          head.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (err) {
          head.scrollIntoView();
        }
      }
      return;
    }

    var reset = target.closest('[data-af-reset]');
    if (reset) {
      event.preventDefault();
      resetFilters();
    }
  }

  function bindControls() {
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        state.query = searchInput.value || '';
        state.pages = {};
        lastSignature = '';
        scheduleApply(120);
      });
    }

    if (workerSelect) {
      workerSelect.addEventListener('change', function () {
        state.worker = workerSelect.value || 'all';
        state.pages = {};
        lastSignature = '';
        apply();
      });
    }

    if (statusWrap) {
      statusWrap.addEventListener('click', function (event) {
        var btn = event.target.closest ? event.target.closest('[data-af-status]') : null;
        if (!btn) return;
        state.status = btn.getAttribute('data-af-status') || 'all';
        state.pages = {};
        lastSignature = '';
        $$('[data-af-status]', statusWrap).forEach(function (other) {
          var on = other === btn;
          other.classList.toggle('is-active', on);
          other.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        apply();
      });
    }
  }

  function observePanes() {
    if (!panes || !window.MutationObserver) return;
    if (observer) observer.disconnect();
    observer = new window.MutationObserver(function () {
      scheduleApply(120);
    });
    observer.observe(panes, { childList: true, subtree: true });
  }

  function activate() {
    panes = $('#historyPanes');
    toolbar = $('#historyToolbar');
    if (!panes || !toolbar) return;

    searchInput = $('#historySearchInput');
    workerSelect = $('#historyWorkerSelect');
    statusWrap = $('#historyStatusFilter');

    bindControls();
    buildWorkerSelect();
    apply();
    observePanes();
  }

  function init() {
    activate();
    window.addEventListener('hashchange', function () {
      if (currentRoute() === 'plans') {
        lastSignature = '';
        scheduleApply(300);
        scheduleApply(900);
      }
    });
    var refresh = $('#historyRefresh');
    if (refresh) {
      refresh.addEventListener('click', function () {
        lastSignature = '';
        scheduleApply(700);
      });
    }
    document.addEventListener('click', onPanesClick, true);
    /* Catch late worker renders (gold/audio/packaging/shopee). */
    window.setTimeout(function () {
      lastSignature = '';
      apply();
    }, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
