# Agentic — Autonomous Pre-Market Intelligence

A production-ready, **zero-dependency** static SaaS web app for a marketplace of autonomous
AI agents. Built with plain HTML, CSS and vanilla JavaScript — no build step, no npm, no
framework. It deploys directly from the root of your `main` branch on GitHub Pages.

Two agents are live:

- **Stock Market News Agent** — a pay-as-you-go 07:00 MYT pre-market brief.
  `5 credits = 1 stock for 7 days`.
- **B2B Lead Scraper Agent** — up to 500 verified B2B leads from up to 10 search terms, exported
  to `.xlsx`. `1 term = 50 leads = 3 credits`, with a live circular ring scaled to the job
  target, 25-row preview and client-side demo export when the backend is offline.
======>>>>>>> REPLACE

---

## 1. What's inside

```
agentic-webpage/
├── index.html   # Seven views, glass navbar, footer, wallet widget, two animated mascots
├── styles.css   # Design tokens, mascot keyframes, progress ring, tables, responsive layout
├── config.js    # ← endpoints, credit prices, stock universe, scraper countries/columns
├── app.js       # Router, credit store, both agent flows, polling, XLSX writer
└── README.md
```

No images, fonts or scripts are loaded from third parties. Every icon, avatar, badge and the
robot mascot is inline SVG/CSS, so there are no broken image links and no external requests.

---

## 2. Run it locally

Because the app uses only relative assets, you can open `index.html` directly in a browser.
Serving it over HTTP is closer to production and avoids any `file://` quirks:

```bash
# any static server works
python -m http.server 8080
# then open http://localhost:8080
```

---

## 3. Deploy to GitHub Pages

1. Push this folder to the **root** of a GitHub repository (`main` branch).
2. In the repository go to **Settings → Pages**.
3. Under *Build and deployment*, choose **Deploy from a branch**.
4. Select branch **`main`** and folder **`/ (root)`**, then **Save**.
5. Your app is live at `https://<username>.github.io/<repo>/`.

Hash routing (`#home`, `#agents`, `#plans`, `#about`, `#configure`, `#scraper-results`,
`#success`) is used on purpose: every route is a direct link that works on GitHub Pages
without server rewrites, and the browser back/forward buttons behave exactly as users expect.
`#configure` opens the stock configuration modal over `#agents`.

> Update the footer GitHub link (`id="ghLink"` in `index.html`) to point at your own repository.

---

## 4. Wire up the backend webhook (n8n)

Open [`config.js`](config.js) and set:

```js
WEBHOOK_URL: 'https://claw.20.205.96.122.sslip.io/webhook/subscribe-stock-brief'
```

That value already points at the n8n subscriber endpoint. Replace it with your own webhook URL
when you fork the project.

When a user confirms an activation, `app.js` **immediately** `POST`s this JSON payload:

```json
{
  "event": "subscriber.activated",
  "agent_id": "stock-market-news-agent",
  "name": "Subscriber Name",
  "email": "subscriber@example.com",
  "watchlist": ["NVDA", "TSLA"],
  "duration_days": 7,
  "credits_spent": 10,
  "remaining_credits": 0,
  "timezone": "Asia/Kuala_Lumpur",
  "subscribed_at": "2026-11-19T14:50:00.000Z",
  "expires_at": "2026-11-26T14:50:00.000Z"
}
```

### Graceful fallback

If the endpoint is unreachable, CORS-blocked, or not deployed yet:

- the UI flow still completes end-to-end (credits are deducted, the subscription is saved,
  and the success page renders);
- the payload is printed to the browser console with a clear label;
- the status badge on `#success` switches to a "webhook not reachable yet" state after a
  10-second timeout.

When the live workflow responds `200` with `{ "ok": true, ... }`, the badge flips to
**"Synced with 07:00 MYT Agent"**. If n8n answers `200` but with `{ "ok": false }`, the badge
reports a rejection instead of a false success.

### Public routing & CORS (Caddy)

`../my-agent-stack/Caddyfile` proxies only the n8n webhook paths and leaves everything else on
OpenClaw:

```caddyfile
@n8n_webhook path /webhook/* /webhook-test/*
@n8n_preflight {
    method OPTIONS
    path /webhook/* /webhook-test/*
}
header @n8n_webhook {
    Access-Control-Allow-Origin "*"
    Access-Control-Allow-Methods "POST, OPTIONS"
    Access-Control-Allow-Headers "Content-Type"
    Access-Control-Max-Age "86400"
}
respond @n8n_preflight 204
reverse_proxy @n8n_webhook n8n:5678
reverse_proxy openclaw:18789   # unchanged: /hooks/* and the gateway UI
```

Apply it with:

