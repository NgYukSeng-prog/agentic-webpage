/* ============================================================================
   LiteWork — app.js
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

  /* Region tab grids for the stock picker (US · Malaysia · Singapore). */
  const STOCK_REGIONS =
    Array.isArray(CFG.STOCK_REGIONS) && CFG.STOCK_REGIONS.length
      ? CFG.STOCK_REGIONS
          .filter(function (region) {
            return region && region.id && Array.isArray(region.stocks) && region.stocks.length;
          })
          .map(function (region) {
            return {
              id: String(region.id),
              label: String(region.label || region.id),
              flag: String(region.flag || ''),
              markets: String(region.markets || ''),
              stocks: region.stocks
            };
          })
      : [
          {
            id: 'us',
            label: 'US Markets',
            flag: '🇺🇸',
            markets: 'NASDAQ · NYSE',
            stocks: Array.isArray(CFG.SUPPORTED_STOCKS) ? CFG.SUPPORTED_STOCKS : []
          }
        ];
  const DEFAULT_STOCK_REGION = String(
    CFG.DEFAULT_STOCK_REGION || (STOCK_REGIONS[0] && STOCK_REGIONS[0].id) || 'us'
  );

  /* Flattened universe — used for lookups and the default pre-selection. */
  const STOCKS = STOCK_REGIONS.reduce(function (all, region) {
    return all.concat(region.stocks);
  }, []);

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
  const ACCOUNT_HISTORY_URL = API_BASE + '/account/history';

  /* --- Billing (USD credit packs) ---------------------------------------- */
  const BILLING_CHECKOUT_URL = String(
    CFG.BILLING_CHECKOUT_URL || API_BASE + '/billing/create-checkout'
  );
  const CHECKOUT_MANUAL_EMAIL = String(
    CFG.CHECKOUT_MANUAL_EMAIL || 'group.litework@gmail.com'
  );

  /* --- Stock brief delivery: 5 trading days, weekends skipped ------------ */
  const TRADING_DAYS = toPositiveInt(CFG.STOCK_TRADING_DAYS, 5);
  const DELIVERY_NOTE = String(
    CFG.STOCK_DELIVERY_NOTE ||
      'Delivered every market morning at 07:00 MYT (skips Saturday & Sunday when US markets are closed — you always receive 5 full market-day briefs).'
  );
  const FREE_SIGNUP_CREDITS = toPositiveInt(CFG.FREE_SIGNUP_CREDITS, 5);
  /* Home layout: 'template1' | 'template2' | 'template3'. */
  const HOME_TEMPLATE = (function () {
    const t = String(CFG.HOME_TEMPLATE || 'template3').toLowerCase().trim();
    return t === 'template1' || t === 'template2' || t === 'template3' ? t : 'template3';
  })();
  const GOOGLE_CLIENT_ID = String(CFG.GOOGLE_CLIENT_ID || '').trim();
  const GOOGLE_GSI_SRC = 'https://accounts.google.com/gsi/client';

  /* B2B Lead Scraper: 1 search term = 50 leads (3 cr) or 100 leads (5 cr).
     Max 500 leads per run, so 100-lead mode caps at 5 terms. */
  const LEAD_OPTIONS =
    Array.isArray(CFG.LEAD_SCRAPER_LEADS_OPTIONS) && CFG.LEAD_SCRAPER_LEADS_OPTIONS.length
      ? CFG.LEAD_SCRAPER_LEADS_OPTIONS
          .map(function (option) {
            return {
              leads: toPositiveInt(option && option.leads, 50),
              credits: toPositiveInt(option && option.credits, 3),
              label: String((option && option.label) || (option && option.leads) + ' leads / term'),
              note: String((option && option.note) || (option && option.credits) + ' credits / term')
            };
          })
          .filter(function (option) { return option.leads > 0 && option.credits > 0; })
      : [
          { leads: 50, credits: 3, label: '50 leads / term', note: '3 credits / term' },
          { leads: 100, credits: 5, label: '100 leads / term', note: '5 credits / term' }
        ];
  const LEAD_MAX_LEADS = toPositiveInt(CFG.LEAD_SCRAPER_MAX_LEADS, 500);
  const LEAD_CREDITS_PER_TERM = toPositiveInt(CFG.LEAD_SCRAPER_CREDITS_PER_TERM, LEAD_OPTIONS[0].credits);
  const LEAD_LEADS_PER_TERM = toPositiveInt(CFG.LEAD_SCRAPER_LEADS_PER_TERM, LEAD_OPTIONS[0].leads);
  const LEAD_MIN_CREDITS = toPositiveInt(CFG.LEAD_SCRAPER_MIN_CREDITS, LEAD_OPTIONS[0].credits);
  const LEAD_MAX_TERMS = toPositiveInt(CFG.LEAD_SCRAPER_MAX_TERMS, 10);
  const LEAD_MAX_TARGET = LEAD_MAX_LEADS;
  let scraperLeadsPerTerm = LEAD_OPTIONS[0].leads;

  function leadOptionFor(leads) {
    const wanted = toPositiveInt(leads, LEAD_OPTIONS[0].leads);
    for (let i = 0; i < LEAD_OPTIONS.length; i += 1) {
      if (LEAD_OPTIONS[i].leads === wanted) return LEAD_OPTIONS[i];
    }
    return LEAD_OPTIONS[0];
  }

  /* 100 leads → 5 terms · 50 leads → 10 terms (never above LEAD_MAX_LEADS). */
  function leadMaxTermsFor(leads) {
    const per = toPositiveInt(leads, LEAD_OPTIONS[0].leads);
    return Math.max(1, Math.min(LEAD_MAX_TERMS, Math.floor(LEAD_MAX_LEADS / per)));
  }
  const LEAD_AGENT_ID = CFG.LEAD_SCRAPER_AGENT_ID || 'b2b-lead-scraper';
  const LEAD_AGENT_NAME = CFG.LEAD_SCRAPER_AGENT_NAME || 'Lead Scraper Agent';
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
        { id: 'phone', label: 'Phone Number' }
      ];
  const LEAD_OPTIONAL_COLUMNS = Array.isArray(CFG.LEAD_SCRAPER_OPTIONAL_COLUMNS)
    ? CFG.LEAD_SCRAPER_OPTIONAL_COLUMNS
    : [];
  const RING_LENGTH = 364.42; // 2 * PI * 58

  /* --- Invoice OCR agent (3rd live worker) ------------------------------- */
  const INV_AGENT_ID = CFG.INVOICE_OCR_AGENT_ID || 'invoice-ocr';
  const INV_AGENT_NAME = CFG.INVOICE_OCR_AGENT_NAME || 'Invoice OCR Agent';
  const INV_TIER_1_MAX = toPositiveInt(CFG.INVOICE_OCR_TIER_1_MAX, 5);
  const INV_TIER_1_CREDITS = toPositiveInt(CFG.INVOICE_OCR_TIER_1_CREDITS, 5);
  const INV_TIER_2_MAX = toPositiveInt(CFG.INVOICE_OCR_TIER_2_MAX, 15);
  const INV_TIER_2_CREDITS = toPositiveInt(CFG.INVOICE_OCR_TIER_2_CREDITS, 10);
  const INV_MAX_FILE_BYTES = (Number(CFG.INVOICE_OCR_MAX_FILE_MB) || 10) * 1024 * 1024;
  const INV_POLL_MS = toPositiveInt(CFG.INVOICE_OCR_POLL_MS, 2500);
  const INV_START_URL = CFG.INVOICE_OCR_START_URL || '';
  const INV_STATUS_URL = CFG.INVOICE_OCR_STATUS_URL || '';
  const INV_DOWNLOAD_URL = CFG.INVOICE_OCR_DOWNLOAD_URL || '';
  const INV_ACCEPT =
    CFG.INVOICE_OCR_ACCEPT || '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp';
  const INV_COLUMNS =
    Array.isArray(CFG.INVOICE_OCR_COLUMNS) && CFG.INVOICE_OCR_COLUMNS.length
      ? CFG.INVOICE_OCR_COLUMNS
      : [
          'Source File',
          'Document Type',
          'Invoice Number',
          'Invoice Date',
          'Due Date',
          'Payment Terms',
          'Supplier Name',
          'Supplier TIN',
          'Supplier BRN / UEN',
          'Supplier SST / GST Reg',
          'MyInvois UUID / Status',
          'Buyer Name',
          'PO / Ref No.',
          'Currency',
          'Subtotal',
          'Tax Type & Rate',
          'Tax Amount',
          'Discount / Rounding',
          'Grand Total',
          'Payment Status / Method',
          'Confidence / Notes'
        ];
  const INV_SHEET2_NOTE = 'Sheet 2: Itemized Line Items';
  /* Both cloud workers can legitimately run for a long time (multi-term
     scraping / large invoice batches). Keep auto-polling for 30 minutes. */
  const STATUS_POLL_WINDOW_MS = 30 * 60 * 1000;

  /* --- Lead Enricher agent (4th live worker) ------------------------------
     1–50 sites = 5 cr · 51–150 = 10 cr · 151–300 = 15 cr. */
  const LE_AGENT_ID = CFG.LEAD_ENRICHER_AGENT_ID || 'website-email-lead-enricher';
  const LE_AGENT_NAME = CFG.LEAD_ENRICHER_AGENT_NAME || 'Website & Email Lead Enricher';
  const LE_TIER_1_MAX = toPositiveInt(CFG.LEAD_ENRICHER_TIER_1_MAX, 50);
  const LE_TIER_1_CREDITS = toPositiveInt(CFG.LEAD_ENRICHER_TIER_1_CREDITS, 5);
  const LE_TIER_2_MAX = toPositiveInt(CFG.LEAD_ENRICHER_TIER_2_MAX, 150);
  const LE_TIER_2_CREDITS = toPositiveInt(CFG.LEAD_ENRICHER_TIER_2_CREDITS, 10);
  const LE_TIER_3_MAX = toPositiveInt(CFG.LEAD_ENRICHER_TIER_3_MAX, 300);
  const LE_TIER_3_CREDITS = toPositiveInt(CFG.LEAD_ENRICHER_TIER_3_CREDITS, 15);
  const LE_MAX_FILE_BYTES = (Number(CFG.LEAD_ENRICHER_MAX_FILE_MB) || 10) * 1024 * 1024;
  const LE_POLL_MS = toPositiveInt(CFG.LEAD_ENRICHER_POLL_MS, 2500);
  const LE_START_URL = CFG.LEAD_ENRICHER_START_URL || '';
  const LE_STATUS_URL = CFG.LEAD_ENRICHER_STATUS_URL || '';
  const LE_DOWNLOAD_URL = CFG.LEAD_ENRICHER_DOWNLOAD_URL || '';
  const LE_ACCEPT = CFG.LEAD_ENRICHER_ACCEPT || '.xlsx,.xls,.csv';
  const LE_COLUMNS =
    Array.isArray(CFG.LEAD_ENRICHER_COLUMNS) && CFG.LEAD_ENRICHER_COLUMNS.length
      ? CFG.LEAD_ENRICHER_COLUMNS
      : [
          'Public Email 1',
          'Public Email 2',
          'Email Source Page',
          'MX / DNS Status',
          'Website Status',
          'WhatsApp Number',
          'Facebook URL',
          'Instagram URL',
          'LinkedIn URL',
          'AI Outreach Opener'
        ];

  /* --- Review Miner agent (5th live worker) ------------------------------
     1–3 competitors = 5 cr · 4–5 competitors = 8 cr. */
  const RW_AGENT_ID = CFG.REVIEW_MINER_AGENT_ID || 'competitor-review-miner';
  const RW_AGENT_NAME = CFG.REVIEW_MINER_AGENT_NAME || 'Competitor Review Miner';
  const RW_TIER_1_MAX = toPositiveInt(CFG.REVIEW_MINER_TIER_1_MAX, 3);
  const RW_TIER_1_CREDITS = toPositiveInt(CFG.REVIEW_MINER_TIER_1_CREDITS, 5);
  const RW_TIER_2_MAX = toPositiveInt(CFG.REVIEW_MINER_TIER_2_MAX, 5);
  const RW_TIER_2_CREDITS = toPositiveInt(CFG.REVIEW_MINER_TIER_2_CREDITS, 8);
  const RW_POLL_MS = toPositiveInt(CFG.REVIEW_MINER_POLL_MS, 2500);
  const RW_START_URL = CFG.REVIEW_MINER_START_URL || '';
  const RW_STATUS_URL = CFG.REVIEW_MINER_STATUS_URL || '';
  const RW_DOWNLOAD_URL = CFG.REVIEW_MINER_DOWNLOAD_URL || '';
  const RW_SHEETS =
    Array.isArray(CFG.REVIEW_MINER_SHEETS) && CFG.REVIEW_MINER_SHEETS.length
      ? CFG.REVIEW_MINER_SHEETS
      : ['Executive Battlecard', 'Complaint Breakdown', 'Raw Reviews'];

  /* --- Property Deal Sniper (6th live worker) ----------------------------
     Instant Day-0 baseline + daily 08:00 MYT below-market watch.
     7 days = 5 credits · 14 days = 8 credits. */
  const PROP_AGENT_ID = CFG.PROPERTY_SCOUT_AGENT_ID || 'property-deal-scout';
  const PROP_AGENT_NAME = CFG.PROPERTY_SCOUT_AGENT_NAME || 'Property Deal Sniper (MY & SG)';
  const PROP_CREDITS = toPositiveInt(CFG.PROPERTY_SCOUT_CREDITS, 5);
  const PROP_CREDITS_14 = toPositiveInt(CFG.PROPERTY_SCOUT_CREDITS_14, 8);
  const PROP_DAYS = toPositiveInt(CFG.PROPERTY_SCOUT_DURATION_DAYS, 7);
  const PROP_MAX_DAYS = toPositiveInt(CFG.PROPERTY_SCOUT_MAX_DURATION_DAYS, 14);
  const PROP_MAX_DEALS = toPositiveInt(CFG.PROPERTY_SCOUT_MAX_DEALS, 50);
  const PROP_POLL_MS = toPositiveInt(CFG.PROPERTY_SCOUT_POLL_MS, 2500);
  const PROP_START_URL = CFG.PROPERTY_SCOUT_START_URL || '';
  const PROP_STATUS_URL = CFG.PROPERTY_SCOUT_STATUS_URL || '';
  const PROP_DOWNLOAD_URL = CFG.PROPERTY_SCOUT_DOWNLOAD_URL || '';
  const PROPERTY_LOCATIONS =
    CFG.PROPERTY_LOCATIONS && typeof CFG.PROPERTY_LOCATIONS === 'object'
      ? CFG.PROPERTY_LOCATIONS
      : { Malaysia: {}, Singapore: {} };
  const PROP_COUNTRY_CURRENCY = { Malaysia: 'MYR', Singapore: 'SGD' };

  /* --- Competitor Change Tracker (7th live worker) -----------------------
     5 credits / 7 days · up to 3 competitor URLs. */
  const CT_AGENT_ID = CFG.COMPETITOR_TRACKER_AGENT_ID || 'competitor-change-tracker';
  const CT_AGENT_NAME =
    CFG.COMPETITOR_TRACKER_AGENT_NAME || 'Competitor Website & Promo Change Tracker';
  const CT_CREDITS = toPositiveInt(CFG.COMPETITOR_TRACKER_CREDITS, 5);
  const CT_DAYS = toPositiveInt(CFG.COMPETITOR_TRACKER_DAYS, 7);
  const CT_MAX_URLS = toPositiveInt(CFG.COMPETITOR_TRACKER_MAX_URLS, 3);
  const CT_START_URL = CFG.COMPETITOR_TRACKER_START_URL || '';

  /* --- Website Watchdog (8th live worker) --------------------------------
     5 credits per site / 30 days · daily 06:00 MYT uptime, SSL, speed & broken links (1–3 sites). */
  const WDG_AGENT_ID = CFG.SITE_WATCHDOG_AGENT_ID || 'website-watchdog';
  const WDG_AGENT_NAME =
    CFG.SITE_WATCHDOG_AGENT_NAME || 'Website Uptime, SSL & Broken-Link Watchdog';
  const WDG_CREDITS_PER_SITE = toPositiveInt(
    CFG.SITE_WATCHDOG_CREDITS_PER_SITE || CFG.SITE_WATCHDOG_CREDITS,
    5
  );
  const WDG_DAYS = toPositiveInt(CFG.SITE_WATCHDOG_DAYS, 30);
  const WDG_MAX_URLS = toPositiveInt(CFG.SITE_WATCHDOG_MAX_URLS, 3);
  const WDG_START_URL =
    CFG.SITE_WATCHDOG_START_URL || API_BASE + '/site-watchdog-start';

  const INV_EXPORT_FORMATS =
    Array.isArray(CFG.INVOICE_OCR_EXPORT_FORMATS) && CFG.INVOICE_OCR_EXPORT_FORMATS.length
      ? CFG.INVOICE_OCR_EXPORT_FORMATS
      : [
          {
            id: 'standard',
            label: 'Standard LiteWork Excel',
            hint: '21-column Summary + Line Items sheets',
            subtitle: '21 MY/SG Summary Fields + Line Items Sheet',
            columns: INV_COLUMNS,
            note: 'Sheet 2: Itemized Line Items (7 columns)'
          },
          {
            id: 'xero',
            label: 'Xero Bills Ready',
            hint: 'Single-sheet Xero Bills import format — SG / Cloud SMEs',
            subtitle: '11 Xero Bills Import Columns · Single Sheet',
            columns: [
              '*ContactName',
              '*InvoiceNumber',
              '*InvoiceDate',
              '*DueDate',
              'Reference',
              '*Description',
              '*Quantity',
              '*UnitAmount',
              '*AccountCode',
              '*TaxType',
              'Currency'
            ],
            note: 'Single sheet ("Xero Bills") · Auto-includes Discount / Rounding lines'
          },
          {
            id: 'sql_autocount',
            label: 'SQL Account / AutoCount Ready',
            hint: 'Single-sheet MY accounting import format',
            subtitle: '19 Purchase-Invoice Columns · Single Sheet',
            columns: [
              'DocNo',
              'DocDate',
              'DueDate',
              'SupplierName',
              'SupplierTIN',
              'SupplierBRN',
              'SupplierSST',
              'MyInvoisUUID',
              'Currency',
              'PONo',
              'ItemDescription',
              'Qty',
              'UnitPrice',
              'TaxType',
              'TaxAmount',
              'SubTotal',
              'GrandTotal',
              'PaymentTerms',
              'Notes'
            ],
            note: 'Single sheet ("Purchase Invoices") · Ready for SQL Account, AutoCount & Bukku'
          }
        ];
  const INV_DEFAULT_EXPORT_FORMAT =
    String(CFG.INVOICE_OCR_DEFAULT_EXPORT_FORMAT || 'standard').toLowerCase() || 'standard';

  function invoiceExportFormatMeta(id) {
    const wanted = String(id || INV_DEFAULT_EXPORT_FORMAT).trim().toLowerCase();
    for (let i = 0; i < INV_EXPORT_FORMATS.length; i += 1) {
      if (String(INV_EXPORT_FORMATS[i].id || '').toLowerCase() === wanted) {
        return INV_EXPORT_FORMATS[i];
      }
    }
    return (
      INV_EXPORT_FORMATS[0] || {
        id: INV_DEFAULT_EXPORT_FORMAT,
        label: 'Standard LiteWork Excel',
        hint: ''
      }
    );
  }

  function invoiceExportColumnsSpec(id) {
    const format = invoiceExportFormatMeta(id);
    const columns =
      Array.isArray(format.columns) && format.columns.length ? format.columns : INV_COLUMNS;
    return {
      columns: columns,
      subtitle: String(format.subtitle || '21 MY/SG Summary Fields + Line Items Sheet'),
      note: String(format.note || INV_SHEET2_NOTE)
    };
  }

  function invoiceColumnsBlockHtml(id) {
    const spec = invoiceExportColumnsSpec(id);
    const chips = spec.columns
      .map(function (label) {
        return '<span class="inv-chip">' + escapeHtml(label) + '</span>';
      })
      .join('');
    return (
      '<p class="inv-cols-title">Fixed Excel Columns Extracted ' +
      '<span>(' + escapeHtml(spec.subtitle) + ')</span></p>' +
      '<div class="inv-chips">' + chips + '</div>' +
      '<p class="inv-chip-note">' + escapeHtml(spec.note) + '</p>'
    );
  }

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

  /* Multi-market formatting for the sample briefs (US · Bursa · SGX). */
  function briefMoney(brief, n) {
    const amount = Number(n);
    const value = Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
    const currency = String((brief && brief.currency) || 'USD').toUpperCase();
    if (currency === 'MYR') return 'RM' + value;
    if (currency === 'SGD') return 'S$' + value;
    return '$' + value;
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

  /* The 4 official LiteWork USD credit packs. config.js is the source of
     truth; this local copy keeps the page working if config.js is stale. */
  const FALLBACK_PACKS = [
    {
      id: 'starter',
      name: 'Starter',
      credits: 25,
      price: 5,
      rate: '$0.20 / credit',
      blurb: 'Best for trying your first batches',
      note: 'Pay once · credits never expire',
      features: [
        '25 credits · $5.00 USD',
        '$0.20 per credit',
        'Try any agent before scaling',
        'No auto-renewal'
      ]
    },
    {
      id: 'growth',
      name: 'Growth',
      credits: 60,
      price: 10,
      rate: '$0.167 / credit',
      bonus: '17% bonus',
      badge: 'Most Popular',
      popular: true,
      blurb: 'For solo founders & bookkeepers',
      note: 'Pay once · credits never expire',
      features: [
        '60 credits · $10.00 USD',
        '$0.167 per credit · 17% bonus',
        'Ideal for weekly agent runs',
        'No auto-renewal'
      ]
    },
    {
      id: 'business',
      name: 'Business',
      credits: 160,
      price: 25,
      rate: '$0.156 / credit',
      bonus: '22% bonus',
      blurb: 'For SME teams running monthly ops',
      note: 'Pay once · credits never expire',
      features: [
        '160 credits · $25.00 USD',
        '$0.156 per credit · 22% bonus',
        'Shared credit wallet for your team',
        'No auto-renewal'
      ]
    },
    {
      id: 'agency',
      name: 'Agency',
      credits: 350,
      price: 50,
      rate: '$0.143 / credit',
      bonus: '29% bonus',
      blurb: 'Best value for accounting firms & agencies',
      note: 'Pay once · credits never expire',
      features: [
        '350 credits · $50.00 USD',
        '$0.143 per credit · 29% bonus',
        'Best value per credit',
        'No auto-renewal'
      ]
    }
  ];

  const PACKS =
    Array.isArray(CFG.CREDIT_PACKS) && CFG.CREDIT_PACKS.length
      ? CFG.CREDIT_PACKS
      : FALLBACK_PACKS;

  function packById(packId) {
    const wanted = String(packId || '').trim();
    for (let i = 0; i < PACKS.length; i += 1) {
      if (String(PACKS[i].id) === wanted) return PACKS[i];
    }
    return null;
  }

  /* Realistic sample briefs used by the home preview + "live sample" modal.
     They mirror the delivered email: ticker + close, a 4-metric strip, both
     bias badges, and the Why Hold / Why Sell columns. Illustrative only. */
  const BRIEFS = {
    NVDA: {
      symbol: 'NVDA',
      name: 'NVIDIA Corporation',
      price: 138.42,
      changePct: 2.4,
      dayLow: 134.1,
      dayHigh: 139.02,
      low52: 86.62,
      high52: 153.13,
      marketCap: '$3.39T',
      pe: '64.2',
      fundamental: { hold: 62, sell: 38 },
      macd: { hold: 68, sell: 32 },
      takeaway:
        'Constructive structure, but momentum is flattening above the $132 shelf — hold rather than chase the open.',
      whyHold: [
        'Data-centre capex guidance reaffirmed for H2.',
        'Price keeps holding above the $132.40 support shelf.'
      ],
      whySell: [
        'MACD histogram is flattening as RSI cools from 58.',
        'At 64× earnings there is little room for a miss.'
      ]
    },
    AAPL: {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      price: 227.64,
      changePct: -0.8,
      dayLow: 226.2,
      dayHigh: 231.4,
      low52: 164.08,
      high52: 240.03,
      marketCap: '$3.44T',
      pe: '35.8',
      fundamental: { hold: 55, sell: 45 },
      macd: { hold: 50, sell: 50 },
      takeaway:
        'Mid-range and neutral — no edge until price closes above $234.50 or tests $218 support.',
      whyHold: [
        'Services mix sits at a record share of gross profit.',
        'Buyback programme cushions the downside.'
      ],
      whySell: [
        'EU App Store fee ruling pressures services margins.',
        'Supplier orders described as stable, not urgent.'
      ]
    },
    TSLA: {
      symbol: 'TSLA',
      name: 'Tesla, Inc.',
      price: 251.87,
      changePct: -2.9,
      dayLow: 249.4,
      dayHigh: 259.1,
      low52: 138.8,
      high52: 299.29,
      marketCap: '$802B',
      pe: '78.4',
      fundamental: { hold: 35, sell: 65 },
      macd: { hold: 28, sell: 72 },
      takeaway:
        'Bearish crossover with a widening histogram — rallies into $265 keep getting sold, so stay defensive.',
      whyHold: [
        'Energy storage deployments hit a quarterly record.',
        'Cash cushion still covers the current capex plan.'
      ],
      whySell: [
        'Delivery estimates trimmed on softer EU registrations.',
        'Fresh price cuts extended to two more markets.'
      ]
    },
    '1295.KL': {
      symbol: '1295.KL',
      name: 'Public Bank Berhad',
      currency: 'MYR',
      price: 4.55,
      changePct: 0.7,
      dayLow: 4.51,
      dayHigh: 4.58,
      low52: 3.92,
      high52: 4.72,
      marketCap: 'RM88.4B',
      pe: '12.6',
      fundamental: { hold: 66, sell: 34 },
      macd: { hold: 58, sell: 42 },
      takeaway:
        'Steady accumulation above the RM4.40 shelf — a defensive hold while loan growth guidance is reaffirmed.',
      whyHold: [
        'Asset quality stays strong with a stable impaired-loan ratio.',
        'Dividend yield near 5% keeps income funds supportive.'
      ],
      whySell: [
        'Net interest margin compresses as deposit costs creep up.',
        'MACD histogram is flattening just below the 4.60 resistance.'
      ]
    },
    'D05.SI': {
      symbol: 'D05.SI',
      name: 'DBS Group Holdings',
      currency: 'SGD',
      price: 65.44,
      changePct: 1.1,
      dayLow: 64.6,
      dayHigh: 65.88,
      low52: 52.3,
      high52: 68.1,
      marketCap: 'S$186B',
      pe: '12.9',
      fundamental: { hold: 70, sell: 30 },
      macd: { hold: 62, sell: 38 },
      takeaway:
        'Trend remains constructive above S$63 — hold through the dividend date rather than chase a stretched open.',
      whyHold: [
        'Record fee income and a fully covered dividend support the floor.',
        'Price holds above the S$63.20 breakout shelf.'
      ],
      whySell: [
        'Wealth-management flows cooled versus last quarter.',
        'Valuation near 1.5× book leaves little margin for a miss.'
      ]
    }
  };

  const TITLES = {
    home: 'LiteWork — Your Low-Cost AI Workforce',
    agents: 'AI Agents — 8 Live Workers, One Credit Wallet',
    plans: 'Manage My Plan — Subscriptions & History',
    topup: 'Top Up Credits — LiteWork',
    about: 'About Us — LiteWork',
    configure: 'Configure Your Worker — LiteWork',
    'scraper-results': 'Lead Scraper Results — LiteWork',
    'invoice-results': 'Invoice Results — LiteWork',
    'enricher-results': 'Lead Enricher Results — LiteWork',
    'review-results': 'Review Miner Results — LiteWork',
    'property-results': 'Property Sniper Results — LiteWork',
    'watchdog-results': 'Website Watchdog Report — LiteWork',
    success: 'Subscription Confirmed — LiteWork'
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
      scraperJob: null,
      invoiceJob: null,
      enricherJob: null,
      reviewJob: null,
      propertyJob: null,
      trackerJob: null,
      watchdogJob: null
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
            : null,
        invoiceJob:
          parsed.invoiceJob && typeof parsed.invoiceJob === 'object'
            ? parsed.invoiceJob
            : null,
        enricherJob:
          parsed.enricherJob && typeof parsed.enricherJob === 'object'
            ? parsed.enricherJob
            : null,
        reviewJob:
          parsed.reviewJob && typeof parsed.reviewJob === 'object'
            ? parsed.reviewJob
            : null,
        propertyJob:
          parsed.propertyJob && typeof parsed.propertyJob === 'object'
            ? parsed.propertyJob
            : null,
        trackerJob:
          parsed.trackerJob && typeof parsed.trackerJob === 'object'
            ? parsed.trackerJob
            : null,
        watchdogJob:
          parsed.watchdogJob && typeof parsed.watchdogJob === 'object'
            ? parsed.watchdogJob
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
          scraperJob: state.scraperJob || null,
          invoiceJob: state.invoiceJob || null,
          enricherJob: state.enricherJob || null,
          reviewJob: state.reviewJob || null,
          propertyJob: state.propertyJob || null,
          trackerJob: state.trackerJob || null,
          watchdogJob: state.watchdogJob || null
        })
      );
    } catch (err) {
      // Private mode / storage disabled — the session still works in memory.
      console.warn('[LiteWork] Could not persist state to localStorage.', err);
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
      console.warn('[LiteWork] Could not persist the session token.', err);
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

  /* The ONLY path that writes a credit balance after auth. */
  function setLiveCredits(value) {
    if (value === null || value === undefined || value === '') return false;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return false;
    state.credits = Math.floor(n);
    if (auth.user) auth.user.credits = state.credits;
    return true;
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
    let credits = 0;
    if (norm.user.credits !== null && Number.isFinite(Number(norm.user.credits))) {
      credits = Math.max(0, Math.floor(Number(norm.user.credits)));
    }

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

  /* Delivery email is always the authenticated account email. */
  function accountEmail() {
    return String((auth.user && auth.user.email) || '').trim();
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
      const avatarEl = $('#navAvatar');
      /* Compact pill: name (or email prefix) only — the email address stays
         inside Account Settings. */
      if (nameEl) nameEl.textContent = displayUserName(auth.user);
      if (avatarEl) avatarEl.innerHTML = avatarMarkup(auth.user.avatar_id, 'avatar--nav');
    }

    updateSubscribeButton();
    updateScraperButton();

    if (currentRoute() === 'plans') renderHistory();
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
        console.warn('[LiteWork] Could not refresh the live session.', err);
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
    historyState = {
      loaded: false,
      loading: false,
      stock: [],
      b2b: [],
      invoice: [],
      enricher: [],
      review: [],
      property: [],
      tracker: [],
      watchdog: []
    };
    historyPages = {
      stock: 1,
      b2b: 1,
      invoice: 1,
      enricher: 1,
      review: 1,
      property: 1,
      tracker: 1,
      watchdog: 1
    };
    stopScraperTimers();
    stopLeTimer();
    stopRwTimer();
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
      else if (gate.action === 'invoice') openInvoiceModal();
      else if (gate.action === 'enricher') openLeadEnricherModal();
      else if (gate.action === 'review') openReviewMinerModal();
      else if (gate.action === 'watchdog') openWatchdogModal();
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
  let googleGsiInitialized = false;
  let googleRenderRetryTimer = null;

  const GOOGLE_GSI_SELECTOR =
    'script[data-google-gsi], script[src*="accounts.google.com/gsi/client"]';

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

  function stopGoogleRenderRetry() {
    if (googleRenderRetryTimer) {
      window.clearTimeout(googleRenderRetryTimer);
      googleRenderRetryTimer = null;
    }
  }

  /* GSI must be initialised exactly once per page load. */
  function ensureGoogleGsiInitialized() {
    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
      return false;
    }
    if (!googleGsiInitialized) {
      googleGsiInitialized = true;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true
      });
    }
    return true;
  }

  function loadGoogleIdentity() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      return Promise.resolve();
    }
    if (googleScriptPromise) return googleScriptPromise;

    googleScriptPromise = new Promise(function (resolve, reject) {
      let settled = false;
      const finish = function (err) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (err) reject(err);
        else resolve();
      };
      const timeout = window.setTimeout(function () {
        finish(new Error('Google script load timed out'));
      }, 8000);

      /* One script tag only, whether it was injected here or in the HTML. */
      const existing = document.querySelector(GOOGLE_GSI_SELECTOR);
      if (existing) {
        if (window.google && window.google.accounts && window.google.accounts.id) {
          finish();
          return;
        }
        existing.addEventListener('load', function () { finish(); });
        existing.addEventListener('error', function () {
          finish(new Error('Google script failed to load'));
        });
        return;
      }
      const script = document.createElement('script');
      script.src = GOOGLE_GSI_SRC;
      script.async = true;
      script.defer = true;
      script.setAttribute('data-google-gsi', '1');
      script.onload = function () { finish(); };
      script.onerror = function () { finish(new Error('Google script failed to load')); };
      document.head.appendChild(script);
    }).catch(function (err) {
      googleScriptPromise = null;
      throw err;
    });

    return googleScriptPromise;
  }

  function showGoogleUnavailable(slot, note) {
    if (!slot || !slot.isConnected) return;
    stopGoogleRenderRetry();
    slot.classList.remove('is-loading', 'is-rendered');
    slot.innerHTML = googleDisabledMarkup(note || 'Google Sign-In is unavailable right now.');
  }

  function renderGoogleButton(slot, attempt) {
    if (!slot || !slot.isConnected) return;

    const container = slot.querySelector('#googleButton');
    if (!container) {
      stopGoogleRenderRetry();
      return;
    }

    /* The modal animation can briefly report a 0px width. Wait for layout. */
    if (!container.clientWidth) {
      if (attempt >= 15) {
        showGoogleUnavailable(slot, 'Google Sign-In is unavailable right now.');
        return;
      }
      stopGoogleRenderRetry();
      googleRenderRetryTimer = window.setTimeout(function () {
        renderGoogleButton(slot, attempt + 1);
      }, 60);
      return;
    }

    stopGoogleRenderRetry();

    if (!ensureGoogleGsiInitialized()) {
      showGoogleUnavailable(slot, 'Google Sign-In is unavailable right now.');
      return;
    }

    const btnWidth = Math.max(
      240,
      Math.min(380, Math.floor(container.clientWidth || 320))
    );

    /* Clear placeholders before GSI paints the official button. */
    const loading = slot.querySelector('#googleLoading');
    if (loading && loading.parentNode) loading.parentNode.removeChild(loading);
    container.innerHTML = '';
    slot.classList.remove('is-loading');
    slot.classList.add('is-rendered');

    try {
      window.google.accounts.id.renderButton(container, {
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        logo_alignment: 'left',
        width: btnWidth
      });
    } catch (err) {
      console.warn('[LiteWork] Google Sign-In renderButton failed.', err);
      showGoogleUnavailable(slot, 'Google Sign-In is unavailable right now.');
    }
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
    stopGoogleRenderRetry();

    const slot = $('#googleSlot');
    if (!slot) return;

    slot.classList.remove('is-loading', 'is-rendered');

    if (!GOOGLE_CLIENT_ID) {
      slot.innerHTML = googleDisabledMarkup('Not configured — add GOOGLE_CLIENT_ID to config.js.');
      return;
    }

    slot.classList.add('is-loading');
    slot.innerHTML =
      '<div class="google-loading" id="googleLoading">' +
      '  <button type="button" class="google-btn is-loading" disabled>' +
      '    <span class="google-loading-dot" aria-hidden="true"></span>' +
      '    <span class="google-btn-label">Loading Google Sign-In…</span>' +
      '  </button>' +
      '</div>' +
      '<div class="google-button-target" id="googleButton"></div>';

    loadGoogleIdentity()
      .then(function () {
        if (!slot.isConnected) return;
        if (!window.google || !window.google.accounts || !window.google.accounts.id) {
          throw new Error('Google Identity Services unavailable');
        }
        /* Initialize exactly once, then wait for the modal to settle. */
        ensureGoogleGsiInitialized();
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            renderGoogleButton(slot, 0);
          });
        });
      })
      .catch(function (err) {
        console.warn('[LiteWork] Google Sign-In could not load.', err);
        const failedScript = document.querySelector(GOOGLE_GSI_SELECTOR);
        if (
          failedScript &&
          !(window.google && window.google.accounts && window.google.accounts.id)
        ) {
          failedScript.remove();
        }
        showGoogleUnavailable(slot, 'Google Sign-In is unavailable right now.');
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
    if (title) title.textContent = isLogin ? 'Welcome back' : 'Create your free account';
    const sub = $('#authSub');
    if (sub) {
      sub.textContent = isLogin
        ? 'Log in to access your credits and live agents.'
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
        '<h2 class="modal-title" id="modalTitle"><span id="authTitle">Welcome back</span></h2>' +
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
        '<button type="button" class="acc-avatar-tile' +
        (avatar.id === currentId ? ' is-selected' : '') +
        '" data-avatar-choice="' + avatar.id + '" aria-pressed="' +
        (avatar.id === currentId ? 'true' : 'false') + '">' +
        avatarMarkup(avatar.id, 'avatar--picker') +
        '<span class="acc-avatar-name">' + escapeHtml(avatar.label) + '</span>' +
        '</button>'
      );
    }).join('');

    const currentAvatar = AVATARS.filter(function (a) { return a.id === currentId; })[0] || AVATARS[0];
    const displayName = displayUserName(auth.user);
    const userEmail = auth.user.email || '—';

    openModal(
      '<div class="acc-modal">' +
        '<div class="acc-header">' +
        '  <h2 class="modal-title" id="modalTitle">Account Settings</h2>' +
        '  <p class="acc-header-sub">Profile, live credit wallet, animated avatar &amp; session security</p>' +
        '</div>' +
        '<div class="acc-hero">' +
        '  <div class="acc-hero-avatar" id="avatarPreview">' +
        avatarMarkup(currentId, 'avatar--preview') +
        '  </div>' +
        '  <div class="acc-hero-info">' +
        '    <div class="acc-hero-top">' +
        '      <strong class="acc-hero-name">' + escapeHtml(displayName) + '</strong>' +
        '      <span class="acc-member-pill">Verified Account</span>' +
        '    </div>' +
        '    <p class="acc-hero-email" id="accountEmail">' + escapeHtml(userEmail) + '</p>' +
        '  </div>' +
        '</div>' +

        '<div class="acc-stats">' +
        '  <div class="acc-stat-card">' +
        '    <div class="acc-stat-copy">' +
        '      <span class="acc-stat-label">Available Credits</span>' +
        '      <strong class="acc-stat-value"><span data-credit-count>' + state.credits + '</span> <small>cr</small></strong>' +
        '    </div>' +
        '    <a class="btn btn-primary btn-sm acc-stat-btn" href="#topup" data-modal-close>Top Up Credits</a>' +
        '  </div>' +
        '  <div class="acc-stat-card">' +
        '    <div class="acc-stat-copy">' +
        '      <span class="acc-stat-label">Live Activity</span>' +
        '      <strong class="acc-stat-sub">Runs, watches &amp; history</strong>' +
        '    </div>' +
        '    <button type="button" class="btn btn-ghost btn-sm acc-stat-btn" id="accountHistoryBtn">Subscriptions &amp; History →</button>' +
        '  </div>' +
        '</div>' +

        '<div class="acc-section">' +
        '  <div class="acc-section-head">' +
        '    <div>' +
        '      <h3>Avatar</h3>' +
        '      <p>Animated SVG profile badge synced across devices</p>' +
        '    </div>' +
        '    <span class="acc-avatar-active" id="avatarPreviewName">' + escapeHtml(currentAvatar.label) + '</span>' +
        '  </div>' +
        '  <div class="acc-avatar-grid" id="avatarPicker" role="group" aria-label="Profile avatar">' +
        choices +
        '  </div>' +
        '  <p class="avatar-error" id="avatarError" role="alert"></p>' +
        '  <div class="acc-save-row">' +
        '    <button type="button" class="btn btn-primary" id="avatarSaveBtn">Save Avatar</button>' +
        '  </div>' +
        '</div>' +

        '<div class="acc-footer">' +
        '  <div class="acc-footer-meta">' +
        '    <button type="button" class="acc-reset-link" id="accountResetBtn">Reset Password</button>' +
        '    <span class="acc-footer-note">Email-verified accounts can request a 6-digit reset code.</span>' +
        '  </div>' +
        '  <button type="button" class="btn btn-danger-outline btn-sm" id="accountLogoutBtn">Log Out</button>' +
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
      const saveBtn = $('#avatarSaveBtn');
      if (saveBtn) {
        saveBtn.classList.remove('is-saved');
        saveBtn.textContent = 'Save Avatar';
      }
    };

    $$('#avatarPicker [data-avatar-choice]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyChoice(btn.getAttribute('data-avatar-choice'));
      });
    });

    const resetBtn = $('#accountResetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        const email = auth.user && auth.user.email ? String(auth.user.email) : '';
        closeModal(false);
        openAuthModal('login', 'Request a 6-digit verification code to reset your password.');
        authResetEmail = email;
        openForgotStep('request');
      });
    }

    const logoutBtn = $('#accountLogoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        closeModal(false);
        logoutUser();
      });
    }

    const historyBtn = $('#accountHistoryBtn');
    if (historyBtn) {
      historyBtn.addEventListener('click', function () {
        closeModal(false);
        if (window.location.hash === '#plans') {
          renderHistory(true);
          window.scrollTo(0, 0);
        } else {
          window.location.hash = '#plans';
        }
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
            saveBtn.disabled = false;
            saveBtn.classList.add('is-saved');
            saveBtn.textContent = '✓ Avatar Saved';
            toast('Avatar updated — it will follow you across devices.', 'success');
          });
        })
        .catch(function (error) {
          saveBtn.disabled = false;
          saveBtn.classList.remove('is-saved');
          saveBtn.textContent = 'Save Avatar';
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
  const ROUTES = [
    'home',
    'agents',
    'plans',
    'topup',
    'about',
    'configure',
    'scraper-results',
    'invoice-results',
    'enricher-results',
    'review-results',
    'property-results',
    'watchdog-results',
    'success'
  ];

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
      const agentRoutes =
        route === 'configure' ||
        route === 'success' ||
        route === 'scraper-results' ||
        route === 'invoice-results' ||
        route === 'enricher-results' ||
        route === 'review-results' ||
        route === 'property-results' ||
        route === 'watchdog-results';
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

    /* Every in-flight job keeps polling in the background — leaving a results
       page must never pause or cancel its status loop. The floating
       bottom-right pill mirrors the most recent active job. */
    ensureScraperRunning();
    ensureInvoiceRunning();
    ensureLeRunning();
    ensureRwRunning();
    ensurePropRunning();

    if (route === 'configure') {
      /* #configure is now a modal: show #agents underneath, then open it. */
      $$('.view').forEach(function (view) {
        view.classList.toggle('is-active', view.getAttribute('data-view') === 'agents');
      });
      enterConfigure();
    }
    if (route === 'plans') renderHistory();
    if (route === 'topup') renderTopup();
    if (route === 'success') renderSuccess();
    if (route === 'scraper-results') renderScraperResults();
    if (route === 'invoice-results') renderInvoiceResults();
    if (route === 'enricher-results') renderLeResults();
    if (route === 'review-results') renderRwResults();
    if (route === 'property-results') renderPropertyResults();
    if (route === 'watchdog-results') renderWatchdogResults();

    renderScraperCardStatus();
    if (route === 'agents') ensureScraperRunning();

    if ((route === 'agents' || route === 'scraper-results') &&
        state.scraperJob && state.scraperJob.status === 'completed' &&
        state.scraperJob.email_sent !== true && state.scraperJob.mode === 'live') {
      startEmailTrail();
    }

    document.title = TITLES[route] || TITLES.home;
    window.scrollTo(0, 0);

    updateJobDock();
  }

  /* ============ GLOBAL ACTIVE-JOB DOCK (multi-job AssistiveTouch) ========= */
  const JOB_DOCK_POS_KEY = 'lw_job_pill_pos';
  const JOB_DOCK_DISMISS_KEY = 'lw_job_dismissed';
  const JOB_DOCK_MARGIN = 12;
  const JOB_DOCK_DEFAULT_GAP = 20;
  const JOB_DOCK_DRAG_THRESHOLD = 6;

  /* In-progress states used by the five workers' backends. */
  const JOB_DOCK_RUNNING = [
    'running',
    'queued',
    'starting',
    'exporting',
    'processing',
    'pending',
    'waiting',
    'refreshing'
  ];
  const JOB_DOCK_DONE = ['completed', 'complete', 'success', 'done'];
  const JOB_DOCK_FAILED = ['failed', 'error', 'cancelled', 'canceled'];

  /* Jobs seen running in THIS session — only these may surface once finished.
     Old completed jobs restored from localStorage never enter this set. */
  const activeJobIds = new Set();
  let jobDockDrag = null;
  let jobDockSuppressClick = false;
  let lastJobDockSignature = '';

  function loadDismissedJobIds() {
    const set = new Set();
    try {
      const raw = window.sessionStorage.getItem(JOB_DOCK_DISMISS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) {
        list.forEach(function (id) {
          if (id) set.add(String(id));
        });
      }
    } catch (err) {
      /* sessionStorage unavailable — dismissal is session-memory only. */
    }
    return set;
  }

  const dismissedJobIds = loadDismissedJobIds();

  function saveDismissedJobIds() {
    try {
      window.sessionStorage.setItem(
        JOB_DOCK_DISMISS_KEY,
        JSON.stringify(Array.from(dismissedJobIds))
      );
    } catch (err) {
      /* ignore */
    }
  }

  function dismissJobDockId(id) {
    const key = String(id || '');
    if (!key) return;
    dismissedJobIds.add(key);
    saveDismissedJobIds();
    lastJobDockSignature = '';
    updateJobDock();
  }

  function findJobById(id) {
    const key = String(id || '');
    if (!key) return null;
    const jobs = [
      state.scraperJob,
      state.invoiceJob,
      state.enricherJob,
      state.reviewJob,
      state.propertyJob,
      state.trackerJob
    ];
    for (let i = 0; i < jobs.length; i += 1) {
      if (jobs[i] && String(jobs[i].job_id) === key) return jobs[i];
    }
    return null;
  }

  function jobDockStartedAt(job) {
    const raw = job && (job.started_at || job.created_at || job.submitted_at);
    const ms = raw ? new Date(raw).getTime() : NaN;
    return Number.isFinite(ms) ? ms : 0;
  }

  function jobDockNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function jobDockState(job) {
    const status = String((job && job.status) || '').toLowerCase();
    if (JOB_DOCK_RUNNING.indexOf(status) !== -1) return 'running';
    if (JOB_DOCK_DONE.indexOf(status) !== -1) return 'done';
    if (JOB_DOCK_FAILED.indexOf(status) !== -1) return 'failed';
    return '';
  }

  /* Build the visible stack: every in-progress job + only jobs that ran in
     this session and have just finished (until dismissed). */
  function jobDockEntries() {
    const defs = [
      {
        job: state.scraperJob,
        route: 'scraper-results',
        name: 'Lead Scraper',
        percent: jobDockNumber(scraperPercent(state.scraperJob))
      },
      {
        job: state.invoiceJob,
        route: 'invoice-results',
        name: 'Invoice OCR',
        percent: jobDockNumber(state.invoiceJob && state.invoiceJob.percent)
      },
      {
        job: state.enricherJob,
        route: 'enricher-results',
        name: 'Lead Enricher',
        percent: jobDockNumber(state.enricherJob && state.enricherJob.percent)
      },
      {
        job: state.reviewJob,
        route: 'review-results',
        name: 'Review Miner',
        percent: jobDockNumber(state.reviewJob && state.reviewJob.percent)
      },
      {
        job: state.propertyJob,
        route: 'property-results',
        name: 'Property Sniper',
        percent: jobDockNumber(state.propertyJob && state.propertyJob.percent)
      },
      {
        job: state.trackerJob,
        route: 'plans',
        name: 'Competitor Tracker',
        percent: 100
      }
    ];

    const entries = [];

    defs.forEach(function (def) {
      const job = def.job;
      if (!job || !job.job_id) return;

      const id = String(job.job_id);
      if (dismissedJobIds.has(id)) return;

      const stateName = jobDockState(job);

      if (stateName === 'running') {
        activeJobIds.add(id);
        entries.push({
          id: id,
          route: def.route,
          name: def.name,
          state: 'running',
          percent: clamp(jobDockNumber(def.percent), 0, 99),
          startedAt: jobDockStartedAt(job)
        });
        return;
      }

      /* Finished/failed jobs surface only if they ran in this session. */
      if (!activeJobIds.has(id)) return;

      if (stateName === 'done') {
        entries.push({
          id: id,
          route: def.route,
          name: def.name,
          state: 'done',
          percent: 100,
          startedAt: jobDockStartedAt(job)
        });
      } else if (stateName === 'failed') {
        entries.push({
          id: id,
          route: def.route,
          name: def.name,
          state: 'failed',
          percent: clamp(jobDockNumber(def.percent), 0, 99),
          startedAt: jobDockStartedAt(job)
        });
      }
    });

    return entries.sort(function (a, b) {
      return b.startedAt - a.startedAt;
    });
  }

  /* --- Header safe zone, persistence and magnetic edge snapping ---------- */
  function jobDockHeaderBottom() {
    const headerEl = document.querySelector('header, .site-header, .navbar');
    return headerEl ? headerEl.getBoundingClientRect().bottom : 72;
  }

  /* iOS Safari shrinks the visual viewport when the address bar collapses or
     the keyboard opens — clamp against the area the user can actually see. */
  function jobDockViewportHeight() {
    return window.visualViewport ? window.visualViewport.height : window.innerHeight;
  }

  /* Bounds cover the ENTIRE stack height, so the last row can never clip off
     the bottom and the first row can never hide behind the navbar. */
  function jobDockBounds(dock) {
    const width = dock.offsetWidth;
    const height = dock.offsetHeight;
    const viewportHeight = jobDockViewportHeight();
    const minTop = Math.ceil(jobDockHeaderBottom() + JOB_DOCK_MARGIN);
    const maxTop = Math.max(minTop, viewportHeight - height - JOB_DOCK_MARGIN);
    const maxLeft = Math.max(JOB_DOCK_MARGIN, window.innerWidth - width - JOB_DOCK_MARGIN);
    return { width: width, height: height, minTop: minTop, maxTop: maxTop, maxLeft: maxLeft };
  }

  function readJobDockPos() {
    try {
      const raw = window.localStorage.getItem(JOB_DOCK_POS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const top = Number(parsed && parsed.top);
      const side = parsed && parsed.side;
      if (Number.isFinite(top) && (side === 'left' || side === 'right')) {
        return { side: side, top: top };
      }
      /* Legacy {left, top} — derive the nearest side. */
      const left = Number(parsed && parsed.left);
      if (Number.isFinite(left) && Number.isFinite(top)) {
        return { side: left < window.innerWidth / 2 ? 'left' : 'right', top: top };
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  function saveJobDockPos(side, top) {
    try {
      window.localStorage.setItem(
        JOB_DOCK_POS_KEY,
        JSON.stringify({ side: side === 'left' ? 'left' : 'right', top: Math.round(top) })
      );
    } catch (err) {
      /* Private mode / storage disabled — position simply won't persist. */
    }
  }

  function clampJobDockTop(value, bounds) {
    return Math.min(Math.max(bounds.minTop, value), bounds.maxTop);
  }

  function clampJobDockLeft(value, bounds) {
    return Math.min(Math.max(JOB_DOCK_MARGIN, value), bounds.maxLeft);
  }

  function edgeLeftFor(side, bounds) {
    return side === 'left' ? JOB_DOCK_MARGIN : bounds.maxLeft;
  }

  /* Write the clamped position to the dock (no persistence). `bounds` may be
     passed in during a drag to avoid re-measuring on every pointermove. */
  function setJobDockPosition(left, top, bounds) {
    const dock = $('#jobDock');
    if (!dock || dock.hidden) return null;

    const b = bounds || jobDockBounds(dock);
    const clampedLeft = clampJobDockLeft(left, b);
    const clampedTop = clampJobDockTop(top, b);

    dock.style.left = clampedLeft + 'px';
    dock.style.top = clampedTop + 'px';
    dock.style.right = 'auto';
    dock.style.bottom = 'auto';

    return { left: clampedLeft, top: clampedTop, bounds: b };
  }

  /* Restore: pin to the saved side, strictly below the header safe zone.
     With no saved position, default to bottom-right (20px gap). */
  function restoreJobDockPosition() {
    const dock = $('#jobDock');
    if (!dock || dock.hidden) return;

    const bounds = jobDockBounds(dock);
    const saved = readJobDockPos();

    if (saved) {
      setJobDockPosition(edgeLeftFor(saved.side, bounds), clampJobDockTop(saved.top, bounds));
      return;
    }

    setJobDockPosition(
      bounds.maxLeft,
      clampJobDockTop(jobDockViewportHeight() - bounds.height - JOB_DOCK_DEFAULT_GAP, bounds)
    );
  }

  /* Magnetic snap: glide to the nearest left/right edge on release. */
  function snapJobDockToEdge() {
    const dock = $('#jobDock');
    if (!dock || dock.hidden) return null;

    const bounds = jobDockBounds(dock);
    const rect = dock.getBoundingClientRect();
    const centerX = rect.left + bounds.width / 2;
    const side = centerX < window.innerWidth / 2 ? 'left' : 'right';
    const targetLeft = edgeLeftFor(side, bounds);
    const targetTop = clampJobDockTop(rect.top, bounds);

    /* Spring-like glide only for the snap; drag tracking stays instant. */
    dock.classList.add('is-snapping');
    void dock.offsetWidth;
    setJobDockPosition(targetLeft, targetTop);
    saveJobDockPos(side, targetTop);

    window.setTimeout(function () {
      dock.classList.remove('is-snapping');
    }, 320);

    return { side: side, left: targetLeft, top: targetTop };
  }

  /* window.resize / orientationchange: re-pin to the saved edge. */
  function reclampJobDockPosition() {
    const dock = $('#jobDock');
    if (!dock || dock.hidden) return;

    const bounds = jobDockBounds(dock);
    const saved = readJobDockPos();

    if (saved) {
      const top = clampJobDockTop(saved.top, bounds);
      setJobDockPosition(edgeLeftFor(saved.side, bounds), top);
      saveJobDockPos(saved.side, top);
      return;
    }

    const rect = dock.getBoundingClientRect();
    setJobDockPosition(bounds.maxLeft, clampJobDockTop(rect.top, bounds));
  }

  function renderJobDockRows(entries) {
    return entries
      .map(function (entry) {
        const done = entry.state === 'done';
        const failed = entry.state === 'failed';
        const rowClass = done ? ' is-done' : failed ? ' is-failed' : '';
        const status = done ? 'Ready' : failed ? 'Failed' : Math.floor(entry.percent) + '%';
        const action = done || failed ? 'Open →' : 'View →';

        return (
          '<div class="job-dock-row' + rowClass + '" data-job-row="' + escapeHtml(entry.id) + '">' +
          '<span class="job-dock-grip" aria-hidden="true">⋮⋮</span>' +
          (done
            ? '<span class="job-dock-dot is-check" aria-hidden="true">✓</span>'
            : '<span class="job-dock-dot" aria-hidden="true"></span>') +
          '<span class="job-dock-name">' + escapeHtml(entry.name) + '</span>' +
          '<span class="job-dock-status">' + status + '</span>' +
          '<button type="button" class="job-dock-open" data-job-open="' + escapeHtml(entry.route) +
          '" data-job-id="' + escapeHtml(entry.id) + '">' + action + '</button>' +
          (done || failed
            ? '<button type="button" class="job-dock-x" data-job-dismiss="' + escapeHtml(entry.id) +
              '" aria-label="Dismiss ' + escapeHtml(entry.name) + ' status">×</button>'
            : '') +
          '</div>'
        );
      })
      .join('');
  }

  function updateJobDock() {
    /* Never rewrite the dock DOM mid-gesture: the 2.5s status poll would
       destroy the node currently under the finger on iPhone / iPad. */
    if (jobDockDrag) return;

    const dock = $('#jobDock');
    const rowsEl = $('#jobDockRows');
    if (!dock || !rowsEl) return;

    const route = currentRoute();
    /* A job's own results page never shows its dock row. */
    const entries = jobDockEntries().filter(function (entry) {
      return entry.route !== route;
    });

    if (!entries.length) {
      dock.hidden = true;
      lastJobDockSignature = '';
      return;
    }

    const signature = entries
      .map(function (entry) {
        return entry.id + ':' + entry.state + ':' + Math.floor(entry.percent);
      })
      .join('|');
    const wasHidden = dock.hidden;

    dock.hidden = false;

    if (signature !== lastJobDockSignature) {
      rowsEl.innerHTML = renderJobDockRows(entries);
      lastJobDockSignature = signature;
    }

    if (wasHidden) {
      restoreJobDockPosition();
    } else if (!jobDockDrag && !dock.classList.contains('is-snapping')) {
      /* Row count changes the stack height/width — re-pin to the saved edge
         and re-clamp the top so the whole stack stays in the safe area. */
      const rect = dock.getBoundingClientRect();
      const bounds = jobDockBounds(dock);
      const saved = readJobDockPos();
      const side = saved
        ? saved.side
        : rect.left + bounds.width / 2 < window.innerWidth / 2
        ? 'left'
        : 'right';
      setJobDockPosition(edgeLeftFor(side, bounds), rect.top, bounds);
    }
  }

  /* Track the dock at 60fps for whichever input started the gesture. */
  function moveJobDockTo(clientX, clientY) {
    if (!jobDockDrag) return;

    const dx = clientX - jobDockDrag.startX;
    const dy = clientY - jobDockDrag.startY;

    if (!jobDockDrag.moved) {
      if (Math.sqrt(dx * dx + dy * dy) <= JOB_DOCK_DRAG_THRESHOLD) return;
      jobDockDrag.moved = true;
      jobDockDrag.dragging = true;
      const dock = $('#jobDock');
      if (dock) {
        dock.classList.remove('is-snapping');
        dock.classList.add('is-dragging');
      }
    }

    const applied = setJobDockPosition(
      jobDockDrag.originLeft + dx,
      jobDockDrag.originTop + dy,
      jobDockDrag.bounds
    );

    /* Rebase the drag origin on the clamped result so over-dragging past an
       edge never creates a dead zone when the user drags back. */
    if (applied) {
      jobDockDrag.originLeft = applied.left - dx;
      jobDockDrag.originTop = applied.top - dy;
    }
  }

  /* Finish a gesture: persist + snap only if it became a drag. */
  function endJobDockDrag() {
    if (!jobDockDrag) return;

    const dock = $('#jobDock');
    const moved = jobDockDrag.moved;
    jobDockDrag = null;

    if (dock) {
      dock.classList.remove('is-dragging');
      if (moved) snapJobDockToEdge();
    }

    if (moved) {
      /* Swallow the synthetic click that follows a drag release. */
      jobDockSuppressClick = true;
      window.setTimeout(function () {
        jobDockSuppressClick = false;
      }, 350);
      /* DOM updates were paused during the gesture — refresh after release. */
      window.setTimeout(updateJobDock, 0);
    }
  }

  function bindJobDock() {
    const dock = $('#jobDock');
    if (!dock) return;

    /* Delegated click: View/Open/× keep working because pointer capture is
       only taken after a real drag starts (see moveJobDock). */
    dock.addEventListener('click', function (event) {
      if (jobDockSuppressClick) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const dismissBtn = event.target.closest
        ? event.target.closest('[data-job-dismiss]')
        : null;
      if (dismissBtn) {
        event.preventDefault();
        event.stopPropagation();
        dismissJobDockId(dismissBtn.getAttribute('data-job-dismiss'));
        return;
      }

      let openBtn = event.target.closest ? event.target.closest('[data-job-open]') : null;
      if (!openBtn) {
        /* Tapping the pill body (grip, name, %) opens its View → link. */
        const row = event.target.closest ? event.target.closest('[data-job-row]') : null;
        openBtn = row && row.querySelector ? row.querySelector('[data-job-open]') : null;
      }
      if (!openBtn) return;

      event.preventDefault();
      const id = openBtn.getAttribute('data-job-id') || '';
      const route = openBtn.getAttribute('data-job-open');
      if (!route) return;

      /* Opening a finished job marks it viewed so it never lingers. */
      if (jobDockState(findJobById(id)) === 'done') dismissJobDockId(id);
      window.location.hash = '#' + route;
    });

    /* A press anywhere on the dock (except ×) starts a drag. Movement past
       6px suppresses the click; a tap still opens View → immediately. */
    function beginJobDockDrag(clientX, clientY) {
      if (dock.hidden) return;

      /* Any fresh press clears the previous drag's click guard. */
      jobDockSuppressClick = false;

      /* Freeze any in-flight snap animation at the current visual spot. */
      const rect = dock.getBoundingClientRect();
      dock.classList.remove('is-snapping');
      dock.style.left = rect.left + 'px';
      dock.style.top = rect.top + 'px';
      dock.style.right = 'auto';
      dock.style.bottom = 'auto';

      jobDockDrag = {
        startX: clientX,
        startY: clientY,
        originLeft: rect.left,
        originTop: rect.top,
        moved: false,
        dragging: false,
        /* Measured once per gesture — stable for 60fps tracking. */
        bounds: jobDockBounds(dock)
      };
    }

    function jobDockPressAllowed(target) {
      return !(target && target.closest && target.closest('[data-job-dismiss]'));
    }

    /* Never intercept taps or scrolls aimed at form controls — iOS Safari
       needs the native gesture to open the virtual keyboard. */
    function isFormFieldTarget(target) {
      return !!(
        target &&
        target.closest &&
        target.closest('input, textarea, select, [contenteditable]')
      );
    }

    /* Touch Events: iPhone / iPad Safari track the finger on window so the
       gesture never dies when it leaves the pill. */
    dock.addEventListener(
      'touchstart',
      function (event) {
        if (dock.hidden) return;
        if (isFormFieldTarget(event.target)) return;
        const touch = event.touches && event.touches[0];
        if (!touch || !jobDockPressAllowed(event.target)) return;
        beginJobDockDrag(touch.clientX, touch.clientY);
      },
      { passive: true }
    );

    window.addEventListener(
      'touchmove',
      function (event) {
        if (!jobDockDrag) return;
        if (isFormFieldTarget(event.target)) return;
        const touch = event.touches && event.touches[0];
        if (!touch) return;
        moveJobDockTo(touch.clientX, touch.clientY);
        /* Pin the gesture to the dock ONLY after a real drag starts. */
        if (jobDockDrag && jobDockDrag.dragging === true && event.cancelable) {
          event.preventDefault();
        }
      },
      { passive: false }
    );

    window.addEventListener('touchend', endJobDockDrag);
    window.addEventListener('touchcancel', endJobDockDrag);

    /* Mouse Events (desktop + trackpad), ignoring the synthetic pair that
       follows a real touch. */
    let lastTouchAt = 0;
    dock.addEventListener(
      'touchstart',
      function () { lastTouchAt = Date.now(); },
      { passive: true }
    );
    dock.addEventListener(
      'touchend',
      function () { lastTouchAt = Date.now(); },
      { passive: true }
    );

    dock.addEventListener('mousedown', function (event) {
      if (dock.hidden || event.button !== 0) return;
      if (isFormFieldTarget(event.target)) return;
      if (Date.now() - lastTouchAt < 700) return;
      if (!jobDockPressAllowed(event.target)) return;
      beginJobDockDrag(event.clientX, event.clientY);
    });

    window.addEventListener('mousemove', function (event) {
      if (!jobDockDrag) return;
      if (isFormFieldTarget(event.target)) return;
      if (Date.now() - lastTouchAt < 700) return;
      moveJobDockTo(event.clientX, event.clientY);
      if (jobDockDrag && jobDockDrag.dragging === true && event.cancelable) {
        event.preventDefault();
      }
    });

    window.addEventListener('mouseup', function () {
      if (!jobDockDrag) return;
      if (Date.now() - lastTouchAt < 700) return;
      endJobDockDrag();
    });

    /* Keep the whole stack on-screen after resize / iPad rotation. */
    window.addEventListener('resize', reclampJobDockPosition);
    window.addEventListener('orientationchange', function () {
      window.setTimeout(reclampJobDockPosition, 250);
    });

    window.setInterval(updateJobDock, 1000);
    updateJobDock();
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
    btn.textContent = 'Launch Lead Scraper';

    if (caption) {
      /* Always visible: for signed-in users with credits the note is the
         product summary; otherwise it explains what is needed. */
      caption.hidden = false;
      if (!signedIn) {
        caption.innerHTML =
          'Log in for <strong>' + FREE_SIGNUP_CREDITS + ' free credits</strong> to launch this agent.';
      } else if (!enough) {
        caption.innerHTML =
          'Need ' + LEAD_MIN_CREDITS + ' credits (1 term · ' + LEAD_LEADS_PER_TERM +
          ' leads). <a href="#topup">Top up credits</a>.';
      } else {
        caption.innerHTML =
          LEAD_OPTIONS.map(function (option) {
            return option.credits + ' credits per ' + option.leads + '-lead term';
          }).join(' · ') + ' · Finished .xlsx emailed & downloadable.';
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
      /* Always visible: product summary when funded, prompt when not. */
      caption.hidden = false;
      if (!signedIn) {
        caption.innerHTML =
          'Log in for <strong>' + FREE_SIGNUP_CREDITS + ' free credits</strong> to subscribe.';
      } else if (!enough) {
        caption.innerHTML =
          'Need ' + CREDITS_PER_STOCK + ' credits for ' +
          TRADING_DAYS + ' trading days (1 stock · Mon–Fri). ' +
          '<a href="#topup">Top up credits</a>.';
      } else {
        caption.innerHTML =
          '07:00 MYT Mon–Fri · Skips US market weekends (' +
          TRADING_DAYS + ' full market briefs).';
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
  /* The preview mirrors the delivered 07:00 MYT email: a Daily Market Brief
     header, ticker + close, a 4-metric strip, both bias badges with a one-line
     takeaway, the Why Hold / Why Sell columns and a quiet disclaimer. */
  function briefDateLabel() {
    const offsetMs = (Number(CFG.TIMEZONE_OFFSET_HOURS) || 8) * 3600000;
    const myt = new Date(Date.now() + offsetMs);
    const y = myt.getUTCFullYear();
    const m = String(myt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(myt.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function briefBullets(items) {
    const list = Array.isArray(items) ? items : [];
    return (
      '<ul>' +
      list
        .map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; })
        .join('') +
      '</ul>'
    );
  }

  function renderBrief(symbol) {
    const b = BRIEFS[symbol];
    if (!b) return '';

    const up = Number(b.changePct) >= 0;
    const changeText =
      (up ? '+' : '-') + Math.abs(Number(b.changePct) || 0).toFixed(1) + '%';
    const fundamental = b.fundamental || { hold: 50, sell: 50 };
    const macd = b.macd || { hold: 50, sell: 50 };
    const dayRange =
      b.dayLow == null || b.dayHigh == null
        ? '—'
        : briefMoney(b, b.dayLow) + ' – ' + briefMoney(b, b.dayHigh);

    return (
      '<div class="brief brief-compact">' +
      '  <div class="brief-head">' +
      '    <div class="brief-agent">' +
      '      <span class="brief-avatar" aria-hidden="true">L</span>' +
      '      <div class="brief-agent-text">' +
      '        <strong>Daily Market Brief</strong>' +
      '        <span>Good morning · ' + escapeHtml(briefDateLabel()) + ' (MYT)</span>' +
      '      </div>' +
      '    </div>' +
      '    <span class="brief-tag">07:00 MYT</span>' +
      '  </div>' +
      '  <div class="brief-ident">' +
      '    <div class="brief-ident-main">' +
      '      <span class="brief-symbol">' + escapeHtml(b.symbol) + '</span>' +
      '      <span class="brief-company">' + escapeHtml(b.name || '') + '</span>' +
      '    </div>' +
      '    <div class="brief-ident-price">' +
      '      <span class="brief-close">' + briefMoney(b, b.price) + '</span>' +
      '      <span class="pill-change ' + (up ? 'up' : 'down') + '">' + changeText + '</span>' +
      '    </div>' +
      '  </div>' +
      '  <div class="brief-metrics">' +
      '    <div class="metric"><span>Day Range</span><strong>' + dayRange + '</strong></div>' +
      '    <div class="metric"><span>52-Wk Range</span><strong>' +
      briefMoney(b, b.low52) + ' – ' + briefMoney(b, b.high52) + '</strong></div>' +
      '    <div class="metric"><span>Market Cap</span><strong>' +
      escapeHtml(b.marketCap || '—') + '</strong></div>' +
      '    <div class="metric"><span>P/E Ratio</span><strong>' +
      escapeHtml(b.pe || '—') + '</strong></div>' +
      '  </div>' +
      '  <div class="brief-bias">' +
      '    <div class="brief-bias-head">' +
      '      <span>Fundamental / News Bias</span>' +
      '      <span class="bias-pills">' +
      '        <span class="bias-pill hold">Hold ' + (Number(fundamental.hold) || 0) + '%</span>' +
      '        <span class="bias-pill sell">Sell ' + (Number(fundamental.sell) || 0) + '%</span>' +
      '      </span>' +
      '    </div>' +
      '    <p class="brief-bias-note">' + escapeHtml(b.takeaway || '') + '</p>' +
      '  </div>' +
      '  <div class="brief-bias">' +
      '    <div class="brief-bias-head">' +
      '      <span>MACD Technical Bias</span>' +
      '      <span class="bias-pills">' +
      '        <span class="bias-pill hold">Hold ' + (Number(macd.hold) || 0) + '%</span>' +
      '        <span class="bias-pill sell">Sell ' + (Number(macd.sell) || 0) + '%</span>' +
      '      </span>' +
      '    </div>' +
      '  </div>' +
      '  <div class="brief-why">' +
      '    <div class="brief-why-col">' +
      '      <h4>Why Hold</h4>' + briefBullets(b.whyHold) +
      '    </div>' +
      '    <div class="brief-why-col">' +
      '      <h4>Why Sell</h4>' + briefBullets(b.whySell) +
      '    </div>' +
      '  </div>' +
      '  <div class="brief-foot">Informational only · Not financial advice</div>' +
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
        '<p class="modal-sub">This is exactly what lands in your inbox at 07:00 MYT — every market morning of your ' +
        TRADING_DAYS + '-trading-day window (Mon–Fri). Switch ticker to preview another brief.</p>' +
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

  /* ==================== G. TOP UP CREDITS + HISTORY ===================== */
  function renderTopup() {
    const grid = $('#packGrid');
    if (!grid) return;

    grid.innerHTML = PACKS.map(function (p) {
      const badgeLabel = p.badge || (p.popular ? 'Most Popular' : '');
      const bonus = p.bonus ? ' <span class="pack-bonus">(+' + escapeHtml(p.bonus) + ')</span>' : '';
      const rateLine = p.rate
        ? '<p class="pack-rate">' + escapeHtml(p.rate) + (p.bonus ? ' · +' + escapeHtml(p.bonus) : '') + '</p>'
        : '';
      return (
        '<article class="pack' + (p.popular ? ' is-popular' : '') + '">' +
        (badgeLabel ? '<span class="pack-badge">' + escapeHtml(badgeLabel) + '</span>' : '') +
        '<h2>' + escapeHtml(p.name) + '</h2>' +
        '<div class="pack-price"><span class="pack-currency">$</span>' +
        Number(p.price).toFixed(2) +
        '<span class="pack-unit">USD</span></div>' +
        '<p class="pack-blurb">' + escapeHtml(p.blurb) + '</p>' +
        '<div class="pack-credits"><strong>' + p.credits + '</strong> credits' + bonus + '</div>' +
        rateLine +
        '<ul class="pack-features">' +
        (Array.isArray(p.features) ? p.features : [])
          .map(function (f) { return '<li>' + escapeHtml(f) + '</li>'; })
          .join('') +
        '</ul>' +
        '<button type="button" class="btn ' + (p.popular ? 'btn-primary' : 'btn-ghost') +
        ' btn-block" data-buy="' + escapeHtml(p.id) + '">Buy Pack</button>' +
        '<p class="pack-note">' + escapeHtml(p.note || '') + '</p>' +
        '</article>'
      );
    }).join('');

    grid.querySelectorAll('[data-buy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openCheckout(btn.getAttribute('data-buy'));
      });
    });

    $$('[data-credit-count]').forEach(function (el) {
      el.textContent = String(state.credits);
    });
  }

  /* ---------------- Subscriptions & run history (per agent) --------------
     Loaded from GET /webhook/account/history with the session bearer token.
     Both agents are kept in separate lists so the UI can render clean tabs. */
  const HISTORY_PAGE_SIZE = 5;
  let historyState = {
    loaded: false,
    loading: false,
    stock: [],
    b2b: [],
    invoice: [],
    enricher: [],
    review: [],
    property: [],
    tracker: [],
    watchdog: []
  };
  let historyPages = {
    stock: 1,
    b2b: 1,
    invoice: 1,
    enricher: 1,
    review: 1,
    property: 1,
    tracker: 1,
    watchdog: 1
  };

  function historySource(body) {
    if (body && typeof body === 'object' && body.data && typeof body.data === 'object') {
      return body.data;
    }
    return body && typeof body === 'object' ? body : {};
  }

  function pickArray(source, keys) {
    for (let i = 0; i < keys.length; i += 1) {
      const value = source ? source[keys[i]] : null;
      if (Array.isArray(value)) return value;
    }
    return [];
  }

  function firstValue(source, keys, fallback) {
    for (let i = 0; i < keys.length; i += 1) {
      const value = source ? source[keys[i]] : null;
      if (value !== null && value !== undefined && String(value).trim() !== '') return value;
    }
    return fallback;
  }

  function normalizeHistorySub(raw) {
    const sub = raw && typeof raw === 'object' ? raw : {};
    const tickersRaw = firstValue(
      sub,
      ['tickers', 'watchlist', 'selected_tickers', 'symbols', 'stocks', 'ticker'],
      null
    );
    let tickers = [];
    if (Array.isArray(tickersRaw)) tickers = tickersRaw.slice();
    else if (typeof tickersRaw === 'string') {
      tickers = tickersRaw.split(/[,\s]+/).filter(function (t) { return !!t; });
    }
    const expiresAt = firstValue(
      sub,
      ['expires_at', 'expiresAt', 'expiry_date', 'end_date', 'end'],
      ''
    );
    const startedAt = firstValue(
      sub,
      ['started_at', 'activated_at', 'start_date', 'created_at', 'createdAt'],
      ''
    );
    const status = String(firstValue(sub, ['status', 'state'], '')).toLowerCase();
    const expiredByDate =
      !!expiresAt && new Date(expiresAt).getTime() < Date.now();
    const expired =
      status === 'expired' ||
      status === 'cancelled' ||
      status === 'canceled' ||
      expiredByDate;

    return {
      tickers: tickers,
      active: !expired,
      email: String(
        firstValue(sub, ['delivery_email', 'email', 'user_email'], accountEmail()) || ''
      ),
      startedAt: startedAt,
      expiresAt: expiresAt,
      tradingDaysRemaining: firstValue(
        sub,
        ['trading_days_remaining', 'tradingDaysRemaining', 'trading_days_left', 'tradingDaysLeft'],
        ''
      ),
      credits: Number(
        firstValue(sub, ['credits_spent', 'creditsSpent', 'credits', 'credits_used'], 0)
      ) || 0
    };
  }

  function normalizeHistoryJob(raw) {
    const job = raw && typeof raw === 'object' ? raw : {};
    const termsRaw = firstValue(
      job,
      ['search_terms', 'terms', 'keywords', 'query', 'active_query'],
      ''
    );
    let terms = [];
    if (Array.isArray(termsRaw)) terms = termsRaw.slice();
    else if (typeof termsRaw === 'string') {
      terms = termsRaw.split(',').map(function (t) { return t.trim(); }).filter(function (t) { return !!t; });
    }

    /* Recorded Excel columns — used to block jobs with no Website column. */
    const columns = (function () {
      const raw = firstValue(
        job,
        ['selected_columns', 'columns', 'column_ids', 'column_keys', 'fields'],
        null
      );
      if (Array.isArray(raw)) {
        return raw.map(function (value) { return String(value); });
      }
      if (typeof raw === 'string' && raw.trim()) {
        return raw
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map(function (value) { return value.replace(/["'\s]/g, ''); })
          .filter(function (value) { return !!value; });
      }
      return [];
    })();

    const websiteFromColumns = columns.length
      ? columns.some(function (value) {
          const key = String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
          return (
            key === 'website' ||
            key === 'websiteurl' ||
            key === 'url' ||
            key === 'domain' ||
            key === 'mapsurl'
          );
        })
      : null;

    const explicitWebsite = (function () {
      const raw = firstValue(
        job,
        ['has_website', 'hasWebsite', 'website_included', 'includes_website'],
        null
      );
      if (raw === null) return null;
      if (typeof raw === 'boolean') return raw;
      const text = String(raw).trim().toLowerCase();
      if (['true', '1', 'yes', 'y'].indexOf(text) !== -1) return true;
      if (['false', '0', 'no', 'n'].indexOf(text) !== -1) return false;
      return null;
    })();

    /* Some backends mark a Lead Scraper job as already enriched. */
    const alreadyEnriched = (function () {
      const raw = firstValue(
        job,
        ['already_enriched', 'alreadyEnriched', 'is_enriched', 'enriched'],
        null
      );
      if (raw === true || raw === 1) return true;
      if (typeof raw === 'string') {
        const text = raw.trim().toLowerCase();
        return ['true', '1', 'yes', 'y', 'completed', 'done', 'enriched'].indexOf(text) !== -1;
      }
      return false;
    })();

    return {
      job_id: String(firstValue(job, ['job_id', 'id', 'jobId'], '')),
      display_id: String(firstValue(job, ['display_id', 'displayId', 'public_id'], '') || ''),
      country: String(firstValue(job, ['country', 'location', 'region'], '—')),
      terms: terms,
      scraped:
        Number(
          firstValue(job, ['scraped_rows', 'collected_count', 'leads_collected', 'count'], 0)
        ) || 0,
      target: Number(firstValue(job, ['target_count', 'target_rows', 'target'], 0)) || 0,
      status: String(firstValue(job, ['status', 'state'], 'completed')).toLowerCase(),
      created: firstValue(job, ['created_at', 'createdAt', 'started_at', 'date'], ''),
      completed: firstValue(job, ['completed_at', 'completedAt'], ''),
      credits:
        Number(firstValue(job, ['credits_spent', 'creditsSpent', 'credits', 'credits_used'], 0)) || 0,
      columns: columns,
      /* true/false when known, null when the backend never recorded it. */
      hasWebsite: explicitWebsite !== null ? explicitWebsite : websiteFromColumns,
      alreadyEnriched: alreadyEnriched,
      downloadReady:
        job.download_ready === true ||
        job.download_ready === 'true' ||
        job.download_ready === 1
    };
  }

  /* MYT calendar date for an arbitrary epoch value. */
  function mytDateString(ms) {
    const offsetMs = (Number(CFG.TIMEZONE_OFFSET_HOURS) || 8) * 3600000;
    const d = new Date(ms + offsetMs);
    return (
      d.getUTCFullYear() +
      '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getUTCDate()).padStart(2, '0')
    );
  }

  /* Live validity countdown for one subscription window. */
  function subscriptionValidity(expiresAt, startedAt) {
    const expiresMs = new Date(expiresAt).getTime();
    if (!expiresAt || !Number.isFinite(expiresMs)) {
      return { expired: false, label: 'No expiry', tone: 'muted', percent: 0, remainingMs: 0 };
    }

    const remaining = expiresMs - Date.now();
    if (remaining <= 0) {
      return { expired: true, label: 'Expired', tone: 'muted', percent: 0, remainingMs: 0 };
    }

    const startedMs = new Date(startedAt).getTime();
    const windowMs =
      Number.isFinite(startedMs) && startedMs < expiresMs
        ? expiresMs - startedMs
        : SUB_DAYS * 86400000;
    const percent = clamp((remaining / Math.max(windowMs, 86400000)) * 100, 2, 100);

    if (remaining < 86400000) {
      const expiresToday = mytDateString(expiresMs) === mytDateString(Date.now());
      return {
        expired: false,
        label: expiresToday ? 'Expires today' : '< 1 day left',
        tone: 'warn',
        percent: percent,
        remainingMs: remaining
      };
    }

    const days = Math.ceil(remaining / 86400000);
    return {
      expired: false,
      label: days + ' day' + (days === 1 ? '' : 's') + ' left',
      tone: 'ok',
      percent: percent,
      remainingMs: remaining
    };
  }

  function historyTime(value) {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }

  /* Remaining market weekdays (Mon–Fri) until expiry, in MYT.
     Prefers the server value `trading_days_remaining` when present.      */
  function tradingDaysRemaining(expiresAt, explicitValue) {
    if (
      explicitValue !== null &&
      explicitValue !== undefined &&
      String(explicitValue).trim() !== ''
    ) {
      const n = Number(explicitValue);
      if (Number.isFinite(n) && n >= 0) return clamp(Math.floor(n), 0, TRADING_DAYS);
    }

    const expiresMs = new Date(expiresAt).getTime();
    if (!expiresAt || !Number.isFinite(expiresMs)) return TRADING_DAYS;
    if (expiresMs <= Date.now()) return 0;

    const offsetMs = (Number(CFG.TIMEZONE_OFFSET_HOURS) || 8) * 3600000;
    const startDay = Math.floor((Date.now() + offsetMs) / 86400000);
    const endDay = Math.floor((expiresMs + offsetMs) / 86400000);
    let count = 0;

    /* Today is excluded — briefs arrive on future market mornings. */
    for (let day = startDay + 1; day <= endDay; day += 1) {
      const dow = new Date(day * 86400000).getUTCDay(); /* 0 Sun … 6 Sat */
      if (dow >= 1 && dow <= 5) count += 1;
    }
    return clamp(count, 0, TRADING_DAYS);
  }

  function tradingStepsHtml(remaining) {
    const filled = clamp(Number(remaining) || 0, 0, TRADING_DAYS);
    let steps = '';
    for (let i = 0; i < TRADING_DAYS; i += 1) {
      steps += '<span class="' + (i < filled ? 'is-on' : '') + '"></span>';
    }
    return (
      '<div class="hist-steps" role="img" aria-label="' + filled + ' of ' + TRADING_DAYS +
      ' trading days remaining">' + steps + '</div>'
    );
  }

  function sortNewestFirst(list, key) {
    return list.slice().sort(function (a, b) {
      return historyTime(b[key]) - historyTime(a[key]);
    });
  }

  /* Human-friendly reference shown in the UI; internal IDs stay for API calls. */
  function formatJobRef(item) {
    if (!item) return '';
    return item.display_id || item.job_id || item.watch_id || item.id || '';
  }

  /* Compact display_id chip for the history cards. */
  function histIdBadge(job) {
    const ref = formatJobRef(job);
    return ref ? '<span class="hist-id">' + escapeHtml(ref) + '</span>' : '';
  }

  /* Resolve a typed reference (display_id or internal id) to a history entry. */
  function findHistoryJob(list, ref) {
    const wanted = String(ref || '').trim();
    if (!wanted) return null;
    const entries = Array.isArray(list) ? list : [];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!entry) continue;
      if (
        String(entry.job_id || '') === wanted ||
        String(entry.display_id || '') === wanted
      ) {
        return entry;
      }
    }
    return null;
  }

  function normalizeInvoiceJob(raw) {
    const job = raw && typeof raw === 'object' ? raw : {};
    const filesRaw = firstValue(
      job,
      ['files_count', 'total_files', 'file_count', 'files_total', 'files'],
      0
    );
    const files = Array.isArray(filesRaw) ? filesRaw.length : Number(filesRaw) || 0;

    return {
      job_id: String(firstValue(job, ['job_id', 'id', 'jobId'], '')),
      display_id: String(firstValue(job, ['display_id', 'displayId', 'public_id'], '') || ''),
      files: files,
      processed:
        Number(firstValue(job, ['files_processed', 'processed_files', 'completed_files'], 0)) || 0,
      credits: Number(firstValue(job, ['credits_spent', 'creditsSpent', 'credits'], 0)) || 0,
      status: String(firstValue(job, ['status', 'state'], 'completed')).toLowerCase(),
      exportFormat: String(firstValue(job, ['export_format', 'exportFormat'], '')),
      created: firstValue(job, ['created_at', 'createdAt', 'started_at', 'date'], ''),
      downloadReady:
        job.download_ready === true ||
        job.download_ready === 'true' ||
        job.download_ready === 1
    };
  }

  function normalizeEnricherJob(raw) {
    const job = raw && typeof raw === 'object' ? raw : {};
    const sitesRaw = firstValue(
      job,
      ['sites_total', 'total_sites', 'sites_count', 'input_rows', 'row_count', 'websites', 'sites'],
      0
    );
    const sites = Array.isArray(sitesRaw) ? sitesRaw.length : Number(sitesRaw) || 0;
    return {
      job_id: String(firstValue(job, ['job_id', 'id', 'jobId'], '')),
      display_id: String(firstValue(job, ['display_id', 'displayId', 'public_id'], '') || ''),
      sites: sites,
      checked:
        Number(firstValue(job, ['sites_checked', 'checked_sites', 'websites_checked'], 0)) || 0,
      credits: Number(firstValue(job, ['credits_spent', 'creditsSpent', 'credits'], 0)) || 0,
      status: String(firstValue(job, ['status', 'state'], 'completed')).toLowerCase(),
      source: String(firstValue(job, ['source', 'source_type', 'input_source'], '')),
      /* The Lead Scraper job this enrichment was built from, when recorded. */
      source_job_id: String(
        firstValue(
          job,
          ['source_job_id', 'sourceJobId', 'lead_job_id', 'input_job_id', 'source_id'],
          ''
        ) || ''
      ),
      created: firstValue(job, ['created_at', 'createdAt', 'started_at', 'date'], ''),
      downloadReady:
        job.download_ready === true ||
        job.download_ready === 'true' ||
        job.download_ready === 1
    };
  }

  function normalizeReviewJob(raw) {
    const job = raw && typeof raw === 'object' ? raw : {};
    const competitorsRaw = firstValue(
      job,
      ['competitors_total', 'total_competitors', 'competitor_count', 'competitors'],
      0
    );
    const competitors = Array.isArray(competitorsRaw)
      ? competitorsRaw.length
      : Number(competitorsRaw) || 0;
    const reviewsRaw = firstValue(
      job,
      ['reviews_count', 'total_reviews', 'review_count', 'reviews'],
      0
    );
    const reviews = Array.isArray(reviewsRaw) ? reviewsRaw.length : Number(reviewsRaw) || 0;
    return {
      job_id: String(firstValue(job, ['job_id', 'id', 'jobId'], '')),
      display_id: String(firstValue(job, ['display_id', 'displayId', 'public_id'], '') || ''),
      competitors: competitors,
      reviews: reviews,
      credits: Number(firstValue(job, ['credits_spent', 'creditsSpent', 'credits'], 0)) || 0,
      status: String(firstValue(job, ['status', 'job_status'], 'completed')).toLowerCase(),
      created: firstValue(job, ['created_at', 'createdAt', 'started_at', 'date'], ''),
      downloadReady:
        job.download_ready === true ||
        job.download_ready === 'true' ||
        job.download_ready === 1
    };
  }

  function normalizePropertyJob(raw) {
    const job = raw && typeof raw === 'object' ? raw : {};
    const dealsRaw = firstValue(
      job,
      ['unique_deals', 'deals_found', 'deals_count', 'listings_count', 'total_deals', 'deals'],
      0
    );
    const durationDays = clamp(
      Number(
        firstValue(job, ['duration_days', 'watch_days', 'watch_duration', 'days'], PROP_DAYS)
      ) || PROP_DAYS,
      1,
      PROP_MAX_DAYS
    );
    const belowMarketPct = propParseThreshold(
      firstValue(job, ['below_market_pct', 'alert_threshold', 'threshold'], 10)
    );
    const expiresAt = firstValue(
      job,
      ['expires_at', 'expiresAt', 'watch_ends_at', 'end_date'],
      ''
    );
    const startedAt = firstValue(
      job,
      ['started_at', 'created_at', 'createdAt', 'date'],
      ''
    );
    const explicitDays = firstValue(
      job,
      ['days_left', 'days_remaining', 'watch_days_left'],
      null
    );
    let daysLeft;
    if (explicitDays !== null && String(explicitDays).trim() !== '') {
      daysLeft = clamp(Number(explicitDays) || 0, 0, durationDays);
    } else if (expiresAt) {
      daysLeft = clamp(
        Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000),
        0,
        durationDays
      );
    } else {
      daysLeft = durationDays;
    }
    const percent = clamp((daysLeft / durationDays) * 100, 2, 100);

    return {
      job_id: String(firstValue(job, ['job_id', 'id', 'jobId'], '')),
      display_id: String(firstValue(job, ['display_id', 'displayId', 'public_id'], '') || ''),
      country: String(firstValue(job, ['country', 'region'], '')),
      state: String(firstValue(job, ['state', 'state_region', 'region_state'], '')),
      city: String(firstValue(job, ['city', 'district', 'area'], '')),
      listingType: String(firstValue(job, ['listing_type', 'mode', 'deal_type'], '')),
      deals: Array.isArray(dealsRaw) ? dealsRaw.length : Number(dealsRaw) || 0,
      durationDays: durationDays,
      belowMarketPct: belowMarketPct,
      alerts: Number(firstValue(job, ['alerts_sent', 'alerts', 'alert_count'], 0)) || 0,
      sniped:
        Number(firstValue(job, ['deals_sniped', 'deals_sniped_count', 'deals_alerted'], 0)) || 0,
      daysLeft: daysLeft,
      percent: percent,
      expiresAt: expiresAt,
      credits: Number(firstValue(job, ['credits_spent', 'creditsSpent', 'credits'], 0)) || 0,
      status: String(firstValue(job, ['status', 'job_status'], 'completed')).toLowerCase(),
      created: startedAt,
      downloadReady:
        job.download_ready === true ||
        job.download_ready === 'true' ||
        job.download_ready === 1
    };
  }

  function normalizeTrackerJob(raw) {
    const job = raw && typeof raw === 'object' ? raw : {};
    const urlsRaw = firstValue(
      job,
      ['urls', 'competitor_urls', 'websites', 'targets', 'tracked_urls'],
      0
    );
    const daysRaw = firstValue(
      job,
      ['days_left', 'days_remaining', 'watch_days_left'],
      null
    );
    const daysLeft =
      daysRaw === null || daysRaw === ''
        ? CT_DAYS
        : clamp(Number(daysRaw) || 0, 0, CT_DAYS);
    const expiresAt = firstValue(
      job,
      ['expires_at', 'expiresAt', 'end_date', 'watch_ends_at'],
      ''
    );
    const startedAt = firstValue(
      job,
      ['started_at', 'created_at', 'createdAt', 'date'],
      ''
    );
    const percent = expiresAt
      ? subscriptionValidity(expiresAt, startedAt).percent
      : (daysLeft / CT_DAYS) * 100;
    return {
      job_id: String(firstValue(job, ['job_id', 'watch_id', 'id'], '')),
      display_id: String(firstValue(job, ['display_id', 'displayId', 'public_id'], '') || ''),
      urls: Array.isArray(urlsRaw) ? urlsRaw.length : Number(urlsRaw) || 0,
      changes: Number(firstValue(job, ['changes_detected', 'changes', 'change_count'], 0)) || 0,
      credits: Number(firstValue(job, ['credits_spent', 'creditsSpent', 'credits'], 0)) || 0,
      status: String(firstValue(job, ['status', 'job_status'], 'active')).toLowerCase(),
      created: startedAt,
      expiresAt: expiresAt,
      daysLeft: daysLeft,
      percent: clamp(Number(percent) || 0, 0, 100),
      downloadReady: false
    };
  }

  function normalizeWatchdogReport(rawReport) {
    if (!rawReport) return [];
    let list = [];
    if (Array.isArray(rawReport)) {
      list = rawReport;
    } else if (typeof rawReport === 'object') {
      if (Array.isArray(rawReport.sites)) list = rawReport.sites;
      else if (Array.isArray(rawReport.results)) list = rawReport.results;
      else if (Array.isArray(rawReport.checks)) list = rawReport.checks;
      else if (rawReport.url || rawReport.status || rawReport.site_status) list = [rawReport];
    }
    return list
      .filter(function (item) { return item && typeof item === 'object'; })
      .map(function (site) {
        const rawStatus = String(
          firstValue(site, ['status', 'site_status', 'health', 'state'], 'healthy')
        ).toLowerCase();
        const sslRaw = firstValue(site, ['ssl_days_left', 'ssl_days', 'ssl_expiry_days'], null);
        const msRaw = firstValue(site, ['response_ms', 'latency_ms', 'load_ms'], null);
        const httpRaw = firstValue(site, ['http_status', 'status_code', 'code'], null);
        const httpStatus = httpRaw == null || httpRaw === '' ? null : Math.round(Number(httpRaw) || 0);
        const brokenRaw = firstValue(site, ['broken_links', 'broken_count', 'broken'], 0);
        const brokenList = Array.isArray(brokenRaw)
          ? brokenRaw
              .map(function (entry) {
                if (typeof entry === 'string') return { url: entry, anchor: '', status: null, reason: '' };
                if (entry && typeof entry === 'object') {
                  const code = firstValue(entry, ['http_status', 'status_code', 'status', 'code'], null);
                  return {
                    url: String(firstValue(entry, ['url', 'href', 'link', 'target'], '')),
                    anchor: String(firstValue(entry, ['anchor', 'anchor_text', 'text', 'label'], '')),
                    status: code == null || code === '' ? null : String(code),
                    reason: String(firstValue(entry, ['reason', 'error', 'message'], ''))
                  };
                }
                return null;
              })
              .filter(function (entry) { return entry && (entry.url || entry.reason); })
          : [];
        const brokenCount = Array.isArray(brokenRaw)
          ? brokenRaw.length
          : Number(brokenRaw) || 0;

        const warningsRaw = firstValue(site, ['warnings', 'issues', 'reasons'], null);
        const warnings = [];
        if (Array.isArray(warningsRaw)) {
          warningsRaw.forEach(function (w) {
            if (typeof w === 'string' && w.trim()) warnings.push(w.trim());
            else if (w && typeof w === 'object') {
              const msg = firstValue(w, ['message', 'reason', 'detail', 'label'], '');
              if (msg) warnings.push(String(msg));
            }
          });
        } else if (typeof warningsRaw === 'string' && warningsRaw.trim()) {
          warnings.push(warningsRaw.trim());
        }
        const singleReason = firstValue(site, ['warning', 'error', 'reason', 'message'], '');
        if (singleReason && warnings.indexOf(String(singleReason)) === -1) {
          warnings.push(String(singleReason));
        }

        const responseMs = msRaw == null || msRaw === '' ? null : Math.round(Number(msRaw) || 0);
        const sslDaysLeft = sslRaw == null || sslRaw === '' ? null : Math.round(Number(sslRaw) || 0);
        const hasBroken = brokenList.length > 0 || brokenCount > 0;
        const hasWarnFlags =
          warnings.length > 0 ||
          site.is_slow === true ||
          site.ssl_warning === true ||
          (sslDaysLeft !== null && sslDaysLeft <= 14) ||
          (httpStatus !== null && httpStatus >= 400 && httpStatus < 500);

        let status = 'healthy';
        if (
          rawStatus.indexOf('down') !== -1 ||
          rawStatus.indexOf('fail') !== -1 ||
          rawStatus.indexOf('error') !== -1 ||
          rawStatus === 'red' ||
          httpStatus === 0 ||
          (httpStatus !== null && httpStatus >= 500)
        ) {
          status = 'down';
        } else if (
          rawStatus.indexOf('warn') !== -1 ||
          rawStatus.indexOf('slow') !== -1 ||
          rawStatus.indexOf('degrad') !== -1 ||
          rawStatus === 'amber' ||
          hasBroken ||
          hasWarnFlags
        ) {
          status = 'warning';
        }

        return {
          url: String(firstValue(site, ['url', 'site', 'target'], '')),
          label: String(firstValue(site, ['label', 'name'], '')),
          status: status,
          httpStatus: httpStatus,
          responseMs: responseMs,
          sslDaysLeft: sslDaysLeft,
          brokenLinks: brokenCount,
          brokenList: brokenList,
          warnings: warnings
        };
      });
  }

  function deriveWatchdogOverallStatus(reportSites, rawStatus) {
    const sites = Array.isArray(reportSites) ? reportSites : [];
    if (sites.some(function (s) { return s.status === 'down'; })) return 'down';
    if (sites.some(function (s) { return s.status === 'warning'; })) return 'warning';
    const raw = String(rawStatus || 'healthy').toLowerCase();
    if (raw.indexOf('down') !== -1 || raw.indexOf('error') !== -1 || raw === 'red') return 'down';
    if (raw.indexOf('warn') !== -1 || raw.indexOf('slow') !== -1 || raw === 'amber') return 'warning';
    return 'healthy';
  }

  function normalizeWatchdogJob(raw) {
    const job = raw && typeof raw === 'object' ? raw : {};
    const urlsRaw = firstValue(
      job,
      ['urls', 'sites', 'websites', 'targets', 'tracked_urls'],
      []
    );
    const urlsList = Array.isArray(urlsRaw)
      ? urlsRaw
          .map(function (u) {
            return typeof u === 'string'
              ? u
              : u && typeof u === 'object'
              ? String(u.url || u.site || '')
              : '';
          })
          .filter(Boolean)
      : [];
    const urlsCount = Array.isArray(urlsRaw)
      ? urlsList.length
      : Number(firstValue(job, ['urls_count', 'url_count'], urlsRaw)) || 0;
    const daysRaw = firstValue(
      job,
      ['days_remaining', 'days_left', 'watch_days_left'],
      null
    );
    const daysLeft =
      daysRaw === null || daysRaw === ''
        ? WDG_DAYS
        : clamp(Number(daysRaw) || 0, 0, WDG_DAYS);
    const expiresAt = firstValue(
      job,
      ['expires_at', 'expiresAt', 'end_date'],
      ''
    );
    const startedAt = firstValue(
      job,
      ['started_at', 'created_at', 'createdAt', 'date'],
      ''
    );
    const reportSites = normalizeWatchdogReport(job.last_report || job.report);
    const lastStatus = deriveWatchdogOverallStatus(
      reportSites,
      firstValue(job, ['last_status', 'health_status', 'status'], 'healthy')
    );
    let sslDaysLeft = firstValue(job, ['ssl_days_left', 'min_ssl_days'], null);
    if ((sslDaysLeft === null || sslDaysLeft === '') && reportSites.length) {
      const sslVals = reportSites
        .map(function (s) { return s.sslDaysLeft; })
        .filter(function (v) { return v !== null; });
      if (sslVals.length) sslDaysLeft = Math.min.apply(null, sslVals);
    }
    const percent = expiresAt
      ? subscriptionValidity(expiresAt, startedAt).percent
      : (daysLeft / WDG_DAYS) * 100;

    return {
      job_id: String(firstValue(job, ['watch_id', 'job_id', 'id'], '')),
      display_id: String(firstValue(job, ['display_id', 'displayId', 'public_id'], '') || ''),
      urls: urlsList,
      urlsCount: urlsCount || urlsList.length || 1,
      daysLeft: daysLeft,
      lastStatus: lastStatus,
      reportSites: reportSites,
      sslDaysLeft: sslDaysLeft === null || sslDaysLeft === '' ? null : Math.round(Number(sslDaysLeft) || 0),
      alertsSent: Number(firstValue(job, ['alerts_sent', 'alerts', 'alert_count'], 0)) || 0,
      lastChecked: firstValue(job, ['last_checked_at', 'checked_at', 'updated_at'], startedAt),
      credits: Number(firstValue(job, ['credits_spent', 'creditsSpent', 'credits'], WDG_CREDITS_PER_SITE)) || WDG_CREDITS_PER_SITE,
      created: startedAt,
      expiresAt: expiresAt,
      percent: clamp(Number(percent) || 0, 0, 100),
      downloadReady: false
    };
  }

  function renderStockHistoryCard(sub) {
    const validity = subscriptionValidity(sub.expiresAt, sub.startedAt);
    const remaining = validity.expired
      ? 0
      : tradingDaysRemaining(sub.expiresAt, sub.tradingDaysRemaining);
    const badgeClass = validity.expired
      ? 'hist-badge muted'
      : remaining <= 2
      ? 'hist-badge warn'
      : 'hist-badge ok';
    const badgeLabel = validity.expired ? 'Expired' : 'Active (Mon–Fri)';
    const tickers = sub.tickers.length
      ? sub.tickers
          .map(function (t) { return '<span class="pill-ticker">' + escapeHtml(t) + '</span>'; })
          .join('')
      : '<span class="pill-ticker">—</span>';

    return (
      '<article class="hist-card' + (validity.expired ? ' is-expired' : '') + '">' +
      '<div class="hist-card-top">' +
      '<strong>' + escapeHtml(AGENT_NAME) + '</strong>' +
      '<span class="' + badgeClass + '">' + escapeHtml(badgeLabel) + '</span>' +
      '</div>' +
      '<div class="hist-pill-row">' + tickers + '</div>' +
      '<div class="hist-trading">' +
      '<span class="hist-trading-label"><strong>' + remaining + ' / ' + TRADING_DAYS +
      '</strong> trading days left</span>' +
      tradingStepsHtml(remaining) +
      '</div>' +
      '<p class="hist-trading-note">' + escapeHtml(DELIVERY_NOTE) + '</p>' +
      '<dl class="hist-meta">' +
      '<div><dt>Purchase date</dt><dd>' +
      escapeHtml(sub.startedAt ? fmtMYT(sub.startedAt) : '—') + '</dd></div>' +
      '<div><dt>Expiry date</dt><dd>' +
      escapeHtml(sub.expiresAt ? fmtMYT(sub.expiresAt) : '—') + '</dd></div>' +
      '<div><dt>Credits spent</dt><dd>' + sub.credits + ' credit' +
      (sub.credits === 1 ? '' : 's') + '</dd></div>' +
      '<div><dt>Delivery email</dt><dd>' + escapeHtml(sub.email || '—') + '</dd></div>' +
      '</dl>' +
      '</article>'
    );
  }

  function renderB2BHistoryCard(job) {
    const labels = {
      completed: 'Completed',
      complete: 'Completed',
      success: 'Completed',
      done: 'Completed',
      running: 'Running',
      processing: 'Running',
      waiting: 'Running',
      queued: 'Queued',
      pending: 'Queued',
      failed: 'Failed',
      error: 'Failed',
      cancelled: 'Cancelled',
      canceled: 'Cancelled'
    };
    const label = labels[job.status] || (job.status ? job.status : 'Unknown');
    const ok = label === 'Completed';
    const tone = ok ? 'ok' : label === 'Failed' || label === 'Cancelled' ? 'bad' : label === 'Running' || label === 'Queued' ? 'warn' : 'muted';
    const termsText = job.terms.length ? job.terms.join(' · ') : '—';
    const subtitle =
      job.country && job.country !== '—' ? job.country + ' · ' + termsText : termsText;
    const leads = job.status === 'completed' ? Math.max(job.scraped, job.target) : job.scraped;
    const leadText = leads + ' / ' + (job.target ? job.target : '—') + ' leads';

    return (
      '<article class="hist-card">' +
      '<div class="hist-card-top">' +
      '<strong>Lead Scraper Agent</strong>' +
      histIdBadge(job) +
      '<span class="hist-badge ' + tone + '">' + escapeHtml(label) + '</span>' +
      '</div>' +
      '<p class="hist-sub">' + escapeHtml(subtitle) + '</p>' +
      '<dl class="hist-meta">' +
      '<div><dt>Leads</dt><dd>' + escapeHtml(leadText) + '</dd></div>' +
      '<div><dt>Credits spent</dt><dd>' + job.credits + ' credit' +
      (job.credits === 1 ? '' : 's') + '</dd></div>' +
      '<div><dt>Job ID</dt><dd><code>' + escapeHtml(formatJobRef(job) || '—') + '</code></dd></div>' +
      '<div><dt>Created</dt><dd>' +
      escapeHtml(job.created ? fmtMYT(job.created) : '—') + '</dd></div>' +
      '</dl>' +
      '<div class="hist-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-history-resume="' +
      escapeHtml(job.job_id) + '"' + (job.job_id ? '' : ' disabled') + '>' +
      (ok ? 'View Results' : 'View Progress') + '</button>' +
      (job.downloadReady && job.job_id
        ? '<button type="button" class="btn btn-primary btn-sm" data-history-download="' +
          escapeHtml(job.job_id) + '">Download .xlsx</button>'
        : '') +
      '</div>' +
      '</article>'
    );
  }

  /* 5 items per page, clamped to the current list length. */
  function historyPageSlice(kind, list) {
    const pages = Math.max(1, Math.ceil(list.length / HISTORY_PAGE_SIZE));
    const page = clamp(Number(historyPages[kind]) || 1, 1, pages);
    historyPages[kind] = page;
    return {
      page: page,
      pages: pages,
      items: list.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE)
    };
  }

  function renderHistoryPager(kind, label, page, pages, total) {
    if (total <= HISTORY_PAGE_SIZE) return '';
    const atStart = page <= 1;
    const atEnd = page >= pages;
    return (
      '<nav class="hist-pager" aria-label="' + escapeHtml(label) + ' pagination">' +
      '<button type="button" class="btn btn-ghost btn-sm hist-pager-btn" data-hist-page="' + kind +
      '" data-hist-dir="prev"' + (atStart ? ' disabled aria-disabled="true"' : '') +
      '>← Previous</button>' +
      '<span class="hist-pager-info" aria-live="polite">Page ' + page + ' of ' + pages + '</span>' +
      '<button type="button" class="btn btn-ghost btn-sm hist-pager-btn" data-hist-page="' + kind +
      '" data-hist-dir="next"' + (atEnd ? ' disabled aria-disabled="true"' : '') +
      '>Next →</button>' +
      '</nav>'
    );
  }

  function renderInvoiceHistoryCard(job) {
    const labels = {
      completed: 'Completed',
      complete: 'Completed',
      success: 'Completed',
      done: 'Completed',
      running: 'Running',
      processing: 'Running',
      ocr: 'Running',
      queued: 'Queued',
      pending: 'Queued',
      starting: 'Queued',
      failed: 'Failed',
      error: 'Failed',
      cancelled: 'Cancelled',
      canceled: 'Cancelled'
    };
    const label = labels[job.status] || (job.status ? job.status : 'Unknown');
    const ok = label === 'Completed';
    const tone = ok
      ? 'ok'
      : label === 'Failed' || label === 'Cancelled'
      ? 'bad'
      : label === 'Running' || label === 'Queued'
      ? 'warn'
      : 'muted';
    const fileText = job.files
      ? job.files + ' file' + (job.files === 1 ? '' : 's')
      : '—';
    const creditText = job.credits + ' credit' + (job.credits === 1 ? '' : 's');

    return (
      '<article class="hist-card">' +
      '<div class="hist-card-top">' +
      '<strong>Invoice OCR Agent</strong>' +
      histIdBadge(job) +
      '<span class="hist-badge ' + tone + '">' + escapeHtml(label) + '</span>' +
      '</div>' +
      '<p class="hist-sub">' + escapeHtml(fileText) + ' · ' + escapeHtml(creditText) + '</p>' +
      '<dl class="hist-meta">' +
      '<div><dt>Files</dt><dd>' + escapeHtml(fileText) + '</dd></div>' +
      '<div><dt>Credits spent</dt><dd>' + escapeHtml(creditText) + '</dd></div>' +
      '<div><dt>Job ID</dt><dd><code>' + escapeHtml(formatJobRef(job) || '—') + '</code></dd></div>' +
      '<div><dt>Created</dt><dd>' +
      escapeHtml(job.created ? fmtMYT(job.created) : '—') + '</dd></div>' +
      '</dl>' +
      '<div class="hist-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-invoice-resume="' +
      escapeHtml(job.job_id) + '"' + (job.job_id ? '' : ' disabled') +
      '>View Results</button>' +
      (job.downloadReady && job.job_id
        ? '<button type="button" class="btn btn-primary btn-sm" data-invoice-download="' +
          escapeHtml(job.job_id) + '">Download .xlsx</button>'
        : '') +
      '</div>' +
      '</article>'
    );
  }

  /* Shared status badge tone mapping for the two newest workers. */
  function historyBadgeInfo(status) {
    const labels = {
      completed: 'Completed',
      complete: 'Completed',
      success: 'Completed',
      done: 'Completed',
      running: 'Running',
      processing: 'Running',
      enricher: 'Running',
      mining: 'Running',
      queued: 'Queued',
      pending: 'Queued',
      starting: 'Queued',
      failed: 'Failed',
      error: 'Failed',
      cancelled: 'Cancelled',
      canceled: 'Cancelled'
    };
    const label = labels[status] || (status ? status : 'Unknown');
    const tone =
      label === 'Completed'
        ? 'ok'
        : label === 'Failed' || label === 'Cancelled'
        ? 'bad'
        : label === 'Running' || label === 'Queued'
        ? 'warn'
        : 'muted';
    return { label: label, tone: tone, ok: label === 'Completed' };
  }

  function renderEnricherHistoryCard(job) {
    const badge = historyBadgeInfo(job.status);
    const siteText = job.sites
      ? job.sites + ' website' + (job.sites === 1 ? '' : 's')
      : '—';
    const creditText = job.credits + ' credit' + (job.credits === 1 ? '' : 's');
    return (
      '<article class="hist-card">' +
      '<div class="hist-card-top">' +
      '<strong>Lead Enricher</strong>' +
      histIdBadge(job) +
      '<span class="hist-badge ' + badge.tone + '">' + escapeHtml(badge.label) + '</span>' +
      '</div>' +
      '<p class="hist-sub">' + escapeHtml(siteText) + ' · ' + escapeHtml(creditText) + '</p>' +
      '<dl class="hist-meta">' +
      '<div><dt>Websites</dt><dd>' + escapeHtml(siteText) + '</dd></div>' +
      '<div><dt>Credits spent</dt><dd>' + escapeHtml(creditText) + '</dd></div>' +
      '<div><dt>Job ID</dt><dd><code>' + escapeHtml(formatJobRef(job) || '—') + '</code></dd></div>' +
      '<div><dt>Created</dt><dd>' +
      escapeHtml(job.created ? fmtMYT(job.created) : '—') + '</dd></div>' +
      '</dl>' +
      '<div class="hist-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-enricher-resume="' +
      escapeHtml(job.job_id) + '"' + (job.job_id ? '' : ' disabled') +
      '>View Results</button>' +
      (job.downloadReady && job.job_id
        ? '<button type="button" class="btn btn-primary btn-sm" data-enricher-download="' +
          escapeHtml(job.job_id) + '">Download .xlsx</button>'
        : '') +
      '</div>' +
      '</article>'
    );
  }

  function renderReviewHistoryCard(job) {
    const badge = historyBadgeInfo(job.status);
    const competitorText = job.competitors
      ? job.competitors + ' competitor' + (job.competitors === 1 ? '' : 's')
      : '—';
    const reviewText = job.reviews ? job.reviews + ' reviews' : '—';
    const creditText = job.credits + ' credit' + (job.credits === 1 ? '' : 's');
    return (
      '<article class="hist-card">' +
      '<div class="hist-card-top">' +
      '<strong>Review Miner</strong>' +
      histIdBadge(job) +
      '<span class="hist-badge ' + badge.tone + '">' + escapeHtml(badge.label) + '</span>' +
      '</div>' +
      '<p class="hist-sub">' + escapeHtml(competitorText) + ' · ' + escapeHtml(reviewText) +
      ' · ' + escapeHtml(creditText) + '</p>' +
      '<dl class="hist-meta">' +
      '<div><dt>Competitors</dt><dd>' + escapeHtml(competitorText) + '</dd></div>' +
      '<div><dt>Reviews</dt><dd>' + escapeHtml(reviewText) + '</dd></div>' +
      '<div><dt>Job ID</dt><dd><code>' + escapeHtml(formatJobRef(job) || '—') + '</code></dd></div>' +
      '<div><dt>Created</dt><dd>' +
      escapeHtml(job.created ? fmtMYT(job.created) : '—') + '</dd></div>' +
      '</dl>' +
      '<div class="hist-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-review-resume="' +
      escapeHtml(job.job_id) + '"' + (job.job_id ? '' : ' disabled') +
      '>View Results</button>' +
      (job.downloadReady && job.job_id
        ? '<button type="button" class="btn btn-primary btn-sm" data-review-download="' +
          escapeHtml(job.job_id) + '">Download .xlsx</button>'
        : '') +
      '</div>' +
      '</article>'
    );
  }

  function renderPropertyHistoryCard(job) {
    const active = job.status === 'active' || job.status === 'watching';
    const badge = active
      ? { label: 'Sniper Active', tone: 'ok' }
      : historyBadgeInfo(job.status);
    const deals = Number(job.deals) || 0;
    const duration = clamp(Number(job.durationDays) || PROP_DAYS, 1, PROP_MAX_DAYS);
    const daysLeft = clamp(Number(job.daysLeft) || 0, 0, duration);
    const percent = clamp(Number(job.percent) || 0, 2, 100);
    const alerts = Number(job.alerts) || 0;
    const sniped = Number(job.sniped) || 0;
    const creditText = job.credits + ' credit' + (job.credits === 1 ? '' : 's');
    const baselineText = deals
      ? deals + ' baseline deal' + (deals === 1 ? '' : 's')
      : '—';
    const location =
      [job.city, job.state, job.country].filter(function (part) { return !!part; }).join(', ') ||
      '—';
    const alertBadge =
      alerts > 0 || sniped > 0
        ? alerts + ' alert' + (alerts === 1 ? '' : 's') +
          (sniped ? ' · ' + sniped + ' sniped' : '')
        : 'No alerts yet';

    return (
      '<article class="hist-card">' +
      '<div class="hist-card-top">' +
      '<strong>Property Sniper</strong>' +
      histIdBadge(job) +
      '<span class="hist-badge ' + badge.tone + '">' + escapeHtml(badge.label) + '</span>' +
      '</div>' +
      '<p class="hist-sub">' + escapeHtml(location) + ' · ' + duration +
      '-day watch · ' + escapeHtml(propAlertLabel(job.belowMarketPct)) + '</p>' +
      '<div class="hist-trading">' +
      '<span class="hist-trading-label"><strong>' + daysLeft + ' / ' + duration +
      '</strong> days left</span>' +
      '<span class="hist-badge ' + (alerts > 0 || sniped > 0 ? 'warn' : 'ok') + '">' +
      escapeHtml(alertBadge) + '</span>' +
      '</div>' +
      '<div class="watch-progress"><span style="width:' + percent + '%"></span></div>' +
      '<dl class="hist-meta">' +
      '<div><dt>Baseline deals</dt><dd>' + escapeHtml(baselineText) + '</dd></div>' +
      '<div><dt>Alert trigger</dt><dd>' +
      escapeHtml(propAlertLabel(job.belowMarketPct)) + '</dd></div>' +
      '<div><dt>Alerts sent</dt><dd>' + alerts + '</dd></div>' +
      '<div><dt>Deals sniped</dt><dd>' + sniped + '</dd></div>' +
      '<div><dt>Credits spent</dt><dd>' + escapeHtml(creditText) + '</dd></div>' +
      '<div><dt>Job ID</dt><dd><code>' + escapeHtml(formatJobRef(job) || '—') + '</code></dd></div>' +
      '<div><dt>Started</dt><dd>' +
      escapeHtml(job.created ? fmtMYT(job.created) : '—') + '</dd></div>' +
      '</dl>' +
      '<div class="hist-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-property-resume="' +
      escapeHtml(job.job_id) + '"' + (job.job_id ? '' : ' disabled') +
      '>View Baseline</button>' +
      (job.downloadReady && job.job_id
        ? '<button type="button" class="btn btn-primary btn-sm" data-property-download="' +
          escapeHtml(job.job_id) + '">Download .xlsx</button>'
        : '') +
      '</div>' +
      '</article>'
    );
  }

  function renderTrackerHistoryCard(job) {
    const badge = historyBadgeInfo(job.status === 'active' ? 'running' : job.status);
    const urlText = job.urls
      ? job.urls + ' URL' + (job.urls === 1 ? '' : 's')
      : '—';
    const creditText = job.credits + ' credit' + (job.credits === 1 ? '' : 's');
    const changes = Number(job.changes) || 0;
    const daysLeft = Number(job.daysLeft) || 0;
    const percent = clamp(Number(job.percent) || 0, 2, 100);
    const label = job.status === 'active' ? 'Watching' : badge.label;

    return (
      '<article class="hist-card">' +
      '<div class="hist-card-top">' +
      '<strong>Competitor Tracker</strong>' +
      histIdBadge(job) +
      '<span class="hist-badge ' + badge.tone + '">' + escapeHtml(label) + '</span>' +
      '</div>' +
      '<p class="hist-sub">' + escapeHtml(urlText) + ' · ' + escapeHtml(creditText) + '</p>' +
      '<div class="hist-trading">' +
      '<span class="hist-trading-label"><strong>' + daysLeft + ' / ' + CT_DAYS +
      '</strong> days left</span>' +
      '<span class="hist-badge ' + (changes > 0 ? 'warn' : 'ok') + '">' +
      (changes > 0
        ? changes + ' change' + (changes === 1 ? '' : 's') + ' detected'
        : 'No changes yet') +
      '</span>' +
      '</div>' +
      '<div class="watch-progress"><span style="width:' + percent + '%"></span></div>' +
      '<dl class="hist-meta">' +
      '<div><dt>URLs watched</dt><dd>' + escapeHtml(urlText) + '</dd></div>' +
      '<div><dt>Changes detected</dt><dd>' + changes + '</dd></div>' +
      '<div><dt>Credits spent</dt><dd>' + escapeHtml(creditText) + '</dd></div>' +
      '<div><dt>Watch ID</dt><dd><code>' + escapeHtml(formatJobRef(job) || '—') + '</code></dd></div>' +
      '<div><dt>Started</dt><dd>' +
      escapeHtml(job.created ? fmtMYT(job.created) : '—') + '</dd></div>' +
      '</dl>' +
      '</article>'
    );
  }

  function watchdogStatusMeta(status) {
    if (status === 'down') return { tone: 'bad', label: 'Down' };
    if (status === 'warning') return { tone: 'warn', label: 'Warning' };
    return { tone: 'ok', label: 'Healthy' };
  }

  function watchdogSiteReasons(site) {
    const reasons = [];
    if (site.httpStatus !== null && (site.httpStatus >= 400 || site.httpStatus === 0)) {
      reasons.push(site.httpStatus === 0 ? 'Site unreachable (no HTTP response)' : 'HTTP ' + site.httpStatus + ' error');
    }
    if (Array.isArray(site.brokenList) && site.brokenList.length) {
      site.brokenList.forEach(function (item) {
        const codePart = item.status ? ' (HTTP ' + item.status + ')' : '';
        const anchorPart = item.anchor ? ' ["' + item.anchor + '"]' : '';
        const reasonPart = !item.status && item.reason ? ' (' + item.reason + ')' : '';
        reasons.push('Broken link' + codePart + reasonPart + anchorPart + ': ' + (item.url || 'unknown URL'));
      });
    } else if (site.brokenLinks > 0) {
      reasons.push(site.brokenLinks + ' broken link' + (site.brokenLinks === 1 ? '' : 's') + ' detected');
    }
    if (Array.isArray(site.warnings) && site.warnings.length) {
      site.warnings.forEach(function (w) {
        if (reasons.indexOf(w) === -1) reasons.push(w);
      });
    }
    if (site.sslDaysLeft !== null && site.sslDaysLeft <= 14) {
      const sslMsg = site.sslDaysLeft <= 0
        ? 'SSL certificate expired'
        : 'SSL expires in ' + site.sslDaysLeft + ' day' + (site.sslDaysLeft === 1 ? '' : 's');
      if (!reasons.some(function (r) { return r.toLowerCase().indexOf('ssl') !== -1; })) {
        reasons.push(sslMsg);
      }
    }
    if (site.responseMs !== null && site.responseMs >= 3500) {
      const slowMsg = 'Slow response: ' + site.responseMs.toLocaleString() + ' ms';
      if (!reasons.some(function (r) { return r.toLowerCase().indexOf('slow') !== -1 || r.indexOf('ms') !== -1; })) {
        reasons.push(slowMsg);
      }
    }
    return reasons;
  }

  function renderWatchdogIssuesHtml(sites, fallbackStatus) {
    const issueBlocks = [];
    (sites || []).forEach(function (site) {
      const reasons = watchdogSiteReasons(site);
      if (!reasons.length && site.status === 'healthy') return;
      if (!reasons.length) {
        reasons.push(site.status === 'down' ? 'Site failed health check' : 'Health warning reported');
      }
      const toneClass = site.status === 'down' ? 'is-down' : 'is-warning';
      const siteLabel = site.label || site.url;
      issueBlocks.push(
        '<div class="wdg-issues ' + toneClass + '">' +
        (siteLabel ? '<strong class="wdg-issues-site">' + escapeHtml(siteLabel) + '</strong>' : '') +
        '<ul>' +
        reasons.map(function (r) { return '<li>' + escapeHtml(r) + '</li>'; }).join('') +
        '</ul>' +
        '</div>'
      );
    });
    if (!issueBlocks.length && (fallbackStatus === 'warning' || fallbackStatus === 'down')) {
      const toneClass = fallbackStatus === 'down' ? 'is-down' : 'is-warning';
      issueBlocks.push(
        '<div class="wdg-issues ' + toneClass + '"><ul><li>' +
        (fallbackStatus === 'down'
          ? 'Site downtime detected — check email alert for details.'
          : 'Performance, SSL, or broken-link warning detected.') +
        '</li></ul></div>'
      );
    }
    return issueBlocks.join('');
  }

  function renderWatchdogHistoryCard(job) {
    const statusMeta = watchdogStatusMeta(job.lastStatus);
    const sitesText = job.urls && job.urls.length
      ? job.urls.join(' · ')
      : job.urlsCount + ' site' + (job.urlsCount === 1 ? '' : 's');
    const creditText = job.credits + ' credit' + (job.credits === 1 ? '' : 's');
    const daysLeft = Number(job.daysLeft) || 0;
    const percent = clamp(Number(job.percent) || 0, 2, 100);
    const sslText = job.sslDaysLeft !== null ? job.sslDaysLeft + ' days left' : '—';
    const alerts = Number(job.alertsSent) || 0;
    const issuesHtml = renderWatchdogIssuesHtml(job.reportSites, job.lastStatus);

    return (
      '<article class="hist-card">' +
      '<div class="hist-card-top">' +
      '<strong>Website Watchdog</strong>' +
      histIdBadge(job) +
      '<span class="hist-badge ' + statusMeta.tone + '">' + escapeHtml(statusMeta.label) + '</span>' +
      '</div>' +
      '<p class="hist-sub">' + escapeHtml(sitesText) + ' · ' + escapeHtml(creditText) + '</p>' +
      '<div class="hist-trading">' +
      '<span class="hist-trading-label"><strong>' + daysLeft + ' / ' + WDG_DAYS +
      '</strong> days left</span>' +
      '<span class="hist-badge ' + (alerts > 0 ? 'warn' : 'ok') + '">' +
      alerts + ' alert' + (alerts === 1 ? '' : 's') + ' sent' +
      '</span>' +
      '</div>' +
      '<div class="watch-progress"><span style="width:' + percent + '%"></span></div>' +
      issuesHtml +
      '<dl class="hist-meta">' +
      '<div><dt>SSL expiry</dt><dd>' + escapeHtml(sslText) + '</dd></div>' +
      '<div><dt>Alerts sent</dt><dd>' + alerts + '</dd></div>' +
      '<div><dt>Last checked</dt><dd>' +
      escapeHtml(job.lastChecked ? fmtMYT(job.lastChecked) : '—') + '</dd></div>' +
      '<div><dt>Credits spent</dt><dd>' + escapeHtml(creditText) + '</dd></div>' +
      '<div><dt>Watch ID</dt><dd><code>' + escapeHtml(formatJobRef(job) || '—') + '</code></dd></div>' +
      '</dl>' +
      '<div class="hist-actions">' +
      '<button type="button" class="btn btn-primary btn-sm" data-watchdog-view="' +
      escapeHtml(job.job_id || job.display_id) + '">View Report</button>' +
      '</div>' +
      '</article>'
    );
  }

  function paintHistory() {
    const stockPane = $('#historyStock');
    const b2bPane = $('#historyB2B');
    const invoicePane = $('#historyInvoice');
    const enricherPane = $('#historyEnricher');
    const reviewPane = $('#historyReview');
    const propertyPane = $('#historyProperty');
    const trackerPane = $('#historyTracker');
    const watchdogPane = $('#historyWatchdog');
    const stockCount = historyState.stock.length;
    const b2bCount = historyState.b2b.length;
    const invoiceCount = historyState.invoice.length;
    const enricherCount = historyState.enricher.length;
    const reviewCount = historyState.review.length;
    const propertyCount = historyState.property.length;
    const trackerCount = historyState.tracker.length;
    const watchdogCount = historyState.watchdog.length;
    const stockPage = historyPageSlice('stock', historyState.stock);
    const b2bPage = historyPageSlice('b2b', historyState.b2b);
    const invoicePage = historyPageSlice('invoice', historyState.invoice);
    const enricherPage = historyPageSlice('enricher', historyState.enricher);
    const reviewPage = historyPageSlice('review', historyState.review);
    const propertyPage = historyPageSlice('property', historyState.property);
    const trackerPage = historyPageSlice('tracker', historyState.tracker);
    const watchdogPage = historyPageSlice('watchdog', historyState.watchdog);

    if (stockPane) {
      stockPane.innerHTML = stockCount
        ? renderHistoryPager('stock', 'Stock subscriptions', stockPage.page, stockPage.pages, stockCount) +
          '<div class="hist-list">' +
          stockPage.items.map(renderStockHistoryCard).join('') +
          '</div>'
        : '<div class="hist-empty">' +
          '<p class="empty-note">No stock brief subscriptions yet. Subscribe to a ticker and your first brief lands in your inbox at 07:00 MYT.</p>' +
          '<a class="btn btn-primary btn-sm" href="#agents">Subscribe to Stock Brief</a>' +
          '</div>';
    }

    if (b2bPane) {
      b2bPane.innerHTML = b2bCount
        ? renderHistoryPager('b2b', 'Lead Scraper jobs', b2bPage.page, b2bPage.pages, b2bCount) +
          '<div class="hist-list">' +
          b2bPage.items.map(renderB2BHistoryCard).join('') +
          '</div>'
        : '<div class="hist-empty">' +
          '<p class="empty-note">No lead scraping jobs yet. Run the scraper and the .xlsx history will appear here.</p>' +
          '<a class="btn btn-primary btn-sm" href="#agents">Launch Lead Scraper</a>' +
          '</div>';
    }

    if (invoicePane) {
      invoicePane.innerHTML = invoiceCount
        ? renderHistoryPager('invoice', 'Invoice OCR jobs', invoicePage.page, invoicePage.pages, invoiceCount) +
          '<div class="hist-list">' +
          invoicePage.items.map(renderInvoiceHistoryCard).join('') +
          '</div>'
        : '<div class="hist-empty">' +
          '<p class="empty-note">No invoice OCR jobs yet. Upload a batch and the extracted Excel history will appear here.</p>' +
          '<a class="btn btn-primary btn-sm" href="#agents">Run Invoice OCR</a>' +
          '</div>';
    }

    if (enricherPane) {
      enricherPane.innerHTML = enricherCount
        ? renderHistoryPager('enricher', 'Lead Enricher jobs', enricherPage.page, enricherPage.pages, enricherCount) +
          '<div class="hist-list">' +
          enricherPage.items.map(renderEnricherHistoryCard).join('') +
          '</div>'
        : '<div class="hist-empty">' +
          '<p class="empty-note">No lead enrichment jobs yet. Enrich a website list and the .xlsx history will appear here.</p>' +
          '<a class="btn btn-primary btn-sm" href="#agents">Launch Lead Enricher</a>' +
          '</div>';
    }

    if (reviewPane) {
      reviewPane.innerHTML = reviewCount
        ? renderHistoryPager('review', 'Review Miner jobs', reviewPage.page, reviewPage.pages, reviewCount) +
          '<div class="hist-list">' +
          reviewPage.items.map(renderReviewHistoryCard).join('') +
          '</div>'
        : '<div class="hist-empty">' +
          '<p class="empty-note">No review mining jobs yet. Mine 1–5 competitors and the battlecard history will appear here.</p>' +
          '<a class="btn btn-primary btn-sm" href="#agents">Launch Review Miner</a>' +
          '</div>';
    }

    if (propertyPane) {
      propertyPane.innerHTML = propertyCount
        ? renderHistoryPager('property', 'Property Sniper watches', propertyPage.page, propertyPage.pages, propertyCount) +
          '<div class="hist-list">' +
          propertyPage.items.map(renderPropertyHistoryCard).join('') +
          '</div>'
        : '<div class="hist-empty">' +
          '<p class="empty-note">No sniper watches yet. Start the Property Deal Sniper for an instant baseline plus daily below-market alerts.</p>' +
          '<a class="btn btn-primary btn-sm" href="#agents">Start Deal Sniper</a>' +
          '</div>';
    }

    if (trackerPane) {
      trackerPane.innerHTML = trackerCount
        ? renderHistoryPager('tracker', 'Competitor Tracker watches', trackerPage.page, trackerPage.pages, trackerCount) +
          '<div class="hist-list">' +
          trackerPage.items.map(renderTrackerHistoryCard).join('') +
          '</div>'
        : '<div class="hist-empty">' +
          '<p class="empty-note">No competitor watches yet. Start a 7-day watch and every real price or text change will appear here.</p>' +
          '<a class="btn btn-primary btn-sm" href="#agents">Start 7-Day Watch</a>' +
          '</div>';
    }

    if (watchdogPane) {
      watchdogPane.innerHTML = watchdogCount
        ? renderHistoryPager('watchdog', 'Website Watchdogs', watchdogPage.page, watchdogPage.pages, watchdogCount) +
          '<div class="hist-list">' +
          watchdogPage.items.map(renderWatchdogHistoryCard).join('') +
          '</div>'
        : '<div class="hist-empty">' +
          '<p class="empty-note">No website watchdogs yet. Start a 30-day watchdog to monitor uptime, SSL expiry and broken links.</p>' +
          '<a class="btn btn-primary btn-sm" href="#agents">Start 30-Day Watchdog</a>' +
          '</div>';
    }

    /* Keep tab + section counters in sync. */
    const counts = {
      stock: stockCount,
      b2b: b2bCount,
      invoice: invoiceCount,
      enricher: enricherCount,
      review: reviewCount,
      property: propertyCount,
      tracker: trackerCount,
      watchdog: watchdogCount
    };
    $$('[data-hist-count]').forEach(function (el) {
      const key = el.getAttribute('data-hist-count');
      el.textContent = String(counts[key] == null ? 0 : counts[key]);
    });
    $$('[data-hist-count-label="stock"]').forEach(function (el) {
      el.textContent = stockCount + ' subscription' + (stockCount === 1 ? '' : 's');
    });
    ['b2b', 'invoice', 'enricher', 'review', 'property', 'tracker', 'watchdog'].forEach(function (key) {
      $$('[data-hist-count-label="' + key + '"]').forEach(function (el) {
        el.textContent = counts[key] + ' ' + (key === 'watchdog' ? 'watch' + (counts[key] === 1 ? '' : 'es') : 'job' + (counts[key] === 1 ? '' : 's'));
      });
    });
  }

  /* All / stock / b2b / invoice / enricher / review / property / tracker / watchdog filter for the panel. */
  function applyHistoryFilter(name) {
    const filter =
      name === 'stock' || name === 'b2b' || name === 'invoice' ||
      name === 'enricher' || name === 'review' ||
      name === 'property' || name === 'tracker' || name === 'watchdog'
        ? name
        : 'all';
    $$('[data-history-tab]').forEach(function (btn) {
      const on = btn.getAttribute('data-history-tab') === filter;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    $$('[data-hist-group]').forEach(function (group) {
      group.hidden = filter !== 'all' && group.getAttribute('data-hist-group') !== filter;
    });

    /* Switching agent filters always returns every list to page 1. */
    historyPages = {
      stock: 1,
      b2b: 1,
      invoice: 1,
      enricher: 1,
      review: 1,
      property: 1,
      tracker: 1,
      watchdog: 1
    };
    if (isLoggedIn() && !historyState.loading) paintHistory();
  }

  function renderHistory(force) {
    const stockPane = $('#historyStock');
    const b2bPane = $('#historyB2B');
    const invoicePane = $('#historyInvoice');
    const enricherPane = $('#historyEnricher');
    const reviewPane = $('#historyReview');
    const propertyPane = $('#historyProperty');
    const trackerPane = $('#historyTracker');
    const watchdogPane = $('#historyWatchdog');
    if (
      !stockPane && !b2bPane && !invoicePane && !enricherPane && !reviewPane &&
      !propertyPane && !trackerPane && !watchdogPane
    ) {
      return;
    }

    /* Refresh (and every fresh fetch) starts from page 1. */
    if (force) {
      historyPages = {
        stock: 1,
        b2b: 1,
        invoice: 1,
        enricher: 1,
        review: 1,
        property: 1,
        tracker: 1,
        watchdog: 1
      };
    }

    if (!isLoggedIn()) {
      historyState = {
        loaded: false,
        loading: false,
        stock: [],
        b2b: [],
        invoice: [],
        enricher: [],
        review: [],
        property: [],
        tracker: [],
        watchdog: []
      };
      const loginCard =
        '<div class="hist-empty">' +
        '<p class="empty-note">Log in to view your subscriptions and purchase history. Your stock briefs, scraping runs, invoice batches, enrichment runs, review battlecards, property sniper watches, competitor watches and website watchdogs are tied to your LiteWork account.</p>' +
        '<button type="button" class="btn btn-primary btn-sm" data-history-login>Log in</button>' +
        '</div>';
      if (stockPane) stockPane.innerHTML = loginCard;
      if (b2bPane) b2bPane.innerHTML = loginCard;
      if (invoicePane) invoicePane.innerHTML = loginCard;
      if (enricherPane) enricherPane.innerHTML = loginCard;
      if (reviewPane) reviewPane.innerHTML = loginCard;
      if (propertyPane) propertyPane.innerHTML = loginCard;
      if (trackerPane) trackerPane.innerHTML = loginCard;
      if (watchdogPane) watchdogPane.innerHTML = loginCard;
      $$('[data-hist-count]').forEach(function (el) { el.textContent = '0'; });
      $$('[data-hist-count-label="stock"]').forEach(function (el) { el.textContent = '0 subscriptions'; });
      ['b2b', 'invoice', 'enricher', 'review', 'property', 'tracker', 'watchdog'].forEach(function (key) {
        $$('[data-hist-count-label="' + key + '"]').forEach(function (el) {
          el.textContent = key === 'watchdog' ? '0 watches' : '0 jobs';
        });
      });
      return;
    }

    if (historyState.loading) return;
    if (historyState.loaded && !force) {
      paintHistory();
      return;
    }

    historyState.loading = true;
    if (stockPane) stockPane.innerHTML = '<p class="empty-note">Loading your subscriptions…</p>';
    if (b2bPane) b2bPane.innerHTML = '<p class="empty-note">Loading your scraping jobs…</p>';
    if (invoicePane) invoicePane.innerHTML = '<p class="empty-note">Loading your invoice jobs…</p>';
    if (enricherPane) enricherPane.innerHTML = '<p class="empty-note">Loading your enrichment jobs…</p>';
    if (reviewPane) reviewPane.innerHTML = '<p class="empty-note">Loading your review mining jobs…</p>';
    if (propertyPane) propertyPane.innerHTML = '<p class="empty-note">Loading your sniper watches…</p>';
    if (trackerPane) trackerPane.innerHTML = '<p class="empty-note">Loading your competitor watches…</p>';
    if (watchdogPane) watchdogPane.innerHTML = '<p class="empty-note">Loading your website watchdogs…</p>';

    apiFetch(ACCOUNT_HISTORY_URL, { method: 'GET' }, 20000)
      .then(function (response) {
        return readJson(response).then(function (body) {
          if (response.status === 401) {
            handleAuthExpired(
              'Your session expired. Log in again to view your history.',
              null
            );
            return null;
          }
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return body;
        });
      })
      .then(function (body) {
        historyState.loading = false;
        if (body === null) return;

        const source = historySource(body);
        const stockRaw = pickArray(source, [
          'stock_brief',
          'stock_briefs',
          'subscriptions',
          'stock_subscriptions',
          'stock_history',
          'briefs',
          'stock'
        ]);
        const b2bRaw = pickArray(source, [
          'b2b_lead_scraper',
          'jobs',
          'scraper_jobs',
          'lead_jobs',
          'b2b',
          'b2b_jobs',
          'scrapes'
        ]);
        const invoiceRaw = pickArray(source, [
          'invoice_ocr',
          'invoice_jobs',
          'invoice_history',
          'invoices',
          'invoice'
        ]);
        const enricherRaw = pickArray(source, [
          'lead_enricher',
          'lead_enricher_jobs',
          'enricher_jobs',
          'enricher',
          'enrichment_jobs'
        ]);
        const reviewRaw = pickArray(source, [
          'review_miner',
          'review_miner_jobs',
          'review_jobs',
          'review',
          'battlecards'
        ]);
        const propertyRaw = pickArray(source, [
          'property_scout',
          'property_scout_jobs',
          'property_jobs',
          'property',
          'deals'
        ]);
        const trackerRaw = pickArray(source, [
          'competitor_tracker',
          'competitor_tracker_jobs',
          'competitor_trackers',
          'tracker_jobs',
          'tracker',
          'watches'
        ]);
        const watchdogRaw = pickArray(source, [
          'site_watchdog',
          'site_watchdogs',
          'website_watchdog',
          'watchdog_jobs',
          'watchdog'
        ]);
        const combined = pickArray(source, ['history', 'records', 'runs', 'items']);
        const stockExtra = [];
        const b2bExtra = [];
        const invoiceExtra = [];
        const enricherExtra = [];
        const reviewExtra = [];
        const propertyExtra = [];
        const trackerExtra = [];
        const watchdogExtra = [];

        combined.forEach(function (item) {
          const kind = String(
            (item && (item.agent || item.agent_id || item.type || item.kind)) || ''
          ).toLowerCase();
          if (kind.indexOf('watchdog') !== -1 || kind.indexOf('uptime') !== -1) {
            watchdogExtra.push(item);
          } else if (kind.indexOf('track') !== -1 || kind.indexOf('monitor') !== -1) {
            trackerExtra.push(item);
          } else if (kind.indexOf('property') !== -1 || kind.indexOf('scout') !== -1) {
            propertyExtra.push(item);
          } else if (kind.indexOf('enrich') !== -1) {
            enricherExtra.push(item);
          } else if (kind.indexOf('review') !== -1 || kind.indexOf('competitor') !== -1) {
            reviewExtra.push(item);
          } else if (kind.indexOf('invoice') !== -1 || kind.indexOf('ocr') !== -1) {
            invoiceExtra.push(item);
          } else if (
            kind.indexOf('lead') !== -1 ||
            kind.indexOf('scrap') !== -1 ||
            kind.indexOf('b2b') !== -1
          ) {
            b2bExtra.push(item);
          } else {
            stockExtra.push(item);
          }
        });

        historyState.stock = stockRaw.concat(stockExtra).map(normalizeHistorySub);
        historyState.b2b = b2bRaw.concat(b2bExtra).map(normalizeHistoryJob);
        historyState.invoice = invoiceRaw.concat(invoiceExtra).map(normalizeInvoiceJob);
        historyState.enricher = enricherRaw.concat(enricherExtra).map(normalizeEnricherJob);
        historyState.review = reviewRaw.concat(reviewExtra).map(normalizeReviewJob);
        historyState.property = propertyRaw.concat(propertyExtra).map(normalizePropertyJob);
        historyState.tracker = trackerRaw.concat(trackerExtra).map(normalizeTrackerJob);
        historyState.watchdog = watchdogRaw.concat(watchdogExtra).map(normalizeWatchdogJob);

        /* Fall back to the locally cached activations when the server has
           nothing recorded yet for this browser. */
        if (!historyState.stock.length && Array.isArray(state.subscriptions) && state.subscriptions.length) {
          historyState.stock = state.subscriptions.map(function (sub) {
            return normalizeHistorySub({
              tickers: sub.watchlist,
              expires_at: sub.expiresAt,
              started_at: sub.startedAt,
              email: sub.email,
              credits_spent: sub.creditsSpent,
              status: sub.status
            });
          });
        }

        historyState.stock = sortNewestFirst(historyState.stock, 'startedAt');
        historyState.b2b = sortNewestFirst(historyState.b2b, 'created');
        historyState.invoice = sortNewestFirst(historyState.invoice, 'created');
        historyState.enricher = sortNewestFirst(historyState.enricher, 'created');
        historyState.review = sortNewestFirst(historyState.review, 'created');
        historyState.property = sortNewestFirst(historyState.property, 'created');
        historyState.tracker = sortNewestFirst(historyState.tracker, 'created');
        historyState.watchdog = sortNewestFirst(historyState.watchdog, 'created');

        historyState.loaded = true;
        paintHistory();
      })
      .catch(function (err) {
        historyState.loading = false;
        const message =
          err && err.name === 'AbortError'
            ? 'History request timed out'
            : err && err.message
            ? err.message
            : 'Could not load history';
        const note =
          '<p class="empty-note">Could not load your history (' +
          escapeHtml(message) +
          '). <button type="button" class="linklike" data-history-retry>Try again</button>.</p>';
        if (stockPane) stockPane.innerHTML = note;
        if (b2bPane) b2bPane.innerHTML = note;
        if (invoicePane) invoicePane.innerHTML = note;
        if (enricherPane) enricherPane.innerHTML = note;
        if (reviewPane) reviewPane.innerHTML = note;
        if (propertyPane) propertyPane.innerHTML = note;
        if (trackerPane) trackerPane.innerHTML = note;
        console.warn('[LiteWork] Account history unavailable.', message);
      });
  }

  function openHistoryJob(jobId) {
    const ref = String(jobId || '').trim();
    if (!ref) return;

    stopScraperTimers();
    const known = findHistoryJob(historyState.b2b, ref);
    const id = String((known && known.job_id) || ref);
    const current = state.scraperJob;
    if (!current || String(current.job_id || '') !== id) {
      state.scraperJob = {
        job_id: id,
        display_id: known ? String(known.display_id || '') : (ref !== id ? ref : ''),
        mode: 'live',
        status: 'running',
        starting: false,
        posted: true,
        scraped_rows: 0,
        filled_rows: 0,
        percent: 0,
        download_ready: false,
        collected_count: 0,
        target_count: known ? known.target : 0,
        country: known ? known.country : '',
        search_terms: known ? known.terms : [],
        selected_columns: LEAD_REQUIRED_COLUMNS.map(function (c) { return c.id; }),
        credits_spent: known ? known.credits : 0,
        started_at: '',
        email: accountEmail(),
        poll_errors: 0,
        status_warned: false
      };
      saveState();
    }

    if (currentRoute() === 'scraper-results') {
      renderScraperResults();
    } else {
      window.location.hash = '#scraper-results';
    }
  }

  function downloadHistoryJob(jobId) {
    const id = String(jobId || '').trim();
    if (!id || !LEAD_DOWNLOAD_URL) {
      toast('Download unlocks when your Excel is ready.', 'warn');
      return;
    }

    const url = LEAD_DOWNLOAD_URL + '?job_id=' + encodeURIComponent(id);
    toast('Preparing your download…', 'info');

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
          'litework-leads-' + id.replace(/[^A-Za-z0-9_-]/g, '') + '.xlsx';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 4000);
        toast('Excel download ready.', 'success');
      })
      .catch(function (err) {
        console.warn('[LiteWork] History download failed.', err);
        toast('Could not download the Excel file. Please try again.', 'warn');
      });
  }

  function manualTopUpLink(pack, orderId) {
    const title = 'Manual Credit Top-Up — ' + pack.name;
    const lines = [
      'Hi LiteWork team,',
      '',
      'I would like to request a manual credit top-up.',
      '',
      'Order ID: ' + (orderId || '(not issued yet)'),
      'Pack: ' + pack.name + ' — ' + pack.credits + ' credits · $' +
        Number(pack.price).toFixed(2) + ' USD',
      'Account email: ' + (state.email || '(please add my account email)'),
      '',
      'Please send me the payment instructions. Thank you!'
    ];
    return (
      'mailto:' + CHECKOUT_MANUAL_EMAIL +
      '?subject=' + encodeURIComponent(title) +
      '&body=' + encodeURIComponent(lines.join('\n'))
    );
  }

  function showCheckoutOnboarding(pack, payload) {
    const orderId = String(
      firstValue(payload || {}, ['order_id', 'orderId', 'reference', 'id'], '') || ''
    );
    const orderRow = orderId
      ? '<div class="checkout-line"><span>Order ID</span><span><code>' +
        escapeHtml(orderId) + '</code></span></div>'
      : '';

    openModal(
      '<h2 class="modal-title" id="modalTitle">Checkout is finalising</h2>' +
        '<p class="modal-sub">Your pack is reserved. Online card & bank checkout is currently finalizing bank verification — nothing has been charged and no credits were added yet.</p>' +
        '<div class="checkout-summary">' +
        '  <div class="checkout-pack">' +
        '    <span class="checkout-pack-name">' + escapeHtml(pack.name) + ' Pack</span>' +
        '    <span class="checkout-pack-credits">+' + pack.credits + ' credits</span>' +
        '  </div>' +
        '  <p>' + escapeHtml(pack.blurb) + '</p>' +
        '  <div class="checkout-line"><span>Credits</span><span>' + pack.credits + ' credits</span></div>' +
        '  <div class="checkout-line"><span>Amount</span><span>$' +
        Number(pack.price).toFixed(2) + ' USD</span></div>' +
        '  <div class="checkout-line"><span>Rate</span><span>' +
        escapeHtml(pack.rate || '') + (pack.bonus ? ' · +' + escapeHtml(pack.bonus) : '') +
        '</span></div>' +
        orderRow +
        '  <div class="checkout-line"><span>Current live balance</span><span>' +
        state.credits + ' credits</span></div>' +
        '</div>' +
        '<div class="checkout-notice">' +
        '  <strong>Prefer to top up right now?</strong>' +
        '  <p>Send us a manual top-up request with your Order ID and pack — we will reply with secure bank transfer or card instructions and credit your wallet once payment clears.</p>' +
        '</div>' +
        '<div class="checkout-actions">' +
        '  <a class="btn btn-primary btn-lg" href="' + manualTopUpLink(pack, orderId) + '">Request Instant Manual Top-Up</a>' +
        '  <button type="button" class="btn btn-ghost btn-lg" data-modal-close>Maybe later</button>' +
        '</div>' +
        '<p class="fine">Manual requests go to ' + escapeHtml(CHECKOUT_MANUAL_EMAIL) +
        '. Credits are only ever added server-side after payment is verified.</p>'
    );
  }

  function openCheckout(packId) {
    const pack = packById(packId);
    if (!pack) return;

    if (!requireAuth({ action: 'checkout', packId: packId })) return;

    openModal(
      '<h2 class="modal-title" id="modalTitle">Starting secure checkout…</h2>' +
        '<p class="modal-sub">Connecting to the LiteWork payment gateway for the ' +
        escapeHtml(pack.name) + ' pack (' + pack.credits + ' credits · $' +
        Number(pack.price).toFixed(2) + ' USD).</p>' +
        '<div class="checkout-loading" role="status" aria-live="polite">' +
        '<span class="checkout-spinner" aria-hidden="true"></span>' +
        '<span>Please wait — you will be redirected if the gateway is live.</span>' +
        '</div>'
    );

    if (!BILLING_CHECKOUT_URL) {
      showCheckoutOnboarding(pack, null);
      return;
    }

    apiFetch(
      BILLING_CHECKOUT_URL,
      { method: 'POST', body: JSON.stringify({ pack_id: pack.id }) },
      20000
    )
      .then(function (response) {
        return readJson(response).then(function (body) {
          if (response.status === 401) {
            handleAuthExpired(
              'Your session expired. Log in again to top up credits.',
              { action: 'checkout', packId: pack.id }
            );
            return null;
          }
          return { ok: response.ok, status: response.status, body: body || {} };
        });
      })
      .then(function (result) {
        if (!result) return;

        const body = result.body && typeof result.body === 'object' ? result.body : {};
        const data =
          body.data && typeof body.data === 'object' ? body.data : body;
        const mode = String(
          firstValue(data, ['mode', 'checkout_mode'], body.mode || '') || ''
        ).toLowerCase();
        const checkoutUrl = String(
          firstValue(
            data,
            ['checkout_url', 'checkoutUrl', 'payment_url', 'url'],
            body.checkout_url || ''
          ) || ''
        ).trim();

        if (mode === 'live' && checkoutUrl) {
          toast('Redirecting to secure checkout…', 'info');
          window.location.href = checkoutUrl;
          return;
        }

        showCheckoutOnboarding(pack, data);
      })
      .catch(function (err) {
        console.warn('[LiteWork] Checkout request failed.', err);
        showCheckoutOnboarding(pack, null);
      });
  }

  /* =========================== H. CONFIGURE ============================== */
  /* Region-aware picker: US · Malaysia (Bursa) · Singapore (SGX).
     Tickers can be combined across regions in one subscription. */
  let stockRegionId = DEFAULT_STOCK_REGION;

  function stockRegionById(id) {
    for (let i = 0; i < STOCK_REGIONS.length; i += 1) {
      if (STOCK_REGIONS[i].id === id) return STOCK_REGIONS[i];
    }
    return STOCK_REGIONS[0] || null;
  }

  function buildStockGrid() {
    const grid = $('#stockGrid');
    if (!grid) return;

    const tabs = $('#stockRegionTabs');
    if (tabs && !tabs.dataset.bound) {
      tabs.innerHTML = STOCK_REGIONS.map(function (region) {
        return (
          '<button type="button" class="region-tab" data-stock-region="' + escapeHtml(region.id) + '" role="tab" aria-selected="false">' +
          (region.flag ? '<span class="region-flag" aria-hidden="true">' + region.flag + '</span>' : '') +
          '<span class="region-label">' + escapeHtml(region.label) + '</span>' +
          '<span class="region-count">' + region.stocks.length + '</span>' +
          '</button>'
        );
      }).join('');

      tabs.addEventListener('click', function (event) {
        const btn = event.target.closest ? event.target.closest('[data-stock-region]') : null;
        if (!btn) return;
        const id = btn.getAttribute('data-stock-region');
        if (!id || id === stockRegionId) return;
        stockRegionId = id;
        renderStockRegion();
      });
      tabs.dataset.bound = '1';
    }

    if (!grid.dataset.bound) {
      grid.addEventListener('click', function (event) {
        const card = event.target.closest ? event.target.closest('.stock-card') : null;
        if (!card || card.disabled) return;
        toggleStock(card.getAttribute('data-ticker'));
      });
      grid.dataset.bound = '1';
    }

    const chips = $('#stockChips');
    if (chips && !chips.dataset.bound) {
      chips.addEventListener('click', function (event) {
        const btn = event.target.closest ? event.target.closest('[data-remove-ticker]') : null;
        if (!btn) return;
        toggleStock(btn.getAttribute('data-remove-ticker'));
      });
      chips.dataset.bound = '1';
    }

    renderStockRegion();
  }

  function renderStockRegion() {
    const grid = $('#stockGrid');
    if (!grid) return;

    const region = stockRegionById(stockRegionId) || STOCK_REGIONS[0];
    if (!region) {
      grid.innerHTML = '';
      return;
    }

    grid.innerHTML = region.stocks.map(function (stock) {
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
    grid.setAttribute('aria-label', region.label + ' tickers');

    const tabs = $('#stockRegionTabs');
    if (tabs) {
      $$('[data-stock-region]', tabs).forEach(function (btn) {
        const active = btn.getAttribute('data-stock-region') === region.id;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', String(active));
      });
    }

    const note = $('#stockRegionNote');
    if (note) {
      note.textContent =
        region.markets + ' · ' + region.stocks.length + ' tickers · ' +
        CREDITS_PER_STOCK + ' credits per stock';
    }

    renderSelectedChips();
    renderConfigure();
  }

  /* Compact chip strip: selected tickers stay visible when switching tabs. */
  function renderSelectedChips() {
    const wrap = $('#stockChips');
    if (!wrap) return;

    if (!selectedStocks.length) {
      wrap.innerHTML =
        '<span class="stock-chips-empty">No tickers selected yet — tap any card to add (any region).</span>';
      return;
    }

    wrap.innerHTML = selectedStocks
      .map(function (ticker) {
        return (
          '<span class="stock-chip">' + escapeHtml(ticker) +
          '<button type="button" class="stock-chip-x" data-remove-ticker="' + escapeHtml(ticker) +
          '" aria-label="Remove ' + escapeHtml(ticker) + '">×</button></span>'
        );
      })
      .join('');
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
        TRADING_DAYS + ' trading days (Mon–Fri)</p>' +
        '<p class="stock-delivery-note">' + escapeHtml(DELIVERY_NOTE) + '</p>' +
        '<div class="notice notice-warn" id="configureLocked" hidden>' +
        '<strong>You need at least ' + CREDITS_PER_STOCK + ' credits for a ' +
        TRADING_DAYS + '-trading-day subscription.</strong>' +
        '<p>Your balance is <span data-credit-count>' + state.credits +
        '</span> credits. A $5 Starter pack (25 credits) covers 5 stocks for a full market week.</p>' +
        '<a class="btn btn-primary btn-sm" href="#topup">Top up credits</a>' +
        '</div>' +
        '<div id="configureBody">' +
        '<div class="calc-card modal-calc"><div class="calc-grid">' +
        '<div class="calc-cell"><span class="calc-label">Available</span>' +
        '<span class="calc-value" id="calcAvailable">0 Credits</span></div>' +
        '<div class="calc-cell"><span class="calc-label">Selected</span>' +
        '<span class="calc-value" id="calcSelected">0</span></div>' +
        '<div class="calc-cell"><span class="calc-label">Duration</span>' +
        '<span class="calc-value" id="calcDuration">' + TRADING_DAYS + ' Trading Days</span></div>' +
        '<div class="calc-cell calc-cell-total"><span class="calc-label">Total cost</span>' +
        '<span class="calc-value" id="calcCost">' + CREDITS_PER_STOCK + ' Credits</span>' +
        '<span class="calc-sub" id="calcRemaining"></span></div>' +
        '</div></div>' +
        '<div class="modal-section"><h3>1. Select stocks</h3>' +
        '<span class="pill-note" id="stockQuotePill"></span></div>' +
        '<div class="stock-region-tabs" id="stockRegionTabs" role="tablist" aria-label="Market region"></div>' +
        '<p class="fine stock-region-note" id="stockRegionNote"></p>' +
        '<div class="stock-chips" id="stockChips" aria-live="polite"></div>' +
        '<div class="stock-grid" id="stockGrid" role="group" aria-label="Select stocks to monitor"></div>' +
        '<p class="fine" id="stockGridHint"></p>' +
        '<div class="modal-section"><h3>2. Delivery details</h3>' +
        '<span class="fine">Email only</span></div>' +
        '<form id="configureForm" class="config-form stock-modal-form" novalidate>' +
        '<div class="form-two">' +
        '<div class="field"><label for="fullName">Full name <span class="req">*</span></label>' +
        '<input type="text" id="fullName" name="fullName" placeholder="Alex Tan" autocomplete="name" required />' +
        '<span class="field-error" id="nameError" role="alert"></span></div>' +
        '<div class="field"><label for="email">Delivery email</label>' +
        '<input type="email" id="email" name="email" class="is-locked" value="' +
        escapeHtml(accountEmail()) + '" disabled tabindex="-1" />' +
        '<span class="field-error" id="emailError" role="alert"></span></div>' +
        '</div>' +
        '<div class="config-summary" id="configSummary"></div>' +
        '<button type="submit" class="btn btn-activate" id="activateBtn">Confirm & Spend ' +
        CREDITS_PER_STOCK + ' Credits (' + TRADING_DAYS + ' Trading Days)</button>' +
        '<p class="fine">First brief arrives on the next market morning at 07:00 MYT.</p>' +
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
    if (emailEl) {
      emailEl.value = accountEmail();
      emailEl.disabled = true;
      emailEl.setAttribute('tabindex', '-1');
    }

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
    setText('#calcDuration', TRADING_DAYS + ' Trading Days (Mon–Fri)');
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
          ' selected across regions. Deselect one to swap, or top up for more.';
      } else {
        const free = max - selectedStocks.length;
        hint.textContent =
          'Choose up to ' + max + ' stock' + (max === 1 ? '' : 's') +
          ' across any region for this activation · ' + free + ' slot' +
          (free === 1 ? '' : 's') + ' left.';
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
        '<span>' + cost + ' credits · ' + TRADING_DAYS + ' trading days</span></div>' +
        '<div class="config-summary-row"><span>Balance after activation</span>' +
        '<span>' + remaining + ' credits</span></div>';
    }

    const activateBtn = $('#activateBtn');
    if (activateBtn) {
      activateBtn.classList.remove('is-busy');
      activateBtn.textContent =
        'Confirm & Spend ' + cost + ' Credits (' + TRADING_DAYS + ' Trading Days)';
      activateBtn.disabled = selectedStocks.length === 0 || cost > state.credits;
    }

    /* Chips mirror selections across every region tab. */
    renderSelectedChips();
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
    const email = accountEmail();
    if (emailEl) emailEl.value = email;

    const cost = selectedStocks.length * CREDITS_PER_STOCK;
    let valid = true;

    if (name.length < 2) {
      setFieldError(nameEl, 'Please enter your full name.');
      valid = false;
    }
    if (!isValidEmail(email)) {
      setFieldError(
        emailEl,
        'Your account email is missing. Please log out and log in again.'
      );
      valid = false;
    }
    if (selectedStocks.length === 0) {
      toast('Select at least one stock to activate.', 'warn');
      valid = false;
    }
    if (cost > state.credits) {
      toast('Not enough credits for this watchlist. Top up credits.', 'warn');
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

    console.log('[LiteWork] subscriber.activated → ' + (CFG.WEBHOOK_URL || '(no webhook configured)'));
    console.log('[LiteWork] webhook payload:', JSON.stringify(payload, null, 2));

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
        setLiveCredits(result.remaining);
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

      /* Never mutate credits locally — only trust remaining_credits. */
      if (!setLiveCredits(result.remaining) && auth.token) {
        refreshSession();
      }
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
          '[LiteWork] Agent webhook unreachable — keeping the local activation.',
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
        escapeHtml(fmtMYT(sub.expiresAt)) + '</strong> · ' + TRADING_DAYS +
        ' trading days (Mon–Fri)';
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
    body.scrollTop = 0;
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
    stopInvoiceTimer();
    stopLeTimer();
    stopRwTimer();
    pendingGate = null;
    selectedStocks = [];
    lastWebhookResult = null;
    pendingWebhook = false;

    /* Local job/subscription history belongs to the signed-in account. */
    state.subscriptions = [];
    state.lastSubscription = null;
    state.scraperJob = null;
    state.invoiceJob = null;
    state.enricherJob = null;
    state.reviewJob = null;
    state.propertyJob = null;
    state.trackerJob = null;
    state.watchdogJob = null;
    historyState = {
      loaded: false,
      loading: false,
      stock: [],
      b2b: [],
      invoice: [],
      enricher: [],
      review: [],
      property: [],
      tracker: [],
      watchdog: []
    };
    historyPages = {
      stock: 1,
      b2b: 1,
      invoice: 1,
      enricher: 1,
      review: 1,
      property: 1,
      tracker: 1,
      watchdog: 1
    };
    saveState();

    clearAuthSession();
    renderTopup();
    renderHistory();
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

    /* Click-away for the nav, wallet and the Lead Enricher job picker */
    document.addEventListener('click', function (event) {
      const nav = $('#navbar');
      if (nav && !nav.contains(event.target)) closeMobileNav();

      const wallet = $('#wallet');
      if (wallet && !wallet.contains(event.target)) closeWallet();

      const jobCombo = $('#leJobCombo');
      if (jobCombo && !jobCombo.contains(event.target)) closeLeJobPanel(true);
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

    /* Escape closes the job dropdown first, then the overlays */
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (closeLeJobPanel(true)) return;
      closeModal();
      closeWallet();
      closeMobileNav();
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

    /* Subscriptions & history: All / Stock / B2B filters */
    $$('[data-history-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyHistoryFilter(btn.getAttribute('data-history-tab'));
      });
    });

    /* Subscriptions & history: refresh, retry, resume and download */
    const historyRefresh = $('#historyRefresh');
    if (historyRefresh) {
      historyRefresh.addEventListener('click', function () {
        renderHistory(true);
      });
    }

    const historyPanel = $('#historyPanel');
    if (historyPanel) {
      historyPanel.addEventListener('click', function (event) {
        const pageBtn = event.target.closest('[data-hist-page]');
        if (pageBtn) {
          const kind = pageBtn.getAttribute('data-hist-page');
          const dir = pageBtn.getAttribute('data-hist-dir');
          if (
            kind === 'stock' ||
            kind === 'b2b' ||
            kind === 'invoice' ||
            kind === 'enricher' ||
            kind === 'review' ||
            kind === 'property' ||
            kind === 'tracker' ||
            kind === 'watchdog'
          ) {
            const list = historyState[kind] || [];
            const total = list.length;
            const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
            const current = clamp(Number(historyPages[kind]) || 1, 1, pages);
            historyPages[kind] = clamp(current + (dir === 'next' ? 1 : -1), 1, pages);
            paintHistory();
          }
          return;
        }

        const login = event.target.closest('[data-history-login]');
        if (login) {
          openAuthModal('login', 'Log in to load your subscriptions and run history.');
          return;
        }
        const retry = event.target.closest('[data-history-retry]');
        if (retry) {
          renderHistory(true);
          return;
        }
        const resume = event.target.closest('[data-history-resume]');
        if (resume) {
          openHistoryJob(resume.getAttribute('data-history-resume'));
          return;
        }
        const download = event.target.closest('[data-history-download]');
        if (download) {
          downloadHistoryJob(download.getAttribute('data-history-download'));
          return;
        }

        const invResume = event.target.closest('[data-invoice-resume]');
        if (invResume) {
          openInvoiceHistoryJob(invResume.getAttribute('data-invoice-resume'));
          return;
        }

        const invDownload = event.target.closest('[data-invoice-download]');
        if (invDownload) {
          downloadInvoiceExcel(invDownload.getAttribute('data-invoice-download'));
          return;
        }

        const leResume = event.target.closest('[data-enricher-resume]');
        if (leResume) {
          openLeHistoryJob(leResume.getAttribute('data-enricher-resume'));
          return;
        }

        const leDownload = event.target.closest('[data-enricher-download]');
        if (leDownload) {
          downloadLeExcel(leDownload.getAttribute('data-enricher-download'));
          return;
        }

        const rwResume = event.target.closest('[data-review-resume]');
        if (rwResume) {
          openRwHistoryJob(rwResume.getAttribute('data-review-resume'));
          return;
        }

        const rwDownload = event.target.closest('[data-review-download]');
        if (rwDownload) {
          downloadRwExcel(rwDownload.getAttribute('data-review-download'));
          return;
        }

        const propResume = event.target.closest('[data-property-resume]');
        if (propResume) {
          openPropHistoryJob(propResume.getAttribute('data-property-resume'));
          return;
        }

        const propDownload = event.target.closest('[data-property-download]');
        if (propDownload) {
          downloadPropExcel(propDownload.getAttribute('data-property-download'));
          return;
        }

        const wdgView = event.target.closest('[data-watchdog-view]');
        if (wdgView) {
          openWatchdogHistoryJob(wdgView.getAttribute('data-watchdog-view'));
        }
      });
    }

    /* Category filter pills + strict 3-agents-per-page pagination */
    (function bindAgentFilters() {
      const pills = $$('[data-agent-filter]');
      const cards = $$('#agentGrid [data-agent-cat]');
      if (!pills.length || !cards.length) return;

      const PAGE_SIZE = 3;
      let filter = 'all';
      let page = 1;

      const pager = $('#agentPager');
      const info = $('#agentPageInfo');
      const nums = $('#agentPageNums');
      const prev = $('#agentPrev');
      const next = $('#agentNext');

      function filteredCards() {
        if (filter === 'all') return cards;
        return cards.filter(function (card) {
          const cats = String(card.getAttribute('data-agent-cat') || '')
            .split(/\s+/)
            .filter(function (c) { return !!c; });
          return cats.indexOf(filter) !== -1;
        });
      }

      function paintPages() {
        const list = filteredCards();
        const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
        page = clamp(page, 1, pages);

        cards.forEach(function (card) { card.hidden = true; });
        list
          .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
          .forEach(function (card) { card.hidden = false; });

        /* Filtered categories with <= 3 agents need no pagination. */
        if (pager) pager.hidden = list.length <= PAGE_SIZE;
        if (info) info.textContent = 'Page ' + page + ' of ' + pages;

        if (nums) {
          let html = '';
          for (let i = 1; i <= pages; i += 1) {
            html +=
              '<button type="button" class="agent-pager-num' +
              (i === page ? ' is-active' : '') + '" data-agent-page="' + i +
              '" aria-label="Page ' + i + '"' +
              (i === page ? ' aria-current="page"' : '') + '>' + i + '</button>';
          }
          nums.innerHTML = html;
        }

        if (prev) {
          const off = page <= 1;
          prev.disabled = off;
          prev.setAttribute('aria-disabled', off ? 'true' : 'false');
        }
        if (next) {
          const off = page >= pages;
          next.disabled = off;
          next.setAttribute('aria-disabled', off ? 'true' : 'false');
        }
      }

      pills.forEach(function (pill) {
        pill.addEventListener('click', function () {
          filter = pill.getAttribute('data-agent-filter') || 'all';
          page = 1;
          pills.forEach(function (other) {
            const on = other === pill;
            other.classList.toggle('is-active', on);
            other.setAttribute('aria-selected', on ? 'true' : 'false');
          });
          paintPages();
        });
      });

      if (prev) {
        prev.addEventListener('click', function () {
          if (page <= 1) return;
          page -= 1;
          paintPages();
        });
      }
      if (next) {
        next.addEventListener('click', function () {
          page += 1;
          paintPages();
        });
      }
      if (nums) {
        nums.addEventListener('click', function (event) {
          const btn = event.target.closest ? event.target.closest('[data-agent-page]') : null;
          if (!btn) return;
          page = toPositiveInt(btn.getAttribute('data-agent-page'), 1);
          paintPages();
        });
      }

      paintPages();
    })();

    /* Coming-soon waitlist buttons */
    $$('[data-waitlist]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toast(btn.getAttribute('data-waitlist') + ' is on the way — you are on the list.', 'info');
      });
    });

    /* Subscribe → auth gate → configuration modal */
    function launchStockAgent() {
      if (!isLoggedIn()) {
        requireAuth({ action: 'stock' });
        return;
      }
      if (state.credits < CREDITS_PER_STOCK) {
        toast('You need at least ' + CREDITS_PER_STOCK + ' credits to subscribe.', 'warn');
        return;
      }
      openStockModal();
    }

    const subscribeBtn = $('#subscribeBtn');
    if (subscribeBtn) {
      subscribeBtn.addEventListener('click', launchStockAgent);
    }
    $$('[data-open-stock]').forEach(function (btn) {
      btn.addEventListener('click', launchStockAgent);
    });

    /* Lead Scraper: auth gate → configuration modal */
    function launchScraperAgent() {
      if (!isLoggedIn()) {
        requireAuth({ action: 'scraper' });
        return;
      }
      if (state.credits < LEAD_MIN_CREDITS) {
        toast('Needs at least ' + LEAD_MIN_CREDITS + ' credits (1 term · ' + LEAD_LEADS_PER_TERM + ' leads).', 'warn');
        return;
      }
      openScraperModal();
    }

    const scraperBtn = $('#scraperSubscribeBtn');
    if (scraperBtn) {
      scraperBtn.addEventListener('click', launchScraperAgent);
    }
    $$('[data-open-scraper]').forEach(function (btn) {
      btn.addEventListener('click', launchScraperAgent);
    });

    /* Lead Scraper: column reference */
    $$('[data-open-columns]').forEach(function (btn) {
      btn.addEventListener('click', openColumnsModal);
    });

    /* Invoice OCR: extracted-column reference */
    $$('[data-open-invoice-columns]').forEach(function (btn) {
      btn.addEventListener('click', openInvoiceColumnsModal);
    });

    /* Invoice OCR: launch modal, resume + download */
    $$('[data-open-invoice]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openInvoiceModal();
      });
    });

    const invoiceResumeBtn = $('#invoiceResumeBtn');
    if (invoiceResumeBtn) {
      invoiceResumeBtn.addEventListener('click', function () {
        const input = $('#invoiceResumeId');
        const value = input ? input.value.trim() : '';
        if (!value) {
          toast('Enter an Invoice Job ID to check.', 'warn');
          return;
        }
        openInvoiceHistoryJob(value);
      });
    }

    const invoiceDownloadBtn = $('#invoiceDownloadBtn');
    if (invoiceDownloadBtn) {
      invoiceDownloadBtn.addEventListener('click', function () {
        downloadInvoiceExcel();
      });
    }

    /* Lead Enricher (Worker #4): launch, columns, resume + download */
    $$('[data-open-enricher]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openLeadEnricherModal();
      });
    });

    $$('[data-open-enricher-columns]').forEach(function (btn) {
      btn.addEventListener('click', openEnricherColumnsModal);
    });

    const leResumeBtn = $('#leResumeBtn');
    if (leResumeBtn) {
      leResumeBtn.addEventListener('click', function () {
        const input = $('#leResumeId');
        const value = input ? input.value.trim() : '';
        if (!value) {
          toast('Enter a Lead Enricher Job ID to check.', 'warn');
          return;
        }
        openLeHistoryJob(value);
      });
    }

    const leResumeInput = $('#leResumeId');
    if (leResumeInput) {
      leResumeInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (leResumeBtn) leResumeBtn.click();
        }
      });
    }

    const leDownloadBtn = $('#leDownloadBtn');
    if (leDownloadBtn) {
      leDownloadBtn.addEventListener('click', function () {
        downloadLeExcel();
      });
    }

    /* Review Miner (Worker #5): launch, sheet reference, resume + download */
    $$('[data-open-review]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openReviewMinerModal();
      });
    });

    $$('[data-open-review-sheets]').forEach(function (btn) {
      btn.addEventListener('click', openReviewSheetsModal);
    });

    const rwResumeBtn = $('#rwResumeBtn');
    if (rwResumeBtn) {
      rwResumeBtn.addEventListener('click', function () {
        const input = $('#rwResumeId');
        const value = input ? input.value.trim() : '';
        if (!value) {
          toast('Enter a Review Miner Job ID to check.', 'warn');
          return;
        }
        openRwHistoryJob(value);
      });
    }

    const rwResumeInput = $('#rwResumeId');
    if (rwResumeInput) {
      rwResumeInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (rwResumeBtn) rwResumeBtn.click();
        }
      });
    }

    const rwDownloadBtn = $('#rwDownloadBtn');
    if (rwDownloadBtn) {
      rwDownloadBtn.addEventListener('click', function () {
        downloadRwExcel();
      });
    }

    /* Property Deal Sniper (Worker #6): launch, resume + download */
    $$('[data-open-property]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openPropertyModal();
      });
    });

    const propResumeBtn = $('#propResumeBtn');
    if (propResumeBtn) {
      propResumeBtn.addEventListener('click', function () {
        const input = $('#propResumeId');
        const value = input ? input.value.trim() : '';
        if (!value) {
          toast('Enter a Property Sniper Job ID to check.', 'warn');
          return;
        }
        openPropHistoryJob(value);
      });
    }

    const propResumeInput = $('#propResumeId');
    if (propResumeInput) {
      propResumeInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (propResumeBtn) propResumeBtn.click();
        }
      });
    }

    const propDownloadBtn = $('#propDownloadBtn');
    if (propDownloadBtn) {
      propDownloadBtn.addEventListener('click', function () {
        downloadPropExcel();
      });
    }

    /* Competitor Change Tracker (Worker #7): launch */
    $$('[data-open-competitor]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openCompetitorTrackerModal();
      });
    });

    /* Website Watchdog (Worker #8): launch */
    $$('[data-open-watchdog]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openWatchdogModal();
      });
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
  let scraperPollInFlight = false;
  let scraperPollController = null;
  let scraperPollEpoch = 0;
  let scraperPollStartedAt = 0;

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

  function scraperJobFailed(job) {
    const status = String((job && job.status) || '').toLowerCase();
    return (
      status === 'failed' ||
      status === 'error' ||
      status === 'cancelled' ||
      status === 'canceled'
    );
  }

  function scraperPollActive(job) {
    return !!job && !scraperJobFailed(job) && !scraperIsComplete(job);
  }

  function stopScraperTimers() {
    scraperPollEpoch += 1;
    if (scraperPollTimer) {
      window.clearTimeout(scraperPollTimer);
      scraperPollTimer = null;
    }
    scraperPollStartedAt = 0;
    if (scraperPollController) {
      try {
        scraperPollController.abort();
      } catch (err) {
        /* already settled */
      }
      scraperPollController = null;
    }
    scraperPollInFlight = false;
  }

  /* Background-safe: the scraper keeps polling on every route so the global
     floating progress pill stays accurate when the user navigates away. */
  function scraperPageActive() {
    return true;
  }

  function stopEmailTrail() {
    if (emailTrailTimer) {
      window.clearTimeout(emailTrailTimer);
      emailTrailTimer = null;
    }
    emailTrailTries = 0;
  }

  /* After completion, poll up to 3× more (3s apart) for the SMTP flag.
     A setTimeout chain avoids overlapping requests. */
  function startEmailTrail() {
    if (emailTrailTimer) return;
    const job = state.scraperJob;
    if (!job || job.mode === 'demo' || job.email_sent === true) return;

    emailTrailTries = 0;
    const tick = function () {
      emailTrailTimer = null;
      const current = state.scraperJob;
      if (!current || current.email_sent === true || emailTrailTries >= 3) {
        stopEmailTrail();
        return;
      }
      emailTrailTries += 1;
      pollScraperStatus(true);
      if (emailTrailTries < 3 && current.email_sent !== true) {
        emailTrailTimer = window.setTimeout(tick, 3000);
      } else {
        stopEmailTrail();
      }
    };
    emailTrailTimer = window.setTimeout(tick, 3000);
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
        '<span class="card-job-pill"><span class="job-live-dot"></span>Finishing up…</span>' +
        '<a class="btn btn-ghost btn-sm" href="#scraper-results">View Progress</a>' +
        '</div>';
      return;
    }

    if (status === 'queued' || status === 'pending') {
      wrap.hidden = false;
      wrap.innerHTML =
        '<div class="card-job-live">' +
        '<span class="card-job-pill"><span class="job-live-dot"></span>Queued · Waiting to start…</span>' +
        '<a class="btn btn-ghost btn-sm" href="#scraper-results">View Progress</a>' +
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
        '<a class="btn btn-ghost btn-sm" href="#scraper-results">View Progress</a>' +
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
    if (resume) resume.value = formatJobRef(job) || '';
    const resumeBtn = $('#resumeBtn');
    if (resumeBtn) {
      resumeBtn.disabled = false;
      resumeBtn.removeAttribute('disabled');
      resumeBtn.setAttribute('aria-disabled', 'false');
    }

    renderJobSummary();
    renderLeadsTable();
    updateScraperProgress();

    if (scraperIsComplete(job)) {
      completeScraperJob(true);
      return;
    }
    if (scraperJobFailed(job)) {
      const message = job.error || job.status || 'start a new scrape';
      setScraperBadge('fail', 'Job failed · ' + message);
      const rule = $('#ringRule');
      if (rule) rule.textContent = 'Failed · ' + message;
      const sub = $('#downloadSub');
      if (sub) sub.textContent = 'Failed · ' + message;
      return;
    }
    ensureScraperRunning();
  }

  /* 95 → "1m 35s" */
  function formatElapsed(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    if (mins <= 0) return secs + 's';
    return mins + 'm ' + (secs < 10 ? '0' + secs : String(secs)) + 's';
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

    const ringRule = $('#ringRule');
    if (ringRule) {
      ringRule.textContent =
        (Number(job.credits_per_term) || LEAD_CREDITS_PER_TERM) + ' credits per ' +
        (Number(job.leads_per_term) || LEAD_LEADS_PER_TERM) + '-lead term';
    }

    if (summary) {
      summary.innerHTML =
        '<div class="summary-row"><dt>Country</dt><dd>' + escapeHtml(job.country) + '</dd></div>' +
        '<div class="summary-row"><dt>Search terms</dt><dd>' + (job.search_terms || []).length + '</dd></div>' +
        '<div class="summary-row"><dt>Leads per term</dt><dd>' +
        (Number(job.leads_per_term) || LEAD_LEADS_PER_TERM) + '</dd></div>' +
        '<div class="summary-row"><dt>Target leads</dt><dd><strong>' + scraperTarget(job) + '</strong></dd></div>' +
        '<div class="summary-row"><dt>Credits spent</dt><dd><strong>' + (job.credits_spent || 0) + '</strong></dd></div>' +
        '<div class="summary-row"><dt>Columns</dt><dd>' + cols.length + '</dd></div>' +
        '<div class="summary-row"><dt>Started</dt><dd>' + escapeHtml(fmtMYT(job.started_at)) + '</dd></div>' +
        '<div class="summary-row"><dt>Job ID</dt><dd><code>' + escapeHtml(formatJobRef(job)) + '</code></dd></div>';
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

    /* Current search term + elapsed time, next to the percentage ring. */
    const activeEl = $('#ringActive');
    if (activeEl) {
      const activeQuery = String(job.active_query || '').trim();
      const phase = String(job.status || '').toLowerCase();
      const terminal =
        complete ||
        phase === 'completed' ||
        phase === 'complete' ||
        phase === 'failed' ||
        phase === 'error';
      if (activeQuery && !terminal) {
        activeEl.hidden = false;
        activeEl.textContent =
          'Scraping "' + activeQuery + '" · ' + formatElapsed(job.query_elapsed_s);
      } else {
        activeEl.hidden = true;
        activeEl.textContent = '';
      }
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
        downloadSub.textContent = 'Finishing up…';
      } else {
        downloadSub.textContent = 'Working — safe to close this tab and return anytime.';
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
          ' when ready — safe to close this tab.';
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

  /* The backend returns cells under a few different key names. Normalise the
     common aliases so Phone Number / Company Name never render blank. */
  function leadCellValue(row, id) {
    if (!row || typeof row !== 'object') return '—';

    const read = function (keys) {
      for (let i = 0; i < keys.length; i += 1) {
        const raw = row[keys[i]];
        if (raw === null || raw === undefined) continue;
        const text = String(raw).trim();
        if (text) return text;
      }
      return '';
    };

    let value = '';
    if (id === 'phone') {
      value = read([
        'phone',
        'phone_number',
        'Phone Number',
        'Phone',
        'phoneNumber',
        'telephone',
        'mobile'
      ]);
    } else if (id === 'company_name') {
      value = read(['company_name', 'name', 'title', 'Company Name', 'Company', 'company']);
    } else {
      const label = LEAD_COLUMN_LABELS[id];
      value = read(
        label && label !== id
          ? [id, label, String(label).replace(/\s+/g, '_').toLowerCase()]
          : [id]
      );
    }

    return value || '—';
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
                  const value = leadCellValue(row, id);
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
    const message = reason ? String(reason) : 'The scraper stopped unexpectedly.';
    job.status = 'failed';
    job.error = message;
    stopScraperTimers();
    stopEmailTrail();
    saveState();

    renderScraperCardStatus();
    setScraperBadge('fail', 'Job failed · ' + message);

    const rule = $('#ringRule');
    if (rule) rule.textContent = 'Failed · ' + message;
    const sub = $('#downloadSub');
    if (sub) sub.textContent = 'Failed · ' + message;

    toast('Scrape failed — ' + message, 'warn');
  }

  /* ----- live backend: POST start, then poll every 2.5s ----- */
  function ensureScraperRunning() {
    const job = state.scraperJob;
    if (!job || scraperJobFailed(job) || scraperIsComplete(job)) return;
    if (!isLoggedIn()) return;

    if (job.starting) {
      /* Do not let a stale "starting" flag freeze the status loop forever. */
      const startedMs = new Date(job.started_at || 0).getTime();
      if (Number.isFinite(startedMs) && Date.now() - startedMs < 20000) return;
      job.starting = false;
      saveState();
    }

    if (!job.posted) {
      job.posted = true;
      saveState();
      postScraperStart(job);
      return;
    }

    startLivePolling(job);
  }

  function postScraperStart(job, options) {
    const opts = options || {};

    const failStart = function (message) {
      const text = message || 'The scraper could not start. Please try again.';
      revertScraperStart(job, true);
      if (typeof opts.onError === 'function') opts.onError(text);
      else toast(text, 'warn');
    };

    if (!LEAD_START_URL) {
      failStart('Lead Scraper is unavailable right now. Please try again later.');
      return;
    }

    if (!isLoggedIn()) {
      revertScraperStart(job, true);
      handleAuthExpired(
        'Your session expired. Log in again to launch the Lead Scraper.',
        { action: 'scraper' }
      );
      return;
    }

    setScraperBadge('pending', 'Working…');

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
        target_count: scraperTarget(job),
        leads_per_term: Number(job.leads_per_term) || scraperLeadsPerTerm,
        credits_per_term: Number(job.credits_per_term) || LEAD_CREDITS_PER_TERM,
        credits_spent: job.credits_spent,
        remaining_credits: Math.max(0, state.credits)
      }),
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) {
        if (timer) window.clearTimeout(timer);

        if (response.status === 401) {
          return readJson(response).then(function () {
            return { kind: 'unauthorized' };
          });
        }
        if (response.status === 402) {
          return readJson(response).then(function (body) {
            return { kind: 'insufficient', body: body || {} };
          });
        }
        return readJson(response).then(function (body) {
          if (!response.ok) {
            return { kind: 'error', status: response.status, body: body || {} };
          }
          return { kind: 'ok', body: body || {} };
        });
      })
      .then(function (result) {
        if (!result) return;

        if (result.kind === 'unauthorized') {
          revertScraperStart(job, true);
          handleAuthExpired(
            'Your session expired. Log in again to launch the Lead Scraper.',
            { action: 'scraper' }
          );
          return;
        }

        const body = result.body || {};

        /* Any live balance returned by the backend wins. */
        const liveCreditsApplied = setLiveCredits(extractRemaining(body));
        if (liveCreditsApplied) syncCreditUI();

        if (result.kind === 'insufficient') {
          failStart(
            body.error || 'Insufficient credits for this scrape. Top up and try again.'
          );
          return;
        }

        if (result.kind === 'error') {
          failStart(
            body.error || 'The scraper could not start (HTTP ' + result.status + ').'
          );
          return;
        }

        const status = String(body.status || '').toLowerCase();
        if (body.ok === false || status === 'failed' || status === 'error' ||
            status === 'cancelled' || status === 'canceled') {
          failStart(body.error || 'The scraper could not start this run.');
          return;
        }

        if (body.mode === 'demo' || status === 'demo') {
          failStart('Lead Scraper is temporarily busy. Please try again later.');
          return;
        }

        if (body.job_id && String(body.job_id) !== String(job.job_id)) {
          job.job_id = String(body.job_id);
        }
        if (body.display_id) job.display_id = String(body.display_id);
        job.starting = false;
        job.posted = true;
        job.status = status || 'running';
        saveState();

        if (!liveCreditsApplied && auth.token) refreshSession();

        if (typeof opts.onStarted === 'function') opts.onStarted(body);
        else startLivePolling(job);
      })
      .catch(function (err) {
        if (timer) window.clearTimeout(timer);
        console.warn(
          '[LiteWork] Lead scraper start response unavailable.',
          err && err.message ? err.message : err
        );
        failStart('Temporarily busy — please try again in a moment.');
      });
  }

  /* Stop a start attempt. Credits are never adjusted client-side. */
  function revertScraperStart(job, clearJob) {
    stopScraperTimers();
    stopEmailTrail();
    if (clearJob) state.scraperJob = null;
    saveState();
    syncCreditUI();
    renderScraperResults();
  }

  function startLivePolling(job, force) {
    if (!job || !LEAD_STATUS_URL) return;
    if (!scraperPageActive()) return;
    if (scraperPollTimer || scraperPollInFlight) return;
    if (!force && !scraperPollActive(job)) return;

    scraperPollStartedAt = Date.now();
    scraperPollEpoch += 1;
    const epoch = scraperPollEpoch;
    setScraperBadge('pending', 'Working…');
    pollScraperStatus(!!force, epoch);
  }

  /* Used by tab-focus resume and the Check button. */
  function forceScraperPollNow() {
    const job = state.scraperJob;
    if (!job || !LEAD_STATUS_URL) return;
    if (scraperPollTimer) {
      window.clearTimeout(scraperPollTimer);
      scraperPollTimer = null;
    }
    if (scraperPollInFlight) return;
    if (!scraperPollStartedAt) scraperPollStartedAt = Date.now();
    pollScraperStatus(true, scraperPollEpoch);
  }

  function scheduleNextScraperPoll(delay, epoch) {
    if (epoch !== scraperPollEpoch) return;
    if (scraperPollTimer) window.clearTimeout(scraperPollTimer);
    scraperPollTimer = window.setTimeout(function () {
      scraperPollTimer = null;
      pollScraperStatus(false, epoch);
    }, Math.max(0, delay));
  }

  function pollScraperStatus(force, expectedEpoch) {
    const job = state.scraperJob;
    if (!job || !LEAD_STATUS_URL) return;
    const epoch = expectedEpoch == null ? scraperPollEpoch : expectedEpoch;
    if (epoch !== scraperPollEpoch) return;
    if (scraperPollInFlight) return;
    if (!force && !scraperPollActive(job)) return;
    if (!scraperPollStartedAt) scraperPollStartedAt = Date.now();

    scraperPollInFlight = true;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    scraperPollController = controller;
    /* 12s: brief VPS CPU spikes must not abort a perfectly good poll. */
    const timer = controller ? window.setTimeout(function () { controller.abort(); }, 12000) : null;

    const request = fetch(LEAD_STATUS_URL + '?job_id=' + encodeURIComponent(job.job_id), {
      mode: 'cors',
      headers: authHeaders(),
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) {
        if (epoch !== scraperPollEpoch) return null;
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
        if (epoch !== scraperPollEpoch) return;
        if (typeof data !== 'object') throw new Error('Empty status response');

        if (setLiveCredits(extractRemaining(data))) {
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

        /* Live active search term + elapsed timer for that term. */
        if (data.active_query != null) {
          job.active_query = String(data.active_query);
        }
        const queryElapsed = toNumber(data.query_elapsed_s);
        if (queryElapsed !== null) {
          job.query_elapsed_s = Math.max(0, queryElapsed);
        }

        const status = String(data.status || job.status || 'running').toLowerCase();
        job.status = status;
        job.status_warned = false;
        job.poll_errors = 0;
        if (data.display_id) job.display_id = String(data.display_id);

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

        if (
          status === 'queued' ||
          status === 'pending' ||
          status === 'starting' ||
          String(data.phase || '').toLowerCase() === 'starting'
        ) {
          setScraperBadge('pending', 'Working…');
        } else {
          setScraperBadge(
            'pending',
            'Working · ' + Math.floor(clamp(Number(job.percent) || 0, 0, 100)) + '%'
          );
        }

        saveState();
        updateScraperProgress();
        renderLeadsTable();
      })
      .catch(function (err) {
        if (epoch !== scraperPollEpoch) return;

        /* Transient spikes are normal. Keep the last good status on the first
           two failures and only surface "Still working…" after three. */
        const failures = (Number(job && job.poll_errors) || 0) + 1;
        if (job) job.poll_errors = failures;

        console.warn(
          '[LiteWork] Lead scraper status check failed (' + failures + ').',
          err && err.message ? err.message : err
        );

        if (job) {
          if (failures >= 3) {
            setScraperBadge('pending', 'Still working…');
          } else {
            const phase = String(job.status || '').toLowerCase();
            if (!phase || phase === 'queued' || phase === 'pending' || phase === 'starting') {
              setScraperBadge('pending', 'Working…');
            }
          }
          saveState();
        }
        updateScraperProgress();
      });

    /* ALWAYS release the in-flight guard and, while the job is still active,
       schedule the next poll — including after network / abort / 5xx errors. */
    request.finally(function () {
      if (timer) window.clearTimeout(timer);
      if (scraperPollController === controller) scraperPollController = null;
      if (epoch !== scraperPollEpoch) return;

      scraperPollInFlight = false;
      const activeJob = state.scraperJob;
      if (!activeJob || !scraperPollActive(activeJob)) return;

      if (!scraperPollStartedAt) scraperPollStartedAt = Date.now();
      if (Date.now() - scraperPollStartedAt >= STATUS_POLL_WINDOW_MS) {
        setScraperBadge('pending', 'Still running — click Check to refresh');
        saveState();
        updateScraperProgress();
        return;
      }
      scheduleNextScraperPoll(LEAD_POLL_MS, epoch);
    });
  }

  /* ----- resume / check job ----- */
  function handleResume() {
    const input = $('#resumeJobId');
    if (!input) return;

    const entered = input.value.trim();
    if (!entered) {
      toast('Enter a Job ID to check.', 'warn');
      input.focus();
      return;
    }

    const current = state.scraperJob;
    /* Accept a display_id or the internal job_id; API calls need the internal one. */
    const knownJob =
      findHistoryJob(historyState.b2b, entered) ||
      (current && String(formatJobRef(current)) === entered ? current : null);
    const value = String((knownJob && knownJob.job_id) || entered);
    const displayRef =
      knownJob && knownJob.display_id
        ? String(knownJob.display_id)
        : entered !== value
        ? entered
        : '';

    const resumeBtn = $('#resumeBtn');
    if (resumeBtn) {
      resumeBtn.disabled = false;
      resumeBtn.removeAttribute('disabled');
      resumeBtn.setAttribute('aria-disabled', 'false');
    }

    const sameJob = !!current && String(current.job_id || '') === value;

    stopScraperTimers();

    let job = current;
    if (!sameJob) {
      job = {
        job_id: value,
        display_id: displayRef,
        name: state.name || '',
        email: accountEmail(),
        country: '',
        search_terms: [],
        selected_columns: LEAD_REQUIRED_COLUMNS.map(function (col) { return col.id; }),
        target_rows: LEAD_MAX_TARGET,
        target_count: LEAD_MAX_TARGET,
        scraped_rows: 0,
        filled_rows: 0,
        percent: 0,
        download_ready: false,
        credits_spent: 0,
        started_at: new Date().toISOString(),
        status: 'running',
        mode: 'live',
        posted: true,
        starting: false,
        collected_count: 0,
        email_sent: false,
        poll_errors: 0
      };
      state.scraperJob = job;
    } else {
      job.job_id = value;
      if (displayRef) job.display_id = displayRef;
      job.mode = 'live';
      job.starting = false;
      job.posted = true;
      job.poll_errors = 0;
      job.error = '';
      if (scraperJobFailed(job)) job.status = 'running';
    }

    saveState();
    renderJobSummary();
    updateScraperProgress();
    renderLeadsTable();

    /* Force a fresh GET immediately; if the backend is still working, the
       setTimeout chain resumes automatically from the response. */
    startLivePolling(job, true);
    toast('Checking job ' + value + '…', 'info');
  }

  /* ----- download ----- */
  function downloadLeads() {
    const job = state.scraperJob;
    if (!job) return;

    if (LEAD_DOWNLOAD_URL) {
      const url = LEAD_DOWNLOAD_URL + '?job_id=' + encodeURIComponent(job.job_id);
      toast('Preparing your download…', 'info');

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
            'litework-leads-' + slug(job.country || 'global') + '-' + job.job_id + '.xlsx';
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
          window.setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 4000);
          toast('Excel download ready.', 'success');
        })
        .catch(function (err) {
          console.warn('[LiteWork] Authenticated download failed.', err);
          toast('Could not download the Excel file. Please try again.', 'warn');
        });
      return;
    }

    toast('Download unlocks when your Excel is ready.', 'warn');
  }

  /* ----- configuration modal ----- */
  let lastScraperRequired = null;
  let scraperEmailTouched = false;

  /* Live quote: filled terms × (per-term lead volume & price). */
  function scraperQuote() {
    const mode = leadOptionFor(scraperLeadsPerTerm);
    const maxTerms = leadMaxTermsFor(mode.leads);
    const terms = $$('.term-field input')
      .filter(function (input) {
        const field = input.closest('.term-field');
        return !field || !field.classList.contains('is-hidden');
      })
      .map(function (input) { return input.value.trim(); })
      .filter(Boolean)
      .slice(0, maxTerms);
    const filled = terms.length;

    return {
      terms: terms,
      filled: filled,
      maxTerms: maxTerms,
      leadsPerTerm: mode.leads,
      creditsPerTerm: mode.credits,
      required: filled * mode.credits,
      target: filled * mode.leads
    };
  }

  /* Apply the 50 / 100 leads-per-term mode: tab state, term cap & copy. */
  function applyScraperLeadMode() {
    const mode = leadOptionFor(scraperLeadsPerTerm);
    const maxTerms = leadMaxTermsFor(mode.leads);

    $$('#scraperLeadMode [data-leads]').forEach(function (btn) {
      const active = toPositiveInt(btn.getAttribute('data-leads'), 0) === mode.leads;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });

    $$('.term-field').forEach(function (field, index) {
      const hidden = index >= maxTerms;
      field.classList.toggle('is-hidden', hidden);
      field.hidden = hidden;
      if (hidden) {
        const input = $('input', field);
        if (input) input.value = '';
      }
    });

    const heading = $('#scraperTermHeading');
    if (heading) heading.textContent = 'Up to ' + maxTerms + ' search terms';

    const hint = $('#scraperModeHint');
    if (hint) {
      hint.textContent =
        '1 term = ' + mode.leads + ' leads = ' + mode.credits + ' credits · max ' +
        maxTerms + ' terms (' + mode.leads * maxTerms + ' leads)';
    }

    const sub = $('#scraperModalSub');
    if (sub) {
      sub.textContent =
        mode.leads + ' leads per term · ' + mode.credits + ' credits per term · max ' +
        maxTerms + ' terms (' + LEAD_MAX_LEADS + ' leads)';
    }

    updateScraperQuote();
  }

  function updateScraperQuote() {
    const quote = scraperQuote();

    const pill = $('#scraperQuotePill');
    if (pill) {
      pill.textContent =
        quote.filled === 0
          ? 'Enter at least 1 search term (' + quote.leadsPerTerm + ' leads · ' +
            quote.creditsPerTerm + ' credits each)'
          : quote.filled + ' term' + (quote.filled === 1 ? '' : 's') + ' × ' +
            quote.leadsPerTerm + ' leads = ' + quote.target + ' unique leads';
    }

    const targetValue = $('#scraperTargetValue');
    if (targetValue) targetValue.textContent = String(quote.target);

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
        emailErr.textContent = 'Account email missing — please log in again.';
      } else if (!emailValid) {
        emailErr.textContent = 'Your account email is not valid — please log in again.';
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

    const leadModeOptions = LEAD_OPTIONS.map(function (option) {
      return (
        '<button type="button" class="lead-mode-pill" data-leads="' + option.leads +
        '" role="tab" aria-selected="false">' +
        '<span class="lead-mode-title">' + option.leads +
        ' leads <span class="lead-mode-unit">/ term</span></span>' +
        '<span class="lead-mode-note">' + option.credits + ' credits / term</span>' +
        '</button>'
      );
    }).join('');

    openModal(
      '<h2 class="modal-title" id="modalTitle">Lead Scraper Agent</h2>' +
      '<p class="modal-sub" id="scraperModalSub">' + LEAD_LEADS_PER_TERM + ' leads per term · ' +
      LEAD_CREDITS_PER_TERM + ' credits per term · max ' + LEAD_MAX_TERMS + ' terms (' +
      LEAD_MAX_LEADS + ' leads)</p>' +
        '<form class="scraper-form" id="scraperForm" novalidate>' +
        '<div class="form-two">' +
        '<div class="field"><label for="scraperName">Full name <span class="req">*</span></label>' +
        '<input type="text" id="scraperName" autocomplete="name" placeholder="Alex Tan" value="' +
        escapeHtml(state.name || '') + '" /></div>' +
        '<div class="field"><label for="scraperEmail">Delivery email</label>' +
        '<input type="email" id="scraperEmail" class="is-locked" value="' +
        escapeHtml(accountEmail()) + '" disabled tabindex="-1" />' +
        '<span class="field-error" id="scraperEmailError" role="alert"></span></div>' +
        '</div>' +
        '<div class="field"><label for="scraperCountry">Target country</label>' +
        '<select id="scraperCountry">' + countryOptions + '</select></div>' +
        '<div class="field" id="customCountryField" hidden>' +
        '<label for="scraperCustomCountry">Custom country</label>' +
        '<input type="text" id="scraperCustomCountry" placeholder="e.g. New Zealand" /></div>' +
        '<div class="modal-section"><h3>Leads per term</h3>' +
        '<span class="fine" id="scraperModeHint"></span></div>' +
        '<div class="lead-mode" id="scraperLeadMode" role="tablist" aria-label="Leads per search term">' +
        leadModeOptions +
        '</div>' +
        '<div class="modal-section"><h3 id="scraperTermHeading">Up to ' + LEAD_MAX_TERMS +
        ' search terms</h3>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="fillTermsBtn">Fill Sample Search Terms</button></div>' +
        '<div class="term-grid">' + terms.join('') + '</div>' +
        '<div class="scraper-quote">' +
        '<div class="scraper-quote-cell"><span class="quote-label">Target leads</span>' +
        '<strong class="quote-value" id="scraperTargetValue">0</strong></div>' +
        '<div class="scraper-quote-cell"><span class="quote-label">Total cost</span>' +
        '<strong class="quote-value modal-credit-total is-zero" id="scraperCreditTotal">0 credits</strong></div>' +
        '</div>' +
        '<p class="pill-note" id="scraperQuotePill">Enter at least 1 search term (' +
        LEAD_LEADS_PER_TERM + ' leads · ' + LEAD_CREDITS_PER_TERM + ' credits each)</p>' +
        '<div class="modal-section"><h3>Excel columns</h3>' +
        '<span class="fine">Company and phone always included</span></div>' +
        '<div class="column-group">' +
        '<div class="column-locked">' + lockedColumns + '</div>' +
        '<p class="col-group-label">Optional columns</p>' +
        optionalColumns +
        '</div>' +
        '<div class="modal-actions">' +
        '<div class="scraper-modal-error" id="scraperFormError" role="alert"></div>' +
        '<p class="scraper-shortfall" id="scraperShortfall" hidden></p>' +
        '<button type="submit" class="btn btn-activate" id="scraperStartBtn" disabled>Confirm & Spend 0 Credits · Scrape 0 Leads</button>' +
        '<p class="fine">Credits are deducted immediately. Processing your request — safe to close this tab and return anytime.</p>' +
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

    const modeWrap = $('#scraperLeadMode');
    if (modeWrap) {
      modeWrap.addEventListener('click', function (event) {
        const btn = event.target.closest ? event.target.closest('[data-leads]') : null;
        if (!btn) return;
        const leads = toPositiveInt(btn.getAttribute('data-leads'), scraperLeadsPerTerm);
        if (leads === scraperLeadsPerTerm) return;
        scraperLeadsPerTerm = leads;
        applyScraperLeadMode();
      });
    }

    const fillBtn = $('#fillTermsBtn');
    if (fillBtn) {
      fillBtn.addEventListener('click', function () {
        $$('.term-field:not(.is-hidden) input').forEach(function (input, index) {
          input.value = LEAD_SAMPLE_TERMS[index] || '';
        });
        updateScraperQuote();
        toast('Sample search terms filled.', 'info');
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
    applyScraperLeadMode();

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
    const email = accountEmail();
    if (emailEl) emailEl.value = email;

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
      setFieldError(
        emailEl,
        'Your account email is missing. Please log out and log in again.'
      );
      problems.push('A valid account email is required.');
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
      leads_per_term: quote.leadsPerTerm,
      credits_per_term: quote.creditsPerTerm,
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

    state.name = name;
    state.email = email;
    state.scraperJob = job;
    job.starting = true;
    job.posted = true;
    saveState();

    if (errorEl) errorEl.textContent = '';
    const startBtn = $('#scraperStartBtn');
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.textContent = 'Starting scrape…';
    }

    postScraperStart(job, {
      onError: function (message) {
        if (errorEl) errorEl.textContent = message;
        updateScraperQuote();
      },
      onStarted: function () {
        closeModal();
        if (currentRoute() === 'scraper-results') {
          renderScraperResults();
        } else {
          window.location.hash = '#scraper-results';
        }
        startLivePolling(job);
      }
    });
  }

  /* Invoice OCR card: extracted-column reference (respects export formats) */
  function openInvoiceColumnsModal() {
    openModal(
      '<h2 class="modal-title" id="modalTitle">Invoice Excel columns</h2>' +
        '<p class="modal-sub">Every invoice lands in your accounting-ready .xlsx with these columns.</p>' +
        '<div class="inv-cols-block">' +
        invoiceColumnsBlockHtml(INV_DEFAULT_EXPORT_FORMAT) +
        '</div>' +
        '<div class="modal-actions"><button type="button" class="btn btn-primary" data-modal-close>Got it</button></div>',
      true
    );
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

  /* ========================= L. INVOICE OCR AGENT ======================== */
  let invoiceFiles = [];
  let invoicePollTimer = null;
  let invoicePollInFlight = false;
  let invoicePollController = null;
  let invoicePollEpoch = 0;
  let invoicePollStartedAt = 0;
  let invoiceStarting = false;
  let invoiceExportFormat = INV_DEFAULT_EXPORT_FORMAT;

  /* Exact backend summary keys, in delivery order. */
  const INVOICE_PREVIEW_COLUMNS = [
    {
      id: 'source_file',
      label: 'Source File',
      keys: ['source_file', 'file_name', 'filename', 'Source File']
    },
    {
      id: 'invoice_number',
      label: 'Invoice No',
      keys: ['invoice_number', 'invoice_no', 'invoiceNumber', 'Invoice Number', 'Invoice No']
    },
    {
      id: 'invoice_date',
      label: 'Date',
      keys: ['invoice_date', 'invoiceDate', 'date', 'Invoice Date', 'Date']
    },
    {
      id: 'supplier_name',
      label: 'Supplier',
      keys: ['supplier_name', 'supplierName', 'supplier', 'Supplier Name', 'Supplier']
    },
    {
      id: 'supplier_tax_ids',
      label: 'TIN / BRN / UEN',
      keys: ['supplier_tin', 'supplierTin', 'Supplier TIN'],
      parts: [
        {
          tag: 'TIN',
          keys: ['supplier_tin', 'supplierTin', 'Supplier TIN', 'supplier_tax_id']
        },
        {
          tag: 'BRN/UEN',
          keys: [
            'supplier_brn_uen',
            'supplierBrnUen',
            'supplier_brn',
            'supplier_uen',
            'Supplier BRN / UEN'
          ]
        },
        {
          tag: 'SST/GST',
          keys: [
            'supplier_sst_gst_reg',
            'supplierSstGstReg',
            'supplier_sst_reg',
            'supplier_gst_reg',
            'Supplier SST / GST Reg'
          ]
        }
      ]
    },
    {
      id: 'myinvois_uuid_status',
      label: 'MyInvois Status',
      keys: [
        'myinvois_uuid_status',
        'myinvoisUuidStatus',
        'MyInvois UUID / Status',
        'myinvois_status'
      ]
    },
    { id: 'currency', label: 'Currency', keys: ['currency', 'Currency', 'currency_code'] },
    { id: 'subtotal', label: 'Subtotal', keys: ['subtotal', 'Subtotal'], money: true },
    {
      id: 'tax_amount',
      label: 'Tax',
      keys: ['tax_amount', 'taxAmount', 'tax', 'Tax Amount', 'Tax'],
      money: true
    },
    {
      id: 'grand_total',
      label: 'Grand Total',
      keys: ['grand_total', 'grandTotal', 'total', 'Grand Total'],
      money: true
    },
    {
      id: 'confidence_notes',
      label: 'Confidence',
      keys: ['confidence_notes', 'confidenceNotes', 'confidence', 'Confidence / Notes', 'notes']
    }
  ];

  /* The backend has returned previews as an array, a wrapped object and as
     separate top-level keys. Normalise all of those shapes. */
  function extractInvoicePreview(data) {
    if (!data || typeof data !== 'object') return [];

    const lists = [];
    const preview = data.preview;
    if (Array.isArray(preview)) {
      lists.push(preview);
    } else if (preview && typeof preview === 'object') {
      if (Array.isArray(preview.rows)) lists.push(preview.rows);
      if (Array.isArray(preview.invoices)) lists.push(preview.invoices);
      if (Array.isArray(preview.summary)) lists.push(preview.summary);
    }

    if (Array.isArray(data.preview_rows)) lists.push(data.preview_rows);
    if (Array.isArray(data.rows)) lists.push(data.rows);
    if (Array.isArray(data.invoices)) lists.push(data.invoices);
    if (Array.isArray(data.invoice_rows)) lists.push(data.invoice_rows);

    for (let i = 0; i < lists.length; i += 1) {
      if (lists[i].length) return lists[i];
    }
    return [];
  }

  /* 1–5 files = 5 credits, 6–15 files = 10 credits, 0 files = 0 credits. */
  function invoiceQuote(count) {
    const n = clamp(Number(count) || 0, 0, INV_TIER_2_MAX);
    let credits = 0;
    let tier = 'No files';
    if (n > 0) {
      if (n <= INV_TIER_1_MAX) {
        credits = INV_TIER_1_CREDITS;
        tier = 'Up to ' + INV_TIER_1_MAX + ' files';
      } else {
        credits = INV_TIER_2_CREDITS;
        tier = INV_TIER_1_MAX + 1 + '–' + INV_TIER_2_MAX + ' files';
      }
    }
    return { count: n, credits: credits, tier: tier };
  }

  function invoiceIsComplete(job) {
    return (
      !!job &&
      String(job.status || '').toLowerCase() === 'completed' &&
      job.download_ready === true
    );
  }

  function invoicePageActive() {
    return true;
  }

  function invoiceJobFailed(job) {
    const status = String((job && job.status) || '').toLowerCase();
    return (
      status === 'failed' ||
      status === 'error' ||
      status === 'cancelled' ||
      status === 'canceled'
    );
  }

  function invoicePollActive(job) {
    return !!job && !invoiceJobFailed(job) && !invoiceIsComplete(job);
  }

  function stopInvoiceTimer() {
    invoicePollEpoch += 1;
    if (invoicePollTimer) {
      window.clearTimeout(invoicePollTimer);
      invoicePollTimer = null;
    }
    invoicePollStartedAt = 0;
    if (invoicePollController) {
      try {
        invoicePollController.abort();
      } catch (err) {
        /* already settled */
      }
      invoicePollController = null;
    }
    invoicePollInFlight = false;
  }

  function setInvoiceBadge(kind, text) {
    const badge = $('#invoiceStatus');
    if (!badge) return;
    badge.classList.remove('is-pending', 'is-ok', 'is-fail');
    if (kind) badge.classList.add('is-' + kind);
    const label = $('.webhook-text', badge);
    if (label) label.textContent = text;
  }

  function startInvoicePolling(job, force) {
    if (!job || !INV_STATUS_URL) return;
    if (!invoicePageActive()) return;
    if (invoicePollTimer || invoicePollInFlight) return;
    if (!force && !invoicePollActive(job)) return;

    invoicePollStartedAt = Date.now();
    invoicePollEpoch += 1;
    const epoch = invoicePollEpoch;
    setInvoiceBadge('pending', 'Working…');
    pollInvoiceStatus(!!force, epoch);
  }

  /* Used by tab-focus resume and the Check button. */
  function forceInvoicePollNow() {
    const job = state.invoiceJob;
    if (!job || !INV_STATUS_URL) return;
    if (invoicePollTimer) {
      window.clearTimeout(invoicePollTimer);
      invoicePollTimer = null;
    }
    if (invoicePollInFlight) return;
    if (!invoicePollStartedAt) invoicePollStartedAt = Date.now();
    pollInvoiceStatus(true, invoicePollEpoch);
  }

  function scheduleNextInvoicePoll(delay, epoch) {
    if (epoch !== invoicePollEpoch) return;
    if (invoicePollTimer) window.clearTimeout(invoicePollTimer);
    invoicePollTimer = window.setTimeout(function () {
      invoicePollTimer = null;
      pollInvoiceStatus(false, epoch);
    }, Math.max(0, delay));
  }

  function ensureInvoiceRunning() {
    const job = state.invoiceJob;
    if (!job || invoiceJobFailed(job) || invoiceIsComplete(job)) return;
    if (!isLoggedIn()) return;
    startInvoicePolling(job);
  }

  function pollInvoiceStatus(force, expectedEpoch) {
    const job = state.invoiceJob;
    if (!job || !INV_STATUS_URL) return;
    const epoch = expectedEpoch == null ? invoicePollEpoch : expectedEpoch;
    if (epoch !== invoicePollEpoch) return;
    if (invoicePollInFlight) return;
    if (!force && !invoicePollActive(job)) return;
    if (!invoicePollStartedAt) invoicePollStartedAt = Date.now();

    invoicePollInFlight = true;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    invoicePollController = controller;
    /* 12s timeout + 3-strike tolerance, same policy as the scraper. */
    const timer = controller ? window.setTimeout(function () { controller.abort(); }, 12000) : null;

    const request = fetch(INV_STATUS_URL + '?job_id=' + encodeURIComponent(job.job_id), {
      mode: 'cors',
      headers: authHeaders(),
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) {
        if (epoch !== invoicePollEpoch) return null;
        if (response.status === 401) {
          stopInvoiceTimer();
          handleAuthExpired(
            'Your session expired. Log in again to check this invoice job.',
            null
          );
          return null;
        }
        if (response.status === 402) {
          failInvoiceJob('Insufficient credits');
          return null;
        }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data) return;
        if (epoch !== invoicePollEpoch) return;
        if (typeof data !== 'object') throw new Error('Empty status response');

        if (setLiveCredits(extractRemaining(data))) syncCreditUI();

        const toNumber = function (value) {
          if (value === null || value === undefined || value === '') return null;
          const n = Number(value);
          return Number.isFinite(n) ? n : null;
        };
        const firstNumber = function () {
          for (let i = 0; i < arguments.length; i += 1) {
            const n = toNumber(arguments[i]);
            if (n !== null) return n;
          }
          return null;
        };

        const percent = toNumber(data.percent);
        if (percent !== null) job.percent = clamp(percent, 0, 100);

        const total = firstNumber(data.files_total, data.total_files, data.file_count);
        if (total !== null) job.files_total = Math.max(0, Math.floor(total));

        const processed = firstNumber(
          data.files_processed,
          data.processed_files,
          data.completed_files
        );
        if (processed !== null) job.files_processed = Math.max(0, Math.floor(processed));

        if (data.active_file != null) job.active_file = String(data.active_file);

        if (data.download_ready != null) {
          job.download_ready =
            data.download_ready === true ||
            data.download_ready === 'true' ||
            data.download_ready === 1;
        }
        if (data.email_sent != null) {
          job.email_sent = data.email_sent === true || data.email_sent === 'true';
        }

        const liveFormat = data.export_format || data.exportFormat;
        if (liveFormat && !job.export_format) job.export_format = String(liveFormat);

        if (data.display_id) job.display_id = String(data.display_id);

        const previewRows = extractInvoicePreview(data);
        if (previewRows.length) job.preview_rows = previewRows.slice(0, 100);

        const status = String(data.status || job.status || 'processing').toLowerCase();
        job.status = status;
        job.poll_errors = 0;

        if (['failed', 'error', 'cancelled', 'canceled'].indexOf(status) !== -1) {
          failInvoiceJob(data.error ? String(data.error) : '');
          return;
        }

        if (['completed', 'complete', 'success', 'done'].indexOf(status) !== -1) {
          if (job.download_ready === true) {
            completeInvoiceJob(true);
          } else {
            setInvoiceBadge('pending', 'Completed — finalizing Excel…');
            saveState();
            updateInvoiceProgress();
            renderInvoiceTable();
          }
          return;
        }

        if (status === 'queued' || status === 'pending' || status === 'starting') {
          setInvoiceBadge('pending', 'Working…');
        } else {
          setInvoiceBadge(
            'pending',
            'Working · ' +
              Math.floor(clamp(Number(job.percent) || 0, 0, 100)) + '%'
          );
        }

        saveState();
        updateInvoiceProgress();
        renderInvoiceTable();
      })
      .catch(function (err) {
        if (epoch !== invoicePollEpoch) return;

        const failures = (Number(job && job.poll_errors) || 0) + 1;
        if (job) job.poll_errors = failures;

        console.warn(
          '[LiteWork] Invoice status check failed (' + failures + ').',
          err && err.message ? err.message : err
        );

        if (job) {
          if (failures >= 3) {
            setInvoiceBadge('pending', 'Still working…');
          } else {
            const phase = String(job.status || '').toLowerCase();
            if (!phase || phase === 'queued' || phase === 'pending' || phase === 'starting') {
              setInvoiceBadge('pending', 'Working…');
            }
          }
          saveState();
        }
        updateInvoiceProgress();
      });

    /* ALWAYS release the in-flight guard and, while the job is still active,
       schedule the next poll — including after network / abort / 5xx errors. */
    request.finally(function () {
      if (timer) window.clearTimeout(timer);
      if (invoicePollController === controller) invoicePollController = null;
      if (epoch !== invoicePollEpoch) return;

      invoicePollInFlight = false;
      const activeJob = state.invoiceJob;
      if (!activeJob || !invoicePollActive(activeJob)) return;

      if (!invoicePollStartedAt) invoicePollStartedAt = Date.now();
      if (Date.now() - invoicePollStartedAt >= STATUS_POLL_WINDOW_MS) {
        setInvoiceBadge('pending', 'Still running — click Check to refresh');
        saveState();
        updateInvoiceProgress();
        return;
      }
      scheduleNextInvoicePoll(INV_POLL_MS, epoch);
    });
  }

  function renderInvoiceResults() {
    const empty = $('#invoiceEmpty');
    const main = $('#invoiceMain');
    if (!empty || !main) return;

    const job = state.invoiceJob;
    if (!job) {
      empty.hidden = false;
      main.hidden = true;
      return;
    }

    empty.hidden = true;
    main.hidden = false;

    const resume = $('#invoiceResumeId');
    if (resume) resume.value = formatJobRef(job) || '';
    const resumeBtn = $('#invoiceResumeBtn');
    if (resumeBtn) {
      resumeBtn.disabled = false;
      resumeBtn.removeAttribute('disabled');
      resumeBtn.setAttribute('aria-disabled', 'false');
    }

    renderInvoiceJobSummary();
    renderInvoiceTable();
    updateInvoiceProgress();

    if (invoiceIsComplete(job)) {
      completeInvoiceJob(true);
      return;
    }
    if (invoiceJobFailed(job)) {
      setInvoiceBadge('fail', 'Job failed · ' + (job.error || job.status || 'upload a new batch'));
      return;
    }
    ensureInvoiceRunning();
  }

  function renderInvoiceJobSummary() {
    const job = state.invoiceJob;
    if (!job) return;
    const meta = $('#invoiceJobMeta');
    const summary = $('#invoiceJobSummary');
    const files = Number(job.files_total) || 0;
    const credits = Number(job.credits_spent) || 0;
    const exportMeta = invoiceExportFormatMeta(job.export_format);

    if (meta) {
      meta.textContent = files
        ? files + ' file' + (files === 1 ? '' : 's') + ' · ' + credits + ' credits'
        : 'Waiting for the first status update…';
    }

    if (summary) {
      summary.innerHTML =
        '<div class="summary-row"><dt>Files</dt><dd><strong>' + files + '</strong></dd></div>' +
        '<div class="summary-row"><dt>Processed</dt><dd>' +
        (Number(job.files_processed) || 0) + '</dd></div>' +
        '<div class="summary-row"><dt>Credits spent</dt><dd><strong>' + credits + '</strong></dd></div>' +
        '<div class="summary-row"><dt>Export format</dt><dd>' +
        '<span class="inv-export-badge" title="' + escapeHtml(exportMeta.hint || '') + '">' +
        escapeHtml(exportMeta.label) + '</span></dd></div>' +
        '<div class="summary-row"><dt>Delivery email</dt><dd>' +
        escapeHtml(job.email || accountEmail() || '—') + '</dd></div>' +
        '<div class="summary-row"><dt>Started</dt><dd>' +
        escapeHtml(job.created_at ? fmtMYT(job.created_at) : '—') + '</dd></div>' +
        '<div class="summary-row"><dt>Job ID</dt><dd><code>' +
        escapeHtml(formatJobRef(job)) + '</code></dd></div>';
    }
  }

  function updateInvoiceProgress() {
    const job = state.invoiceJob;
    if (!job) return;

    const total = Number(job.files_total) || 0;
    const processed = clamp(Math.floor(Number(job.files_processed) || 0), 0, total || 9999);
    const complete = invoiceIsComplete(job);
    /* The ring follows the backend percent exactly (5 → 90 → 95 → 100). */
    const percent = complete
      ? 100
      : Math.floor(clamp(Number(job.percent) || 0, 0, 100));

    const fill = $('#invRingFill');
    if (fill) fill.style.strokeDashoffset = String(RING_LENGTH - (RING_LENGTH * percent) / 100);

    const percentEl = $('#invRingPercent');
    if (percentEl) percentEl.textContent = percent + '%';

    const countEl = $('#invRingCount');
    if (countEl) {
      countEl.textContent = processed + ' / ' + (total || '—') + ' files processed';
    }

    const activeEl = $('#invRingActive');
    if (activeEl) {
      const activeFile = String(job.active_file || '').trim();
      const phase = String(job.status || '').toLowerCase();
      const terminal =
        complete ||
        phase === 'completed' ||
        phase === 'complete' ||
        phase === 'failed' ||
        phase === 'error';
      if (activeFile && !terminal) {
        activeEl.hidden = false;
        activeEl.textContent = 'Extracting "' + activeFile + '"…';
      } else {
        activeEl.hidden = true;
        activeEl.textContent = '';
      }
    }

    const card = $('#invRingCard');
    if (card) card.classList.toggle('is-complete', complete);

    const downloadBtn = $('#invoiceDownloadBtn');
    if (downloadBtn) downloadBtn.disabled = !complete;

    const downloadTitle = $('#invoiceDownloadTitle');
    if (downloadTitle) {
      downloadTitle.textContent =
        complete && total ? 'Excel (.xlsx) · ' + total + ' invoices' : 'Excel (.xlsx)';
    }

    const downloadSub = $('#invoiceDownloadSub');
    if (downloadSub) {
      if (complete) downloadSub.textContent = 'Ready to download';
      else if (String(job.status || '').toLowerCase() === 'completed') {
        downloadSub.textContent = 'Finishing up…';
      } else {
        downloadSub.textContent = 'Working — safe to close this tab and return anytime.';
      }
    }

    const emailNote = $('#invoiceEmailNote');
    if (emailNote) {
      const email = job.email || accountEmail() || 'your delivery email';
      const sent = complete && job.email_sent === true;
      emailNote.textContent = sent
        ? '✓ Excel (.xlsx) emailed to ' + email + ' & ready to download below.'
        : 'Excel (.xlsx) will also be emailed to ' + email +
          ' when ready — safe to close this tab.';
      emailNote.classList.toggle('is-sent', sent);
    }

    const tableMeta = $('#invoiceTableMeta');
    if (tableMeta) {
      const count = (job.preview_rows || []).length;
      tableMeta.textContent =
        'Preview · ' + count + ' invoice' + (count === 1 ? '' : 's') +
        ' ready · fixed MY/SG accounting columns';
    }

    renderInvoiceJobSummary();
  }

  function formatInvoiceMoney(value) {
    const cleaned = String(value).replace(/[^0-9.-]/g, '');
    if (!/[0-9]/.test(cleaned)) return String(value);
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return String(value);
    return n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatInvoiceConfidence(value) {
    const text = String(value).trim();
    const n = Number(text.replace('%', ''));
    if (!Number.isFinite(n)) return text;
    if (text.indexOf('%') !== -1) return Math.round(n) + '%';
    if (n > 0 && n <= 1) return Math.round(n * 100) + '%';
    if (n > 1 && n <= 100) return Math.round(n) + '%';
    return text;
  }

  function invoiceFieldValue(row, keys) {
    if (!row || typeof row !== 'object' || !Array.isArray(keys)) return '';
    for (let i = 0; i < keys.length; i += 1) {
      const raw = row[keys[i]];
      if (raw === null || raw === undefined) continue;
      const text = String(raw).trim();
      if (text) return text;
    }
    return '';
  }

  function invoiceCellValue(row, col) {
    if (!row || typeof row !== 'object') return '—';

    if (Array.isArray(col.parts)) {
      const parts = [];
      col.parts.forEach(function (part) {
        const partValue = invoiceFieldValue(row, part.keys);
        if (partValue) parts.push((part.tag ? part.tag + ' ' : '') + partValue);
      });
      return parts.length ? parts.join(' · ') : '—';
    }

    const value = invoiceFieldValue(row, col.keys);
    if (!value) return '—';

    if (col.id === 'invoice_date') {
      const ms = new Date(value).getTime();
      if (Number.isFinite(ms)) return new Date(ms).toISOString().slice(0, 10);
      return value;
    }
    if (col.id === 'currency') return value.toUpperCase();
    if (col.money) return formatInvoiceMoney(value);
    if (col.id === 'confidence_notes') return formatInvoiceConfidence(value);
    return value;
  }

  function renderInvoiceTable() {
    const table = $('#invoiceTable');
    if (!table || !state.invoiceJob) return;

    const job = state.invoiceJob;
    const rows = Array.isArray(job.preview_rows) ? job.preview_rows.slice(0, 50) : [];
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');

    if (thead) {
      thead.innerHTML =
        '<tr>' +
        INVOICE_PREVIEW_COLUMNS.map(function (col) {
          return '<th>' + escapeHtml(col.label) + '</th>';
        }).join('') +
        '</tr>';
    }

    if (tbody) {
      if (!rows.length) {
        const message =
          String(job.status || '').toLowerCase() === 'completed'
            ? 'Preview unavailable — download the .xlsx for every invoice.'
            : 'Waiting for the first extracted invoice…';
        tbody.innerHTML =
          '<tr><td colspan="' + INVOICE_PREVIEW_COLUMNS.length +
          '" class="table-empty">' + message + '</td></tr>';
      } else {
        tbody.innerHTML = rows
          .map(function (row) {
            return (
              '<tr>' +
              INVOICE_PREVIEW_COLUMNS.map(function (col, index) {
                return '<td class="' + (index === 0 ? 'cell-strong' : '') + '">' +
                  escapeHtml(invoiceCellValue(row, col)) + '</td>';
              }).join('') +
              '</tr>'
            );
          })
          .join('');
      }
    }

    const pill = $('#invoicePreviewPill');
    if (pill) pill.textContent = rows.length + ' invoice' + (rows.length === 1 ? '' : 's');
  }

  function completeInvoiceJob(silent) {
    const job = state.invoiceJob;
    if (!job) return;

    job.status = 'completed';
    job.download_ready = true;
    job.percent = 100;

    /* Render the final rows, pill and subtitle BEFORE the poller stops, so the
       completed payload's preview can never be lost. */
    updateInvoiceProgress();
    renderInvoiceTable();

    stopInvoiceTimer();
    /* Force the history panel to re-fetch next time it opens. */
    historyState.loaded = false;
    saveState();

    setInvoiceBadge('ok', 'Completed · .xlsx ready');
    if (!silent) toast('Invoice Excel is ready to download.', 'success');
  }

  function failInvoiceJob(reason) {
    const job = state.invoiceJob;
    if (!job) return;
    job.status = 'failed';
    job.error = reason || '';
    stopInvoiceTimer();
    saveState();
    updateInvoiceProgress();
    setInvoiceBadge('fail', 'Job failed · ' + (reason || 'please try again'));
  }

  function downloadInvoiceExcel(jobId) {
    const job = state.invoiceJob || {};
    const id = String(jobId || job.job_id || '').trim();
    if (!id || !INV_DOWNLOAD_URL) {
      toast('Download unlocks when your Excel is ready.', 'warn');
      return;
    }

    toast('Preparing your download…', 'info');

    fetch(INV_DOWNLOAD_URL + '?job_id=' + encodeURIComponent(id), {
      mode: 'cors',
      headers: authHeaders()
    })
      .then(function (response) {
        if (response.status === 401) {
          handleAuthExpired(
            'Your session expired. Log in again to download your invoices.',
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
        anchor.download = 'litework-invoices-' + id.replace(/[^A-Za-z0-9_-]/g, '') + '.xlsx';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 4000);
        toast('Invoice Excel download ready.', 'success');
      })
      .catch(function (err) {
        console.warn('[LiteWork] Invoice download failed.', err);
        toast('Could not download the invoice Excel. Please try again.', 'warn');
      });
  }

  function openInvoiceHistoryJob(jobId) {
    const ref = String(jobId || '').trim();
    if (!ref) return;

    stopInvoiceTimer();
    const current = state.invoiceJob;
    const known =
      findHistoryJob(historyState.invoice, ref) ||
      (current && String(formatJobRef(current)) === ref ? current : null);
    const id = String((known && known.job_id) || ref);
    const sameJob = !!current && String(current.job_id || '') === id;

    if (!sameJob) {
      state.invoiceJob = {
        job_id: id,
        display_id: known ? String(known.display_id || '') : (ref !== id ? ref : ''),
        status: 'processing',
        percent: 0,
        files_total: known ? known.files : 0,
        files_processed: known ? known.processed : 0,
        active_file: '',
        download_ready: false,
        preview_rows: [],
        credits_spent: known ? known.credits : 0,
        export_format: known && known.exportFormat ? known.exportFormat : '',
        email: accountEmail(),
        created_at: new Date().toISOString(),
        poll_errors: 0
      };
    } else {
      current.poll_errors = 0;
      current.error = '';
      if (invoiceJobFailed(current)) current.status = 'processing';
    }
    saveState();

    if (currentRoute() === 'invoice-results') {
      renderInvoiceResults();
      startInvoicePolling(state.invoiceJob, true);
    } else {
      window.location.hash = '#invoice-results';
    }
  }

  /* ----- invoice upload helpers ----- */
  function formatFileSize(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  function invoiceExt(name) {
    const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  function invoiceFileBadge(name) {
    const ext = invoiceExt(name);
    if (ext === 'pdf') return 'PDF';
    if (ext === 'doc' || ext === 'docx') return 'DOCX';
    if (ext === 'xls' || ext === 'xlsx') return 'XLSX';
    if (ext === 'csv') return 'CSV';
    if (ext === 'txt') return 'TXT';
    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') return 'IMG';
    return ext ? ext.toUpperCase() : 'FILE';
  }

  function invoiceFileAllowed(name) {
    const ext = invoiceExt(name);
    const allowed = INV_ACCEPT.split(',')
      .map(function (item) { return item.trim().replace(/^\./, '').toLowerCase(); })
      .filter(Boolean);
    return allowed.indexOf(ext) !== -1;
  }

  function renderInvoiceFiles() {
    const list = $('#invFileList');
    if (list) {
      list.innerHTML = invoiceFiles.length
        ? invoiceFiles
            .map(function (entry, index) {
              return (
                '<li class="inv-file-row">' +
                '<span class="inv-file-badge">' + escapeHtml(invoiceFileBadge(entry.name)) + '</span>' +
                '<span class="inv-file-meta"><strong>' + escapeHtml(entry.name) + '</strong>' +
                '<span>' + escapeHtml(formatFileSize(entry.size)) + '</span></span>' +
                '<button type="button" class="inv-file-remove" data-inv-remove="' + index +
                '" aria-label="Remove ' + escapeHtml(entry.name) + '">×</button>' +
                '</li>'
              );
            })
            .join('')
        : '<li class="inv-file-empty">No files queued yet — add up to ' + INV_TIER_2_MAX + ' invoices.</li>';
    }
    updateInvoiceQuote();
  }

  function addInvoiceFiles(fileList) {
    const errEl = $('#invoiceFormError');
    const incoming = Array.prototype.slice.call(fileList || []);
    if (!incoming.length) return;
    const errors = [];

    incoming.forEach(function (file) {
      if (invoiceFiles.length >= INV_TIER_2_MAX) {
        errors.push('Maximum ' + INV_TIER_2_MAX + ' files per run.');
        return;
      }
      if (!invoiceFileAllowed(file.name)) {
        errors.push(file.name + ' is not a supported file type.');
        return;
      }
      if (file.size > INV_MAX_FILE_BYTES) {
        errors.push(
          file.name + ' is larger than ' +
          Math.round(INV_MAX_FILE_BYTES / 1048576) + ' MB.'
        );
        return;
      }
      const duplicate = invoiceFiles.some(function (entry) {
        return entry.name === file.name && entry.size === file.size;
      });
      if (duplicate) {
        errors.push(file.name + ' is already queued.');
        return;
      }
      invoiceFiles.push({ name: file.name, size: file.size, type: file.type || '', file: file });
    });

    if (errEl) errEl.textContent = errors.length ? errors[0] : '';
    renderInvoiceFiles();
  }

  function updateInvoiceQuote() {
    const quote = invoiceQuote(invoiceFiles.length);

    const available = $('#invAvailable');
    if (available) available.textContent = state.credits + ' Credits';

    const filesEl = $('#invFileCount');
    if (filesEl) filesEl.textContent = quote.count + ' / ' + INV_TIER_2_MAX;

    const tierEl = $('#invTier');
    if (tierEl) tierEl.textContent = quote.tier;

    const costEl = $('#invCost');
    if (costEl) {
      costEl.textContent = quote.credits + ' Credits';
      costEl.classList.toggle('is-zero', quote.credits === 0);
    }

    const btn = $('#invoiceStartBtn');
    if (btn) {
      btn.disabled = quote.count === 0 || invoiceStarting;
      btn.textContent = invoiceStarting
        ? 'Uploading invoices…'
        : 'Confirm & Spend ' + quote.credits + ' Credits · Process ' + quote.count +
          ' File' + (quote.count === 1 ? '' : 's');
    }

    const shortfall = Math.max(0, quote.credits - state.credits);
    const shortEl = $('#invoiceShortfall');
    if (shortEl) {
      if (shortfall > 0) {
        shortEl.hidden = false;
        shortEl.textContent =
          'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
          '. Top up credits to continue.';
      } else {
        shortEl.hidden = true;
        shortEl.textContent = '';
      }
    }
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = function () {
        reject(
          reader.error || new Error('Could not read ' + (file && file.name ? file.name : 'file'))
        );
      };
      reader.readAsDataURL(file);
    });
  }

  function openInvoiceModal() {
    if (!requireAuth({ action: 'invoice' })) return;

    invoiceFiles = [];
    invoiceStarting = false;
    invoiceExportFormat = INV_DEFAULT_EXPORT_FORMAT;

    const formatPills = INV_EXPORT_FORMATS.map(function (format) {
      const active = format.id === invoiceExportFormat;
      return (
        '<button type="button" class="inv-format-option' + (active ? ' is-active' : '') +
        '" data-inv-format="' + escapeHtml(format.id) + '" role="radio" aria-checked="' +
        (active ? 'true' : 'false') + '">' +
        '<span class="inv-format-label">' + escapeHtml(format.label) + '</span>' +
        '<span class="inv-format-hint">' + escapeHtml(format.hint || '') + '</span>' +
        '</button>'
      );
    }).join('');

    openModal(
      '<h2 class="modal-title" id="modalTitle">Invoice OCR Agent</h2>' +
      '<p class="modal-sub">Batch PDF, e-Invoice, Word/Excel & Clean Scan → Accounting Excel (MY & SG Ready) · 5 credits for 1–5 files · 10 credits for 6–15 files</p>' +
      '<div class="calc-card modal-calc"><div class="calc-grid">' +
      '<div class="calc-cell"><span class="calc-label">Available</span>' +
      '<span class="calc-value" id="invAvailable">' + state.credits + ' Credits</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Files selected</span>' +
      '<span class="calc-value" id="invFileCount">0 / ' + INV_TIER_2_MAX + '</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Tier</span>' +
      '<span class="calc-value" id="invTier">No files</span></div>' +
      '<div class="calc-cell calc-cell-total"><span class="calc-label">Total cost</span>' +
      '<span class="calc-value" id="invCost">0 Credits</span></div>' +
      '</div></div>' +
      '<form class="invoice-form" id="invoiceForm" novalidate>' +
      '<div class="field"><label for="invoiceEmail">Delivery email</label>' +
      '<input type="email" id="invoiceEmail" class="is-locked" value="' +
      escapeHtml(accountEmail()) + '" disabled tabindex="-1" />' +
      '<span class="field-error" id="invoiceEmailError" role="alert"></span></div>' +
      '<label class="inv-drop" id="invDrop" for="invFileInput">' +
      '<span class="inv-drop-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#6366F1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 16V5" /><path d="m7 10 5-5 5 5" />' +
      '<path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />' +
      '</svg></span>' +
      '<strong>Drag & drop invoices here</strong>' +
      '<span class="inv-drop-sub">or click to browse · up to ' + INV_TIER_2_MAX +
      ' files · max ' + Math.round(INV_MAX_FILE_BYTES / 1048576) + ' MB each</span>' +
      '<span class="inv-drop-types">PDF · DOCX · XLSX · CSV · TXT · JPG · PNG · WEBP</span>' +
      '<span class="inv-drop-tip">Best for digital PDFs, LHDN MyInvois / SG e-Invoices, Word/Excel, and clear scans. Blurry or crumpled smartphone thermal receipts may be flagged as Needs Review.</span>' +
      '</label>' +
      '<input type="file" id="invFileInput" class="inv-file-input" accept="' +
      escapeHtml(INV_ACCEPT) + '" multiple />' +
      '<ul class="inv-filelist" id="invFileList"></ul>' +
      '<div class="inv-format-block">' +
      '<div class="inv-format-head">' +
      '<span class="inv-format-title">Export Format</span>' +
      '<span class="inv-format-note">MY & SG accounting-ready .xlsx</span>' +
      '</div>' +
      '<div class="inv-format-group" id="invFormatGroup" role="radiogroup" aria-label="Accounting export format">' +
      formatPills +
      '</div>' +
      '</div>' +
      '<div class="inv-cols-block" id="invColsBlock">' +
      invoiceColumnsBlockHtml(invoiceExportFormat) +
      '</div>' +
      '<div class="modal-actions">' +
      '<div class="scraper-modal-error" id="invoiceFormError" role="alert"></div>' +
      '<p class="scraper-shortfall" id="invoiceShortfall" hidden></p>' +
      '<button type="submit" class="btn btn-activate" id="invoiceStartBtn" disabled>' +
      'Confirm & Spend 0 Credits · Process 0 Files</button>' +
      '<p class="fine">Credits are deducted immediately. Processing your request — safe to close this tab and return anytime.</p>' +
      '</div>' +
      '</form>',
      true
    );

    const drop = $('#invDrop');
    const input = $('#invFileInput');
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
          addInvoiceFiles(event.dataTransfer.files);
        }
      });
      input.addEventListener('change', function () {
        addInvoiceFiles(input.files);
        input.value = '';
      });
    }

    const fileList = $('#invFileList');
    if (fileList) {
      fileList.addEventListener('click', function (event) {
        const btn = event.target.closest('[data-inv-remove]');
        if (!btn) return;
        const index = Number(btn.getAttribute('data-inv-remove'));
        if (Number.isFinite(index)) {
          invoiceFiles.splice(index, 1);
          renderInvoiceFiles();
        }
      });
    }

    const form = $('#invoiceForm');
    if (form) form.addEventListener('submit', handleInvoiceStart);

    const formatGroup = $('#invFormatGroup');
    if (formatGroup) {
      formatGroup.addEventListener('click', function (event) {
        const option = event.target.closest('[data-inv-format]');
        if (!option) return;
        invoiceExportFormat =
          option.getAttribute('data-inv-format') || INV_DEFAULT_EXPORT_FORMAT;
        $$('#invFormatGroup [data-inv-format]').forEach(function (btn) {
          const active = btn === option;
          btn.classList.toggle('is-active', active);
          btn.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        const colsBlock = $('#invColsBlock');
        if (colsBlock) colsBlock.innerHTML = invoiceColumnsBlockHtml(invoiceExportFormat);
      });
    }

    renderInvoiceFiles();
  }

  function handleInvoiceStart(event) {
    event.preventDefault();

    if (!isLoggedIn()) {
      requireAuth({ action: 'invoice' });
      return;
    }

    const errEl = $('#invoiceFormError');
    const quote = invoiceQuote(invoiceFiles.length);

    if (!invoiceFiles.length) {
      if (errEl) errEl.textContent = 'Add at least one invoice file to continue.';
      return;
    }
    if (invoiceFiles.length > INV_TIER_2_MAX) {
      if (errEl) errEl.textContent = 'Maximum ' + INV_TIER_2_MAX + ' files per run.';
      return;
    }
    if (state.credits < quote.credits) {
      const shortfall = quote.credits - state.credits;
      if (errEl) {
        errEl.textContent =
          'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
          ' for this batch. Top up credits to continue.';
      }
      return;
    }

    if (errEl) errEl.textContent = '';
    invoiceStarting = true;
    updateInvoiceQuote();

    const email = accountEmail();
    const exportFormat = invoiceExportFormat || INV_DEFAULT_EXPORT_FORMAT;
    const batch = invoiceFiles.slice();
    const fileCount = batch.length;

    Promise.all(
      batch.map(function (entry) {
        return readFileAsBase64(entry.file).then(function (data) {
          return {
            name: entry.name,
            type: entry.type || '',
            size: entry.size,
            data_base64: data
          };
        });
      })
    )
      .then(function (files) {
        return apiFetch(
          INV_START_URL,
          {
            method: 'POST',
            body: JSON.stringify({
              email: email,
              export_format: exportFormat,
              files: files
            })
          },
          120000
        );
      })
      .then(function (response) {
        if (!response) return null;
        if (response.status === 401) {
          closeModal(false);
          handleAuthExpired(
            'Your session expired. Log in again to launch Invoice OCR.',
            { action: 'invoice' }
          );
          return null;
        }
        return readJson(response).then(function (body) {
          if (response.status === 402) {
            if (setLiveCredits(extractRemaining(body))) syncCreditUI();
            if (errEl) {
              errEl.textContent =
                (body && (body.error || body.message)) ||
                'Not enough credits for this invoice batch. Top up credits to continue.';
            }
            invoiceStarting = false;
            updateInvoiceQuote();
            return null;
          }
          if (!response.ok) {
            throw new Error(
              (body && (body.error || body.message)) || 'HTTP ' + response.status
            );
          }
          return body || {};
        });
      })
      .then(function (body) {
        if (!body) return;

        if (setLiveCredits(extractRemaining(body))) syncCreditUI();

        const payload = body.data && typeof body.data === 'object' ? body.data : body;
        const inner = payload.data && typeof payload.data === 'object' ? payload.data : {};
        const jobId =
          payload.job_id || payload.jobId || payload.id || inner.job_id || inner.id || '';

        state.invoiceJob = {
          job_id: String(jobId || 'inv_' + Date.now()),
          display_id: String(payload.display_id || inner.display_id || ''),
          status: String(payload.status || inner.status || 'processing').toLowerCase(),
          percent: 0,
          files_total:
            Number(payload.files_total || payload.total_files || payload.file_count || 0) ||
            fileCount,
          files_processed: 0,
          active_file: '',
          download_ready: false,
          preview_rows: [],
          credits_spent: quote.credits,
          export_format: String(payload.export_format || payload.exportFormat || exportFormat),
          email: email,
          created_at: new Date().toISOString(),
          poll_errors: 0
        };
        saveState();

        invoiceStarting = false;
        invoiceFiles = [];
        closeModal(false);
        toast(
          'Invoice OCR started — ' + fileCount + ' file' +
            (fileCount === 1 ? '' : 's') + ' queued.',
          'success'
        );

        if (window.location.hash === '#invoice-results') {
          renderInvoiceResults();
          startInvoicePolling(state.invoiceJob);
        } else {
          window.location.hash = '#invoice-results';
        }
      })
      .catch(function (err) {
        invoiceStarting = false;
        if (errEl) {
          errEl.textContent =
            (err && err.message ? err.message : '') ||
            'Could not start the invoice job. Please try again.';
        }
        updateInvoiceQuote();
        console.warn('[LiteWork] Invoice OCR start failed.', err);
      });
  }

  /* =================== M. LEAD ENRICHER (WORKER #4) ===================== */
  let leFiles = [];
  let leEstimateRows = 0;
  let leRowsExact = true;
  let leHistoryRows = 0;
  let leSelectedJobId = '';
  let leJobData = [];
  /* Source Lead Scraper job IDs already enriched (from the history response). */
  let leServerEnrichedIds = {};
  /* Backend contract: 'lead_job' = a finished Lead Scraper run, 'upload' = file. */
  let leSourceType = 'lead_job';
  let leStarting = false;
  let leJobsLoading = false;
  let lePollTimer = null;
  let lePollInFlight = false;
  let lePollController = null;
  let lePollEpoch = 0;
  let lePollStartedAt = 0;

  /* Preview columns mirror the 10 fixed Excel columns added by the worker. */
  const LE_PREVIEW_COLUMNS = [
    {
      label: 'Company',
      keys: ['company', 'company_name', 'Company', 'Company Name', 'business_name', 'name']
    },
    {
      label: 'Website Status',
      keys: ['website_status', 'site_status', 'Website Status', 'status', 'http_status']
    },
    {
      label: 'Primary Email',
      keys: ['primary_email', 'email', 'public_email', 'email_1', 'Public Email 1']
    },
    {
      label: 'MX Verified',
      keys: ['mx_verified', 'mx_status', 'dns_status', 'MX / DNS Status', 'mx']
    },
    {
      label: 'WhatsApp',
      keys: ['whatsapp', 'whatsapp_number', 'WhatsApp Number', 'wa_number']
    },
    {
      label: 'Socials',
      parts: [
        { tag: 'FB', keys: ['facebook', 'facebook_url', 'Facebook URL'] },
        { tag: 'IG', keys: ['instagram', 'instagram_url', 'Instagram URL'] },
        { tag: 'LI', keys: ['linkedin', 'linkedin_url', 'LinkedIn URL'] }
      ]
    },
    {
      label: 'Outreach Opener',
      keys: [
        'outreach_opener',
        'ai_outreach_opener',
        'AI Outreach Opener',
        'opener',
        'cold_opener'
      ]
    }
  ];

  const RW_PREVIEW_COLUMNS = [
    {
      label: 'Competitor',
      keys: ['competitor', 'competitor_name', 'name', 'company', 'business_name']
    },
    {
      label: 'Avg Rating',
      keys: ['avg_rating', 'average_rating', 'rating', 'avg_stars']
    },
    {
      label: 'Top Complaints',
      keys: ['top_complaints', 'complaints', 'complaint_themes', 'pain_points']
    },
    {
      label: 'Biggest Vulnerability',
      keys: ['biggest_vulnerability', 'vulnerability', 'weakness', 'main_weakness']
    },
    {
      label: 'Sales Counter-Pitch',
      keys: ['counter_pitch', 'sales_counter_pitch', 'pitch', 'sales_pitch']
    }
  ];

  function previewFieldValue(row, keys) {
    if (!row || typeof row !== 'object' || !Array.isArray(keys)) return '';
    for (let i = 0; i < keys.length; i += 1) {
      const raw = row[keys[i]];
      if (raw === null || raw === undefined) continue;
      const text = String(raw).trim();
      if (text) return text;
    }
    return '';
  }

  function previewCellValue(row, col) {
    if (!row || typeof row !== 'object') return '—';
    if (Array.isArray(col.parts)) {
      const parts = [];
      col.parts.forEach(function (part) {
        const value = previewFieldValue(row, part.keys);
        if (value) parts.push(part.tag + ' ' + value);
      });
      return parts.length ? parts.join(' · ') : '—';
    }
    const value = previewFieldValue(row, col.keys);
    return value || '—';
  }

  function renderPreviewTable(table, columns, rows, emptyMessage) {
    if (!table) return;
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (thead) {
      thead.innerHTML =
        '<tr>' +
        columns.map(function (col) {
          return '<th>' + escapeHtml(col.label) + '</th>';
        }).join('') +
        '</tr>';
    }
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="' + columns.length + '" class="table-empty">' +
        escapeHtml(emptyMessage) + '</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map(function (row) {
        return (
          '<tr>' +
          columns.map(function (col, index) {
            return '<td class="' + (index === 0 ? 'cell-strong' : '') + '">' +
              escapeHtml(previewCellValue(row, col)) + '</td>';
          }).join('') +
          '</tr>'
        );
      })
      .join('');
  }

  /* 1–50 = 5 cr · 51–150 = 10 cr · 151–300 = 15 cr. */
  function leQuote(sites) {
    const n = clamp(Number(sites) || 0, 0, LE_TIER_3_MAX);
    let credits = 0;
    let tier = 'No sites';
    if (n > 0) {
      if (n <= LE_TIER_1_MAX) {
        credits = LE_TIER_1_CREDITS;
        tier = '1–' + LE_TIER_1_MAX + ' sites';
      } else if (n <= LE_TIER_2_MAX) {
        credits = LE_TIER_2_CREDITS;
        tier = LE_TIER_1_MAX + 1 + '–' + LE_TIER_2_MAX + ' sites';
      } else {
        credits = LE_TIER_3_CREDITS;
        tier = LE_TIER_2_MAX + 1 + '–' + LE_TIER_3_MAX + ' sites';
      }
    }
    return { count: n, credits: credits, tier: tier };
  }

  function leRawSites() {
    if (leSourceType === 'upload') return Math.max(0, Number(leEstimateRows) || 0);
    return Math.max(0, Number(leHistoryRows) || 0);
  }

  function leSelectedSites() {
    return clamp(leRawSites(), 0, LE_TIER_3_MAX);
  }

  /* History lead counts are exact; uploaded .xlsx counts are only estimated. */
  function leCountIsExact() {
    return leSourceType === 'lead_job' ? true : leRowsExact === true;
  }

  function lePageActive() {
    return true;
  }

  function leIsComplete(job) {
    return (
      !!job &&
      String(job.status || '').toLowerCase() === 'completed' &&
      job.download_ready === true
    );
  }

  function leJobFailed(job) {
    const status = String((job && job.status) || '').toLowerCase();
    return (
      status === 'failed' ||
      status === 'error' ||
      status === 'cancelled' ||
      status === 'canceled'
    );
  }

  /* Never surface raw worker/network jargon to the user. */
  function leFriendlyError(reason) {
    const message = String((reason && reason.message) || reason || '').trim();
    if (!message) return '';
    const lower = message.toLowerCase();
    const technical =
      lower.indexOf('worker') !== -1 ||
      lower.indexOf('unavailable') !== -1 ||
      lower.indexOf('failed to fetch') !== -1 ||
      lower.indexOf('network') !== -1 ||
      lower.indexOf('timeout') !== -1 ||
      lower.indexOf('timed out') !== -1 ||
      lower.indexOf('empty status response') !== -1 ||
      /^http\s*5\d\d$/.test(lower);
    return technical ? 'Temporarily busy — please try again in a moment.' : message;
  }

  function lePollActive(job) {
    return !!job && !leJobFailed(job) && !leIsComplete(job);
  }

  function stopLeTimer() {
    lePollEpoch += 1;
    if (lePollTimer) {
      window.clearTimeout(lePollTimer);
      lePollTimer = null;
    }
    lePollStartedAt = 0;
    if (lePollController) {
      try {
        lePollController.abort();
      } catch (err) {
        /* already settled */
      }
      lePollController = null;
    }
    lePollInFlight = false;
  }

  function setLeBadge(kind, text) {
    const badge = $('#leStatus');
    if (!badge) return;
    badge.classList.remove('is-pending', 'is-ok', 'is-fail');
    if (kind) badge.classList.add('is-' + kind);
    const label = $('.webhook-text', badge);
    if (label) label.textContent = text;
  }

  function startLePolling(job, force) {
    if (!job || !LE_STATUS_URL) return;
    if (!lePageActive()) return;
    if (lePollTimer || lePollInFlight) return;
    if (!force && !lePollActive(job)) return;

    lePollStartedAt = Date.now();
    lePollEpoch += 1;
    const epoch = lePollEpoch;
    setLeBadge('pending', 'Working…');
    pollLeStatus(!!force, epoch);
  }

  function forceLePollNow() {
    const job = state.enricherJob;
    if (!job || !LE_STATUS_URL) return;
    if (lePollTimer) {
      window.clearTimeout(lePollTimer);
      lePollTimer = null;
    }
    if (lePollInFlight) return;
    if (!lePollStartedAt) lePollStartedAt = Date.now();
    pollLeStatus(true, lePollEpoch);
  }

  function scheduleNextLePoll(delay, epoch) {
    if (epoch !== lePollEpoch) return;
    if (lePollTimer) window.clearTimeout(lePollTimer);
    lePollTimer = window.setTimeout(function () {
      lePollTimer = null;
      pollLeStatus(false, epoch);
    }, Math.max(0, delay));
  }

  function ensureLeRunning() {
    const job = state.enricherJob;
    if (!job || leJobFailed(job) || leIsComplete(job)) return;
    if (!isLoggedIn()) return;
    startLePolling(job);
  }

  function extractLePreview(data) {
    if (!data || typeof data !== 'object') return [];
    const lists = [];
    const preview = data.preview;
    if (Array.isArray(preview)) {
      lists.push(preview);
    } else if (preview && typeof preview === 'object') {
      if (Array.isArray(preview.rows)) lists.push(preview.rows);
      if (Array.isArray(preview.leads)) lists.push(preview.leads);
      if (Array.isArray(preview.websites)) lists.push(preview.websites);
    }
    if (Array.isArray(data.preview_rows)) lists.push(data.preview_rows);
    if (Array.isArray(data.rows)) lists.push(data.rows);
    if (Array.isArray(data.results)) lists.push(data.results);
    if (Array.isArray(data.leads)) lists.push(data.leads);
    if (Array.isArray(data.websites)) lists.push(data.websites);
    if (Array.isArray(data.enriched)) lists.push(data.enriched);

    for (let i = 0; i < lists.length; i += 1) {
      if (lists[i].length) return lists[i];
    }
    return [];
  }

  function pollLeStatus(force, expectedEpoch) {
    const job = state.enricherJob;
    if (!job || !LE_STATUS_URL) return;
    const epoch = expectedEpoch == null ? lePollEpoch : expectedEpoch;
    if (epoch !== lePollEpoch) return;
    if (lePollInFlight) return;
    if (!force && !lePollActive(job)) return;
    if (!lePollStartedAt) lePollStartedAt = Date.now();

    lePollInFlight = true;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    lePollController = controller;
    /* 12s timeout + 3-strike tolerance, same policy as the other workers. */
    const timer = controller ? window.setTimeout(function () { controller.abort(); }, 12000) : null;

    const request = fetch(LE_STATUS_URL + '?job_id=' + encodeURIComponent(job.job_id), {
      mode: 'cors',
      headers: authHeaders(),
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) {
        if (epoch !== lePollEpoch) return null;
        if (response.status === 401) {
          stopLeTimer();
          handleAuthExpired(
            'Your session expired. Log in again to check this enrichment job.',
            null
          );
          return null;
        }
        if (response.status === 402) {
          failLeJob('Insufficient credits');
          return null;
        }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data) return;
        if (epoch !== lePollEpoch) return;
        if (typeof data !== 'object') throw new Error('Empty status response');

        if (setLiveCredits(extractRemaining(data))) syncCreditUI();

        const toNumber = function (value) {
          if (value === null || value === undefined || value === '') return null;
          const n = Number(value);
          return Number.isFinite(n) ? n : null;
        };
        const firstNumber = function () {
          for (let i = 0; i < arguments.length; i += 1) {
            const n = toNumber(arguments[i]);
            if (n !== null) return n;
          }
          return null;
        };

        const percent = toNumber(data.percent);
        if (percent !== null) job.percent = clamp(percent, 0, 100);

        const total = firstNumber(data.sites_total, data.total_sites, data.website_count, data.row_count);
        if (total !== null) job.sites_total = Math.max(0, Math.floor(total));

        const checked = firstNumber(
          data.sites_checked,
          data.checked_sites,
          data.websites_checked,
          data.processed_sites
        );
        if (checked !== null) job.sites_checked = Math.max(0, Math.floor(checked));

        const active = data.active_site || data.current_site || data.active_website;
        if (active != null) job.active_site = String(active);

        const sourceJobId = data.source_job_id || data.sourceJobId || data.lead_job_id;
        if (sourceJobId) job.source_job_id = String(sourceJobId);
        if (data.display_id) job.display_id = String(data.display_id);

        if (data.download_ready != null) {
          job.download_ready =
            data.download_ready === true ||
            data.download_ready === 'true' ||
            data.download_ready === 1;
        }
        if (data.email_sent != null) {
          job.email_sent = data.email_sent === true || data.email_sent === 'true';
        }

        const previewRows = extractLePreview(data);
        if (previewRows.length) job.preview_rows = previewRows.slice(0, 100);

        const status = String(data.status || job.status || 'processing').toLowerCase();
        job.status = status;
        job.poll_errors = 0;

        if (['failed', 'error', 'cancelled', 'canceled'].indexOf(status) !== -1) {
          failLeJob(data.error ? String(data.error) : '');
          return;
        }

        if (['completed', 'complete', 'success', 'done'].indexOf(status) !== -1) {
          if (job.download_ready === true) {
            completeLeJob(true);
          } else {
            setLeBadge('pending', 'Completed — finalizing Excel…');
            saveState();
            updateLeProgress();
            renderLeTable();
          }
          return;
        }

        if (status === 'queued' || status === 'pending' || status === 'starting') {
          setLeBadge('pending', 'Working…');
        } else {
          setLeBadge(
            'pending',
            'Working · ' +
              Math.floor(clamp(Number(job.percent) || 0, 0, 100)) + '%'
          );
        }

        saveState();
        updateLeProgress();
        renderLeTable();
      })
      .catch(function (err) {
        if (epoch !== lePollEpoch) return;

        const failures = (Number(job && job.poll_errors) || 0) + 1;
        if (job) job.poll_errors = failures;

        console.warn(
          '[LiteWork] Lead Enricher status check failed (' + failures + ').',
          err && err.message ? err.message : err
        );

        if (job) {
          if (failures >= 3) {
            setLeBadge('pending', 'Still working…');
          } else {
            const phase = String(job.status || '').toLowerCase();
            if (!phase || phase === 'queued' || phase === 'pending' || phase === 'starting') {
              setLeBadge('pending', 'Working…');
            }
          }
          saveState();
        }
        updateLeProgress();
      });

    /* ALWAYS release the guard and keep the setTimeout chain alive. */
    request.finally(function () {
      if (timer) window.clearTimeout(timer);
      if (lePollController === controller) lePollController = null;
      if (epoch !== lePollEpoch) return;

      lePollInFlight = false;
      const activeJob = state.enricherJob;
      if (!activeJob || !lePollActive(activeJob)) return;

      if (!lePollStartedAt) lePollStartedAt = Date.now();
      if (Date.now() - lePollStartedAt >= STATUS_POLL_WINDOW_MS) {
        setLeBadge('pending', 'Still running — click Check to refresh');
        saveState();
        updateLeProgress();
        return;
      }
      scheduleNextLePoll(LE_POLL_MS, epoch);
    });
  }

  function renderLeResults() {
    const empty = $('#enricherEmpty');
    const main = $('#enricherMain');
    if (!empty || !main) return;

    const job = state.enricherJob;
    if (!job) {
      empty.hidden = false;
      main.hidden = true;
      return;
    }

    empty.hidden = true;
    main.hidden = false;

    const resume = $('#leResumeId');
    if (resume) resume.value = formatJobRef(job) || '';
    const resumeBtn = $('#leResumeBtn');
    if (resumeBtn) {
      resumeBtn.disabled = false;
      resumeBtn.removeAttribute('disabled');
      resumeBtn.setAttribute('aria-disabled', 'false');
    }

    renderLeJobSummary();
    renderLeTable();
    updateLeProgress();

    if (leIsComplete(job)) {
      completeLeJob(true);
      return;
    }
    if (leJobFailed(job)) {
      setLeBadge('fail', 'Job failed · ' + (job.error || job.status || 'start a new batch'));
      return;
    }
    ensureLeRunning();
  }

  function renderLeJobSummary() {
    const job = state.enricherJob;
    if (!job) return;
    const meta = $('#leJobMeta');
    const summary = $('#leJobSummary');
    const sites = Number(job.sites_total) || 0;
    const credits = Number(job.credits_spent) || 0;

    if (meta) {
      meta.textContent = sites
        ? sites + ' website' + (sites === 1 ? '' : 's') + ' · ' + credits + ' credits'
        : 'Waiting for the first status update…';
    }

    if (summary) {
      summary.innerHTML =
        '<div class="summary-row"><dt>Websites</dt><dd><strong>' + sites + '</strong></dd></div>' +
        '<div class="summary-row"><dt>Checked</dt><dd>' +
        (Number(job.sites_checked) || 0) + '</dd></div>' +
        '<div class="summary-row"><dt>Credits spent</dt><dd><strong>' + credits + '</strong></dd></div>' +
        '<div class="summary-row"><dt>Source</dt><dd>' +
        escapeHtml(job.source === 'upload' ? 'Excel / CSV upload' : 'Lead Scraper history') +
        '</dd></div>' +
        '<div class="summary-row"><dt>Delivery email</dt><dd>' +
        escapeHtml(job.email || accountEmail() || '—') + '</dd></div>' +
        '<div class="summary-row"><dt>Started</dt><dd>' +
        escapeHtml(job.created_at ? fmtMYT(job.created_at) : '—') + '</dd></div>' +
        '<div class="summary-row"><dt>Job ID</dt><dd><code>' +
        escapeHtml(formatJobRef(job)) + '</code></dd></div>';
    }
  }

  function updateLeProgress() {
    const job = state.enricherJob;
    if (!job) return;

    const total = Number(job.sites_total) || 0;
    const checked = clamp(Math.floor(Number(job.sites_checked) || 0), 0, total || 9999);
    const complete = leIsComplete(job);
    const percent = complete
      ? 100
      : Math.floor(clamp(Number(job.percent) || 0, 0, 100));

    const fill = $('#leRingFill');
    if (fill) fill.style.strokeDashoffset = String(RING_LENGTH - (RING_LENGTH * percent) / 100);

    const percentEl = $('#leRingPercent');
    if (percentEl) percentEl.textContent = percent + '%';

    const countEl = $('#leRingCount');
    if (countEl) {
      countEl.textContent = checked + ' / ' + (total || '—') + ' websites checked';
    }

    const activeEl = $('#leRingActive');
    if (activeEl) {
      const activeSite = String(job.active_site || '').trim();
      const phase = String(job.status || '').toLowerCase();
      const terminal =
        complete ||
        phase === 'completed' ||
        phase === 'complete' ||
        phase === 'failed' ||
        phase === 'error';
      if (activeSite && !terminal) {
        activeEl.hidden = false;
        activeEl.textContent = 'Checking "' + activeSite + '"…';
      } else {
        activeEl.hidden = true;
        activeEl.textContent = '';
      }
    }

    const card = $('#leRingCard');
    if (card) card.classList.toggle('is-complete', complete);

    const downloadBtn = $('#leDownloadBtn');
    if (downloadBtn) downloadBtn.disabled = !complete;

    const downloadTitle = $('#leDownloadTitle');
    if (downloadTitle) {
      downloadTitle.textContent =
        complete && total ? 'Enriched Excel (.xlsx) · ' + total + ' websites' : 'Enriched Excel (.xlsx)';
    }

    const downloadSub = $('#leDownloadSub');
    if (downloadSub) {
      if (complete) downloadSub.textContent = 'Ready to download';
      else if (String(job.status || '').toLowerCase() === 'completed') {
        downloadSub.textContent = 'Finishing up…';
      } else {
        downloadSub.textContent = 'Working — safe to close this tab and return anytime.';
      }
    }

    const emailNote = $('#leEmailNote');
    if (emailNote) {
      const email = job.email || accountEmail() || 'your delivery email';
      const sent = complete && job.email_sent === true;
      emailNote.textContent = sent
        ? '✓ Excel (.xlsx) emailed to ' + email + ' & ready to download below.'
        : 'Excel (.xlsx) will also be emailed to ' + email +
          ' when ready — safe to close this tab.';
      emailNote.classList.toggle('is-sent', sent);
    }

    const tableMeta = $('#leTableMeta');
    if (tableMeta) {
      const count = (job.preview_rows || []).length;
      tableMeta.textContent =
        'Preview · ' + count + ' website' + (count === 1 ? '' : 's') +
        ' enriched · emails, MX, socials & openers';
    }

    renderLeJobSummary();
  }

  function renderLeTable() {
    const table = $('#leTable');
    if (!table || !state.enricherJob) return;
    const job = state.enricherJob;
    const rows = Array.isArray(job.preview_rows) ? job.preview_rows.slice(0, 50) : [];
    const message =
      String(job.status || '').toLowerCase() === 'completed'
        ? 'Preview unavailable — download the .xlsx for every website.'
        : 'Waiting for the first enriched website…';
    renderPreviewTable(table, LE_PREVIEW_COLUMNS, rows, message);

    const pill = $('#lePreviewPill');
    if (pill) {
      pill.textContent = rows.length + ' website' + (rows.length === 1 ? '' : 's');
    }
  }

  function completeLeJob(silent) {
    const job = state.enricherJob;
    if (!job) return;

    job.status = 'completed';
    job.download_ready = true;
    job.percent = 100;

    updateLeProgress();
    renderLeTable();

    stopLeTimer();
    historyState.loaded = false;
    saveState();

    setLeBadge('ok', 'Completed · .xlsx ready');
    if (!silent) toast('Enriched Excel is ready to download.', 'success');
  }

  function failLeJob(reason) {
    const job = state.enricherJob;
    if (!job) return;
    job.status = 'failed';
    job.error = leFriendlyError(reason) || '';
    stopLeTimer();
    saveState();
    updateLeProgress();
    setLeBadge('fail', 'Job failed · ' + (job.error || 'please try again in a moment'));
  }

  function downloadLeExcel(jobId) {
    const job = state.enricherJob || {};
    const id = String(jobId || job.job_id || '').trim();
    if (!id || !LE_DOWNLOAD_URL) {
      toast('Download unlocks when your Excel is ready.', 'warn');
      return;
    }

    toast('Preparing your download…', 'info');

    fetch(LE_DOWNLOAD_URL + '?job_id=' + encodeURIComponent(id), {
      mode: 'cors',
      headers: authHeaders()
    })
      .then(function (response) {
        if (response.status === 401) {
          handleAuthExpired(
            'Your session expired. Log in again to download your enriched leads.',
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
        anchor.download = 'litework-enriched-leads-' + id.replace(/[^A-Za-z0-9_-]/g, '') + '.xlsx';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 4000);
        toast('Enriched Excel download ready.', 'success');
      })
      .catch(function (err) {
        console.warn('[LiteWork] Lead Enricher download failed.', err);
        toast('Could not download the enriched Excel. Please try again.', 'warn');
      });
  }

  function openLeHistoryJob(jobId) {
    const ref = String(jobId || '').trim();
    if (!ref) return;

    stopLeTimer();
    const current = state.enricherJob;
    const known =
      findHistoryJob(historyState.enricher, ref) ||
      (current && String(formatJobRef(current)) === ref ? current : null);
    const id = String((known && known.job_id) || ref);
    const sameJob = !!current && String(current.job_id || '') === id;

    if (!sameJob) {
      state.enricherJob = {
        job_id: id,
        display_id: known ? String(known.display_id || '') : (ref !== id ? ref : ''),
        status: 'processing',
        percent: 0,
        sites_total: known ? known.sites : 0,
        sites_checked: known ? known.checked : 0,
        active_site: '',
        download_ready: false,
        preview_rows: [],
        credits_spent: known ? known.credits : 0,
        source: known && known.source ? known.source : '',
        source_job_id: known && known.source_job_id ? known.source_job_id : '',
        email: accountEmail(),
        created_at: new Date().toISOString(),
        poll_errors: 0
      };
    } else {
      current.poll_errors = 0;
      current.error = '';
      if (leJobFailed(current)) current.status = 'processing';
    }
    saveState();

    if (currentRoute() === 'enricher-results') {
      renderLeResults();
      startLePolling(state.enricherJob, true);
    } else {
      window.location.hash = '#enricher-results';
    }
  }

  /* ----- Lead Enricher configuration modal ----- */
  function leColumnsChipsHtml() {
    return (
      '<div class="inv-cols-block">' +
      '<p class="inv-cols-title">10 Fixed Columns Added to Your Excel</p>' +
      '<div class="inv-chips">' +
      LE_COLUMNS.map(function (label) {
        return '<span class="inv-chip">' + escapeHtml(label) + '</span>';
      }).join('') +
      '</div>' +
      '<p class="inv-chip-note">Appended to your original columns — nothing is overwritten.</p>' +
      '</div>'
    );
  }

  /* null = not recorded (unknown), true/false = known compatibility. */
  function leJobHasWebsiteColumn(job) {
    if (!job) return null;
    if (job.hasWebsite === true || job.hasWebsite === false) return job.hasWebsite;
    const columns = Array.isArray(job.columns) ? job.columns : [];
    if (!columns.length) return null;
    return columns.some(function (value) {
      const key = String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
      return (
        key === 'website' ||
        key === 'websiteurl' ||
        key === 'url' ||
        key === 'domain' ||
        key === 'mapsurl'
      );
    });
  }

  /* Unknown columns stay selectable — only an explicit "no website" blocks. */
  function leJobCompatible(job) {
    return leJobHasWebsiteColumn(job) !== false;
  }

  /* Source job IDs already enriched by a completed Lead Enricher run. */
  function leEnrichedSourceIds() {
    const ids = {};
    Object.keys(leServerEnrichedIds).forEach(function (key) {
      ids[key] = true;
    });
    const enrichers = Array.isArray(historyState.enricher) ? historyState.enricher : [];
    enrichers.forEach(function (entry) {
      if (!entry || !entry.source_job_id) return;
      const status = String(entry.status || '').toLowerCase();
      const done =
        entry.downloadReady === true ||
        ['completed', 'complete', 'success', 'done'].indexOf(status) !== -1;
      if (done) ids[String(entry.source_job_id)] = true;
    });
    const current = state.enricherJob;
    if (current && current.source_job_id) {
      const status = String(current.status || '').toLowerCase();
      if (['completed', 'complete', 'success', 'done'].indexOf(status) !== -1) {
        ids[String(current.source_job_id)] = true;
      }
    }
    return ids;
  }

  /* Only clean, ready-to-enrich jobs ever reach the dropdown. */
  function leJobEligible(job, enrichedIds) {
    if (!job || !job.job_id) return false;
    if (leJobHasWebsiteColumn(job) === false) return false;
    if (job.alreadyEnriched === true) return false;
    if (enrichedIds && enrichedIds[String(job.job_id)]) return false;
    return true;
  }

  function leFirstCompatibleJob() {
    for (let i = 0; i < leJobData.length; i += 1) {
      if (leJobCompatible(leJobData[i])) return leJobData[i];
    }
    return null;
  }

  function leJobLeads(job) {
    return Number(job && job.target) || Number(job && job.scraped) || 0;
  }

  function leJobLabel(job) {
    if (!job) return '';
    const leads = leJobLeads(job);
    const terms = job.terms && job.terms.length ? job.terms.slice(0, 2).join(', ') : '—';
    return (
      (job.country || '—') + ' · ' + terms + ' · ' + (leads || '—') + ' leads · ' +
      formatJobRef(job)
    );
  }

  function leJobMatches(job, query) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return true;
    const haystack = [
      job.country || '',
      job.job_id || '',
      job.display_id || '',
      (job.terms || []).join(' ')
    ]
      .join(' ')
      .toLowerCase();
    return haystack.indexOf(needle) !== -1;
  }

  function leSelectedJob() {
    if (!leSelectedJobId) return null;
    for (let i = 0; i < leJobData.length; i += 1) {
      if (leJobData[i].job_id === leSelectedJobId) return leJobData[i];
    }
    return null;
  }

  function leRestoreJobLabel() {
    const input = $('#leJobSearch');
    if (!input) return;
    const job = leSelectedJob();
    input.value = job ? leJobLabel(job) : '';
  }

  /* Returns true when a dropdown was actually open (so Escape can stop there). */
  function closeLeJobPanel(restoreLabel) {
    const panel = $('#leJobList');
    const input = $('#leJobSearch');
    const wasOpen = !!panel && !panel.hidden;
    if (panel) panel.hidden = true;
    if (input) input.setAttribute('aria-expanded', 'false');
    if (restoreLabel) leRestoreJobLabel();
    return wasOpen;
  }

  function leRenderJobList(query) {
    const panel = $('#leJobList');
    if (!panel) return;

    if (!leJobData.length) {
      panel.innerHTML =
        '<p class="le-combo-empty">No un-enriched Lead Scraper jobs with Website URLs available — upload a file instead.</p>';
      return;
    }

    const list = leJobData.filter(function (job) {
      return leJobMatches(job, query);
    });

    if (!list.length) {
      panel.innerHTML =
        '<p class="le-combo-empty">No jobs match "' + escapeHtml(String(query || '')) + '".</p>';
      return;
    }

    panel.innerHTML = list
      .map(function (job) {
        const leads = leJobLeads(job);
        const terms = job.terms && job.terms.length ? job.terms.slice(0, 3).join(', ') : '—';
        const active = job.job_id === leSelectedJobId;
        return (
          '<button type="button" class="le-combo-option' +
          (active ? ' is-selected' : '') + '"' +
          ' role="option" aria-selected="' + (active ? 'true' : 'false') + '"' +
          ' data-job-id="' + escapeHtml(job.job_id) + '">' +
          '<span class="le-combo-option-main"><strong>' +
          escapeHtml(job.country || '—') + '</strong> · ' + escapeHtml(terms) + '</span>' +
          '<span class="le-combo-option-meta">' +
          (leads ? leads + ' leads' : 'Lead count unknown') +
          ' · ' + escapeHtml(formatJobRef(job)) + '</span>' +
          '</button>'
        );
      })
      .join('');
  }

  function openLeJobPanel() {
    const panel = $('#leJobList');
    const input = $('#leJobSearch');
    if (!panel) return;
    leRenderJobList(input ? input.value : '');
    panel.hidden = false;
    if (input) input.setAttribute('aria-expanded', 'true');
  }

  function selectLeJob(jobId) {
    const wanted = String(jobId || '');
    const job = leJobData.filter(function (entry) { return entry.job_id === wanted; })[0] || null;

    if (job && !leJobCompatible(job)) {
      toast(
        'That Lead Scraper job has no Website column — run it again with Website checked, or upload a file.',
        'warn'
      );
      closeLeJobPanel(true);
      return;
    }

    if (job) {
      leSelectedJobId = job.job_id;
      leHistoryRows = leJobLeads(job) || LE_TIER_1_MAX;
    } else {
      leSelectedJobId = '';
      leHistoryRows = 0;
    }
    closeLeJobPanel(true);
    updateLeQuote();
  }

  function leRenderJobOptions(jobs) {
    /* Hide ineligible rows entirely — no disabled clutter in the dropdown. */
    const enrichedIds = leEnrichedSourceIds();
    leJobData = (Array.isArray(jobs) ? jobs : []).filter(function (job) {
      return leJobEligible(job, enrichedIds);
    });
    const input = $('#leJobSearch');
    const panel = $('#leJobList');

    if (!leJobData.length) {
      leSelectedJobId = '';
      leHistoryRows = 0;
      if (input) {
        input.value = '';
        input.disabled = true;
        input.placeholder = 'No eligible Lead Scraper jobs — upload a file instead';
      }
      if (panel) {
        panel.hidden = true;
        panel.innerHTML = '';
      }
      const emptyNotice = $('#leNoWebsiteNotice');
      if (emptyNotice) emptyNotice.hidden = false;
      updateLeQuote();
      return;
    }

    const anyCompatible = !!leFirstCompatibleJob();
    if (input) {
      input.disabled = false;
      input.placeholder = anyCompatible
        ? 'Search by country, keyword, or Job ID…'
        : 'No completed job includes a Website column';
    }

    /* Keep the current selection when still valid, else auto-pick the newest eligible job. */
    const stillThere = leJobData.some(function (job) {
      return job.job_id === leSelectedJobId;
    });
    if (!stillThere) {
      const first = leFirstCompatibleJob();
      leSelectedJobId = first ? first.job_id : '';
      leHistoryRows = first ? leJobLeads(first) || LE_TIER_1_MAX : 0;
    }

    const notice = $('#leNoWebsiteNotice');
    if (notice) notice.hidden = anyCompatible;

    leRestoreJobLabel();
    leRenderJobList('');
    if (panel) panel.hidden = true;
    if (input) input.setAttribute('aria-expanded', 'false');
    updateLeQuote();
  }

  function loadLeJobs() {
    if (!$('#leJobSearch') || leJobsLoading) return;
    leJobsLoading = true;

    /* Transient loading state until the first render lands. */
    if (!leJobData.length) {
      const input = $('#leJobSearch');
      if (input) {
        input.disabled = true;
        input.placeholder = 'Loading your Lead Scraper jobs…';
      }
    }

    const local = (historyState.b2b || []).filter(function (job) {
      const status = String((job && job.status) || '').toLowerCase();
      return (
        !!job &&
        !!job.job_id &&
        (job.downloadReady ||
          ['completed', 'complete', 'success', 'done'].indexOf(status) !== -1)
      );
    });
    local.sort(function (a, b) {
      return historyTime(b.created) - historyTime(a.created);
    });
    if (local.length) leRenderJobOptions(local);

    apiFetch(ACCOUNT_HISTORY_URL, { method: 'GET' }, 20000)
      .then(function (response) {
        return readJson(response).then(function (body) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return body;
        });
      })
      .then(function (body) {
        leJobsLoading = false;
        const source = historySource(body);
        const raw = pickArray(source, [
          'b2b_lead_scraper',
          'jobs',
          'scraper_jobs',
          'lead_jobs',
          'b2b',
          'b2b_jobs',
          'scrapes'
        ]);
        const jobs = raw.map(normalizeHistoryJob).filter(function (job) {
          const status = String(job.status || '').toLowerCase();
          return (
            !!job.job_id &&
            (job.downloadReady ||
              ['completed', 'complete', 'success', 'done'].indexOf(status) !== -1)
          );
        });
        jobs.sort(function (a, b) {
          return historyTime(b.created) - historyTime(a.created);
        });

        /* Completed Lead Enricher runs tell us which scraper jobs are spent. */
        const enricherRaw = pickArray(source, [
          'lead_enricher',
          'lead_enricher_jobs',
          'enricher_jobs',
          'enricher',
          'enrichment_jobs'
        ]);
        const enrichedIds = {};
        enricherRaw.map(normalizeEnricherJob).forEach(function (entry) {
          if (!entry || !entry.source_job_id) return;
          const status = String(entry.status || '').toLowerCase();
          if (
            entry.downloadReady === true ||
            ['completed', 'complete', 'success', 'done'].indexOf(status) !== -1
          ) {
            enrichedIds[String(entry.source_job_id)] = true;
          }
        });
        leServerEnrichedIds = enrichedIds;

        leRenderJobOptions(jobs.length ? jobs : local);
      })
      .catch(function (err) {
        leJobsLoading = false;
        if (!local.length) leRenderJobOptions([]);
        console.warn(
          '[LiteWork] Could not load Lead Scraper jobs for the enricher.',
          err && err.message ? err.message : err
        );
      });
  }

  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      try {
        const reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result || '')); };
        reader.onerror = function () { reject(new Error('Could not read the file.')); };
        reader.readAsText(file);
      } catch (err) {
        reject(err);
      }
    });
  }

  function estimateLeRows(file) {
    const size = Number(file && file.size) || 0;
    const extMatch = String((file && file.name) || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    const ext = extMatch ? extMatch[1] : '';
    if (ext === 'csv' || ext === 'txt') {
      return readFileText(file)
        .then(function (text) {
          const lines = text.split(/\r\n|\n|\r/).filter(function (line) {
            return String(line).trim() !== '';
          });
          return { rows: Math.max(1, lines.length - 1), exact: true };
        })
        .catch(function () {
          return { rows: Math.max(1, Math.round(size / 140)), exact: false };
        });
    }
    /* .xlsx is a compressed workbook — estimate from file size, never block. */
    return Promise.resolve({ rows: Math.max(1, Math.round(size / 140)), exact: false });
  }

  function setLeFile(file) {
    const errEl = $('#enricherFormError');
    if (errEl) errEl.textContent = '';
    if (!file) return;

    const extMatch = String(file.name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    const ext = extMatch ? extMatch[1] : '';
    if (['xlsx', 'xls', 'csv'].indexOf(ext) === -1) {
      if (errEl) errEl.textContent = 'Upload an .xlsx, .xls or .csv file.';
      return;
    }
    if (file.size > LE_MAX_FILE_BYTES) {
      if (errEl) {
        errEl.textContent =
          'File is too large — the limit is ' +
          Math.round(LE_MAX_FILE_BYTES / 1048576) + ' MB.';
      }
      return;
    }

    leFiles = [file];
    leEstimateRows = 0;
    leRowsExact = false;
    const box = $('#leUploaded');
    if (box) {
      box.hidden = false;
      box.innerHTML =
        '<div><strong>' + escapeHtml(file.name) + '</strong>' +
        '<span id="leUploadedMeta">Reading row count…</span></div>';
    }

    estimateLeRows(file).then(function (result) {
      if (!leFiles.length || leFiles[0] !== file) return;
      leEstimateRows = result.rows;
      leRowsExact = result.exact === true;
      const meta = $('#leUploadedMeta');
      if (meta) {
        meta.textContent =
          (leRowsExact ? result.rows + ' rows' : '≈ ' + result.rows + ' rows') +
          ' · ' + formatFileSize(file.size);
      }
      updateLeQuote();
    });
    updateLeQuote();
  }

  function updateLeQuote() {
    const raw = leRawSites();
    const sites = leSelectedSites();
    const quote = leQuote(sites);
    const tooMany = raw > LE_TIER_3_MAX && leCountIsExact();

    const availableEl = $('#leAvailable');
    if (availableEl) availableEl.textContent = state.credits + ' Credits';

    const siteEl = $('#leSiteCount');
    if (siteEl) {
      siteEl.textContent = raw > LE_TIER_3_MAX ? String(raw) : String(sites);
      siteEl.classList.toggle('is-zero', sites === 0);
    }

    const tierEl = $('#leTier');
    if (tierEl) {
      tierEl.textContent = quote.tier;
      tierEl.classList.toggle('is-zero', sites === 0);
    }

    const costEl = $('#leCost');
    if (costEl) costEl.textContent = quote.credits + ' Credits';

    const shortfall = quote.credits - state.credits;
    const shortEl = $('#enricherShortfall');
    if (shortEl) {
      if (tooMany) {
        shortEl.hidden = false;
        shortEl.textContent =
          'Up to ' + LE_TIER_3_MAX + ' websites per run — split this list into smaller batches.';
      } else if (sites > 0 && shortfall > 0) {
        shortEl.hidden = false;
        shortEl.textContent =
          'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
          ' for this batch. Top up credits to continue.';
      } else {
        shortEl.hidden = true;
        shortEl.textContent = '';
      }
    }

    const btn = $('#enricherStartBtn');
    if (btn) {
      btn.disabled = leStarting || sites <= 0 || !quote.credits || tooMany;
      btn.textContent = leStarting
        ? 'Starting…'
        : 'Confirm & Spend ' + quote.credits + ' Credit' + (quote.credits === 1 ? '' : 's');
    }
  }

  function openLeadEnricherModal() {
    if (!requireAuth({ action: 'enricher' })) return;

    leFiles = [];
    leEstimateRows = 0;
    leHistoryRows = 0;
    leSelectedJobId = '';
    leJobData = [];
    leSourceType = 'lead_job';
    leStarting = false;

    openModal(
      '<h2 class="modal-title" id="modalTitle">Website & Email Lead Enricher</h2>' +
      '<p class="modal-sub">Add verified emails, live MX checks, WhatsApp, socials and AI openers to your list · 5 credits (1–50 sites) · 10 credits (51–150) · 15 credits (151–300)</p>' +
      '<div class="calc-card modal-calc modal-calc-dark"><div class="calc-grid">' +
      '<div class="calc-cell"><span class="calc-label">Available</span>' +
      '<span class="calc-value" id="leAvailable">' + state.credits + ' Credits</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Websites</span>' +
      '<span class="calc-value is-zero" id="leSiteCount">0</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Tier</span>' +
      '<span class="calc-value is-zero" id="leTier">No sites</span></div>' +
      '<div class="calc-cell calc-cell-total"><span class="calc-label">Total cost</span>' +
      '<span class="calc-value" id="leCost">0 Credits</span></div>' +
      '</div></div>' +
      '<form class="invoice-form" id="enricherForm" novalidate>' +
      '<div class="field"><label for="enricherEmail">Delivery email</label>' +
      '<input type="email" id="enricherEmail" class="is-locked" value="' +
      escapeHtml(accountEmail()) + '" disabled tabindex="-1" /></div>' +
      '<div class="src-tabs" role="tablist" aria-label="Lead source">' +
      '<button type="button" class="src-tab is-active" data-le-source="history" role="tab" aria-selected="true">From Lead Scraper History</button>' +
      '<button type="button" class="src-tab" data-le-source="upload" role="tab" aria-selected="false">Upload Excel / CSV</button>' +
      '</div>' +
      '<div class="src-pane" id="lePaneHistory">' +
      '<div class="le-combo" id="leJobCombo">' +
      '<label class="le-combo-label" for="leJobSearch">Completed Lead Scraper job</label>' +
      '<div class="le-combo-field">' +
      '<input type="text" id="leJobSearch" class="le-combo-input" autocomplete="off" spellcheck="false" ' +
      'placeholder="Search by country, keyword, or Job ID…" role="combobox" aria-expanded="false" ' +
      'aria-controls="leJobList" aria-autocomplete="list" />' +
      '<span class="le-combo-caret" aria-hidden="true">⌄</span>' +
      '</div>' +
      '<div class="le-combo-panel" id="leJobList" role="listbox" aria-label="Completed Lead Scraper jobs" hidden></div>' +
      '</div>' +
      '<p class="le-hint">Only completed, un-enriched Lead Scraper jobs that include a <strong>Website</strong> column can be enriched (50–500 leads).</p>' +
      '<p class="le-combo-notice" id="leNoWebsiteNotice" hidden>No un-enriched Lead Scraper jobs with Website URLs available. Run Lead Scraper with <strong>Website</strong> checked, or switch to <strong>Upload Excel / CSV</strong>.</p>' +
      '</div>' +
      '<div class="src-pane" id="lePaneUpload" hidden>' +
      '<label class="inv-drop" id="leDrop" for="leFileInput">' +
      '<span class="inv-drop-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#22D3EE" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 16V5" /><path d="m7 10 5-5 5 5" />' +
      '<path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />' +
      '</svg></span>' +
      '<strong>Drag & drop your website list</strong>' +
      '<span class="inv-drop-sub">or click to browse · max ' +
      Math.round(LE_MAX_FILE_BYTES / 1048576) + ' MB · up to ' + LE_TIER_3_MAX + ' sites</span>' +
      '<span class="inv-drop-types">XLSX · XLS · CSV</span>' +
      '<span class="inv-drop-tip">One row per company. Include a website or Google Maps URL column — the enricher appends 10 verified columns to your original sheet.</span>' +
      '</label>' +
      '<input type="file" id="leFileInput" class="inv-file-input" accept="' +
      escapeHtml(LE_ACCEPT) + '" />' +
      '<div class="le-uploaded" id="leUploaded" hidden></div>' +
      '</div>' +
      '<div class="modal-section"><h3>Enrichment options</h3></div>' +
      '<div class="le-opt is-locked">' +
      '<input type="checkbox" checked disabled />' +
      '<div><span class="le-opt-title">Public Emails + Live DNS/MX Verification ' +
      '<span class="le-opt-badge">Included</span></span>' +
      '<span class="le-opt-hint">Every website is scanned for public addresses and each domain is checked for live MX records.</span></div>' +
      '</div>' +
      '<label class="le-opt">' +
      '<input type="checkbox" id="leSocial" checked />' +
      '<div><span class="le-opt-title">Extract WhatsApp & Social Links (FB, IG, LinkedIn)</span>' +
      '<span class="le-opt-hint">Adds WhatsApp numbers plus Facebook, Instagram and LinkedIn profile URLs.</span></div>' +
      '</label>' +
      '<label class="le-opt">' +
      '<input type="checkbox" id="leAiSummary" />' +
      '<div><span class="le-opt-title">Generate AI 1-Line Company Summary & Custom Cold Opener</span>' +
      '<span class="le-opt-hint">Writes a one-line summary and a tailored first message per lead.</span></div>' +
      '</label>' +
      '<div class="le-offer field" id="leOfferField" hidden>' +
      '<label for="leOffer">Your product or offer (e.g., "Fast packaging supply across Malaysia")</label>' +
      '<input type="text" id="leOffer" autocomplete="off" placeholder="Fast packaging supply across Malaysia" />' +
      '</div>' +
      leColumnsChipsHtml() +
      '<div class="modal-actions">' +
      '<div class="scraper-modal-error" id="enricherFormError" role="alert"></div>' +
      '<p class="scraper-shortfall" id="enricherShortfall" hidden></p>' +
      '<button type="submit" class="btn btn-activate" id="enricherStartBtn" disabled>' +
      'Confirm & Spend 0 Credits</button>' +
      '<p class="fine">Credits are deducted immediately. Processing your request — safe to close this tab and return anytime.</p>' +
      '</div>' +
      '</form>',
      true
    );

    $$('[data-le-source]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        leSourceType =
          btn.getAttribute('data-le-source') === 'upload' ? 'upload' : 'lead_job';
        $$('[data-le-source]').forEach(function (b) {
          const on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        if (leSourceType !== 'lead_job') {
          closeLeJobPanel(false);
        } else {
          closeLeJobPanel(true);
        }
        const historyPane = $('#lePaneHistory');
        const uploadPane = $('#lePaneUpload');
        if (historyPane) historyPane.hidden = leSourceType !== 'lead_job';
        if (uploadPane) uploadPane.hidden = leSourceType !== 'upload';
        updateLeQuote();
      });
    });

    const jobSearch = $('#leJobSearch');
    if (jobSearch) {
      jobSearch.addEventListener('focus', function () {
        if (jobSearch.disabled) return;
        /* Clear the selected label so typing filters from the full list. */
        jobSearch.value = '';
        openLeJobPanel();
      });
      jobSearch.addEventListener('click', function () {
        if (jobSearch.disabled) return;
        const panel = $('#leJobList');
        if (panel && panel.hidden) {
          jobSearch.value = '';
          openLeJobPanel();
        }
      });
      jobSearch.addEventListener('input', function () {
        const panel = $('#leJobList');
        if (panel && panel.hidden) openLeJobPanel();
        else leRenderJobList(jobSearch.value);
      });
      jobSearch.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          event.stopPropagation();
          closeLeJobPanel(true);
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          openLeJobPanel();
        }
      });
    }

    const jobList = $('#leJobList');
    if (jobList) {
      jobList.addEventListener('click', function (event) {
        const option = event.target.closest('[data-job-id]');
        if (!option) return;
        selectLeJob(String(option.getAttribute('data-job-id') || ''));
      });
    }

    const drop = $('#leDrop');
    const input = $('#leFileInput');
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
        if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
          setLeFile(event.dataTransfer.files[0]);
        }
      });
      input.addEventListener('change', function () {
        if (input.files && input.files.length) setLeFile(input.files[0]);
        input.value = '';
      });
    }

    const aiToggle = $('#leAiSummary');
    if (aiToggle) {
      aiToggle.addEventListener('change', function () {
        const offerField = $('#leOfferField');
        if (offerField) offerField.hidden = !aiToggle.checked;
        if (aiToggle.checked && $('#leOffer')) $('#leOffer').focus();
      });
    }

    const form = $('#enricherForm');
    if (form) form.addEventListener('submit', handleLeadEnricherStart);

    updateLeQuote();
    loadLeJobs();
  }

  function openEnricherColumnsModal() {
    openModal(
      '<h2 class="modal-title" id="modalTitle">Lead Enricher — Excel Output</h2>' +
      '<p class="modal-sub">Your original columns are kept and these 10 verified columns are appended.</p>' +
      leColumnsChipsHtml() +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" data-modal-close>Close</button>' +
      '</div>',
      false
    );
  }

  function handleLeadEnricherStart(event) {
    event.preventDefault();

    if (!isLoggedIn()) {
      requireAuth({ action: 'enricher' });
      return;
    }

    const errEl = $('#enricherFormError');
    const file = leFiles[0] || null;
    const selectedJob = leSelectedJob();
    const jobId = leSourceType === 'lead_job' && selectedJob ? selectedJob.job_id : '';
    const sites = leSelectedSites();
    const quote = leQuote(sites);

    if (leSourceType === 'lead_job' && !jobId) {
      if (errEl) errEl.textContent = 'Choose a completed Lead Scraper job, or switch to upload.';
      return;
    }
    if (
      leSourceType === 'lead_job' &&
      selectedJob &&
      leJobHasWebsiteColumn(selectedJob) === false
    ) {
      if (errEl) {
        errEl.textContent =
          'This Lead Scraper job has no Website column — run Lead Scraper with Website checked, or upload a file.';
      }
      return;
    }
    if (leSourceType === 'upload' && !file) {
      if (errEl) errEl.textContent = 'Upload an .xlsx or .csv website list to continue.';
      return;
    }
    if (sites <= 0) {
      if (errEl) errEl.textContent = 'This batch has no websites to enrich.';
      return;
    }
    const rawSites = leRawSites();
    if (rawSites > LE_TIER_3_MAX && leCountIsExact()) {
      if (errEl) {
        errEl.textContent =
          'Maximum ' + LE_TIER_3_MAX + ' websites per run — split the list into smaller batches.';
      }
      return;
    }
    if (state.credits < quote.credits) {
      const shortfall = quote.credits - state.credits;
      if (errEl) {
        errEl.textContent =
          'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
          ' for this batch. Top up credits to continue.';
      }
      return;
    }

    if (errEl) errEl.textContent = '';
    leStarting = true;
    updateLeQuote();

    const email = accountEmail();
    const aiEl = $('#leAiSummary');
    const socialEl = $('#leSocial');
    const offerEl = $('#leOffer');
    const aiOn = !!(aiEl && aiEl.checked);

    /* Backend contract: source_type MUST be exactly 'lead_job' or 'upload'. */
    const includeSocials = !!(socialEl && socialEl.checked);
    const includeAiOpener = aiOn;
    const userOffer = aiOn && offerEl ? String(offerEl.value || '').trim() : '';
    const uploadFile = leSourceType === 'upload' ? file : null;

    const payload = {
      source_type: leSourceType,
      email: email,
      include_socials: includeSocials,
      include_ai_opener: includeAiOpener,
      user_offer: userOffer,
      sites: sites,
      row_count: sites,
      credits: quote.credits
    };

    if (leSourceType === 'lead_job') {
      payload.source_job_id = jobId;
      payload.job_id = jobId;
      payload.country = selectedJob ? String(selectedJob.country || '') : '';
    }

    const ready = uploadFile
      ? readFileAsBase64(uploadFile).then(function (base64) {
          payload.file = {
            name: uploadFile.name,
            type: uploadFile.type || '',
            size: uploadFile.size,
            data_base64: base64
          };
          return payload;
        })
      : Promise.resolve(payload);

    ready
      .then(function (body) {
        return apiFetch(
          LE_START_URL,
          { method: 'POST', body: JSON.stringify(body) },
          120000
        );
      })
      .then(function (response) {
        if (!response) return null;
        if (response.status === 401) {
          closeModal(false);
          handleAuthExpired(
            'Your session expired. Log in again to launch Lead Enricher.',
            { action: 'enricher' }
          );
          return null;
        }
        return readJson(response).then(function (body) {
          if (response.status === 402) {
            if (setLiveCredits(extractRemaining(body))) syncCreditUI();
            if (errEl) {
              errEl.textContent =
                (body && (body.error || body.message)) ||
                'Not enough credits for this enrichment batch. Top up credits to continue.';
            }
            leStarting = false;
            updateLeQuote();
            return null;
          }
          if (!response.ok) {
            throw new Error(
              (body && (body.error || body.message)) || 'HTTP ' + response.status
            );
          }
          return body || {};
        });
      })
      .then(function (body) {
        if (!body) return;

        if (setLiveCredits(extractRemaining(body))) syncCreditUI();

        const outer = body.data && typeof body.data === 'object' ? body.data : body;
        const inner = outer.data && typeof outer.data === 'object' ? outer.data : {};
        const returnedId =
          outer.job_id || outer.jobId || outer.id || inner.job_id || inner.id || '';

        state.enricherJob = {
          job_id: String(returnedId || 'enr_' + Date.now()),
          display_id: String(outer.display_id || inner.display_id || ''),
          status: String(outer.status || inner.status || 'processing').toLowerCase(),
          percent: 0,
          sites_total:
            Number(outer.sites_total || outer.total_sites || outer.row_count || 0) || sites,
          sites_checked: 0,
          active_site: '',
          download_ready: false,
          preview_rows: [],
          credits_spent: quote.credits,
          source: leSourceType,
          source_job_id: leSourceType === 'lead_job' ? String(jobId || '') : '',
          email: email,
          created_at: new Date().toISOString(),
          poll_errors: 0
        };
        saveState();

        leStarting = false;
        leFiles = [];
        closeModal(false);
        toast(
          'Lead enrichment started — ' + sites + ' website' + (sites === 1 ? '' : 's') +
            ' queued.',
          'success'
        );

        if (window.location.hash === '#enricher-results') {
          renderLeResults();
          startLePolling(state.enricherJob);
        } else {
          window.location.hash = '#enricher-results';
        }
      })
      .catch(function (err) {
        leStarting = false;
        if (errEl) {
          errEl.textContent =
            leFriendlyError(err) || 'Temporarily busy — please try again in a moment.';
        }
        updateLeQuote();
        console.warn('[LiteWork] Lead Enricher start failed.', err);
      });
  }

  /* =================== N. REVIEW MINER (WORKER #5) ====================== */
  let rwStarting = false;
  let rwFocus = 'low';
  let rwPollTimer = null;
  let rwPollInFlight = false;
  let rwPollController = null;
  let rwPollEpoch = 0;
  let rwPollStartedAt = 0;

  /* 1–3 competitors = 5 cr · 4–5 competitors = 8 cr. */
  function rwQuote(competitors) {
    const n = clamp(Number(competitors) || 0, 0, RW_TIER_2_MAX);
    let credits = 0;
    let tier = 'No competitors';
    if (n > 0) {
      if (n <= RW_TIER_1_MAX) {
        credits = RW_TIER_1_CREDITS;
        tier = '1–' + RW_TIER_1_MAX + ' competitors';
      } else {
        credits = RW_TIER_2_CREDITS;
        tier = RW_TIER_1_MAX + 1 + '–' + RW_TIER_2_MAX + ' competitors';
      }
    }
    return { count: n, credits: credits, tier: tier };
  }

  function rwCompetitors() {
    const rows = $$('#rwRows [data-rw-competitor]');
    const list = [];
    rows.forEach(function (input) {
      const value = String(input.value || '').trim();
      if (value) list.push(value);
    });
    return list;
  }

  function rwPageActive() {
    return true;
  }

  function rwIsComplete(job) {
    return (
      !!job &&
      String(job.status || '').toLowerCase() === 'completed' &&
      job.download_ready === true
    );
  }

  function rwJobFailed(job) {
    const status = String((job && job.status) || '').toLowerCase();
    return (
      status === 'failed' ||
      status === 'error' ||
      status === 'cancelled' ||
      status === 'canceled'
    );
  }

  function rwPollActive(job) {
    return !!job && !rwJobFailed(job) && !rwIsComplete(job);
  }

  function stopRwTimer() {
    rwPollEpoch += 1;
    if (rwPollTimer) {
      window.clearTimeout(rwPollTimer);
      rwPollTimer = null;
    }
    rwPollStartedAt = 0;
    if (rwPollController) {
      try {
        rwPollController.abort();
      } catch (err) {
        /* already settled */
      }
      rwPollController = null;
    }
    rwPollInFlight = false;
  }

  function setRwBadge(kind, text) {
    const badge = $('#rwStatus');
    if (!badge) return;
    badge.classList.remove('is-pending', 'is-ok', 'is-fail');
    if (kind) badge.classList.add('is-' + kind);
    const label = $('.webhook-text', badge);
    if (label) label.textContent = text;
  }

  function startRwPolling(job, force) {
    if (!job || !RW_STATUS_URL) return;
    if (!rwPageActive()) return;
    if (rwPollTimer || rwPollInFlight) return;
    if (!force && !rwPollActive(job)) return;

    rwPollStartedAt = Date.now();
    rwPollEpoch += 1;
    const epoch = rwPollEpoch;
    setRwBadge('pending', 'Working…');
    pollRwStatus(!!force, epoch);
  }

  function forceRwPollNow() {
    const job = state.reviewJob;
    if (!job || !RW_STATUS_URL) return;
    if (rwPollTimer) {
      window.clearTimeout(rwPollTimer);
      rwPollTimer = null;
    }
    if (rwPollInFlight) return;
    if (!rwPollStartedAt) rwPollStartedAt = Date.now();
    pollRwStatus(true, rwPollEpoch);
  }

  function scheduleNextRwPoll(delay, epoch) {
    if (epoch !== rwPollEpoch) return;
    if (rwPollTimer) window.clearTimeout(rwPollTimer);
    rwPollTimer = window.setTimeout(function () {
      rwPollTimer = null;
      pollRwStatus(false, epoch);
    }, Math.max(0, delay));
  }

  function ensureRwRunning() {
    const job = state.reviewJob;
    if (!job || rwJobFailed(job) || rwIsComplete(job)) return;
    if (!isLoggedIn()) return;
    startRwPolling(job);
  }

  function extractRwPreview(data) {
    if (!data || typeof data !== 'object') return [];
    const lists = [];
    const preview = data.preview;
    if (Array.isArray(preview)) {
      lists.push(preview);
    } else if (preview && typeof preview === 'object') {
      if (Array.isArray(preview.rows)) lists.push(preview.rows);
      if (Array.isArray(preview.competitors)) lists.push(preview.competitors);
      if (Array.isArray(preview.battlecard)) lists.push(preview.battlecard);
    }
    if (Array.isArray(data.preview_rows)) lists.push(data.preview_rows);
    if (Array.isArray(data.rows)) lists.push(data.rows);
    if (Array.isArray(data.competitors)) lists.push(data.competitors);
    if (Array.isArray(data.battlecard)) lists.push(data.battlecard);
    if (Array.isArray(data.results)) lists.push(data.results);

    for (let i = 0; i < lists.length; i += 1) {
      if (lists[i].length) return lists[i];
    }
    return [];
  }

  function pollRwStatus(force, expectedEpoch) {
    const job = state.reviewJob;
    if (!job || !RW_STATUS_URL) return;
    const epoch = expectedEpoch == null ? rwPollEpoch : expectedEpoch;
    if (epoch !== rwPollEpoch) return;
    if (rwPollInFlight) return;
    if (!force && !rwPollActive(job)) return;
    if (!rwPollStartedAt) rwPollStartedAt = Date.now();

    rwPollInFlight = true;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    rwPollController = controller;
    /* 12s timeout + 3-strike tolerance, same policy as the other workers. */
    const timer = controller ? window.setTimeout(function () { controller.abort(); }, 12000) : null;

    const request = fetch(RW_STATUS_URL + '?job_id=' + encodeURIComponent(job.job_id), {
      mode: 'cors',
      headers: authHeaders(),
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) {
        if (epoch !== rwPollEpoch) return null;
        if (response.status === 401) {
          stopRwTimer();
          handleAuthExpired(
            'Your session expired. Log in again to check this review mining job.',
            null
          );
          return null;
        }
        if (response.status === 402) {
          failRwJob('Insufficient credits');
          return null;
        }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data) return;
        if (epoch !== rwPollEpoch) return;
        if (typeof data !== 'object') throw new Error('Empty status response');

        if (setLiveCredits(extractRemaining(data))) syncCreditUI();

        const toNumber = function (value) {
          if (value === null || value === undefined || value === '') return null;
          const n = Number(value);
          return Number.isFinite(n) ? n : null;
        };
        const firstNumber = function () {
          for (let i = 0; i < arguments.length; i += 1) {
            const n = toNumber(arguments[i]);
            if (n !== null) return n;
          }
          return null;
        };

        const percent = toNumber(data.percent);
        if (percent !== null) job.percent = clamp(percent, 0, 100);

        const total = firstNumber(
          data.competitors_total,
          data.total_competitors,
          data.competitor_count
        );
        if (total !== null) job.competitors_total = Math.max(0, Math.floor(total));

        const mined = firstNumber(
          data.competitors_mined,
          data.mined_competitors,
          data.processed_competitors,
          data.competitors_done
        );
        if (mined !== null) job.competitors_mined = Math.max(0, Math.floor(mined));

        const reviews = firstNumber(
          data.reviews_count,
          data.total_reviews,
          data.reviews_scraped,
          data.review_count
        );
        if (reviews !== null) job.reviews_count = Math.max(0, Math.floor(reviews));

        const active = data.active_competitor || data.current_competitor || data.competitor_name;
        if (active != null) job.active_competitor = String(active);

        if (data.download_ready != null) {
          job.download_ready =
            data.download_ready === true ||
            data.download_ready === 'true' ||
            data.download_ready === 1;
        }
        if (data.email_sent != null) {
          job.email_sent = data.email_sent === true || data.email_sent === 'true';
        }

        if (data.display_id) job.display_id = String(data.display_id);

        const previewRows = extractRwPreview(data);
        if (previewRows.length) job.preview_rows = previewRows.slice(0, 100);

        const status = String(data.status || job.status || 'processing').toLowerCase();
        job.status = status;
        job.poll_errors = 0;

        if (['failed', 'error', 'cancelled', 'canceled'].indexOf(status) !== -1) {
          failRwJob(data.error ? String(data.error) : '');
          return;
        }

        if (['completed', 'complete', 'success', 'done'].indexOf(status) !== -1) {
          if (job.download_ready === true) {
            completeRwJob(true);
          } else {
            setRwBadge('pending', 'Completed — finalizing Excel…');
            saveState();
            updateRwProgress();
            renderRwTable();
          }
          return;
        }

        if (status === 'queued' || status === 'pending' || status === 'starting') {
          setRwBadge('pending', 'Working…');
        } else {
          setRwBadge(
            'pending',
            'Working · ' +
              Math.floor(clamp(Number(job.percent) || 0, 0, 100)) + '%'
          );
        }

        saveState();
        updateRwProgress();
        renderRwTable();
      })
      .catch(function (err) {
        if (epoch !== rwPollEpoch) return;

        const failures = (Number(job && job.poll_errors) || 0) + 1;
        if (job) job.poll_errors = failures;

        console.warn(
          '[LiteWork] Review Miner status check failed (' + failures + ').',
          err && err.message ? err.message : err
        );

        if (job) {
          if (failures >= 3) {
            setRwBadge('pending', 'Still working…');
          } else {
            const phase = String(job.status || '').toLowerCase();
            if (!phase || phase === 'queued' || phase === 'pending' || phase === 'starting') {
              setRwBadge('pending', 'Working…');
            }
          }
          saveState();
        }
        updateRwProgress();
      });

    /* ALWAYS release the guard and keep the setTimeout chain alive. */
    request.finally(function () {
      if (timer) window.clearTimeout(timer);
      if (rwPollController === controller) rwPollController = null;
      if (epoch !== rwPollEpoch) return;

      rwPollInFlight = false;
      const activeJob = state.reviewJob;
      if (!activeJob || !rwPollActive(activeJob)) return;

      if (!rwPollStartedAt) rwPollStartedAt = Date.now();
      if (Date.now() - rwPollStartedAt >= STATUS_POLL_WINDOW_MS) {
        setRwBadge('pending', 'Still running — click Check to refresh');
        saveState();
        updateRwProgress();
        return;
      }
      scheduleNextRwPoll(RW_POLL_MS, epoch);
    });
  }

  function renderRwResults() {
    const empty = $('#reviewEmpty');
    const main = $('#reviewMain');
    if (!empty || !main) return;

    const job = state.reviewJob;
    if (!job) {
      empty.hidden = false;
      main.hidden = true;
      return;
    }

    empty.hidden = true;
    main.hidden = false;

    const resume = $('#rwResumeId');
    if (resume) resume.value = formatJobRef(job) || '';
    const resumeBtn = $('#rwResumeBtn');
    if (resumeBtn) {
      resumeBtn.disabled = false;
      resumeBtn.removeAttribute('disabled');
      resumeBtn.setAttribute('aria-disabled', 'false');
    }

    renderRwJobSummary();
    renderRwTable();
    updateRwProgress();

    if (rwIsComplete(job)) {
      completeRwJob(true);
      return;
    }
    if (rwJobFailed(job)) {
      setRwBadge('fail', 'Job failed · ' + (job.error || job.status || 'start a new run'));
      return;
    }
    ensureRwRunning();
  }

  function renderRwJobSummary() {
    const job = state.reviewJob;
    if (!job) return;
    const meta = $('#rwJobMeta');
    const summary = $('#rwJobSummary');
    const competitors = Number(job.competitors_total) || 0;
    const credits = Number(job.credits_spent) || 0;
    const reviews = Number(job.reviews_count) || 0;

    if (meta) {
      meta.textContent = competitors
        ? competitors + ' competitor' + (competitors === 1 ? '' : 's') + ' · ' +
          reviews + ' reviews · ' + credits + ' credits'
        : 'Waiting for the first status update…';
    }

    if (summary) {
      summary.innerHTML =
        '<div class="summary-row"><dt>Competitors</dt><dd><strong>' + competitors + '</strong></dd></div>' +
        '<div class="summary-row"><dt>Mined</dt><dd>' +
        (Number(job.competitors_mined) || 0) + '</dd></div>' +
        '<div class="summary-row"><dt>Reviews</dt><dd>' + reviews + '</dd></div>' +
        '<div class="summary-row"><dt>Credits spent</dt><dd><strong>' + credits + '</strong></dd></div>' +
        '<div class="summary-row"><dt>Review focus</dt><dd>' +
        escapeHtml(job.review_focus === 'all' ? 'All reviews (1–5★)' : 'Low ratings (1–3★)') +
        '</dd></div>' +
        '<div class="summary-row"><dt>Delivery email</dt><dd>' +
        escapeHtml(job.email || accountEmail() || '—') + '</dd></div>' +
        '<div class="summary-row"><dt>Started</dt><dd>' +
        escapeHtml(job.created_at ? fmtMYT(job.created_at) : '—') + '</dd></div>' +
        '<div class="summary-row"><dt>Job ID</dt><dd><code>' +
        escapeHtml(formatJobRef(job)) + '</code></dd></div>';
    }
  }

  function updateRwProgress() {
    const job = state.reviewJob;
    if (!job) return;

    const total = Number(job.competitors_total) || 0;
    const mined = clamp(Math.floor(Number(job.competitors_mined) || 0), 0, total || 9999);
    const reviews = Math.floor(Number(job.reviews_count) || 0);
    const complete = rwIsComplete(job);
    const percent = complete
      ? 100
      : Math.floor(clamp(Number(job.percent) || 0, 0, 100));

    const fill = $('#rwRingFill');
    if (fill) fill.style.strokeDashoffset = String(RING_LENGTH - (RING_LENGTH * percent) / 100);

    const percentEl = $('#rwRingPercent');
    if (percentEl) percentEl.textContent = percent + '%';

    const countEl = $('#rwRingCount');
    if (countEl) {
      countEl.textContent =
        mined + ' / ' + (total || '—') + ' competitors mined · ' + reviews + ' reviews';
    }

    const activeEl = $('#rwRingActive');
    if (activeEl) {
      const activeName = String(job.active_competitor || '').trim();
      const phase = String(job.status || '').toLowerCase();
      const terminal =
        complete ||
        phase === 'completed' ||
        phase === 'complete' ||
        phase === 'failed' ||
        phase === 'error';
      if (activeName && !terminal) {
        activeEl.hidden = false;
        activeEl.textContent = 'Mining "' + activeName + '"…';
      } else {
        activeEl.hidden = true;
        activeEl.textContent = '';
      }
    }

    const card = $('#rwRingCard');
    if (card) card.classList.toggle('is-complete', complete);

    const downloadBtn = $('#rwDownloadBtn');
    if (downloadBtn) downloadBtn.disabled = !complete;

    const downloadTitle = $('#rwDownloadTitle');
    if (downloadTitle) {
      downloadTitle.textContent =
        complete && total
          ? 'Battlecard Excel (.xlsx) · ' + total + ' competitors'
          : 'Battlecard Excel (.xlsx)';
    }

    const downloadSub = $('#rwDownloadSub');
    if (downloadSub) {
      if (complete) downloadSub.textContent = 'Ready to download';
      else if (String(job.status || '').toLowerCase() === 'completed') {
        downloadSub.textContent = 'Finishing up…';
      } else {
        downloadSub.textContent = 'Working — safe to close this tab and return anytime.';
      }
    }

    const emailNote = $('#rwEmailNote');
    if (emailNote) {
      const email = job.email || accountEmail() || 'your delivery email';
      const sent = complete && job.email_sent === true;
      emailNote.textContent = sent
        ? '✓ Excel (.xlsx) emailed to ' + email + ' & ready to download below.'
        : 'Excel (.xlsx) will also be emailed to ' + email +
          ' when ready — safe to close this tab.';
      emailNote.classList.toggle('is-sent', sent);
    }

    const tableMeta = $('#rwTableMeta');
    if (tableMeta) {
      const count = (job.preview_rows || []).length;
      tableMeta.textContent =
        'Preview · ' + count + ' competitor' + (count === 1 ? '' : 's') +
        ' mapped · complaints, vulnerabilities & counter-pitches';
    }

    renderRwJobSummary();
  }

  function renderRwTable() {
    const table = $('#rwTable');
    if (!table || !state.reviewJob) return;
    const job = state.reviewJob;
    const rows = Array.isArray(job.preview_rows) ? job.preview_rows.slice(0, 50) : [];
    const message =
      String(job.status || '').toLowerCase() === 'completed'
        ? 'Preview unavailable — download the .xlsx for the full battlecard.'
        : 'Waiting for the first competitor battlecard…';
    renderPreviewTable(table, RW_PREVIEW_COLUMNS, rows, message);

    const pill = $('#rwPreviewPill');
    if (pill) {
      pill.textContent = rows.length + ' competitor' + (rows.length === 1 ? '' : 's');
    }
  }

  function completeRwJob(silent) {
    const job = state.reviewJob;
    if (!job) return;

    job.status = 'completed';
    job.download_ready = true;
    job.percent = 100;

    updateRwProgress();
    renderRwTable();

    stopRwTimer();
    historyState.loaded = false;
    saveState();

    setRwBadge('ok', 'Completed · .xlsx ready');
    if (!silent) toast('Review battlecard is ready to download.', 'success');
  }

  function failRwJob(reason) {
    const job = state.reviewJob;
    if (!job) return;
    job.status = 'failed';
    job.error = reason || '';
    stopRwTimer();
    saveState();
    updateRwProgress();
    setRwBadge('fail', 'Job failed · ' + (reason || 'please try again'));
  }

  function downloadRwExcel(jobId) {
    const job = state.reviewJob || {};
    const id = String(jobId || job.job_id || '').trim();
    if (!id || !RW_DOWNLOAD_URL) {
      toast('Download unlocks when your Excel is ready.', 'warn');
      return;
    }

    toast('Preparing your download…', 'info');

    fetch(RW_DOWNLOAD_URL + '?job_id=' + encodeURIComponent(id), {
      mode: 'cors',
      headers: authHeaders()
    })
      .then(function (response) {
        if (response.status === 401) {
          handleAuthExpired(
            'Your session expired. Log in again to download your battlecard.',
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
        anchor.download = 'litework-review-battlecard-' + id.replace(/[^A-Za-z0-9_-]/g, '') + '.xlsx';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 4000);
        toast('Battlecard Excel download ready.', 'success');
      })
      .catch(function (err) {
        console.warn('[LiteWork] Review Miner download failed.', err);
        toast('Could not download the battlecard Excel. Please try again.', 'warn');
      });
  }

  function openRwHistoryJob(jobId) {
    const ref = String(jobId || '').trim();
    if (!ref) return;

    stopRwTimer();
    const current = state.reviewJob;
    const known =
      findHistoryJob(historyState.review, ref) ||
      (current && String(formatJobRef(current)) === ref ? current : null);
    const id = String((known && known.job_id) || ref);
    const sameJob = !!current && String(current.job_id || '') === id;

    if (!sameJob) {
      state.reviewJob = {
        job_id: id,
        display_id: known ? String(known.display_id || '') : (ref !== id ? ref : ''),
        status: 'processing',
        percent: 0,
        competitors_total: known ? known.competitors : 0,
        competitors_mined: 0,
        reviews_count: known ? known.reviews : 0,
        active_competitor: '',
        download_ready: false,
        preview_rows: [],
        credits_spent: known ? known.credits : 0,
        review_focus: 'low',
        email: accountEmail(),
        created_at: new Date().toISOString(),
        poll_errors: 0
      };
    } else {
      current.poll_errors = 0;
      current.error = '';
      if (rwJobFailed(current)) current.status = 'processing';
    }
    saveState();

    if (currentRoute() === 'review-results') {
      renderRwResults();
      startRwPolling(state.reviewJob, true);
    } else {
      window.location.hash = '#review-results';
    }
  }

  /* ----- Review Miner configuration modal ----- */
  function rwSheetsChipsHtml() {
    return (
      '<div class="inv-cols-block">' +
      '<p class="inv-cols-title">3 Excel Sheets Included</p>' +
      '<div class="inv-chips">' +
      RW_SHEETS.map(function (label) {
        return '<span class="inv-chip">' + escapeHtml(label) + '</span>';
      }).join('') +
      '</div>' +
      '<p class="inv-chip-note">Executive Battlecard · Complaint Breakdown · Raw Reviews</p>' +
      '</div>'
    );
  }

  function updateReviewRowButtons() {
    const rows = $$('#rwRows .rw-row');
    const count = rows.length;
    rows.forEach(function (row) {
      const btn = row.querySelector('[data-rw-remove]');
      if (btn) btn.disabled = count <= 1;
    });
    const addBtn = $('#rwAddBtn');
    if (addBtn) {
      const full = count >= RW_TIER_2_MAX;
      addBtn.disabled = full;
      addBtn.textContent = full
        ? 'Maximum ' + RW_TIER_2_MAX + ' competitors'
        : '+ Add Competitor';
    }
    const hint = $('#rwCountHint');
    if (hint) hint.textContent = count + ' of ' + RW_TIER_2_MAX;
  }

  function updateReviewQuote() {
    const list = rwCompetitors();
    const quote = rwQuote(list.length);

    const availableEl = $('#rwAvailable');
    if (availableEl) availableEl.textContent = state.credits + ' Credits';

    const countEl = $('#rwCompetitorCount');
    if (countEl) {
      countEl.textContent = String(list.length);
      countEl.classList.toggle('is-zero', list.length === 0);
    }

    const tierEl = $('#rwTier');
    if (tierEl) {
      tierEl.textContent = quote.tier;
      tierEl.classList.toggle('is-zero', list.length === 0);
    }

    const costEl = $('#rwCost');
    if (costEl) costEl.textContent = quote.credits + ' Credits';

    const shortfall = quote.credits - state.credits;
    const shortEl = $('#reviewShortfall');
    if (shortEl) {
      if (list.length > 0 && shortfall > 0) {
        shortEl.hidden = false;
        shortEl.textContent =
          'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
          ' for this run. Top up credits to continue.';
      } else {
        shortEl.hidden = true;
        shortEl.textContent = '';
      }
    }

    const btn = $('#reviewStartBtn');
    if (btn) {
      btn.disabled = rwStarting || list.length === 0 || !quote.credits;
      btn.textContent = rwStarting
        ? 'Starting…'
        : 'Confirm & Spend ' + quote.credits + ' Credit' + (quote.credits === 1 ? '' : 's');
    }
  }

  function addReviewRow(value) {
    const rows = $('#rwRows');
    if (!rows) return;
    if (rows.children.length >= RW_TIER_2_MAX) {
      toast('Up to ' + RW_TIER_2_MAX + ' competitors per run.', 'warn');
      return;
    }

    const row = document.createElement('div');
    row.className = 'rw-row';
    row.innerHTML =
      '<input type="text" data-rw-competitor autocomplete="off" ' +
      'placeholder=\'e.g. "ABC Dental Clinic, Johor Bahru" or a Google Maps URL\' />' +
      '<button type="button" class="rw-remove" data-rw-remove aria-label="Remove competitor">×</button>';
    rows.appendChild(row);

    const input = row.querySelector('[data-rw-competitor]');
    if (input) {
      input.value = value || '';
      input.addEventListener('input', updateReviewQuote);
    }
    const removeBtn = row.querySelector('[data-rw-remove]');
    if (removeBtn) {
      removeBtn.addEventListener('click', function () {
        if ($$('#rwRows .rw-row').length <= 1) return;
        row.parentNode.removeChild(row);
        updateReviewRowButtons();
        updateReviewQuote();
      });
    }

    updateReviewRowButtons();
    updateReviewQuote();
    if (input && !value) input.focus();
  }

  function openReviewMinerModal() {
    if (!requireAuth({ action: 'review' })) return;

    rwStarting = false;
    rwFocus = 'low';

    openModal(
      '<h2 class="modal-title" id="modalTitle">Competitor Review Miner</h2>' +
      '<p class="modal-sub">Mine 1–5 competitors\' Google reviews into an Executive Battlecard · 5 credits (1–3 competitors) · 8 credits (4–5 competitors)</p>' +
      '<div class="calc-card modal-calc modal-calc-dark"><div class="calc-grid">' +
      '<div class="calc-cell"><span class="calc-label">Available</span>' +
      '<span class="calc-value" id="rwAvailable">' + state.credits + ' Credits</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Competitors</span>' +
      '<span class="calc-value is-zero" id="rwCompetitorCount">0</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Tier</span>' +
      '<span class="calc-value is-zero" id="rwTier">No competitors</span></div>' +
      '<div class="calc-cell calc-cell-total"><span class="calc-label">Total cost</span>' +
      '<span class="calc-value" id="rwCost">0 Credits</span></div>' +
      '</div></div>' +
      '<form class="invoice-form" id="reviewForm" novalidate>' +
      '<div class="field"><label for="reviewEmail">Delivery email</label>' +
      '<input type="email" id="reviewEmail" class="is-locked" value="' +
      escapeHtml(accountEmail()) + '" disabled tabindex="-1" /></div>' +
      '<div class="modal-section"><h3>Competitors</h3>' +
      '<span class="fine">Add 1–' + RW_TIER_2_MAX + ' names or Google Maps URLs</span></div>' +
      '<div class="rw-rows" id="rwRows"></div>' +
      '<div class="rw-add-row">' +
      '<button type="button" class="btn btn-ghost btn-sm" id="rwAddBtn">+ Add Competitor</button>' +
      '<span class="fine" id="rwCountHint">1 of ' + RW_TIER_2_MAX + '</span>' +
      '</div>' +
      '<div class="modal-section"><h3>Review focus</h3></div>' +
      '<div class="rw-focus" id="rwFocusGroup" role="radiogroup" aria-label="Review focus">' +
      '<button type="button" class="rw-focus-option is-active" data-rw-focus="low" role="radio" aria-checked="true">' +
      '<strong>Low Ratings Only (1–3★ Pain Points)</strong>' +
      '<span>Fastest path to the weaknesses rivals are already being criticised for.</span>' +
      '</button>' +
      '<button type="button" class="rw-focus-option" data-rw-focus="all" role="radio" aria-checked="false">' +
      '<strong>All Reviews (1–5★ Full SWOT)</strong>' +
      '<span>Full strengths, weaknesses, opportunities and threats per competitor.</span>' +
      '</button>' +
      '</div>' +
      '<div class="field"><label for="rwPitch">Your key advantage (optional — tailors the Sales Counter-Pitch)</label>' +
      '<input type="text" id="rwPitch" autocomplete="off" placeholder="e.g. Same-day delivery with fixed, all-in pricing" /></div>' +
      rwSheetsChipsHtml() +
      '<div class="modal-actions">' +
      '<div class="scraper-modal-error" id="reviewFormError" role="alert"></div>' +
      '<p class="scraper-shortfall" id="reviewShortfall" hidden></p>' +
      '<button type="submit" class="btn btn-activate" id="reviewStartBtn" disabled>' +
      'Confirm & Spend 0 Credits</button>' +
      '<p class="fine">Credits are deducted immediately. Processing your request — safe to close this tab and return anytime.</p>' +
      '</div>' +
      '</form>',
      true
    );

    const addBtn = $('#rwAddBtn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        addReviewRow('');
      });
    }

    const focusGroup = $('#rwFocusGroup');
    if (focusGroup) {
      focusGroup.addEventListener('click', function (event) {
        const option = event.target.closest('[data-rw-focus]');
        if (!option) return;
        rwFocus = option.getAttribute('data-rw-focus') === 'all' ? 'all' : 'low';
        $$('#rwFocusGroup [data-rw-focus]').forEach(function (btn) {
          const on = btn === option;
          btn.classList.toggle('is-active', on);
          btn.setAttribute('aria-checked', on ? 'true' : 'false');
        });
      });
    }

    const form = $('#reviewForm');
    if (form) form.addEventListener('submit', handleReviewMinerStart);

    addReviewRow('');
    updateReviewQuote();
  }

  function openReviewSheetsModal() {
    openModal(
      '<h2 class="modal-title" id="modalTitle">Review Miner — Excel Output</h2>' +
      '<p class="modal-sub">One workbook, three sheets, ready to hand to sales.</p>' +
      rwSheetsChipsHtml() +
      '<ul class="cross-list">' +
      '<li>Executive Battlecard — one row per competitor with rating, complaints, vulnerability and counter-pitch</li>' +
      '<li>Complaint Breakdown — every recurring complaint theme with frequency</li>' +
      '<li>Raw Reviews — the source reviews behind each insight</li>' +
      '</ul>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" data-modal-close>Close</button>' +
      '</div>',
      false
    );
  }

  function handleReviewMinerStart(event) {
    event.preventDefault();

    if (!isLoggedIn()) {
      requireAuth({ action: 'review' });
      return;
    }

    const errEl = $('#reviewFormError');
    const competitors = rwCompetitors();
    const quote = rwQuote(competitors.length);

    if (!competitors.length) {
      if (errEl) errEl.textContent = 'Add at least one competitor to continue.';
      return;
    }
    if (competitors.length > RW_TIER_2_MAX) {
      if (errEl) errEl.textContent = 'Maximum ' + RW_TIER_2_MAX + ' competitors per run.';
      return;
    }
    if (state.credits < quote.credits) {
      const shortfall = quote.credits - state.credits;
      if (errEl) {
        errEl.textContent =
          'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
          ' for this run. Top up credits to continue.';
      }
      return;
    }

    if (errEl) errEl.textContent = '';
    rwStarting = true;
    updateReviewQuote();

    const email = accountEmail();
    const pitchEl = $('#rwPitch');
    const pitch = pitchEl ? String(pitchEl.value || '').trim() : '';

    apiFetch(
      RW_START_URL,
      {
        method: 'POST',
        body: JSON.stringify({
          email: email,
          competitors: competitors,
          review_focus: rwFocus,
          focus: rwFocus,
          pitch_angle: pitch,
          credits: quote.credits
        })
      },
      60000
    )
      .then(function (response) {
        if (!response) return null;
        if (response.status === 401) {
          closeModal(false);
          handleAuthExpired(
            'Your session expired. Log in again to launch Review Miner.',
            { action: 'review' }
          );
          return null;
        }
        return readJson(response).then(function (body) {
          if (response.status === 402) {
            if (setLiveCredits(extractRemaining(body))) syncCreditUI();
            if (errEl) {
              errEl.textContent =
                (body && (body.error || body.message)) ||
                'Not enough credits for this run. Top up credits to continue.';
            }
            rwStarting = false;
            updateReviewQuote();
            return null;
          }
          if (!response.ok) {
            throw new Error(
              (body && (body.error || body.message)) || 'HTTP ' + response.status
            );
          }
          return body || {};
        });
      })
      .then(function (body) {
        if (!body) return;

        if (setLiveCredits(extractRemaining(body))) syncCreditUI();

        const outer = body.data && typeof body.data === 'object' ? body.data : body;
        const inner = outer.data && typeof outer.data === 'object' ? outer.data : {};
        const returnedId =
          outer.job_id || outer.jobId || outer.id || inner.job_id || inner.id || '';

        state.reviewJob = {
          job_id: String(returnedId || 'rev_' + Date.now()),
          display_id: String(outer.display_id || inner.display_id || ''),
          status: String(outer.status || inner.status || 'processing').toLowerCase(),
          percent: 0,
          competitors_total:
            Number(outer.competitors_total || outer.total_competitors || 0) ||
            competitors.length,
          competitors_mined: 0,
          reviews_count: 0,
          active_competitor: '',
          download_ready: false,
          preview_rows: [],
          credits_spent: quote.credits,
          review_focus: rwFocus,
          email: email,
          created_at: new Date().toISOString(),
          poll_errors: 0
        };
        saveState();

        rwStarting = false;
        closeModal(false);
        toast(
          'Review mining started — ' + competitors.length + ' competitor' +
            (competitors.length === 1 ? '' : 's') + ' queued.',
          'success'
        );

        if (window.location.hash === '#review-results') {
          renderRwResults();
          startRwPolling(state.reviewJob);
        } else {
          window.location.hash = '#review-results';
        }
      })
      .catch(function (err) {
        rwStarting = false;
        if (errEl) {
          errEl.textContent =
            (err && err.message ? err.message : '') ||
            'Could not start the review mining job. Please try again.';
        }
        updateReviewQuote();
        console.warn('[LiteWork] Review Miner start failed.', err);
      });
  }

  /* ================= O. PROPERTY DEAL SNIPER (WORKER #6) ================ */
  let propStarting = false;
  let propCountry = 'Malaysia';
  let propMode = 'buy';
  let propDuration = PROP_DAYS;
  let propAlertPct = 10;

  function propCreditsFor(days) {
    return Number(days) >= 14 ? PROP_CREDITS_14 : PROP_CREDITS;
  }

  function propDurationFor(job) {
    return clamp(Number(job && job.duration_days) || PROP_DAYS, 1, PROP_MAX_DAYS);
  }

  function propAlertLabel(pct) {
    const n = Number(pct);
    if (!Number.isFinite(n) || n <= 0) return 'Any New Listing';
    return '≥' + n + '% Below Median';
  }

  function propAlertShortLabel(pct) {
    const n = Number(pct);
    if (!Number.isFinite(n) || n <= 0) return 'Any new listing';
    return '≥' + n + '% below';
  }

  /* Accepts 10, '10', '10%', 'any', or 0 (any new listing). */
  function propParseThreshold(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return 10;
    const text = String(raw).toLowerCase();
    if (text.indexOf('any') !== -1) return 0;
    const n = Number(text.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : 10;
  }
  let propPollTimer = null;
  let propPollInFlight = false;
  let propPollController = null;
  let propPollEpoch = 0;
  let propPollStartedAt = 0;

  function propJobFailed(job) {
    const status = String((job && job.status) || '').toLowerCase();
    return (
      status === 'failed' ||
      status === 'error' ||
      status === 'cancelled' ||
      status === 'canceled'
    );
  }

  function propIsComplete(job) {
    if (!job || job.download_ready !== true) return false;
    const status = String(job.status || '').toLowerCase();
    return (
      status === 'completed' ||
      status === 'complete' ||
      status === 'success' ||
      status === 'active' ||
      status === 'watching'
    );
  }

  function propPollActive(job) {
    return !!job && !propJobFailed(job) && !propIsComplete(job);
  }

  function stopPropTimer() {
    propPollEpoch += 1;
    if (propPollTimer) {
      window.clearTimeout(propPollTimer);
      propPollTimer = null;
    }
    propPollStartedAt = 0;
    if (propPollController) {
      try {
        propPollController.abort();
      } catch (err) {
        /* already settled */
      }
      propPollController = null;
    }
    propPollInFlight = false;
  }

  function setPropBadge(kind, text) {
    const badge = $('#propStatus');
    if (!badge) return;
    badge.classList.remove('is-pending', 'is-ok', 'is-fail');
    if (kind) badge.classList.add('is-' + kind);
    const label = $('.webhook-text', badge);
    if (label) label.textContent = text;
  }

  function startPropPolling(job, force) {
    if (!job || !PROP_STATUS_URL) return;
    if (propPollTimer || propPollInFlight) return;
    if (!force && !propPollActive(job)) return;

    propPollStartedAt = Date.now();
    propPollEpoch += 1;
    const epoch = propPollEpoch;
    setPropBadge('pending', 'Working…');
    pollPropStatus(!!force, epoch);
  }

  function forcePropPollNow() {
    const job = state.propertyJob;
    if (!job || !PROP_STATUS_URL) return;
    if (propPollTimer) {
      window.clearTimeout(propPollTimer);
      propPollTimer = null;
    }
    if (propPollInFlight) return;
    if (!propPollStartedAt) propPollStartedAt = Date.now();
    pollPropStatus(true, propPollEpoch);
  }

  function scheduleNextPropPoll(delay, epoch) {
    if (epoch !== propPollEpoch) return;
    if (propPollTimer) window.clearTimeout(propPollTimer);
    propPollTimer = window.setTimeout(function () {
      propPollTimer = null;
      pollPropStatus(false, epoch);
    }, Math.max(0, delay));
  }

  function ensurePropRunning() {
    const job = state.propertyJob;
    if (!job || propJobFailed(job) || propIsComplete(job)) return;
    if (!isLoggedIn()) return;
    startPropPolling(job);
  }

  function extractPropPreview(data) {
    if (!data || typeof data !== 'object') return [];
    const lists = [];
    const preview = data.preview;
    if (Array.isArray(preview)) {
      lists.push(preview);
    } else if (preview && typeof preview === 'object') {
      if (Array.isArray(preview.rows)) lists.push(preview.rows);
      if (Array.isArray(preview.deals)) lists.push(preview.deals);
      if (Array.isArray(preview.listings)) lists.push(preview.listings);
    }
    if (Array.isArray(data.preview_rows)) lists.push(data.preview_rows);
    if (Array.isArray(data.rows)) lists.push(data.rows);
    if (Array.isArray(data.results)) lists.push(data.results);
    if (Array.isArray(data.deals)) lists.push(data.deals);
    if (Array.isArray(data.listings)) lists.push(data.listings);

    for (let i = 0; i < lists.length; i += 1) {
      if (lists[i].length) return lists[i];
    }
    return [];
  }

  function pollPropStatus(force, expectedEpoch) {
    const job = state.propertyJob;
    if (!job || !PROP_STATUS_URL) return;
    const epoch = expectedEpoch == null ? propPollEpoch : expectedEpoch;
    if (epoch !== propPollEpoch) return;
    if (propPollInFlight) return;
    if (!force && !propPollActive(job)) return;
    if (!propPollStartedAt) propPollStartedAt = Date.now();

    propPollInFlight = true;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    propPollController = controller;
    /* 12s timeout + 3-strike tolerance, same policy as the other workers. */
    const timer = controller
      ? window.setTimeout(function () { controller.abort(); }, 12000)
      : null;

    const request = fetch(PROP_STATUS_URL + '?job_id=' + encodeURIComponent(job.job_id), {
      mode: 'cors',
      headers: authHeaders(),
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) {
        if (epoch !== propPollEpoch) return null;
        if (response.status === 401) {
          stopPropTimer();
          handleAuthExpired(
            'Your session expired. Log in again to check this sniper watch.',
            null
          );
          return null;
        }
        if (response.status === 402) {
          failPropJob('Insufficient credits');
          return null;
        }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data) return;
        if (epoch !== propPollEpoch) return;
        if (typeof data !== 'object') throw new Error('Empty status response');

        if (setLiveCredits(extractRemaining(data))) syncCreditUI();

        const toNumber = function (value) {
          if (value === null || value === undefined || value === '') return null;
          const n = Number(value);
          return Number.isFinite(n) ? n : null;
        };
        const firstNumber = function () {
          for (let i = 0; i < arguments.length; i += 1) {
            const n = toNumber(arguments[i]);
            if (n !== null) return n;
          }
          return null;
        };

        const percent = toNumber(data.percent);
        if (percent !== null) job.percent = clamp(percent, 0, 100);

        const deals = firstNumber(
          data.unique_deals,
          data.deals_found,
          data.deals_count,
          data.listings_count,
          data.total_deals,
          data.count
        );
        if (deals !== null) job.unique_deals = Math.max(0, Math.floor(deals));

        const scanned = firstNumber(
          data.scanned,
          data.checked,
          data.listings_scanned,
          data.processed
        );
        if (scanned !== null) job.scanned = Math.max(0, Math.floor(scanned));

        const active = data.active_listing || data.current_listing || data.active_deal;
        if (active != null) job.active_listing = String(active);

        if (data.download_ready != null) {
          job.download_ready =
            data.download_ready === true ||
            data.download_ready === 'true' ||
            data.download_ready === 1;
        }
        if (data.email_sent != null) {
          job.email_sent = data.email_sent === true || data.email_sent === 'true';
        }

        const duration = firstNumber(data.duration_days, data.watch_days, data.days);
        if (duration !== null) {
          job.duration_days = clamp(Math.floor(duration), 1, PROP_MAX_DAYS);
        }
        const thresholdRaw =
          data.below_market_pct != null ? data.below_market_pct : data.alert_threshold;
        if (thresholdRaw != null) {
          job.below_market_pct = propParseThreshold(thresholdRaw);
        }
        const alerts = firstNumber(data.alerts_sent, data.alerts, data.alert_count);
        if (alerts !== null) job.alerts_sent = Math.max(0, Math.floor(alerts));
        const sniped = firstNumber(
          data.deals_sniped,
          data.deals_sniped_count,
          data.deals_alerted
        );
        if (sniped !== null) job.deals_sniped = Math.max(0, Math.floor(sniped));
        const daysLeft = firstNumber(data.days_left, data.days_remaining, data.watch_days_left);
        if (daysLeft !== null) job.days_left = Math.max(0, Math.floor(daysLeft));
        if (data.expires_at) job.expires_at = String(data.expires_at);

        if (data.display_id) job.display_id = String(data.display_id);

        const previewRows = extractPropPreview(data);
        if (previewRows.length) job.preview_rows = previewRows.slice(0, 100);

        const status = String(data.status || job.status || 'processing').toLowerCase();
        job.status = status;
        job.poll_errors = 0;

        if (['failed', 'error', 'cancelled', 'canceled'].indexOf(status) !== -1) {
          failPropJob(data.error ? String(data.error) : '');
          return;
        }

        if (
          ['completed', 'complete', 'success', 'done', 'active', 'watching'].indexOf(status) !==
          -1
        ) {
          if (job.download_ready === true) {
            completePropJob(true);
          } else {
            setPropBadge('pending', 'Completed — finalizing Excel…');
            saveState();
            updatePropProgress();
            renderPropTable();
          }
          return;
        }

        if (status === 'queued' || status === 'pending' || status === 'starting') {
          setPropBadge('pending', 'Working…');
        } else {
          setPropBadge(
            'pending',
            'Working · ' +
              Math.floor(clamp(Number(job.percent) || 0, 0, 100)) + '%'
          );
        }

        saveState();
        updatePropProgress();
        renderPropTable();
      })
      .catch(function (err) {
        if (epoch !== propPollEpoch) return;

        const failures = (Number(job && job.poll_errors) || 0) + 1;
        if (job) job.poll_errors = failures;

        console.warn(
          '[LiteWork] Property Sniper status check failed (' + failures + ').',
          err && err.message ? err.message : err
        );

        if (job) {
          if (failures >= 3) {
            setPropBadge('pending', 'Still working…');
          } else if (!job.status) {
            setPropBadge('pending', 'Working…');
          }
          saveState();
        }
        updatePropProgress();
      });

    request.finally(function () {
      if (timer) window.clearTimeout(timer);
      if (propPollController === controller) propPollController = null;
      if (epoch !== propPollEpoch) return;

      propPollInFlight = false;
      const activeJob = state.propertyJob;
      if (!activeJob || !propPollActive(activeJob)) return;

      if (!propPollStartedAt) propPollStartedAt = Date.now();
      if (Date.now() - propPollStartedAt >= STATUS_POLL_WINDOW_MS) {
        setPropBadge('pending', 'Still running — click Check to refresh');
        saveState();
        updatePropProgress();
        return;
      }
      scheduleNextPropPoll(PROP_POLL_MS, epoch);
    });
  }

  function renderPropertyResults() {
    const empty = $('#propertyEmpty');
    const main = $('#propertyMain');
    if (!empty || !main) return;

    const job = state.propertyJob;
    if (!job) {
      empty.hidden = false;
      main.hidden = true;
      return;
    }

    empty.hidden = true;
    main.hidden = false;

    const resume = $('#propResumeId');
    if (resume) resume.value = formatJobRef(job) || '';

    renderPropJobSummary();
    renderPropTable();
    updatePropProgress();

    if (propIsComplete(job)) {
      completePropJob(true);
      return;
    }
    if (propJobFailed(job)) {
      setPropBadge('fail', 'Job failed · ' + (job.error || job.status || 'start a new run'));
      return;
    }
    ensurePropRunning();
  }

  function renderPropJobSummary() {
    const job = state.propertyJob;
    if (!job) return;
    const meta = $('#propJobMeta');
    const summary = $('#propJobSummary');
    const deals = Number(job.unique_deals) || (job.preview_rows || []).length;
    const duration = propDurationFor(job);
    const credits = Number(job.credits_spent) || propCreditsFor(duration);
    const alerts = Number(job.alerts_sent) || 0;
    const sniped = Number(job.deals_sniped) || 0;
    const location =
      [job.city, job.state, job.country]
        .filter(function (part) { return !!part; })
        .join(', ') || 'MY & SG';

    if (meta) {
      meta.textContent =
        location + ' · ' + duration + '-day watch · ' + deals + ' baseline deal' +
        (deals === 1 ? '' : 's') + ' · ' + credits + ' credits';
    }

    if (summary) {
      const mode = String(job.listing_type || '').toLowerCase() === 'rent' ? 'Rent' : 'Buy';
      summary.innerHTML =
        '<div class="summary-row"><dt>Location</dt><dd>' +
        escapeHtml(location) + '</dd></div>' +
        '<div class="summary-row"><dt>Mode</dt><dd>' + escapeHtml(mode) + '</dd></div>' +
        '<div class="summary-row"><dt>Property type</dt><dd>' +
        escapeHtml(job.property_type || 'All') + '</dd></div>' +
        '<div class="summary-row"><dt>Max budget</dt><dd>' +
        escapeHtml(
          job.max_budget
            ? (job.currency || 'MYR') + ' ' +
              Number(job.max_budget).toLocaleString('en-US')
            : 'Any'
        ) + '</dd></div>' +
        '<div class="summary-row"><dt>Day-0 baseline deals</dt><dd><strong>' +
        deals + '</strong></dd></div>' +
        '<div class="summary-row"><dt>Watch duration</dt><dd>' +
        duration + ' days</dd></div>' +
        '<div class="summary-row"><dt>Alert trigger</dt><dd>' +
        escapeHtml(propAlertLabel(job.below_market_pct)) + '</dd></div>' +
        '<div class="summary-row"><dt>Alerts sent</dt><dd>' + alerts + '</dd></div>' +
        '<div class="summary-row"><dt>Deals sniped</dt><dd>' + sniped + '</dd></div>' +
        '<div class="summary-row"><dt>Credits spent</dt><dd><strong>' +
        credits + '</strong></dd></div>' +
        '<div class="summary-row"><dt>Delivery email</dt><dd>' +
        escapeHtml(job.email || accountEmail() || '—') + '</dd></div>' +
        '<div class="summary-row"><dt>Started</dt><dd>' +
        escapeHtml(job.started_at ? fmtMYT(job.started_at) : '—') + '</dd></div>' +
        '<div class="summary-row"><dt>Job ID</dt><dd><code>' +
        escapeHtml(formatJobRef(job)) + '</code></dd></div>';
    }
  }

  function updatePropProgress() {
    const job = state.propertyJob;
    if (!job) return;

    const deals = Number(job.unique_deals) || (job.preview_rows || []).length;
    const complete = propIsComplete(job);
    const percent = complete
      ? 100
      : Math.floor(clamp(Number(job.percent) || 0, 0, 100));

    const fill = $('#propRingFill');
    if (fill) fill.style.strokeDashoffset = String(RING_LENGTH - (RING_LENGTH * percent) / 100);

    const percentEl = $('#propRingPercent');
    if (percentEl) percentEl.textContent = percent + '%';

    const countEl = $('#propRingCount');
    if (countEl) {
      countEl.textContent = deals + ' baseline deal' + (deals === 1 ? '' : 's') + ' found';
    }

    const activeEl = $('#propRingActive');
    if (activeEl) {
      const activeListing = String(job.active_listing || '').trim();
      const phase = String(job.status || '').toLowerCase();
      const terminal =
        complete || phase === 'completed' || phase === 'failed' || phase === 'error';
      if (activeListing && !terminal) {
        activeEl.hidden = false;
        activeEl.textContent = 'Scanning "' + activeListing + '"…';
      } else {
        activeEl.hidden = true;
        activeEl.textContent = '';
      }
    }

    const card = $('#propRingCard');
    if (card) card.classList.toggle('is-complete', complete);

    const duration = propDurationFor(job);
    const credits = Number(job.credits_spent) || propCreditsFor(duration);
    const alertPct = Number(job.below_market_pct);
    const banner = $('#propWatchBanner');
    const bannerText = $('#propWatchBannerText');
    if (banner && bannerText) {
      banner.hidden = !complete;
      bannerText.textContent =
        'Daily 08:00 MYT watch active for ' + duration +
        ' days — we\'ll email you only when new deals drop ' +
        (alertPct > 0
          ? '≥' + alertPct + '% below market.'
          : 'below market (any new listing in budget).');
    }

    const rule = $('#propRingRule');
    if (rule) {
      rule.textContent =
        duration + ' days · ' + credits + ' credits · ' +
        propAlertLabel(job.below_market_pct);
    }

    const downloadBtn = $('#propDownloadBtn');
    if (downloadBtn) downloadBtn.disabled = !complete;

    const downloadTitle = $('#propDownloadTitle');
    if (downloadTitle) {
      downloadTitle.textContent =
        complete && deals
          ? 'Day-0 Baseline Excel (.xlsx) · ' + deals + ' deals'
          : 'Day-0 Baseline Excel (.xlsx)';
    }

    const downloadSub = $('#propDownloadSub');
    if (downloadSub) {
      if (complete) downloadSub.textContent = 'Day-0 baseline ready to download';
      else if (String(job.status || '').toLowerCase() === 'completed') {
        downloadSub.textContent = 'Finishing up…';
      } else {
        downloadSub.textContent = 'Working — safe to close this tab and return anytime.';
      }
    }

    const emailNote = $('#propEmailNote');
    if (emailNote) {
      const email = job.email || accountEmail() || 'your delivery email';
      const sent = complete && job.email_sent === true;
      emailNote.textContent = sent
        ? '✓ Day-0 baseline Excel emailed to ' + email + ' & ready to download below.'
        : 'Day-0 baseline Excel will also be emailed to ' + email +
          ' when ready — daily 08:00 MYT alerts follow automatically.';
      emailNote.classList.toggle('is-sent', sent);
    }

    const tableMeta = $('#propTableMeta');
    if (tableMeta) {
      const count = (job.preview_rows || []).length;
      tableMeta.textContent =
        'Day-0 baseline · top ' + count + ' ranked deal' + (count === 1 ? '' : 's') +
        ' · price per sqft & deal rating';
    }

    renderPropJobSummary();
  }

  function renderPropTable() {
    const table = $('#propTable');
    if (!table || !state.propertyJob) return;
    const job = state.propertyJob;
    const rows = Array.isArray(job.preview_rows) ? job.preview_rows.slice(0, 25) : [];
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');

    if (thead) {
      thead.innerHTML =
        '<tr>' +
        ['Rank', 'Property', 'City', 'Price', 'Size', 'Price/sqft', 'vs Median', 'Deal Rating', 'Source', 'View Listing']
          .map(function (label) { return '<th>' + label + '</th>'; })
          .join('') +
        '</tr>';
    }
    if (!tbody) return;

    if (!rows.length) {
      const message =
        String(job.status || '').toLowerCase() === 'completed'
          ? 'Preview unavailable — download the .xlsx for every ranked deal.'
          : 'Waiting for the first ranked deal…';
      tbody.innerHTML =
        '<tr><td colspan="10" class="table-empty">' + escapeHtml(message) + '</td></tr>';
      return;
    }

    tbody.innerHTML = rows
      .map(function (row, index) {
        const rank = previewFieldValue(row, ['rank']) || String(index + 1);
        const property =
          previewFieldValue(row, ['property', 'property_name', 'title', 'name', 'listing_title']) ||
          '—';
        const city = previewFieldValue(row, ['city', 'district', 'area', 'location']) || '—';
        const price =
          previewFieldValue(row, ['price', 'asking_price', 'monthly_rent', 'rent', 'price_text']) ||
          '—';
        const size =
          previewFieldValue(row, ['size', 'built_up', 'built_up_sqft', 'size_sqft', 'area_sqft']) ||
          '—';
        const psf =
          previewFieldValue(row, ['price_per_sqft', 'psf', 'price_psf', 'price_sqft']) || '—';
        const vs =
          previewFieldValue(row, ['vs_median', 'vs_median_percent', 'median_diff', 'vs_median_pct']) ||
          '—';
        const rating =
          previewFieldValue(row, ['deal_rating', 'rating', 'deal_score', 'score']) || '—';
        const source =
          previewFieldValue(row, ['source', 'portal', 'site', 'source_name']) || '—';
        const urlRaw = previewFieldValue(row, ['listing_url', 'url', 'link', 'property_url']);
        const link =
          urlRaw && /^https?:\/\//i.test(urlRaw)
            ? '<a class="prop-listing-link" href="' + escapeHtml(urlRaw) +
              '" target="_blank" rel="noopener noreferrer">View Listing</a>'
            : '—';

        return (
          '<tr>' +
          '<td class="cell-strong">' + escapeHtml(rank) + '</td>' +
          '<td class="cell-strong">' + escapeHtml(property) + '</td>' +
          '<td>' + escapeHtml(city) + '</td>' +
          '<td>' + escapeHtml(price) + '</td>' +
          '<td>' + escapeHtml(size) + '</td>' +
          '<td>' + escapeHtml(psf) + '</td>' +
          '<td>' + escapeHtml(vs) + '</td>' +
          '<td>' + escapeHtml(rating) + '</td>' +
          '<td>' + escapeHtml(source) + '</td>' +
          '<td>' + link + '</td>' +
          '</tr>'
        );
      })
      .join('');

    const pill = $('#propPreviewPill');
    if (pill) {
      pill.textContent = rows.length + ' deal' + (rows.length === 1 ? '' : 's');
    }
  }

  function completePropJob(silent) {
    const job = state.propertyJob;
    if (!job) return;

    job.status = 'completed';
    job.download_ready = true;
    job.percent = 100;

    updatePropProgress();
    renderPropTable();

    stopPropTimer();
    historyState.loaded = false;
    saveState();

    setPropBadge('ok', 'Day-0 baseline ready · sniper watch active');
    if (!silent) toast('Day-0 baseline Excel is ready to download.', 'success');
  }

  function failPropJob(reason) {
    const job = state.propertyJob;
    if (!job) return;
    job.status = 'failed';
    job.error = reason || '';
    stopPropTimer();
    saveState();
    updatePropProgress();
    setPropBadge('fail', 'Job failed · ' + (reason || 'please try again'));
  }

  function downloadPropExcel(jobId) {
    const job = state.propertyJob || {};
    const id = String(jobId || job.job_id || '').trim();
    if (!id || !PROP_DOWNLOAD_URL) {
      toast('Download unlocks when your Excel is ready.', 'warn');
      return;
    }

    toast('Preparing your download…', 'info');

    fetch(PROP_DOWNLOAD_URL + '?job_id=' + encodeURIComponent(id), {
      mode: 'cors',
      headers: authHeaders()
    })
      .then(function (response) {
        if (response.status === 401) {
          handleAuthExpired(
            'Your session expired. Log in again to download your deals.',
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
          'litework-property-baseline-' + id.replace(/[^A-Za-z0-9_-]/g, '') + '.xlsx';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 4000);
        toast('Day-0 baseline Excel download ready.', 'success');
      })
      .catch(function (err) {
        console.warn('[LiteWork] Property Sniper download failed.', err);
        toast('Could not download the Day-0 baseline Excel. Please try again.', 'warn');
      });
  }

  function openPropHistoryJob(jobId) {
    const ref = String(jobId || '').trim();
    if (!ref) return;

    stopPropTimer();
    const current = state.propertyJob;
    const known =
      findHistoryJob(historyState.property, ref) ||
      (current && String(formatJobRef(current)) === ref ? current : null);
    const id = String((known && known.job_id) || ref);
    const sameJob = !!current && String(current.job_id || '') === id;

    if (!sameJob) {
      state.propertyJob = {
        job_id: id,
        display_id: known ? String(known.display_id || '') : (ref !== id ? ref : ''),
        agent_id: PROP_AGENT_ID,
        status: known && known.status ? known.status : 'processing',
        percent: Number(known && known.percent) || 0,
        country: known ? known.country : '',
        state: known ? known.state : '',
        city: known ? known.city : '',
        listing_type: known ? known.listingType : '',
        unique_deals: known ? known.deals : 0,
        preview_rows: [],
        download_ready: !!(known && known.downloadReady),
        duration_days: known ? known.durationDays : PROP_DAYS,
        below_market_pct: known ? known.belowMarketPct : 10,
        alerts_sent: known ? known.alerts : 0,
        deals_sniped: known ? known.sniped : 0,
        days_left: known ? known.daysLeft : PROP_DAYS,
        expires_at: known ? known.expiresAt : '',
        credits_spent: known ? known.credits : PROP_CREDITS,
        email: accountEmail(),
        started_at: new Date().toISOString(),
        poll_errors: 0
      };
    } else {
      current.poll_errors = 0;
      current.error = '';
      if (propJobFailed(current)) current.status = 'processing';
    }
    saveState();

    if (currentRoute() === 'property-results') {
      renderPropertyResults();
      startPropPolling(state.propertyJob, true);
    } else {
      window.location.hash = '#property-results';
    }
  }

  function propStates(country) {
    const table = PROPERTY_LOCATIONS[country];
    return table && typeof table === 'object' ? Object.keys(table) : [];
  }

  function propCities(country, stateName) {
    const table = PROPERTY_LOCATIONS[country];
    const cities = table ? table[stateName] : null;
    return Array.isArray(cities) ? cities : [];
  }

  function fillPropCities(country, stateName) {
    const citySel = $('#propCity');
    if (!citySel) return;
    const cities = propCities(country, stateName);
    citySel.innerHTML = cities.length
      ? cities
          .map(function (city) {
            return '<option value="' + escapeHtml(city) + '">' + escapeHtml(city) + '</option>';
          })
          .join('')
      : '<option value="">Select a state first</option>';
    citySel.disabled = !cities.length;
  }

  function fillPropStates(country) {
    const stateSel = $('#propState');
    if (!stateSel) return;
    const states = propStates(country);
    stateSel.innerHTML = states
      .map(function (stateName) {
        return '<option value="' + escapeHtml(stateName) + '">' +
          escapeHtml(stateName) + '</option>';
      })
      .join('');
    stateSel.disabled = !states.length;
    fillPropCities(country, stateSel.value);
    updatePropQuote();
  }

  function propSelectedLocation() {
    const stateSel = $('#propState');
    const citySel = $('#propCity');
    return {
      state: stateSel ? stateSel.value : '',
      city: citySel ? citySel.value : ''
    };
  }

  function updatePropQuote() {
    const loc = propSelectedLocation();
    const currency = PROP_COUNTRY_CURRENCY[propCountry] || 'MYR';
    const credits = propCreditsFor(propDuration);
    const alertStrip =
      propAlertPct > 0 ? '≥' + propAlertPct + '% Below' : 'Any New Listing';

    const availableEl = $('#propAvailable');
    if (availableEl) availableEl.textContent = state.credits + ' Credits';

    const costEl = $('#propCost');
    if (costEl) costEl.textContent = credits + ' Credits';

    const durationEl = $('#propDurationCalc');
    if (durationEl) durationEl.textContent = propDuration + ' Days';
    const alertEl = $('#propAlertCalc');
    if (alertEl) alertEl.textContent = alertStrip;

    const currencyEl = $('#propCurrency');
    if (currencyEl) currencyEl.textContent = currency;
    const currencyBadge = $('#propCurrencyBadge');
    if (currencyBadge) currencyBadge.textContent = currency;

    const regionEl = $('#propRegion');
    if (regionEl) {
      regionEl.textContent = loc.state
        ? propCountry + ' · ' + loc.state + (loc.city ? ' · ' + loc.city : '')
        : propCountry + ' · Select state';
    }

    const shortfall = credits - state.credits;
    const shortEl = $('#propShortfall');
    if (shortEl) {
      if (shortfall > 0) {
        shortEl.hidden = false;
        shortEl.textContent =
          'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
          ' for this launch. Top up credits to continue.';
      } else {
        shortEl.hidden = true;
        shortEl.textContent = '';
      }
    }

    const btn = $('#propStartBtn');
    if (btn) {
      btn.disabled = propStarting || !loc.state || !loc.city;
      btn.textContent = propStarting
        ? 'Starting…'
        : 'Confirm & Spend ' + credits + ' Credits · Start ' +
          propDuration + '-Day Sniper';
    }
  }

  function openPropertyModal() {
    if (!requireAuth({ action: 'property' })) return;

    propStarting = false;
    propCountry = 'Malaysia';
    propMode = 'buy';
    propDuration = PROP_DAYS;
    propAlertPct = 10;

    openModal(
      '<h2 class="modal-title" id="modalTitle">Property Deal Sniper (MY & SG)</h2>' +
      '<p class="modal-sub">Runs an instant market baseline Excel today, then watches MY & SG portals every morning at 08:00 MYT — emailing you only when a brand-new unit drops below market median.</p>' +
      '<div class="calc-card modal-calc modal-calc-dark"><div class="calc-grid">' +
      '<div class="calc-cell"><span class="calc-label">Available</span>' +
      '<span class="calc-value" id="propAvailable">' + state.credits + ' Credits</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Duration</span>' +
      '<span class="calc-value" id="propDurationCalc">' + PROP_DAYS + ' Days</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Alert</span>' +
      '<span class="calc-value" id="propAlertCalc">≥10% Below</span></div>' +
      '<div class="calc-cell calc-cell-total"><span class="calc-label">Total cost</span>' +
      '<span class="calc-value" id="propCost">' + PROP_CREDITS + ' Credits</span></div>' +
      '</div></div>' +
      '<form class="invoice-form" id="propertyForm" novalidate>' +
      '<div class="field"><label for="propEmail">Delivery email</label>' +
      '<input type="email" id="propEmail" class="is-locked" value="' +
      escapeHtml(accountEmail()) + '" disabled tabindex="-1" /></div>' +
      '<div class="modal-section"><h3>Country</h3>' +
      '<span class="fine">MYR / SGD switches automatically</span></div>' +
      '<div class="prop-country" id="propCountryGroup">' +
      '<button type="button" class="prop-pill is-active" data-prop-country="Malaysia">' +
      'Malaysia<small>MYR listings</small></button>' +
      '<button type="button" class="prop-pill" data-prop-country="Singapore">' +
      'Singapore<small>SGD listings</small></button>' +
      '</div>' +
      '<div class="modal-section"><h3>Location</h3>' +
      '<span class="fine">Country → State / Region → City / District</span></div>' +
      '<div class="prop-location-grid">' +
      '<div class="field"><label for="propState">State / Region</label>' +
      '<select id="propState"></select></div>' +
      '<div class="field"><label for="propCity">City / District</label>' +
      '<select id="propCity"></select></div>' +
      '<div class="field"><label for="propBudget">Max budget</label>' +
      '<div class="prop-budget-wrap"><span class="prop-currency" id="propCurrencyBadge">MYR</span>' +
      '<input type="number" id="propBudget" min="0" step="1000" placeholder="e.g. 500000" /></div></div>' +
      '</div>' +
      '<div class="modal-section"><h3>Deal filters</h3>' +
      '<span class="fine">Rent or buy</span></div>' +
      '<div class="prop-mode" id="propModeGroup">' +
      '<button type="button" class="prop-pill is-active" data-prop-mode="buy">' +
      'Buy<small>Purchase listings</small></button>' +
      '<button type="button" class="prop-pill" data-prop-mode="rent">' +
      'Rent<small>Monthly rental listings</small></button>' +
      '</div>' +
      '<div class="prop-location-grid">' +
      '<div class="field"><label for="propType">Property type</label>' +
      '<select id="propType">' +
      '<option value="All">All</option>' +
      '<option value="Condo / Serviced Residence">Condo / Serviced Residence</option>' +
      '<option value="Landed House">Landed House</option>' +
      '<option value="Room">Room</option>' +
      '</select></div>' +
      '<div class="field"><label for="propBeds">Min bedrooms</label>' +
      '<select id="propBeds">' +
      '<option value="">Any</option>' +
      '<option value="1">1+</option>' +
      '<option value="2">2+</option>' +
      '<option value="3">3+</option>' +
      '<option value="4">4+</option>' +
      '</select></div>' +
      '</div>' +
      '<div class="modal-section"><h3>Sniper duration</h3>' +
      '<span class="fine">Day-0 baseline is instant · daily alerts follow</span></div>' +
      '<div class="prop-mode" id="propDurationGroup">' +
      '<button type="button" class="prop-pill is-active" data-prop-days="7">' +
      '7 Days<small>5 Credits · Standard</small></button>' +
      '<button type="button" class="prop-pill" data-prop-days="14">' +
      '14 Days<small>8 Credits · Best value</small></button>' +
      '</div>' +
      '<div class="modal-section"><h3>Alert trigger threshold</h3>' +
      '<span class="fine">When should we email you?</span></div>' +
      '<div class="prop-alert-grid" id="propAlertGroup">' +
      '<button type="button" class="prop-pill is-active" data-prop-alert="10">' +
      '≥10% Below Median<small>Only true bargains</small></button>' +
      '<button type="button" class="prop-pill" data-prop-alert="5">' +
      '≥5% Below Median<small>Good deals</small></button>' +
      '<button type="button" class="prop-pill" data-prop-alert="15">' +
      '≥15% Below Median<small>Deep discounts only</small></button>' +
      '<button type="button" class="prop-pill" data-prop-alert="0">' +
      'Any New Listing<small>All new units in budget</small></button>' +
      '</div>' +
      '<div class="modal-actions">' +
      '<div class="scraper-modal-error" id="propertyFormError" role="alert"></div>' +
      '<p class="scraper-shortfall" id="propShortfall" hidden></p>' +
      '<button type="submit" class="btn btn-activate" id="propStartBtn" disabled>' +
      'Confirm & Spend ' + PROP_CREDITS + ' Credits · Start ' + PROP_DAYS +
      '-Day Sniper</button>' +
      '<p class="fine">Day-0 baseline Excel is instant. Daily 08:00 MYT alerts run automatically.</p>' +
      '</div>' +
      '</form>',
      true
    );

    const countryGroup = $('#propCountryGroup');
    if (countryGroup) {
      countryGroup.addEventListener('click', function (event) {
        const btn = event.target.closest('[data-prop-country]');
        if (!btn) return;
        propCountry = btn.getAttribute('data-prop-country') === 'Singapore'
          ? 'Singapore'
          : 'Malaysia';
        $$('#propCountryGroup [data-prop-country]').forEach(function (el) {
          el.classList.toggle('is-active', el === btn);
        });
        fillPropStates(propCountry);
      });
    }

    const modeGroup = $('#propModeGroup');
    if (modeGroup) {
      modeGroup.addEventListener('click', function (event) {
        const btn = event.target.closest('[data-prop-mode]');
        if (!btn) return;
        propMode = btn.getAttribute('data-prop-mode') === 'rent' ? 'rent' : 'buy';
        $$('#propModeGroup [data-prop-mode]').forEach(function (el) {
          el.classList.toggle('is-active', el === btn);
        });
      });
    }

    const durationGroup = $('#propDurationGroup');
    if (durationGroup) {
      durationGroup.addEventListener('click', function (event) {
        const btn = event.target.closest('[data-prop-days]');
        if (!btn) return;
        propDuration = toPositiveInt(btn.getAttribute('data-prop-days'), PROP_DAYS) >= 14
          ? 14
          : 7;
        $$('#propDurationGroup [data-prop-days]').forEach(function (el) {
          el.classList.toggle('is-active', el === btn);
        });
        updatePropQuote();
      });
    }

    const alertGroup = $('#propAlertGroup');
    if (alertGroup) {
      alertGroup.addEventListener('click', function (event) {
        const btn = event.target.closest('[data-prop-alert]');
        if (!btn) return;
        propAlertPct = propParseThreshold(btn.getAttribute('data-prop-alert'));
        $$('#propAlertGroup [data-prop-alert]').forEach(function (el) {
          el.classList.toggle('is-active', el === btn);
        });
        updatePropQuote();
      });
    }

    const stateSel = $('#propState');
    if (stateSel) {
      stateSel.addEventListener('change', function () {
        fillPropCities(propCountry, stateSel.value);
        updatePropQuote();
      });
    }
    const citySel = $('#propCity');
    if (citySel) citySel.addEventListener('change', updatePropQuote);
    const budgetEl = $('#propBudget');
    if (budgetEl) budgetEl.addEventListener('input', updatePropQuote);

    const form = $('#propertyForm');
    if (form) form.addEventListener('submit', handlePropertyStart);

    fillPropStates(propCountry);
  }

  function handlePropertyStart(event) {
    event.preventDefault();

    if (!isLoggedIn()) {
      requireAuth({ action: 'property' });
      return;
    }

    const errEl = $('#propertyFormError');
    const loc = propSelectedLocation();
    const budgetEl = $('#propBudget');
    const typeEl = $('#propType');
    const bedsEl = $('#propBeds');
    const budget = budgetEl && budgetEl.value ? Number(budgetEl.value) : 0;
    const credits = propCreditsFor(propDuration);

    if (!loc.state || !loc.city) {
      if (errEl) errEl.textContent = 'Choose a state / region and a city / district to continue.';
      return;
    }
    if (budgetEl && budgetEl.value && (!Number.isFinite(budget) || budget <= 0)) {
      if (errEl) errEl.textContent = 'Enter a valid maximum budget or leave it blank.';
      return;
    }
    if (state.credits < credits) {
      const shortfall = credits - state.credits;
      if (errEl) {
        errEl.textContent =
          'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
          ' for this sniper watch. Top up credits to continue.';
      }
      return;
    }

    if (errEl) errEl.textContent = '';
    propStarting = true;
    updatePropQuote();

    const email = accountEmail();
    const currency = PROP_COUNTRY_CURRENCY[propCountry] || 'MYR';
    const job = {
      job_id: 'prop_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      agent_id: PROP_AGENT_ID,
      country: propCountry,
      state: loc.state,
      city: loc.city,
      listing_type: propMode,
      property_type: typeEl ? typeEl.value : 'All',
      min_bedrooms: bedsEl && bedsEl.value ? Number(bedsEl.value) : null,
      max_budget: budget > 0 ? budget : null,
      currency: currency,
      max_deals: PROP_MAX_DEALS,
      duration_days: propDuration,
      below_market_pct: propAlertPct,
      alerts_sent: 0,
      deals_sniped: 0,
      days_left: propDuration,
      expires_at: new Date(Date.now() + propDuration * 86400000).toISOString(),
      credits_spent: credits,
      email: email,
      status: 'starting',
      percent: 0,
      unique_deals: 0,
      preview_rows: [],
      download_ready: false,
      started_at: new Date().toISOString(),
      poll_errors: 0
    };

    apiFetch(
      PROP_START_URL,
      {
        method: 'POST',
        body: JSON.stringify({
          job_id: job.job_id,
          agent_id: PROP_AGENT_ID,
          email: email,
          country: propCountry,
          state: loc.state,
          state_region: loc.state,
          city: loc.city,
          listing_type: propMode,
          mode: propMode,
          property_type: job.property_type,
          min_bedrooms: job.min_bedrooms,
          max_budget: job.max_budget,
          budget: job.max_budget,
          currency: currency,
          max_deals: PROP_MAX_DEALS,
          duration_days: propDuration,
          watch_days: propDuration,
          below_market_pct: propAlertPct,
          alert_threshold: propAlertLabel(propAlertPct),
          credits: credits,
          credits_spent: credits
        })
      },
      60000
    )
      .then(function (response) {
        if (!response) return null;
        if (response.status === 401) {
          propStarting = false;
          closeModal(false);
          handleAuthExpired(
            'Your session expired. Log in again to start the Property Deal Sniper.',
            { action: 'property' }
          );
          return null;
        }
        return readJson(response).then(function (body) {
          if (response.status === 402) {
            if (setLiveCredits(extractRemaining(body))) syncCreditUI();
            propStarting = false;
            if (errEl) {
              errEl.textContent =
                (body && (body.error || body.message)) ||
                'Not enough credits for this sniper watch. Top up credits to continue.';
            }
            updatePropQuote();
            return null;
          }
          if (!response.ok) {
            throw new Error(
              (body && (body.error || body.message)) || 'HTTP ' + response.status
            );
          }
          return body || {};
        });
      })
      .then(function (body) {
        if (!body) return;

        if (setLiveCredits(extractRemaining(body))) syncCreditUI();

        const outer = body.data && typeof body.data === 'object' ? body.data : body;
        const inner = outer.data && typeof outer.data === 'object' ? outer.data : {};
        const returnedId =
          outer.job_id || outer.jobId || outer.id || inner.job_id || inner.id || '';

        if (returnedId) job.job_id = String(returnedId);
        if (outer.display_id || inner.display_id) {
          job.display_id = String(outer.display_id || inner.display_id);
        }
        job.status = String(outer.status || inner.status || 'running').toLowerCase();
        if (outer.duration_days || inner.duration_days) {
          job.duration_days = toPositiveInt(
            outer.duration_days || inner.duration_days,
            job.duration_days
          );
        }
        if (outer.below_market_pct != null || inner.below_market_pct != null) {
          job.below_market_pct = propParseThreshold(
            outer.below_market_pct != null
              ? outer.below_market_pct
              : inner.below_market_pct
          );
        }
        if (outer.expires_at || inner.expires_at) {
          job.expires_at = String(outer.expires_at || inner.expires_at);
        }
        job.days_left = propDurationFor(job);

        state.propertyJob = job;
        saveState();

        propStarting = false;
        closeModal(false);
        toast(
          'Deal Sniper started — Day-0 baseline is building, daily 08:00 MYT watch active.',
          'success'
        );

        if (currentRoute() === 'property-results') {
          renderPropertyResults();
          startPropPolling(job);
        } else {
          window.location.hash = '#property-results';
        }
      })
      .catch(function (err) {
        propStarting = false;
        if (errEl) {
          errEl.textContent =
            (err && err.message ? err.message : '') ||
            'Could not start the Deal Sniper. Please try again.';
        }
        updatePropQuote();
        console.warn('[LiteWork] Property Sniper start failed.', err);
      });
  }

  /* ============ P. COMPETITOR CHANGE TRACKER (WORKER #7) ================ */
  let ctStarting = false;

  function isHttpUrl(value) {
    return /^https?:\/\/[^\s.]+\.[^\s]+/i.test(String(value || '').trim());
  }

  function ctRows() {
    const rows = [];
    $$('#ctRows [data-ct-row]').forEach(function (row) {
      const urlEl = row.querySelector('[data-ct-url]');
      const labelEl = row.querySelector('[data-ct-label]');
      const url = urlEl ? String(urlEl.value || '').trim() : '';
      if (!url) return;
      rows.push({
        url: url,
        label: labelEl ? String(labelEl.value || '').trim() : ''
      });
    });
    return rows;
  }

  function updateCtQuote() {
    const rows = ctRows();
    const valid = rows.filter(function (row) { return isHttpUrl(row.url); }).length;
    const rowCount = $$('#ctRows [data-ct-row]').length;

    const availableEl = $('#ctAvailable');
    if (availableEl) availableEl.textContent = state.credits + ' Credits';

    const countEl = $('#ctUrlCount');
    if (countEl) {
      countEl.textContent = valid + ' / ' + CT_MAX_URLS;
      countEl.classList.toggle('is-zero', valid === 0);
    }

    const totalEl = $('#ctCost');
    if (totalEl) totalEl.textContent = CT_CREDITS + ' Credits';

    const addBtn = $('#ctAddBtn');
    if (addBtn) {
      const full = rowCount >= CT_MAX_URLS;
      addBtn.disabled = full;
      addBtn.textContent = full ? 'Maximum ' + CT_MAX_URLS + ' URLs' : '+ Add URL';
    }

    const hint = $('#ctCountHint');
    if (hint) hint.textContent = rowCount + ' of ' + CT_MAX_URLS;

    const shortfall = CT_CREDITS - state.credits;
    const shortEl = $('#ctShortfall');
    if (shortEl) {
      if (valid > 0 && shortfall > 0) {
        shortEl.hidden = false;
        shortEl.textContent =
          'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
          ' for this watch. Top up credits to continue.';
      } else {
        shortEl.hidden = true;
        shortEl.textContent = '';
      }
    }

    const btn = $('#ctStartBtn');
    if (btn) {
      btn.disabled = ctStarting || valid === 0;
      btn.textContent = ctStarting
        ? 'Starting…'
        : 'Start 7-Day Watch · ' + CT_CREDITS + ' Credits';
    }
  }

  function addCtRow(url, label) {
    const rowsWrap = $('#ctRows');
    if (!rowsWrap) return;
    if ($$('#ctRows [data-ct-row]').length >= CT_MAX_URLS) {
      toast('Up to ' + CT_MAX_URLS + ' competitor URLs per watch.', 'warn');
      return;
    }

    const row = document.createElement('div');
    row.className = 'ct-row';
    row.setAttribute('data-ct-row', '');
    row.innerHTML =
      '<input type="url" data-ct-url autocomplete="off" spellcheck="false" ' +
      'placeholder="https://competitor.com/pricing" />' +
      '<input type="text" data-ct-label autocomplete="off" placeholder="Label (optional)" />' +
      '<button type="button" class="rw-remove" data-ct-remove aria-label="Remove URL">×</button>';
    rowsWrap.appendChild(row);

    const urlInput = row.querySelector('[data-ct-url]');
    const labelInput = row.querySelector('[data-ct-label]');
    if (urlInput) {
      urlInput.value = url || '';
      urlInput.addEventListener('input', updateCtQuote);
    }
    if (labelInput) {
      labelInput.value = label || '';
      labelInput.addEventListener('input', updateCtQuote);
    }
    const removeBtn = row.querySelector('[data-ct-remove]');
    if (removeBtn) {
      removeBtn.addEventListener('click', function () {
        if ($$('#ctRows [data-ct-row]').length <= 1) return;
        row.parentNode.removeChild(row);
        updateCtQuote();
      });
    }

    updateCtQuote();
    if (urlInput && !url) urlInput.focus();
  }

  function openCompetitorTrackerModal() {
    if (!requireAuth({ action: 'tracker' })) return;

    ctStarting = false;

    openModal(
      '<h2 class="modal-title" id="modalTitle">Competitor Website & Promo Change Tracker</h2>' +
      '<p class="modal-sub">Monitor up to ' + CT_MAX_URLS +
      ' competitor pages for real price, promo or copy changes · ' +
      CT_CREDITS + ' credits / ' + CT_DAYS + ' days</p>' +
      '<div class="calc-card modal-calc modal-calc-dark"><div class="calc-grid">' +
      '<div class="calc-cell"><span class="calc-label">Available</span>' +
      '<span class="calc-value" id="ctAvailable">' + state.credits + ' Credits</span></div>' +
      '<div class="calc-cell"><span class="calc-label">URLs</span>' +
      '<span class="calc-value is-zero" id="ctUrlCount">0 / ' + CT_MAX_URLS + '</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Duration</span>' +
      '<span class="calc-value">' + CT_DAYS + ' Days</span></div>' +
      '<div class="calc-cell calc-cell-total"><span class="calc-label">Total cost</span>' +
      '<span class="calc-value" id="ctCost">' + CT_CREDITS + ' Credits</span></div>' +
      '</div></div>' +
      '<form class="invoice-form" id="trackerForm" novalidate>' +
      '<div class="field"><label for="ctEmail">Delivery email</label>' +
      '<input type="email" id="ctEmail" class="is-locked" value="' +
      escapeHtml(accountEmail()) + '" disabled tabindex="-1" /></div>' +
      '<div class="modal-section"><h3>Competitor URLs</h3>' +
      '<span class="fine">1–' + CT_MAX_URLS +
      ' pages · pricing or promo pages work best</span></div>' +
      '<div class="ct-rows" id="ctRows"></div>' +
      '<div class="rw-add-row">' +
      '<button type="button" class="btn btn-ghost btn-sm" id="ctAddBtn">+ Add URL</button>' +
      '<span class="fine" id="ctCountHint">1 of ' + CT_MAX_URLS + '</span>' +
      '</div>' +
      '<div class="field"><label for="ctWatchFor">What to watch for (optional)</label>' +
      '<input type="text" id="ctWatchFor" autocomplete="off" ' +
      'placeholder="e.g. price drops, new promo codes, plan changes" /></div>' +
      '<p class="ct-note">Daily automated check for ' + CT_DAYS +
      ' days · Instant baseline confirmation email · Change alert emailed only when real text/price changes are detected.</p>' +
      '<div class="modal-actions">' +
      '<div class="scraper-modal-error" id="trackerFormError" role="alert"></div>' +
      '<p class="scraper-shortfall" id="ctShortfall" hidden></p>' +
      '<button type="submit" class="btn btn-activate" id="ctStartBtn" disabled>' +
      'Start 7-Day Watch · ' + CT_CREDITS + ' Credits</button>' +
      '<p class="fine">Credits are deducted immediately. Daily watch alerts run automatically.</p>' +
      '</div>' +
      '</form>',
      true
    );

    const addBtn = $('#ctAddBtn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        addCtRow('');
      });
    }

    const form = $('#trackerForm');
    if (form) form.addEventListener('submit', handleTrackerStart);

    addCtRow('');
  }

  function handleTrackerStart(event) {
    event.preventDefault();

    if (!isLoggedIn()) {
      requireAuth({ action: 'tracker' });
      return;
    }

    const errEl = $('#trackerFormError');
    const rows = ctRows();
    const validRows = rows.filter(function (row) { return isHttpUrl(row.url); });

    if (!rows.length) {
      if (errEl) errEl.textContent = 'Add at least one competitor URL to continue.';
      return;
    }
    if (validRows.length !== rows.length) {
      if (errEl) errEl.textContent =
        'Every competitor URL must start with http:// or https://.';
      return;
    }
    if (rows.length > CT_MAX_URLS) {
      if (errEl) errEl.textContent =
        'Maximum ' + CT_MAX_URLS + ' competitor URLs per watch.';
      return;
    }
    if (state.credits < CT_CREDITS) {
      const shortfall = CT_CREDITS - state.credits;
      if (errEl) {
        errEl.textContent =
          'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
          ' for this watch. Top up credits to continue.';
      }
      return;
    }

    if (errEl) errEl.textContent = '';
    ctStarting = true;
    updateCtQuote();

    const email = accountEmail();
    const watchEl = $('#ctWatchFor');

    apiFetch(
      CT_START_URL,
      {
        method: 'POST',
        body: JSON.stringify({
          agent_id: CT_AGENT_ID,
          email: email,
          urls: rows.map(function (row) { return row.url; }),
          targets: rows,
          url_labels: rows.map(function (row) { return row.label; }),
          watch_for: watchEl ? String(watchEl.value || '').trim() : '',
          duration_days: CT_DAYS,
          days: CT_DAYS,
          max_urls: CT_MAX_URLS,
          credits: CT_CREDITS,
          credits_spent: CT_CREDITS
        })
      },
      60000
    )
      .then(function (response) {
        if (!response) return null;
        if (response.status === 401) {
          ctStarting = false;
          closeModal(false);
          handleAuthExpired(
            'Your session expired. Log in again to start a competitor watch.',
            { action: 'tracker' }
          );
          return null;
        }
        return readJson(response).then(function (body) {
          if (response.status === 402) {
            if (setLiveCredits(extractRemaining(body))) syncCreditUI();
            ctStarting = false;
            if (errEl) {
              errEl.textContent =
                (body && (body.error || body.message)) ||
                'Not enough credits for this watch. Top up credits to continue.';
            }
            updateCtQuote();
            return null;
          }
          if (!response.ok) {
            throw new Error(
              (body && (body.error || body.message)) || 'HTTP ' + response.status
            );
          }
          return body || {};
        });
      })
      .then(function (body) {
        if (!body) return;

        if (setLiveCredits(extractRemaining(body))) syncCreditUI();

        const outer = body.data && typeof body.data === 'object' ? body.data : body;
        const inner = outer.data && typeof outer.data === 'object' ? outer.data : {};
        const watchId = String(
          outer.watch_id ||
          outer.id ||
          outer.job_id ||
          inner.watch_id ||
          inner.id ||
          inner.job_id ||
          'watch_' + Date.now()
        );
        const displayId = String(outer.display_id || inner.display_id || '');
        const expiresAt = String(
          outer.expires_at ||
          inner.expires_at ||
          new Date(Date.now() + CT_DAYS * 86400000).toISOString()
        );

        state.trackerJob = {
          job_id: watchId,
          display_id: displayId,
          agent_id: CT_AGENT_ID,
          status: 'completed',
          urls: rows.length,
          changes_detected: 0,
          credits_spent: CT_CREDITS,
          email: email,
          started_at: new Date().toISOString(),
          expires_at: expiresAt,
          days_left: CT_DAYS,
          percent: 100
        };
        activeJobIds.add(watchId);
        saveState();
        updateJobDock();
        historyState.loaded = false;

        ctStarting = false;

        const modalBody = $('#modalBody');
        if (modalBody) {
          modalBody.innerHTML =
            '<h2 class="modal-title" id="modalTitle">Your 7-day watch is live</h2>' +
            '<div class="watch-confirm">' +
            '<h3>✓ Baseline captured for ' + rows.length + ' competitor URL' +
            (rows.length === 1 ? '' : 's') + '</h3>' +
            '<p>Daily automated checks run for ' + CT_DAYS +
            ' days. A confirmation email is on its way, and you will only be alerted when real text or price changes are detected.</p>' +
            '<div class="watch-confirm-id">Watch ID <code>' +
            escapeHtml(displayId || watchId) + '</code></div>' +
            '<div class="modal-actions">' +
            '<a class="btn btn-primary" href="#plans" data-modal-close>View in Manage My Plan →</a>' +
            '</div>' +
            '</div>';
        }

        toast('Competitor watch started — baseline captured.', 'success');
      })
      .catch(function (err) {
        ctStarting = false;
        if (errEl) {
          errEl.textContent =
            (err && err.message ? err.message : '') ||
            'Could not start the competitor watch. Please try again.';
        }
        updateCtQuote();
        console.warn('[LiteWork] Competitor Tracker start failed.', err);
      });
  }

  /* ========================================================================
     WORKER #8 · WEBSITE UPTIME, SSL & BROKEN-LINK WATCHDOG
     ======================================================================== */
  let wdgStarting = false;
  let wdgThresholdMs = 3500;

  function wdgRows() {
    const rows = [];
    $$('#wdgRows [data-wdg-row]').forEach(function (row) {
      const urlEl = row.querySelector('[data-wdg-url]');
      const labelEl = row.querySelector('[data-wdg-label]');
      rows.push({
        url: urlEl ? String(urlEl.value || '').trim() : '',
        label: labelEl ? String(labelEl.value || '').trim() : ''
      });
    });
    return rows;
  }

  function wdgTotalCredits(validCount) {
    return Math.max(1, Number(validCount) || 0) * WDG_CREDITS_PER_SITE;
  }

  function updateWdgQuote() {
    const rows = wdgRows();
    const valid = rows.filter(function (row) { return isHttpUrl(row.url); }).length;
    const rowCount = $$('#wdgRows [data-wdg-row]').length;
    const totalCredits = wdgTotalCredits(valid);

    const availableEl = $('#wdgAvailable');
    if (availableEl) availableEl.textContent = state.credits + ' Credits';

    const countEl = $('#wdgSiteCount');
    if (countEl) {
      countEl.textContent = valid + ' / ' + WDG_MAX_URLS;
      countEl.classList.toggle('is-zero', valid === 0);
    }

    const totalEl = $('#wdgCost');
    if (totalEl) totalEl.textContent = totalCredits + ' Credits';

    const addBtn = $('#wdgAddBtn');
    if (addBtn) {
      const full = rowCount >= WDG_MAX_URLS;
      addBtn.disabled = full;
      addBtn.textContent = full ? 'Maximum ' + WDG_MAX_URLS + ' Sites' : '+ Add Website';
    }

    const hint = $('#wdgCountHint');
    if (hint) hint.textContent = rowCount + ' of ' + WDG_MAX_URLS;

    const shortfall = totalCredits - state.credits;
    const shortEl = $('#wdgShortfall');
    if (shortEl) {
      if (valid > 0 && shortfall > 0) {
        shortEl.hidden = false;
        shortEl.textContent =
          'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
          ' for this watchdog. Top up credits to continue.';
      } else {
        shortEl.hidden = true;
        shortEl.textContent = '';
      }
    }

    const btn = $('#wdgStartBtn');
    if (btn) {
      btn.disabled = wdgStarting || valid === 0;
      btn.textContent = wdgStarting
        ? 'Running Day-0 Health Check…'
        : 'Confirm & Spend ' + totalCredits + ' Credits · Start ' + WDG_DAYS + '-Day Watchdog';
    }
  }

  function addWdgRow(url, label) {
    const rowsWrap = $('#wdgRows');
    if (!rowsWrap) return;
    if ($$('#wdgRows [data-wdg-row]').length >= WDG_MAX_URLS) {
      toast('Up to ' + WDG_MAX_URLS + ' websites per watchdog.', 'warn');
      return;
    }

    const row = document.createElement('div');
    row.className = 'ct-row';
    row.setAttribute('data-wdg-row', '');
    row.innerHTML =
      '<input type="url" data-wdg-url autocomplete="off" spellcheck="false" ' +
      'placeholder="https://yourcompany.com" />' +
      '<input type="text" data-wdg-label autocomplete="off" placeholder="Label (e.g. Main Site, Shop)" />' +
      '<button type="button" class="rw-remove" data-wdg-remove aria-label="Remove website">×</button>';
    rowsWrap.appendChild(row);

    const urlInput = row.querySelector('[data-wdg-url]');
    const labelInput = row.querySelector('[data-wdg-label]');
    if (urlInput) {
      urlInput.value = url || '';
      urlInput.addEventListener('input', updateWdgQuote);
    }
    if (labelInput) {
      labelInput.value = label || '';
      labelInput.addEventListener('input', updateWdgQuote);
    }
    const removeBtn = row.querySelector('[data-wdg-remove]');
    if (removeBtn) {
      removeBtn.addEventListener('click', function () {
        if ($$('#wdgRows [data-wdg-row]').length <= 1) return;
        row.parentNode.removeChild(row);
        updateWdgQuote();
      });
    }

    updateWdgQuote();
    if (urlInput && !url) urlInput.focus();
  }

  function openWatchdogModal() {
    if (!requireAuth({ action: 'watchdog' })) return;

    wdgStarting = false;
    wdgThresholdMs = 3500;

    openModal(
      '<h2 class="modal-title" id="modalTitle">Website Uptime, SSL &amp; Broken-Link Watchdog</h2>' +
      '<p class="modal-sub">Daily monitoring for up to ' + WDG_MAX_URLS +
      ' live websites · ' + WDG_CREDITS_PER_SITE + ' credits per site / ' + WDG_DAYS + ' days</p>' +
      '<div class="calc-card modal-calc modal-calc-dark"><div class="calc-grid">' +
      '<div class="calc-cell"><span class="calc-label">Available</span>' +
      '<span class="calc-value" id="wdgAvailable">' + state.credits + ' Credits</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Sites</span>' +
      '<span class="calc-value is-zero" id="wdgSiteCount">0 / ' + WDG_MAX_URLS + '</span></div>' +
      '<div class="calc-cell"><span class="calc-label">Duration</span>' +
      '<span class="calc-value">' + WDG_DAYS + ' Days</span></div>' +
      '<div class="calc-cell calc-cell-total"><span class="calc-label">Total cost</span>' +
      '<span class="calc-value" id="wdgCost">' + WDG_CREDITS_PER_SITE + ' Credits</span></div>' +
      '</div></div>' +
      '<form class="invoice-form" id="watchdogForm" novalidate>' +
      '<div class="modal-section"><h3>Websites to monitor</h3>' +
      '<span class="fine">1–' + WDG_MAX_URLS + ' live URLs · ' + WDG_CREDITS_PER_SITE + ' credits / site</span></div>' +
      '<div class="ct-rows" id="wdgRows"></div>' +
      '<div class="rw-add-row">' +
      '<button type="button" class="btn btn-ghost btn-sm" id="wdgAddBtn">+ Add Website</button>' +
      '<span class="fine" id="wdgCountHint">1 of ' + WDG_MAX_URLS + '</span>' +
      '</div>' +
      '<div class="wdg-options">' +
      '<label class="wdg-check">' +
      '<input type="checkbox" id="wdgBrokenLinks" checked />' +
      '<span>Scan for broken checkout, contact &amp; WhatsApp links</span>' +
      '</label>' +
      '<div class="wdg-threshold-row">' +
      '<span class="wdg-threshold-label">Slow-load alert threshold</span>' +
      '<div class="wdg-threshold-pills" role="radiogroup" aria-label="Slow-load alert threshold">' +
      '<button type="button" class="wdg-pill is-active" data-wdg-threshold="3500" role="radio" aria-checked="true">3.5s</button>' +
      '<button type="button" class="wdg-pill" data-wdg-threshold="5000" role="radio" aria-checked="false">5s</button>' +
      '</div>' +
      '</div>' +
      '<p class="wdg-ssl-help">Monitors uptime, page speed, broken links, and SSL (your site\'s HTTPS security certificate that keeps your site trusted &amp; padlock-safe).</p>' +
      '</div>' +
      '<div class="field"><label for="wdgEmail">Delivery email</label>' +
      '<input type="email" id="wdgEmail" class="is-locked" value="' +
      escapeHtml(accountEmail()) + '" disabled tabindex="-1" /></div>' +
      '<p class="ct-note">Runs an instant Day-0 health check now, then monitors every day at 06:00 MYT for ' +
      WDG_DAYS + ' days. Alerts are emailed only when downtime, expiring SSL, slow loads, or broken links are found.</p>' +
      '<div class="modal-actions">' +
      '<div class="scraper-modal-error" id="watchdogFormError" role="alert"></div>' +
      '<p class="scraper-shortfall" id="wdgShortfall" hidden></p>' +
      '<button type="submit" class="btn btn-activate" id="wdgStartBtn" disabled>' +
      'Confirm &amp; Spend ' + WDG_CREDITS_PER_SITE + ' Credits · Start ' + WDG_DAYS + '-Day Watchdog</button>' +
      '<p class="fine">Credits are deducted immediately. Daily watchdog checks run automatically.</p>' +
      '</div>' +
      '</form>',
      true
    );

    const addBtn = $('#wdgAddBtn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        addWdgRow('');
      });
    }

    $$('[data-wdg-threshold]').forEach(function (pill) {
      pill.addEventListener('click', function () {
        wdgThresholdMs = Number(pill.getAttribute('data-wdg-threshold')) || 3500;
        $$('[data-wdg-threshold]').forEach(function (other) {
          const on = other === pill;
          other.classList.toggle('is-active', on);
          other.setAttribute('aria-checked', String(on));
        });
      });
    });

    const form = $('#watchdogForm');
    if (form) form.addEventListener('submit', handleWatchdogStart);

    addWdgRow('');
  }

  function handleWatchdogStart(event) {
    event.preventDefault();

    if (!isLoggedIn()) {
      requireAuth({ action: 'watchdog' });
      return;
    }

    const errEl = $('#watchdogFormError');
    const rows = wdgRows();
    const validRows = rows.filter(function (row) { return isHttpUrl(row.url); });

    if (!rows.length) {
      if (errEl) errEl.textContent = 'Add at least one website URL to continue.';
      return;
    }
    if (validRows.length !== rows.length) {
      if (errEl) errEl.textContent = 'Every website URL must start with http:// or https://.';
      return;
    }
    if (rows.length > WDG_MAX_URLS) {
      if (errEl) errEl.textContent = 'Maximum ' + WDG_MAX_URLS + ' websites per watchdog.';
      return;
    }

    const totalCredits = wdgTotalCredits(validRows.length);
    if (state.credits < totalCredits) {
      const shortfall = totalCredits - state.credits;
      if (errEl) {
        errEl.textContent =
          'You need ' + shortfall + ' more credit' + (shortfall === 1 ? '' : 's') +
          ' for this watchdog. Top up credits to continue.';
      }
      return;
    }

    if (errEl) errEl.textContent = '';
    wdgStarting = true;
    updateWdgQuote();

    const email = accountEmail();
    const brokenEl = $('#wdgBrokenLinks');
    const scanBrokenLinks = brokenEl ? !!brokenEl.checked : true;

    apiFetch(
      WDG_START_URL,
      {
        method: 'POST',
        body: JSON.stringify({
          agent_id: WDG_AGENT_ID,
          email: email,
          urls: rows.map(function (row) { return row.url; }),
          targets: rows,
          url_labels: rows.map(function (row) { return row.label; }),
          scan_broken_links: scanBrokenLinks,
          slow_threshold_ms: wdgThresholdMs,
          duration_days: WDG_DAYS,
          days: WDG_DAYS,
          max_urls: WDG_MAX_URLS,
          credits: totalCredits,
          credits_spent: totalCredits
        })
      },
      60000
    )
      .then(function (response) {
        if (!response) return null;
        if (response.status === 401) {
          wdgStarting = false;
          closeModal(false);
          handleAuthExpired(
            'Your session expired. Log in again to start a website watchdog.',
            { action: 'watchdog' }
          );
          return null;
        }
        return readJson(response).then(function (body) {
          if (response.status === 402) {
            if (setLiveCredits(extractRemaining(body))) syncCreditUI();
            wdgStarting = false;
            if (errEl) {
              errEl.textContent =
                (body && (body.error || body.message)) ||
                'Not enough credits for this watchdog. Top up credits to continue.';
            }
            updateWdgQuote();
            return null;
          }
          if (!response.ok) {
            throw new Error(
              (body && (body.error || body.message)) || 'HTTP ' + response.status
            );
          }
          return body || {};
        });
      })
      .then(function (body) {
        if (!body) return;

        if (setLiveCredits(extractRemaining(body))) syncCreditUI();

        const outer = body.data && typeof body.data === 'object' ? body.data : body;
        const inner = outer.data && typeof outer.data === 'object' ? outer.data : {};
        const watchId = String(
          outer.watch_id ||
          outer.id ||
          outer.job_id ||
          inner.watch_id ||
          inner.id ||
          inner.job_id ||
          'wdg_' + Date.now()
        );
        const displayId = String(outer.display_id || inner.display_id || watchId);
        const reportSites = normalizeWatchdogReport(
          outer.last_report || inner.last_report
        );
        const overallStatus = deriveWatchdogOverallStatus(
          reportSites,
          outer.last_status || inner.last_status || 'healthy'
        );
        const expiresAt = String(
          outer.expires_at ||
          inner.expires_at ||
          new Date(Date.now() + WDG_DAYS * 86400000).toISOString()
        );

        state.watchdogJob = {
          job_id: watchId,
          display_id: displayId,
          urls: rows.map(function (r) { return r.url; }),
          urls_count: Number(outer.urls_count || inner.urls_count || rows.length) || rows.length,
          credits_spent: Number(outer.credits_spent || inner.credits_spent || totalCredits) || totalCredits,
          last_status: overallStatus,
          last_report: reportSites.length
            ? reportSites
            : rows.map(function (r) {
                return {
                  url: r.url,
                  label: r.label,
                  status: overallStatus,
                  httpStatus: null,
                  responseMs: null,
                  sslDaysLeft: null,
                  brokenLinks: 0,
                  brokenList: [],
                  warnings: []
                };
              }),
          email: email,
          started_at: new Date().toISOString(),
          expires_at: expiresAt,
          days_remaining: WDG_DAYS
        };
        saveState();
        historyState.loaded = false;
        wdgStarting = false;

        closeModal(false);
        toast('Website Watchdog active — Day-0 health report ready.', 'success');

        if (currentRoute() === 'watchdog-results') {
          renderWatchdogResults();
        } else {
          window.location.hash = '#watchdog-results';
        }
      })
      .catch(function (err) {
        wdgStarting = false;
        if (errEl) {
          errEl.textContent =
            (err && err.message ? err.message : '') ||
            'Could not start the website watchdog. Please try again.';
        }
        updateWdgQuote();
        console.warn('[LiteWork] Website Watchdog start failed.', err);
      });
  }

  function renderWatchdogResults() {
    const empty = $('#watchdogEmpty');
    const main = $('#watchdogMain');
    if (!empty || !main) return;

    const job = state.watchdogJob;
    if (!job) {
      empty.hidden = false;
      main.hidden = true;
      return;
    }

    empty.hidden = true;
    main.hidden = false;

    const sites = Array.isArray(job.last_report) && job.last_report.length
      ? (typeof job.last_report[0].httpStatus !== 'undefined'
          ? job.last_report
          : normalizeWatchdogReport(job.last_report))
      : (Array.isArray(job.urls) ? job.urls : []).map(function (u) {
          return {
            url: typeof u === 'string' ? u : String((u && u.url) || ''),
            label: '',
            status: job.last_status || 'healthy',
            httpStatus: null,
            responseMs: null,
            sslDaysLeft: null,
            brokenLinks: 0,
            brokenList: [],
            warnings: []
          };
        });

    const overallStatus = deriveWatchdogOverallStatus(sites, job.last_status);
    const overallMeta = watchdogStatusMeta(overallStatus);
    const totalSites = Number(job.urls_count) || sites.length || 1;
    const creditsSpent = Number(job.credits_spent) || wdgTotalCredits(totalSites);
    const ref = job.display_id || job.job_id || '—';

    const ringCard = $('#wdgRingCard');
    if (ringCard) {
      ringCard.classList.toggle('is-complete', overallStatus === 'healthy');
      ringCard.classList.toggle('is-warning', overallStatus === 'warning');
      ringCard.classList.toggle('is-down', overallStatus === 'down');
    }

    const ringFill = $('#wdgRingFill');
    if (ringFill) ringFill.style.strokeDashoffset = '0';
    const ringPct = $('#wdgRingPercent');
    if (ringPct) ringPct.textContent = '100%';
    const ringCount = $('#wdgRingCount');
    if (ringCount) ringCount.textContent = totalSites + ' / ' + totalSites + ' sites checked · Day 0 active';

    const statusBadge = $('#wdgStatusBadge');
    if (statusBadge) {
      statusBadge.classList.remove('is-ok', 'is-fail', 'is-pending', 'is-down');
      statusBadge.classList.add(overallStatus === 'down' ? 'is-down' : overallStatus === 'warning' ? 'is-fail' : 'is-ok');
      const txt = statusBadge.querySelector('.webhook-text');
      if (txt) txt.textContent = WDG_DAYS + '-Day Watchdog Active · Daily 06:00 MYT';
    }

    const emailNote = $('#wdgEmailNote');
    if (emailNote) {
      const em = job.email || accountEmail() || 'your account email';
      emailNote.textContent =
        'Daily checks run at 06:00 MYT for ' + WDG_DAYS + ' days. Alerts are emailed to ' + em + ' only when issues appear.';
    }

    const metaEl = $('#wdgJobMeta');
    if (metaEl) metaEl.textContent = 'Reference ' + ref + ' · Checked ' + fmtMYT(job.started_at || new Date().toISOString());

    const summary = $('#wdgJobSummary');
    if (summary) {
      summary.innerHTML =
        '<div class="summary-row"><dt>Reference</dt><dd><code>' + escapeHtml(ref) + '</code></dd></div>' +
        '<div class="summary-row"><dt>Sites Monitored</dt><dd><strong>' + totalSites + ' site' + (totalSites === 1 ? '' : 's') + '</strong></dd></div>' +
        '<div class="summary-row"><dt>Credits Spent</dt><dd><strong>' + creditsSpent + ' credits</strong></dd></div>' +
        '<div class="summary-row"><dt>Schedule</dt><dd>Daily 06:00 MYT · ' + WDG_DAYS + ' Days</dd></div>' +
        '<div class="summary-row"><dt>Overall Status</dt><dd><span class="hist-badge ' + overallMeta.tone + '">' +
        escapeHtml(overallMeta.label) + '</span></dd></div>';
    }

    const pill = $('#wdgPreviewPill');
    if (pill) pill.textContent = totalSites + ' site' + (totalSites === 1 ? '' : 's');

    const tbody = $('#wdgTable tbody');
    if (tbody) {
      tbody.innerHTML = sites.length
        ? sites
            .map(function (site) {
              const meta = watchdogStatusMeta(site.status);
              const httpText = site.httpStatus !== null ? String(site.httpStatus) : '—';
              const msText = site.responseMs !== null ? site.responseMs.toLocaleString() + ' ms' : '—';
              const sslText = site.sslDaysLeft !== null ? site.sslDaysLeft + ' days' : '—';
              const reasons = watchdogSiteReasons(site);
              const issuesHtml = reasons.length
                ? '<ul class="wdg-table-issues">' +
                  reasons.map(function (r) { return '<li>' + escapeHtml(r) + '</li>'; }).join('') +
                  '</ul>'
                : '<span class="wdg-no-issues">No issues found</span>';
              return (
                '<tr>' +
                '<td class="cell-strong">' +
                escapeHtml(site.label || site.url) +
                (site.label ? '<span class="wdg-table-url">' + escapeHtml(site.url) + '</span>' : '') +
                '</td>' +
                '<td><span class="hist-badge ' + meta.tone + '">' + escapeHtml(meta.label) + '</span></td>' +
                '<td>' + escapeHtml(httpText) + '</td>' +
                '<td>' + escapeHtml(msText) + '</td>' +
                '<td>' + escapeHtml(sslText) + '</td>' +
                '<td>' + issuesHtml + '</td>' +
                '</tr>'
              );
            })
            .join('')
        : '<tr><td colspan="6">No site check details returned.</td></tr>';
    }
  }

  function openWatchdogHistoryJob(watchId) {
    const ref = String(watchId || '').trim();
    if (!ref) return;
    const known = findHistoryJob(historyState.watchdog, ref);
    if (!known) return;

    state.watchdogJob = {
      job_id: known.job_id,
      display_id: known.display_id || known.job_id,
      urls: known.urls || [],
      urls_count: known.urlsCount || (known.urls ? known.urls.length : 1),
      credits_spent: known.credits || WDG_CREDITS_PER_SITE,
      last_status: known.lastStatus,
      last_report: known.reportSites || [],
      email: accountEmail(),
      started_at: known.lastChecked || known.created || new Date().toISOString(),
      expires_at: known.expiresAt || '',
      days_remaining: known.daysLeft
    };
    saveState();

    if (currentRoute() === 'watchdog-results') {
      renderWatchdogResults();
    } else {
      window.location.hash = '#watchdog-results';
    }
  }

  /* Returning to the tab should never wait for the next 2.5s tick. */
  function resumePollingOnFocus() {
    if (document.visibilityState === 'hidden') return;
    if (scraperPollActive(state.scraperJob)) forceScraperPollNow();
    if (invoicePollActive(state.invoiceJob)) forceInvoicePollNow();
    if (lePollActive(state.enricherJob)) forceLePollNow();
    if (rwPollActive(state.reviewJob)) forceRwPollNow();
    if (propPollActive(state.propertyJob)) forcePropPollNow();
    updateJobDock();
  }

  /* ============================== INIT =================================== */
  /* All Home templates live in the DOM; only one is shown. The live output
     preview is a single node moved into the active template's mount point so
     every existing tab/render handler keeps working with zero duplication. */
  function applyHomeTemplate() {
    const templates = {
      template1: $('#homeTemplate1'),
      template2: $('#homeTemplate2'),
      template3: $('#homeTemplate3')
    };
    const active =
      templates[HOME_TEMPLATE] ||
      templates.template3 ||
      templates.template2 ||
      templates.template1;
    if (!active) return;

    Object.keys(templates).forEach(function (key) {
      if (templates[key]) {
        templates[key].hidden = templates[key] !== active;
      }
    });

    const host = $('#homePreviewHost');
    if (!host) return;

    const mount = active.querySelector('[data-home-preview-mount]');
    if (!mount || host.parentNode === mount) return;

    const first = mount.firstElementChild;
    if (first && first.classList && first.classList.contains('preview-note')) {
      mount.insertBefore(host, first);
    } else {
      mount.appendChild(host);
    }
  }

  function init() {
    const year = $('#year');
    if (year) year.textContent = String(new Date().getFullYear());

    if (!window.location.hash) {
      window.history.replaceState(null, '', '#home');
    }

    applyHomeTemplate();
    buildStockGrid();
    renderTopup();
    renderHomeBrief('NVDA');
    renderWalletSubs();
    syncCreditUI();
    updateNextBrief();
    bindEvents();
    renderAuthUI();
    bindJobDock();

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) resumePollingOnFocus();
    });

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