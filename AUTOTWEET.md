# Daily auto-tweet setup for @isitkickingoff

**Goal:** once a day, a GitHub Actions cron job runs a Node script that fetches
the same live APIs the site uses, computes the kick-off index, picks the
hottest region, and posts a tweet to the site's X account.

This costs **£0/month** (GitHub Actions free minutes + Twitter API v2 free tier
= 1,500 tweets/month; you'll use ~30).

## 1. Create the X account + developer app

1. Sign up for X as `@isitkickingoff` (or whatever handle is free).
2. Apply at [developer.x.com](https://developer.x.com) for a Free tier project
   + app. Enable **Read and Write** user authentication.
3. From your app's "Keys and tokens" panel, generate and save:
   - **API Key** (consumer key)
   - **API Key Secret** (consumer secret)
   - **Access Token** (user context, from the "Access Token and Secret" section)
   - **Access Token Secret**

Four strings total. You'll paste them into GitHub repo secrets below.

## 2. Repo structure

Add this to your site repo:

```
/
├── index.html
├── scripts/
│   ├── tweet.mjs
│   └── package.json
└── .github/
    └── workflows/
        └── daily-tweet.yml
```

The files `scripts/tweet.mjs`, `scripts/package.json`, and
`.github/workflows/daily-tweet.yml` are ready-to-copy in this folder — just
move them into the paths above when you set up the repo.

## 3. GitHub repo secrets

In your repo → Settings → Secrets and variables → Actions → New repository
secret, create these four secrets (names exactly as below):

- `TWITTER_API_KEY`
- `TWITTER_API_SECRET`
- `TWITTER_ACCESS_TOKEN`
- `TWITTER_ACCESS_SECRET`

## 4. Tweet cadence & schedule

Default schedule in `daily-tweet.yml` is **17:00 Europe/London**
(cron `0 16 * * *` UTC = 17:00 BST / 16:00 GMT). That's a deliberate pick:
everyone's wrapping up the workday, thinking about tonight, and primed to
click a dashboard that asks "is it kicking off?"

Alternative cadences if you want to try them:

- Morning briefing: 08:00 London (`0 7 * * *` UTC in BST)
- Peak heat: fires only when the index breaches a threshold — see
  "conditional tweeting" at the end of this doc.
- Twice-daily: morning + evening.

## 5. Tweet format

The script generates tweets that vary by tier to stay fresh. Examples:

- Low: "🟢 Tuesday, 10am. UK Kick-Off Index: 18/100 — A BIT TENSE. Nation mostly holding it together. Live gauge: isitkickingoff.com"
- Mid: "🟡 UK Kick-Off Index now at 52/100 — HANDBAGS. Warmest in the NW (61). Everyone's chest is puffed but no one's taken their coat off yet. isitkickingoff.com"
- Hot: "🔴 78/100. IT'S KICKING OFF. Belter weather, Man Utd lost, full moon Friday. Hot spots: NW 84, SCO 79, LON 76. Live gauge: isitkickingoff.com"

Adjust the copy in `scripts/tweet.mjs` to taste — it's a plain JS function.

## 6. Test it before relying on cron

From your local machine (or Codespaces), from the repo root:

```bash
cd scripts
npm install
TWITTER_API_KEY=... TWITTER_API_SECRET=... TWITTER_ACCESS_TOKEN=... TWITTER_ACCESS_SECRET=... \
  node tweet.mjs --dry-run
```

`--dry-run` prints the tweet it would have posted and exits. Drop the flag to
post for real.

You can also trigger the GitHub Action manually from the Actions tab
(it has `workflow_dispatch` enabled).

## 7. Conditional tweeting (optional upgrade)

Instead of tweeting every day regardless, only tweet when the index is "newsworthy":

```js
// In tweet.mjs, around the final api call:
if (score < 55 && !isFriday && !isBankHolidayEve) {
  console.log(`Index ${score} — not newsworthy, skipping tweet.`);
  process.exit(0);
}
```

This turns `@isitkickingoff` into a "when it matters" account. More engaging
follow, but also higher cold-start risk if the score stays quiet for weeks.

## 8. Rate limits to know

- X Free tier: **1,500 tweets/month**, **500 reads/month**. Your script tweets
  once/day = 30/mo. Plenty of headroom.
- Open-Meteo / TheSportsDB / gov.uk / rss2json: no auth, generous free limits,
  a single daily fetch is nothing.
