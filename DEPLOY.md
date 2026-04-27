# Test-deploy guide — GitHub → Cloudflare Pages

This folder is a complete test bundle for **isitkickingoff.com**. It is set up to:

- deploy as a static site to Cloudflare Pages
- block search engines from indexing it (`robots.txt` + `noindex` meta tag) so it stays private while you shake the hosting down
- apply security headers via Cloudflare's `_headers` file
- show a tasteful 404 page if anyone hits a missing URL
- show the Shop button in the nav but **greyed out, no link** (you can flick it on later)

Total size: about 0.6 MB. There are no build steps — Cloudflare just serves the HTML files as-is.

---

## What's in this folder

| File | Purpose |
|---|---|
| `index.html` | The dashboard (the main thing) |
| `news.html` | Build log / release notes |
| `snapshot.html` | Reads the most recent score from your browser's session storage |
| `shop.html` | Merch page (currently unreachable — Shop nav button is greyed out) |
| `legal.html` | Privacy · Terms · Disclaimer · Cookies · Contact |
| `404.html` | Friendly "lost the plot" page for unknown URLs |
| `robots.txt` | **Blocks all crawlers** (test-deploy only — replace before launch) |
| `_headers` | Cloudflare-applied HTTP headers (security + cache) |
| `.gitignore` | Stops macOS / editor cruft being committed |
| `DEPLOY.md` | This file |

---

## Part A — Get the files on GitHub (≈ 10 min, first-time)

You said you've never used GitHub. The friendliest path is **GitHub Desktop**, the official Mac app — no terminal needed.

### 1. Make a GitHub account
Go to https://github.com → **Sign up**. Free account is fine. Use the same email as Cloudflare so the integration is painless.

### 2. Install GitHub Desktop
https://desktop.github.com → download the Mac app → install → sign in with the account you just made.

### 3. Create the repository
In GitHub Desktop:
- **File → New repository**
- Name: `isitkickingoff` (lowercase, no spaces)
- Local path: pick somewhere outside this Cowork folder, e.g. `~/Documents/GitHub/`
- **Initialize this repository with a README**: tick it
- Git ignore: `None` (we ship our own `.gitignore`)
- **Create repository**

### 4. Drop the files in
Open the new `isitkickingoff` folder in Finder. **Copy everything from this `deploy-test/` folder into it** — `index.html`, `news.html`, etc., plus `_headers`, `robots.txt`, `.gitignore`, `404.html`, `DEPLOY.md`.

### 5. Push to GitHub
Back in GitHub Desktop you'll see all the new files in the left pane.
- At the bottom-left, summary: `Initial test deploy v0.41`
- Click **Commit to main**
- Top of the window: **Publish repository**
- Tick **Keep this code private** (recommended for the test phase — the dashboard repo is small and private repos work fine on Cloudflare Pages free tier)
- **Publish Repository**

Done. Your code is now on github.com/<your-username>/isitkickingoff.

---

## Part B — Deploy to Cloudflare Pages (≈ 5 min)

### 1. Make a Cloudflare account (free)
https://dash.cloudflare.com → sign up. Same email as GitHub if you can — it makes connection smoother.

### 2. Create the Pages project
In the Cloudflare dashboard left sidebar:
- **Workers & Pages → Create application → Pages → Connect to Git**
- Click **Connect GitHub**, authorise Cloudflare to see your repos. You can grant access to **all repos** or just `isitkickingoff` — your call.
- Pick the `isitkickingoff` repository → **Begin setup**

### 3. Build settings
This is a static site, so the settings are dead simple:
- **Project name**: `isitkickingoff` (this becomes your test URL: `isitkickingoff.pages.dev`)
- **Production branch**: `main`
- **Framework preset**: `None`
- **Build command**: *(leave blank)*
- **Build output directory**: `/` *(leave the default — root)*
- Click **Save and Deploy**

Cloudflare will do its first deploy. About 30–60 seconds. When it goes green, click the URL — your dashboard is live at `https://isitkickingoff.pages.dev`.

### 4. Verify the test deploy
Open the live URL on:
- Desktop browser (Chrome/Safari/Firefox)
- Phone (try iPhone Add-to-Home-Screen → Union Jack icon should appear)

Check that:
- ✅ The gauge loads and starts pulling live data
- ✅ Top nav: Dashboard / Snapshot / News / Buy Me a Coffee / **Shop (greyed out, not clickable)**
- ✅ Snapshot link works (open dashboard first, wait 5s, then click Snapshot)
- ✅ News link works
- ✅ Footer links: Privacy / Terms / Disclaimer / Cookies / Contact all open `legal.html`
- ✅ Hit a made-up URL like `/banana` → 404 page shows
- ✅ View page source → confirm `<meta name="robots" content="noindex,nofollow,noarchive" />` is present

**It should NOT** appear in Google search — `robots.txt` and the meta tag both block it.

