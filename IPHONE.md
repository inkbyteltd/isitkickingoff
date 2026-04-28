# Running "Is It Kicking Off?" on your iPhone

The dashboard is a single self-contained `index.html` — every CSS rule, every
script, every emoji icon is inline. Nothing to install, nothing to host. You
just need to get the file onto your iPhone and open it in Safari.

## 1. Get the file onto your iPhone (pick whichever's easiest)

### Option A — AirDrop (fastest, recommended)

1. Open Finder on your Mac, navigate to the project folder
   `/Users/hal/Documents/Claude/Projects/Kicking Off/`
2. Right-click `index.html` → **Share** → **AirDrop**
3. Pick your iPhone from the AirDrop sheet
4. On the iPhone, tap **Accept** → **Save to Files**
5. Pick a location (On My iPhone → Files, or iCloud Drive)

### Option B — iCloud Drive

1. Drop `index.html` into `iCloud Drive/` on your Mac
2. Wait ~10 seconds for sync
3. Open the **Files** app on your iPhone → iCloud Drive → tap `index.html`

### Option C — Email it to yourself

1. Compose a new email, attach `index.html`, send to yourself
2. Open the email on your iPhone → tap the attachment → **Share** → **Save to Files**

## 2. Open it in Safari

1. Open the **Files** app on your iPhone
2. Navigate to where you saved `index.html`
3. **Long-press** the file → **Share** → **Open in Safari**
   (or just tap it — most iOS versions open HTML in Safari directly)

## 3. Add to Home Screen for an app-like experience (optional but recommended)

This gives you a proper full-screen launcher with a 🍺 icon — no Safari chrome,
opens like a native app.

1. With the dashboard open in Safari, tap the **Share button** (square with up-arrow)
2. Scroll down → **Add to Home Screen**
3. Name stays as "Is It Kicking Off"
4. Tap **Add**
5. The orange 🍺 icon appears on your Home Screen — tap it to launch full-screen

## 4. ⚠️ Why no live data appears on iPhone — and how to fix it

When you open the file directly from the Files app, Safari treats it as a
`file://` origin. **iOS Safari blocks ALL cross-origin fetches from
file:// pages**, regardless of the API's CORS headers — this is by design,
not a bug, and it differs from desktop Chrome which is more permissive.

So when run locally on iPhone, every "Live" data feed silently fails and
falls back to its Modelled pool. The dashboard still renders fully, but
every chip reads "Modelled" instead of "Live".

You have two ways to get live data working on the phone.

### Option A — One-click local server (recommended)

There's a `start-iphone-server.command` file in the project folder that
handles everything for you.

1. **In Finder**, double-click `start-iphone-server.command`
   (it lives in the same folder as `index.html`)
2. A Terminal window opens, prints your iPhone-ready URL, and starts the server
3. The URL will look like `http://192.168.1.42:8000/`
4. **On your iPhone, same wifi**, open Safari and go to that URL
5. Live data feeds now work — Weather, News, TfL, Football, Fuel, etc.
6. Add to Home Screen — works as long as the Terminal window stays open

**Stop the server later:** Ctrl+C in the Terminal window, or just close it.

**First-time Gatekeeper warning:** macOS might block the script the first time
with "cannot be opened because it is from an unidentified developer". If so:

- Right-click the file → **Open** → click **Open** in the warning dialog
- Or: System Settings → Privacy & Security → scroll to **"start-iphone-server.command was blocked"** → click **Open Anyway**

After approving once, double-click works forever.

### Option A (Terminal version, if Gatekeeper is being awkward)

Same outcome, no Gatekeeper involvement:

```bash
cd "/Users/hal/Documents/Claude/Projects/Kicking Off"
python3 -m http.server 8000
```

Then find your Mac's wifi IP with:

```bash
ipconfig getifaddr en0
```

And on your iPhone (same wifi) open Safari to `http://<that-ip>:8000/`.

### Option B — Permanent hosting (best long-term, free)

Push the project to GitHub, connect to **Cloudflare Pages** (free tier,
generous bandwidth, global CDN). Five-minute setup documented in
`DEPLOY.md`. You'll then get a real `https://isitkickingoff.com` URL that
works from any device, any network, with full live data. Add THAT to your
iPhone home screen and it just works forever.

## 5. What works either way (no live data needed)

Even when every live feed is blocked, these run on pure local logic and
always produce fresh values:

- Hero gauge with 7 threat tiers and 10 rotating blurbs per tier
- Hour-of-day envelope (drifts the score through the day)
- Time / day-of-week scoring
- Region filter and UK heat map
- 🍺 Wetherspoons Live with rotating featured branches
- 🫖 Nation On Kettle with morning-rush curve
- 🌭 Greggs Emergency, 🌕 Lunacy Factor (moon phase), 🏖️ Bank Holiday (hardcoded fallback)
- 📺 Telly Drama, 🛒 Checkout Rage, 🚑 A&E Pressure, 🛡️ UK Threat Level
- 🍻 Stella Artois Index + 🥙 Kebab tickers (live-ticking counters)
- 🪧 London Marches & Demos with rotating pool + seasonal events
- ⛽ Petrol prices (uses hardcoded fallback when CMA fetch is blocked)
- Westminster Polling + Leader pint-test (hardcoded indicative data)
- 7-day trend sparkline
- Social share buttons (open WhatsApp/X/Facebook etc. when tapped)

## 6. The feeds that need a real origin (option A or B)

These show "Modelled" / use evergreen fallbacks when run from `file://`:

- 🌤️ Weather — Open-Meteo
- 📰 News tension — BBC / Guardian / Sky / Daily Mail / Mirror RSS
- ⚽ Firm Factor — TheSportsDB fixture data
- 🚇 Transport Chaos — TfL Unified API
- 👑 Royal Drama — uses news RSS
- 🔍 Search Panic — Google Trends RSS (only sometimes; works occasionally)
- ⛽ Fuel Pump Rage — CMA Pump Watch retailer JSON

## 5. Troubleshooting

**"Share" buttons don't open the relevant apps.** Make sure WhatsApp,
Telegram, etc. are installed on the iPhone — the share URLs use
`api.whatsapp.com` etc. which redirect to the installed app.

**Heat map tiles don't tap.** iOS sometimes needs a short hold rather than a
quick tap. The `cursor: pointer` styling is honoured by Safari, but very
quick taps occasionally miss the click handler. Try a slightly longer press.

**Counter doesn't increment.** The Stella/Kebab tickers update once per second
via `setInterval`. iOS may pause this when the app is backgrounded — tap the
gauge to wake it up, or scroll to force a refresh.

**Add to Home Screen icon is generic.** This means your iOS version isn't
parsing the SVG `apple-touch-icon`. Replace the line in `<head>` with a
180×180 PNG hosted somewhere reachable (or accept the default).

## 6. What you can NOT do from a local file (and why hosting helps)

These features only work once the dashboard is hosted at a real URL:

- **Open Graph link previews** when you share to WhatsApp/X/etc. (requires
  publicly fetchable URL)
- **Cross-origin live API calls** with full reliability (Safari's
  file:// CORS rules are strict)
- **Daily auto-tweet** — needs the GitHub Actions cron + Twitter API
  (see AUTOTWEET.md)
- **Persistent analytics** — Plausible/Cloudflare Web Analytics need a
  real origin

For full functionality, the next step is publishing to a real domain —
see DEPLOY.md for the Cloudflare Pages instructions.