```bash
cd ~/my-agent-stack
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

### n8n workflow branch

The **Daily US Stock Brief (SaaS / multi-tenant)** workflow has three branches:

1. **Schedule** — `Daily 07:00 MYT` → `Fetch Active Subscribers` → `User Loop` → per-ticker
   Yahoo fetch + MACD → `Wake Stock Agent` → SMTP delivery.
2. **Delivery webhook** — `POST /webhook/deliver-stock-brief` → normalize → send email.
3. **Subscriber webhook** — `POST /webhook/subscribe-stock-brief` → `Upsert Active Subscriber`
   → `Respond 200 Subscribed`. Subscribers live in `$getWorkflowStaticData('global').subscribers`
   and are read back by `Fetch Active Subscribers`, which skips expired 7-day windows.

The ready-to-paste Code-node bodies are in
`../my-agent-stack/n8n-code/upsert-active-subscriber.js` and
`../my-agent-stack/n8n-code/fetch-active-subscribers.js` (also on the server at
`~/my-agent-stack/n8n-code/`). Full node-by-node setup: `../my-agent-stack/WEBHOOK_CONNECT.md`.

### B2B Lead Scraper endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/webhook/subscribe-lead-scraper` | `POST` | Creates a job. Body: `{ job_id, agent_id, name, email, country, search_terms, selected_columns, target_rows, credits_spent }` where both values are `terms × 50` and `terms × 3` |
| `/webhook/lead-scraper-status?job_id=…` | `GET` | Returns `{ status, collected_count, preview_rows? }`; polled every 5s |
| `/webhook/download-leads?job_id=…` | `GET` | Streams the finished `.xlsx` |

**Offline fallback:** if the start call fails (CORS, 404, inactive workflow) or a status poll
fails, the job switches to `mode: "demo"`. The ring then animates smoothly in ~1% steps up to
`target_rows` (terms × 50), deterministic sample rows are generated from the chosen country and
search terms, and the download button builds a **real `.xlsx` in the browser** with exactly
`target_rows` rows (store-only ZIP + OOXML, zero dependencies). The preview table always renders
only the columns the user selected.

---

## 5. Configuration reference

| Key | Default | Meaning |
| --- | --- | --- |
| `WEBHOOK_URL` | n8n endpoint | Where `subscriber.activated` is POSTed |
| `API_BASE` | `https://n8n.20.205.96.122.sslip.io/webhook` | Neon auth/account API root |
| `AUTH_TOKEN_KEY` | `aaas_token` | localStorage key for the session token |
| `FREE_SIGNUP_CREDITS` | `5` | Credits granted by a new account |
| `GOOGLE_CLIENT_ID` | empty | Google Identity Services web client ID; empty shows a disabled Google button |
| `CREDITS_PER_STOCK_WEEK` | `5` | Credits for 1 stock × 7 days |
| `SUBSCRIPTION_DAYS` | `7` | Length of an activation window |
| `TIMEZONE` | `Asia/Kuala_Lumpur` | Payload timezone + delivery timezone |
| `TIMEZONE_OFFSET_HOURS` | `8` | Used for the live 07:00 MYT countdown |
| `DELIVERY_HOUR_MYT` | `7` | Delivery hour for the countdown |
| `STORAGE_KEY` | `agentic.state.v1` | Local job/subscription cache key |
| `AGENT_ID` / `AGENT_NAME` | stock agent | Identity in the webhook payload |
| `SUPPORTED_STOCKS` | 12 tickers | Drives the configuration grid |
| `LEAD_SCRAPER_CREDITS_PER_TERM` | `3` | Credits per search term |
| `LEAD_SCRAPER_LEADS_PER_TERM` | `50` | Leads per search term |
| `LEAD_SCRAPER_MIN_CREDITS` | `3` | Minimum credits to open the scraper |
| `LEAD_SCRAPER_MAX_TERMS` | `10` | Max terms (500 leads) |
| `LEAD_SCRAPER_CREDITS` | `3` | Legacy alias for the minimum |
| `LEAD_SCRAPER_START_URL` | n8n endpoint | `POST` job start |
| `LEAD_SCRAPER_STATUS_URL` | n8n endpoint | `GET ?job_id=` polled every 2.5s |
| `LEAD_SCRAPER_DOWNLOAD_URL` | n8n endpoint | `GET ?job_id=` for the `.xlsx` |
| `LEAD_SCRAPER_POLL_MS` | `2500` | Realtime status poll interval |
| `LEAD_SCRAPER_COUNTRIES` | 22 options | Country selector, incl. Other |
| `LEAD_SCRAPER_SAMPLE_TERMS` | 10 terms | Placeholders + Fill Sample button |
| `LEAD_SCRAPER_REQUIRED_COLUMNS` | 2 | Company, phone (always on) |
| `LEAD_SCRAPER_OPTIONAL_COLUMNS` | 6 | Website, address, maps, rating, category, hours |

Add or remove entries in `SUPPORTED_STOCKS` (`{ symbol, name, tag }`) and the selection grid
regenerates automatically. Keep the list short and liquid — it is designed to stay usable on a
360px-wide phone.

