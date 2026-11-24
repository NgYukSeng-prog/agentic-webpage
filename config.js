/* ============================================================================
   LiteWork — Centralized configuration
   ----------------------------------------------------------------------------
   This is the ONLY file you need to touch to wire the app to your backend.

   1. WEBHOOK_URL
      Point this at your n8n "subscriber" webhook endpoint. The app POSTs a
      JSON payload (event: "subscriber.activated") immediately after a user
      activates a paid subscription.
      While the endpoint is unreachable / not yet deployed, the app degrades
      gracefully: the UI flow still completes and the payload is logged in the
      console + shown as a status badge on the success page.

   2. CREDITS_PER_STOCK_WEEK
      Business rule: 5 credits buys 1 stock for 5 trading days (Mon–Fri).

   3. SUBSCRIPTION_DAYS
      Length of an activation window in calendar days.

   4. API_BASE
      Neon-backed authentication + account service. The browser stores only
      the session token (AUTH_TOKEN_KEY) and fetches live profile/credits from
      GET /auth/me on every page load.

   5. BILLING_CHECKOUT_URL
      Payment gateway endpoint. POST { pack_id } with the session bearer token.
      Returns { mode: 'live', checkout_url } when the gateway is live, or
      { mode: 'onboarding' } while bank/Airwallex verification is finalising.
      Credits are ALWAYS granted server-side — never in the browser.

   6. CREDIT_PACKS
      The 4 official USD credit packs shown on #topup.
   ========================================================================== */

