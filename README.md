# Agentic — Autonomous Pre-Market Intelligence

A production-ready, **zero-dependency** static SaaS web app for a marketplace of autonomous
financial AI agents. Built with plain HTML, CSS and vanilla JavaScript — no build step, no npm,
no framework. It deploys directly from the root of your `main` branch on GitHub Pages.

The flagship agent is the **Stock Market News Agent**: a pay-as-you-go agent that emails a
mobile-first pre-market brief every day at **07:00 MYT** (UTC+8). Credits are priced in USD
($5 = 5 credits = one stock for 7 days).

---

## 1. What's inside

```
agentic-webpage/
├── index.html   # All six views, sticky glass navbar, footer, wallet widget, SVG mascot
├── styles.css   # Design tokens, fintech dark theme, mascot animations, responsive layout
├── config.js    # ← the only file you normally need to edit (webhook URL + stock universe)
├── app.js       # Hash router, localStorage credit store, credit logic, webhook POST
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

Hash routing (`#home`, `#agents`, `#plans`, `#about`, `#configure`, `#success`) is used on
purpose: every route is a direct link that works on GitHub Pages without server rewrites, and
the browser back/forward buttons behave exactly as users expect.

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

---

## 5. Configuration reference

| Key | Default | Meaning |
| --- | --- | --- |
| `WEBHOOK_URL` | n8n endpoint | Where `subscriber.activated` is POSTed |
| `CREDITS_PER_STOCK_WEEK` | `5` | Credits for 1 stock × 7 days |
| `SUBSCRIPTION_DAYS` | `7` | Length of an activation window |
| `DEFAULT_CREDITS` | `4` | New-visitor balance (one short of a subscription) |
| `TIMEZONE` | `Asia/Kuala_Lumpur` | Payload timezone + delivery timezone |
| `TIMEZONE_OFFSET_HOURS` | `8` | Used for the live 07:00 MYT countdown |
| `DELIVERY_HOUR_MYT` | `7` | Delivery hour for the countdown |
| `STORAGE_KEY` | `agentic.state.v1` | localStorage key |
| `AGENT_ID` / `AGENT_NAME` | stock agent | Identity in the webhook payload |
| `SUPPORTED_STOCKS` | 12 tickers | Drives the configuration grid |

Add or remove entries in `SUPPORTED_STOCKS` (`{ symbol, name, tag }`) and the selection grid
regenerates automatically. Keep the list short and liquid — it is designed to stay usable on a
360px-wide phone.

---

## 6. Credit rules (the important business logic)

- **Rate:** 5 credits = 1 stock for 7 days.
- **New visitors start with 4 credits**, so the locked state is easy to demo.
- `maxAffordableStocks = Math.floor(credits / 5)`.
- On `#agents`, the **Subscribe** button is:
  - **grey** (`#94A3B8` / text `#F8FAFC`), `disabled`, `cursor: not-allowed` when `credits < 5`,
    with the caption *"Requires at least 5 credits for 7 days (1 stock). Top up in Manage My
    Plan."*;
  - **vibrant red** (`#DC2626`, hover `#B91C1C`) and navigates to `#configure` when `credits >= 5`.
- On `#configure` the grid locks every unselected ticker (`opacity: 0.45`, `disabled`,
  tooltip *"Insufficient credits for +1 stock (needs +5 credits)"*) once
  `selectedStocks.length >= maxAffordableStocks`. Deselecting unlocks immediately.
- Cost is deducted at activation and the success page shows the remaining balance, which is
  mirrored instantly in the fixed bottom-left credit pill.

### Quick test script

| Step | Expected |
| --- | --- |
| Load the site (fresh visitor) | Pill reads **Credits: 4**; Subscribe is grey + disabled |
| `#plans` → *Starter Top-Up* → **Purchase Credits (USD)** → **Pay $5.00 (Demo)** | Pill reads **9** |
| `#agents` | Subscribe turns red and is clickable |
| `#configure` | 1 stock pre-selected · calculator shows `5 Credits` · all other tickers locked at cap |
| Deselect NVDA, select TSLA + AAPL (with 9 credits only 1 slot) | Only 1 selectable — lock re-applies |
| Fill name + email → **Confirm & Spend 5 Credits (7 Days)** | Success page + pill shows **4** |
| Footer → **Demo Reset: 4 Credits** | Balance back to 4, active subscriptions cleared |

---

## 7. Persistence

State is stored in `localStorage` under `agentic.state.v1`:

```json
{
  "credits": 4,
  "email": "you@example.com",
  "name": "Alex Tan",
  "subscriptions": [ { "id": "sub_…", "watchlist": ["NVDA"], "startedAt": "…", "expiresAt": "…" } ],
  "lastSubscription": { }
}
```

A **"Demo Reset: 4 Credits"** button lives in both the wallet popover and the footer, so both
credit states (locked and unlocked) are easy to test.

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
