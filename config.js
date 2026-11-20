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
  ]
};