window.CONFIG = {
  /* --- Backend ---------------------------------------------------------- */
  WEBHOOK_URL: 'https://claw.20.205.96.122.sslip.io/webhook/subscribe-stock-brief',

  /* --- Neon auth / account API ------------------------------------------ */
  API_BASE: 'https://n8n.20.205.96.122.sslip.io/webhook',
  AUTH_TOKEN_KEY: 'aaas_token',
  FREE_SIGNUP_CREDITS: 5,

  /* --- Billing / credit checkout ---------------------------------------- */
  BILLING_CHECKOUT_URL: 'https://n8n.20.205.96.122.sslip.io/webhook/billing/create-checkout',
  /* Manual top-up fallback while online card/bank checkout is onboarding. */
  CHECKOUT_MANUAL_EMAIL: 'group.litework@gmail.com',

  /* Google Identity Services client ID. Paste your OAuth Web client ID here.
     Leave blank to show a disabled "Continue with Google" control. */
  GOOGLE_CLIENT_ID: '87470842640-0bvtq39i9h3pg5om9ephb6sumnob6mlk.apps.googleusercontent.com',

  /* --- Pricing / credit rules ------------------------------------------- */
  CREDITS_PER_STOCK_WEEK: 5,
  SUBSCRIPTION_DAYS: 7,
  /* One stock brief = 5 market-day deliveries (Mon–Fri, weekends skipped). */
  STOCK_TRADING_DAYS: 5,
  STOCK_DELIVERY_NOTE:
    'Delivered every market morning at 07:00 MYT (skips Saturday & Sunday when US markets are closed — you always receive 5 full market-day briefs).',

  /* --- Official USD credit packs ----------------------------------------
     Clicking "Buy Pack" posts { pack_id } to BILLING_CHECKOUT_URL. */
  CREDIT_PACKS: [
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
  ],

  /* --- Delivery ---------------------------------------------------------- */
  TIMEZONE: 'Asia/Kuala_Lumpur',
  TIMEZONE_OFFSET_HOURS: 8, // MYT = UTC+8 (no DST)
  DELIVERY_HOUR_MYT: 7, // 07:00 MYT

  /* --- Identity ---------------------------------------------------------- */
  STORAGE_KEY: 'agentic.state.v1',
  AGENT_ID: 'stock-market-news-agent',
  AGENT_NAME: 'Stock Market News Agent',

  /* --- Curated universe --------------------------------------------------
     A deliberately small, liquid US equity / ETF list so the selection grid
     stays usable on a phone. Add or remove entries freely — the grid is
     generated from this array.                                          */
  SUPPORTED_STOCKS: [
    { symbol: 'NVDA', name: 'NVIDIA Corporation', tag: 'Semiconductors' },
    { symbol: 'AAPL', name: 'Apple Inc.', tag: 'Consumer Tech' },
    { symbol: 'TSLA', name: 'Tesla, Inc.', tag: 'EV & Energy' },
    { symbol: 'PLTR', name: 'Palantir Technologies', tag: 'AI Software' },
    { symbol: 'SPY', name: 'SPDR S&P 500 ETF', tag: 'Index ETF' },
    { symbol: 'MSFT', name: 'Microsoft Corporation', tag: 'Cloud & AI' },
    { symbol: 'AMZN', name: 'Amazon.com, Inc.', tag: 'E-Commerce' },
    { symbol: 'META', name: 'Meta Platforms, Inc.', tag: 'Social & AI' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', tag: 'Search & Ads' },
    { symbol: 'AMD', name: 'Advanced Micro Devices', tag: 'Semiconductors' },
    { symbol: 'QQQ', name: 'Invesco QQQ Trust', tag: 'Nasdaq-100 ETF' },
    { symbol: 'NFLX', name: 'Netflix, Inc.', tag: 'Streaming' }
  ],

  /* --- Lead Scraper Agent -----------------------------------------------
     Second live Agent-as-a-Service. 15 credits buys one 1,000-lead .xlsx
     extraction run (10 search terms). Endpoints are consumed by app.js.  */
  /* Per-term pricing: 1 search term = 50 leads = 3 credits.
     LEAD_SCRAPER_CREDITS stays as the minimum entry price (1 term). */
  LEAD_SCRAPER_CREDITS: 3,
  LEAD_SCRAPER_CREDITS_PER_TERM: 3,
  LEAD_SCRAPER_LEADS_PER_TERM: 50,
  LEAD_SCRAPER_MIN_CREDITS: 3,
  LEAD_SCRAPER_MAX_TERMS: 10,
  LEAD_SCRAPER_AGENT_ID: 'b2b-lead-scraper',
  LEAD_SCRAPER_AGENT_NAME: 'Lead Scraper Agent',
  LEAD_SCRAPER_TARGET_ROWS: 1000,
  LEAD_SCRAPER_POLL_MS: 2500,
  LEAD_SCRAPER_START_URL:
    'https://claw.20.205.96.122.sslip.io/webhook/subscribe-lead-scraper',
  LEAD_SCRAPER_STATUS_URL:
    'https://claw.20.205.96.122.sslip.io/webhook/lead-scraper-status',
  LEAD_SCRAPER_DOWNLOAD_URL:
    'https://claw.20.205.96.122.sslip.io/webhook/download-leads',

  LEAD_SCRAPER_COUNTRIES: [
    'Malaysia',
    'Singapore',
    'Indonesia',
    'Thailand',
    'Vietnam',
    'Philippines',
    'United States',
    'United Kingdom',
    'Germany',
    'Australia',
    'Japan',
    'South Korea',
    'India',
    'United Arab Emirates',
    'Canada',
    'France',
    'Netherlands',
    'Brazil',
    'Saudi Arabia',
    'Taiwan',
    'Hong Kong',
    'Other (Custom Country)'
  ],

  LEAD_SCRAPER_SAMPLE_TERMS: [
    'Precision machine manufacturer',
    'Technology company',
    'CNC machining',
    'Industrial automation supplier',
    'Software development agency',
    'Packaging manufacturer',
    'Logistics company',
    'Solar panel installer',
    'Medical device distributor',
    'Furniture manufacturer'
  ],

  /* Always exported — not toggleable. */
  LEAD_SCRAPER_REQUIRED_COLUMNS: [
    { id: 'company_name', label: 'Company Name' },
    { id: 'phone', label: 'Phone Number' }
  ],

  /* Optional extras — 1-line sublabels shown in the picker. */
  LEAD_SCRAPER_OPTIONAL_COLUMNS: [
    {
      id: 'website',
      label: 'Website URL',
      short: 'Website',
      badge: 'Highly Recommended',
      hint: 'Verify business & find extra contacts'
    },
    {
      id: 'address',
      label: 'Full Physical Address',
      short: 'Address',
      hint: 'Territory mapping & direct mail'
    },
    {
      id: 'maps_url',
      label: 'Google Maps URL',
      short: 'Maps URL',
      hint: '1-click profile, photos & map pin'
    },
    {
      id: 'rating',
      label: 'Star Rating & Review Count',
      short: 'Rating',
      hint: 'Qualify company size (e.g. 4.8 stars, 500 reviews)'
    },
    {
      id: 'category',
      label: 'Primary Category',
      short: 'Category',
      hint: 'Exact Google industry tag'
    },
    {
      id: 'hours',
      label: 'Operating Hours',
      short: 'Hours',
      hint: 'Best time for cold calls'
    }
  ],

  /* --- Invoice OCR agent -------------------------------------------------
     3rd live worker. Up to 15 files per run: 5 credits for 1–5 files,
     10 credits for 6–15 files. Uploads are sent as base64 in the POST. */
  INVOICE_OCR_AGENT_ID: 'invoice-ocr',
  INVOICE_OCR_AGENT_NAME: 'Invoice OCR Agent',
  INVOICE_OCR_TIER_1_MAX: 5,
  INVOICE_OCR_TIER_1_CREDITS: 5,
  INVOICE_OCR_TIER_2_MAX: 15,
  INVOICE_OCR_TIER_2_CREDITS: 10,
  INVOICE_OCR_MAX_FILE_MB: 10,
  INVOICE_OCR_POLL_MS: 2500,
  INVOICE_OCR_START_URL:
    'https://n8n.20.205.96.122.sslip.io/webhook/invoice-ocr-start',
  INVOICE_OCR_STATUS_URL:
    'https://n8n.20.205.96.122.sslip.io/webhook/invoice-ocr-status',
  INVOICE_OCR_DOWNLOAD_URL:
    'https://n8n.20.205.96.122.sslip.io/webhook/download-invoice-excel',
  INVOICE_OCR_ACCEPT:
    '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp',

  /* Accounting export formats. The backend writes a different .xlsx shape for
     each option, while the 21 MY/SG summary fields stay consistent. */
  INVOICE_OCR_EXPORT_FORMATS: [
    {
      id: 'standard',
      label: 'Standard LiteWork Excel',
      hint: '21-column Summary + Line Items sheets',
      subtitle: '21 MY/SG Summary Fields + Line Items Sheet',
      columns: [
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
      ],
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
  ],
  INVOICE_OCR_DEFAULT_EXPORT_FORMAT: 'standard',

  /* --- Lead Enricher agent (4th live worker) ------------------------------
     Upload an Excel/CSV list of websites (or reuse a finished Lead Scraper
     job) and get 10 extra columns back: public emails, live DNS/MX checks,
     WhatsApp + social profiles and an optional AI cold opener.
     Tier pricing: 1–50 sites = 5 cr · 51–150 = 10 cr · 151–300 = 15 cr. */
  LEAD_ENRICHER_AGENT_ID: 'website-email-lead-enricher',
  LEAD_ENRICHER_AGENT_NAME: 'Website & Email Lead Enricher',
  LEAD_ENRICHER_TIER_1_MAX: 50,
  LEAD_ENRICHER_TIER_1_CREDITS: 5,
  LEAD_ENRICHER_TIER_2_MAX: 150,
  LEAD_ENRICHER_TIER_2_CREDITS: 10,
  LEAD_ENRICHER_TIER_3_MAX: 300,
  LEAD_ENRICHER_TIER_3_CREDITS: 15,
  LEAD_ENRICHER_MAX_FILE_MB: 10,
  LEAD_ENRICHER_POLL_MS: 2500,
  LEAD_ENRICHER_START_URL:
    'https://n8n.20.205.96.122.sslip.io/webhook/lead-enricher-start',
  LEAD_ENRICHER_STATUS_URL:
    'https://n8n.20.205.96.122.sslip.io/webhook/lead-enricher-status',
  LEAD_ENRICHER_DOWNLOAD_URL:
    'https://n8n.20.205.96.122.sslip.io/webhook/download-enriched-leads',
  LEAD_ENRICHER_ACCEPT: '.xlsx,.xls,.csv',

  /* The 10 fixed columns appended to the uploaded Excel by the enricher. */
  LEAD_ENRICHER_COLUMNS: [
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
  ],

  /* --- Review Miner agent (5th live worker) ------------------------------
     Mines 1–5 competitors' Google reviews into an Executive Battlecard
     .xlsx. Tier pricing: 1–3 competitors = 5 cr · 4–5 competitors = 8 cr. */
  REVIEW_MINER_AGENT_ID: 'competitor-review-miner',
  REVIEW_MINER_AGENT_NAME: 'Competitor Review Miner',
  REVIEW_MINER_TIER_1_MAX: 3,
  REVIEW_MINER_TIER_1_CREDITS: 5,
  REVIEW_MINER_TIER_2_MAX: 5,
  REVIEW_MINER_TIER_2_CREDITS: 8,
  REVIEW_MINER_POLL_MS: 2500,
  REVIEW_MINER_START_URL:
    'https://n8n.20.205.96.122.sslip.io/webhook/review-miner-start',
  REVIEW_MINER_STATUS_URL:
    'https://n8n.20.205.96.122.sslip.io/webhook/review-miner-status',
  REVIEW_MINER_DOWNLOAD_URL:
    'https://n8n.20.205.96.122.sslip.io/webhook/download-review-battlecard',

  /* The 3 sheets written into the battlecard workbook. */
  REVIEW_MINER_SHEETS: [
    'Executive Battlecard',
    'Complaint Breakdown',
    'Raw Reviews'
  ],

  /* The 21 fixed MY/SG summary fields written to Sheet 1 of the .xlsx.
     Sheet 2 holds the itemized line items for every invoice. */
  INVOICE_OCR_COLUMNS: [
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
  ]
};