---

## 6. Credit rules (the important business logic)

- **Stock brief:** 5 credits = 1 stock for 7 days. **Lead Scraper:** 3 credits per term
  (1 term = 50 leads), with a 3-credit minimum.
- **Credits are server-authoritative (Neon).** The browser persists only
  `aaas_token` and refreshes the live profile + balance from `GET /auth/me`.
- **New accounts get 5 free credits** on sign up. Logged-out visitors can click Subscribe or
  Purchase; the Login / Sign Up modal opens and resumes the flow after authentication.
- `maxAffordableStocks = Math.floor(credits / 5)`.
- On `#agents`, both **Subscribe** buttons share the same gate:
  - logged out → enabled, opens the auth gate;
  - logged in but below the price (5 or 3 credits) → grey (`#94A3B8`), `disabled`, with a
    one-line top-up caption;
  - logged in at or above the price → vibrant red (`#DC2626`, hover `#B91C1C`), enabled.
- Stock Subscribe and `#configure` both open the stock configuration modal over `#agents`;
  Lead Scraper Subscribe opens its own matching modal. Both require a live session.
- In the stock modal the grid locks every unselected ticker (`opacity: 0.45`, `disabled`,
  tooltip *"Insufficient credits for +1 stock (needs +5 credits)"*) once
  `selectedStocks.length >= maxAffordableStocks`. Deselecting unlocks immediately.
- The scraper modal quotes live: `terms × 3` credits / `terms × 50` leads, disables Confirm at
  0 terms or when the balance is short, and shows *"Need N more credits"*.
- After an agent call, the wallet is refreshed from the response's `remaining_credits` (when
  supplied). `401` clears the session and reopens the Login modal; `402` shows an insufficient
  credits message without spending. The fixed bottom-left pill flashes a floating `+N` / `-N`
  delta, and the navbar credit badge pulses on change.

### Quick test script

| Step | Expected |
| --- | --- |
| Load the site (fresh visitor) | Navbar shows **Log In** + **Sign Up (5 Free Credits)**; pill reads **Credits: 0** |
| Click a stock or scraper **Subscribe** | Auth modal opens with *"Log in or sign up to get 5 free credits and continue."* |
| Sign up with email + password (6+ chars) | Token saved to `aaas_token`; navbar avatar + name + **Credits 5**; gated modal resumes |
| Click the navbar avatar | Account Settings shows email, credits and all 5 animated avatars |
| Pick an avatar → **Save avatar** | `POST /account/avatar` with `{ avatar_id }`; navbar avatar updates |
| Reload the page | `GET /auth/me` restores profile, credits and the saved avatar |
| Stock **Subscribe** → confirm | `POST` carries `Authorization: Bearer …`; success page; credits follow `remaining_credits` |
| Expired token (401) | Session cleared, Login modal opens with a re-login prompt |
| Server says 402 | Insufficient-credits toast, no spend, config modal stays open |

---

## 7. Persistence

Authentication persists **only** the session token:

```
localStorage["aaas_token"] = "<session token>"
```

Live identity and credits are never cached — they always come from `GET /auth/me` on load.
`agentic.state.v1` keeps only local job/bookkeeping history:

```json
{
  "subscriptions": [ { "id": "sub_…", "watchlist": ["NVDA"], "startedAt": "…", "expiresAt": "…" } ],
  "lastSubscription": { },
  "scraperJob": {
    "job_id": "lead_…",
    "country": "Malaysia",
    "search_terms": ["CNC machining"],
    "selected_columns": ["company_name", "phone", "website"],
    "collected_count": 420,
    "mode": "demo",
    "status": "running"
  }
}
```

Logging out clears the token plus the local subscription/job history. There is no demo credit
reset anymore: the server owns the wallet.

---

## 8. Accessibility & quality notes

- Keyboard reachable controls, visible focus rings, `aria-pressed` on stock cards,
  `aria-expanded` on the wallet/nav toggles, `role="dialog"` modals with Escape-to-close.
- All animation is disabled under `prefers-reduced-motion`.
- Layout verified from 360px phones up to wide desktops; the fixed credit pill is offset from
  interactive content on small screens.
- No console errors. A failed webhook request may log a network warning by design (browsers
  always surface failed fetches) — the app continues normally.

---

## 9. Demo limitations

- The checkout is a **UI simulation**: no payment gateway, no card data leaves the browser and
  nothing is charged. Swap the `Pay … (Demo)` handler for Stripe Checkout or Lemon Squeezy when
  you are ready to take real money.
- Credit balances are local to the browser. Production billing must verify credits
  server-side before writing to your database.
- Sample briefs on the home page and in the sample-output modal use illustrative prices.

---

## 10. Disclaimer

For informational and educational tracking purposes only. **Not financial advice.** Agentic
Labs is not a broker, dealer, investment adviser or fiduciary. Market data can be delayed,
incomplete or revised.
