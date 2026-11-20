/* ============================================================================
   Agentic — Centralized configuration
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
      Business rule: 5 credits buys 1 stock for 7 days.

   3. SUBSCRIPTION_DAYS
      Length of an activation window.

   4. DEFAULT_CREDITS
      New visitors start with 4 credits (one short of the 5 needed), which
      makes the "grey / disabled" subscribe state easy to demo.
   ========================================================================== */

window.CONFIG = {
  /* --- Backend ---------------------------------------------------------- */
  WEBHOOK_URL: 'https://claw.20.205.96.122.sslip.io/webhook/subscribe-stock-brief',

  /* --- Pricing / credit rules ------------------------------------------- */
  CREDITS_PER_STOCK_WEEK: 5,
  SUBSCRIPTION_DAYS: 7,
  DEFAULT_CREDITS: 4,

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

  /* --- B2B Lead Scraper agent -------------------------------------------
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
  LEAD_SCRAPER_AGENT_NAME: 'B2B Lead Scraper Agent',
  LEAD_SCRAPER_TARGET_ROWS: 1000,
  LEAD_SCRAPER_POLL_MS: 5000,
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
    { id: 'email', label: 'Email' },
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
  ]
};