---

## Part C — Connecting your Squarespace domain (when you're ready)

You said you bought `isitkickingoff.com` via Squarespace. Two options:

### Option 1 — Move DNS to Cloudflare (recommended)
You keep ownership of the domain at Squarespace, but Cloudflare runs the DNS. This is the cleanest setup, gets you Cloudflare's CDN/CSAT/cache for free, and means custom domain on Pages is one click.

1. In Cloudflare: **Add a site → enter `isitkickingoff.com` → Free plan**.
2. Cloudflare will read your existing DNS and give you **two nameservers**, e.g. `aliana.ns.cloudflare.com` and `lou.ns.cloudflare.com`.
3. In Squarespace Domains settings → **Advanced DNS settings** → change nameservers to the two Cloudflare ones. Save.
4. Wait. Propagation usually takes minutes, sometimes a few hours. Cloudflare will email you when it sees the change.
5. Back in Cloudflare Pages → your project → **Custom domains → Set up a custom domain → `isitkickingoff.com`** (and add `www.isitkickingoff.com` too). Cloudflare will auto-create the DNS records.
6. SSL/TLS is automatic and free.

### Option 2 — Keep DNS at Squarespace
Squarespace will let you point a `CNAME` to `isitkickingoff.pages.dev`. It works but you give up the Cloudflare DNS layer. Only do this if you specifically want to keep DNS at Squarespace.

---

## Part D — Before going public (DO NOT SKIP)

When you're happy and ready to take the dashboard live, do these in order:

1. **Remove the noindex meta tag** from each HTML file. Search every file for `TEST DEPLOY: noindex` and delete that line and the meta tag below it.
2. **Replace `robots.txt`** with a production version:
   ```
   User-agent: *
   Allow: /
   Sitemap: https://isitkickingoff.com/sitemap.xml
   ```
3. **Remove `X-Robots-Tag: noindex, nofollow`** from `_headers` (it's the line near the top of the `/*` block).
4. **Re-enable the Shop button** by reverting the nav changes in `index.html`, `news.html`, `snapshot.html`, `shop.html`, `legal.html` — change:
   ```html
   <a aria-disabled="true" title="Shop coming soon" style="opacity:.4;cursor:not-allowed;pointer-events:none">🛍️ Shop</a>
   ```
   back to:
   ```html
   <a href="./shop.html">🛍️ Shop</a>
   ```
   (and `class="active"` on the shop.html version).
5. **Add a real `og-image.png`** to the repo root — a 1200×630 PNG. The OG meta tag in `index.html` already references `/og-image.png` so just drop one in. Otherwise social link previews will use a generic icon.
6. **Drop in your analytics token** in `index.html` head — Plausible or Cloudflare Web Analytics.
7. **(Optional) Wire Supabase**: paste your Supabase URL + anon key into the two constants near the top of the `index.html` script block. Run the SQL setup block (in the same comment) once in Supabase's SQL editor.
8. **Add a `sitemap.xml`** at the root (a simple one — five URL entries for index, news, snapshot, shop, legal).
9. Push the changes via GitHub Desktop. Cloudflare auto-deploys on push to `main` — you'll see the new build in the Pages dashboard within ~60 seconds.

---

## How updates work after this

Edit a file locally → GitHub Desktop shows the change → write a one-line commit summary → click **Commit to main** → click **Push origin**. Cloudflare deploys automatically. You can roll back to any previous deploy from the Pages dashboard.

If you want a "preview" deploy without affecting production, push to a branch other than `main` (e.g. `staging`). Cloudflare gives every branch its own URL.

---

## If something breaks

- **The page is blank** → open browser DevTools (Cmd+Opt+I) → Console tab → look for red errors. Most likely candidate: the inline JS bundled inside `index.html` failed to parse. Pull the previous version from GitHub Desktop's history.
- **The favicon shows a question mark** → some browsers cache aggressively. Hard refresh with Cmd+Shift+R.
- **Live data won't load** → some CORS proxies go down occasionally. The dashboard has fallbacks for every feed; you'll just see the modelled values until the proxy is back.
- **Cloudflare deploy fails** → check the build log in the Cloudflare Pages dashboard. For static sites this almost never fails — common cause is a typo in `_headers` or `_redirects`.
- **You see "Shop" still clickable** → cache. Cloudflare → Caching → **Purge Everything**. Then hard-refresh your browser.

---

## Summary

You will end up with:

- **Test URL** (right now): `https://isitkickingoff.pages.dev` — private, no indexing, full functionality
- **Production URL** (after Part D): `https://isitkickingoff.com` — public, indexed, Shop live

Total cost: **£0/month**. Cloudflare Pages free tier covers ~unlimited traffic for a static site, GitHub free tier covers a private repo, Supabase free tier covers ~50,000 rows / 500 MB which is years of daily snapshots.

Good luck. — Claude
