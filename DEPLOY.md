# Is It Kicking Off? — Go-Live Guide

This doc covers the end-to-end steps to take the prototype from a single local HTML
file to a public site at **isitkickingoff.com** that can survive going viral, be
monitored, be monetised, and posts to its own X account once a day.

## 1. Hosting

**Recommended: Cloudflare Pages.** Free, global CDN, free custom-domain SSL,
handles traffic spikes effortlessly, built-in analytics. Netlify and Vercel are
equivalent alternatives — pick whichever you already have an account with.

Steps:

1. Create a GitHub repo (e.g. `isitkickingoff/site`) and push `index.html` to it.
2. In Cloudflare dashboard → Pages → Create project → connect your GitHub repo.
   Framework preset: **None (static HTML)**. Build command: empty. Output dir: `/`.
3. After the first deploy, add the custom domain `isitkickingoff.com` in the Pages
   project settings. Cloudflare auto-provisions the cert.
4. Point the domain's nameservers at Cloudflare (or just the CNAME if you keep
   DNS elsewhere — Pages gives you the exact record to add).

Alternatives: **Netlify** / **Vercel** are one-click deploys from the same repo.
**GitHub Pages** works too but with no edge-compute flexibility if you later want
server-side render for Open Graph share images.

## 2. Analytics

Drop ONE of these into `<head>` before launch. The placeholder is already in
`index.html` as a comment.

**Option A — Cloudflare Web Analytics (free, no cookie banner needed):**
```html
<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "YOUR_TOKEN"}'></script>
```

**Option B — Plausible (£10/mo, nicer UX, event tracking):**
```html
<script defer data-domain="isitkickingoff.com" src="https://plausible.io/js/script.js"></script>
```

With Plausible you can also track custom events (share-button clicks, region
filter usage) — useful for understanding what the viral moment looks like:
```js
// Add inside wireShareButtons / selectRegion:
if (window.plausible) window.plausible('share', { props: { platform }});
```

## 3. Uptime monitoring

**UptimeRobot (free).** Add a keyword monitor that pings `https://isitkickingoff.com/`
every 5 minutes and fails if the response doesn't contain the text
`IS IT KICKING OFF`. Email + Slack alerts. Set a second monitor that fetches
`/` and asserts HTTP 200.

## 4. Error tracking

**Sentry (free tier: 5k errors / month).** Add to `<head>`:
```html
<script src="https://js.sentry-cdn.com/YOUR_KEY.min.js" crossorigin="anonymous"></script>
```
This catches JS errors from real users — essential once users with exotic
browsers / ad-blockers / CORS-restrictive extensions start hitting the site and
your APIs silently fail.

## 5. AdSense

Placeholder is already in `index.html` between the signal cards and the live
tickers (natural mid-scroll break). To go live:

1. Sign up at google.com/adsense, add the site.
2. AdSense gives you a `<script>` loader tag and an `<ins class="adsbygoogle">`
   unit tag. Paste the loader into `<head>` (replacing the placeholder comment)
   and the `<ins>` tag into the `#ad-slot` element (replacing the placeholder div).
3. Set the ad format to **responsive** (`data-ad-format="auto"` +
   `data-full-width-responsive="true"`) so it serves leaderboard on desktop and
   banner on mobile.

**Do not add a second ad for now.** One responsive unit keeps page performance
fast and the UI tone honest. Add more only if the site genuinely monetises.

## 6. Share images (optional but high-leverage)

Right now the Open Graph / Twitter Card tags point at
`https://isitkickingoff.com/og-image.png`. Drop a 1200×630 static image there
and every share preview looks sharp.

For a *much* more viral share: render the image dynamically with the current
gauge value. That needs a serverless function (Cloudflare Workers / Vercel
Edge) using `satori` or `@vercel/og`. Saved for v2.

## 7. Daily auto-tweet

See **AUTOTWEET.md** for the full setup. Summary: a Node script in
`scripts/tweet.mjs` runs on a GitHub Actions cron every day at 17:00 London,
fetches the same live APIs, computes the kick-off index, and posts it to your
`@isitkickingoff` X account.

## 8. Go-live checklist

- [ ] GitHub repo created and `index.html` pushed
- [ ] Cloudflare Pages (or Netlify/Vercel) deploying from the repo
- [ ] `isitkickingoff.com` pointing at the Pages deploy
- [ ] Analytics snippet added to `<head>`
- [ ] `og-image.png` (1200×630) uploaded to site root
- [ ] AdSense approved and `<ins>` unit live
- [ ] UptimeRobot monitor configured
- [ ] Sentry (optional) configured
- [ ] X account `@isitkickingoff` created
- [ ] X Developer app + tokens generated
- [ ] GitHub repo secrets set (see AUTOTWEET.md)
- [ ] GitHub Action `daily-tweet.yml` manually triggered once and confirmed posting
