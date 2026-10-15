/**
 * Cloudflare Worker for isitkickingoff.com
 *
 * Handles two responsibilities:
 *
 *   1. /api/* — server-side fetches for data sources that don't ship
 *      browser-friendly CORS headers or need a key. Server-side fetching has
 *      no CORS limits and we can edge-cache (5 min) so upstreams aren't hammered.
 *
 *   2. Everything else — delegates to env.ASSETS (the static assets bundle)
 *      so the dashboard / news / changelog / etc continue to be served
 *      exactly as before.
 *
 * Secrets: one. /api/football needs FOOTBALL_DATA_TOKEN, set in the Cloudflare
 * dashboard (Pages project → Settings → Variables and Secrets, type "Secret").
 * Never commit the token. Without it /api/football returns 503 and the page
 * falls back to TheSportsDB.
 */

const YAHOO_QUOTE = 'https://query1.finance.yahoo.com/v7/finance/quote';
const STOOQ_BASE  = 'https://stooq.com/q/d/l';

const CACHE_TTL_SECONDS = 300; // 5 minutes
const ALLOWED_SYMBOLS = /^[A-Za-z0-9.,=^_-]+$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/_worker.js' || url.pathname === '/worker.js') {
      return new Response('Not found', { status: 404 });
    }

    if (url.pathname.startsWith('/api/') && request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (url.pathname === '/api/quote') {
      return handleYahooQuote(url, ctx);
    }

    if (url.pathname === '/api/stooq') {
      return handleStooq(url, ctx);
    }

    if (url.pathname === '/api/polymarket') {
      return handlePolymarket(url, ctx);
    }

    if (url.pathname === '/api/football') {
      return handleFootball(url, env, ctx);
    }

    if (url.pathname === '/api/health') {
      return jsonResponse({ ok: true, ts: Date.now() });
    }

    const res = await env.ASSETS.fetch(request);
    // v3.30 — only isitkickingoff.com should appear in search. Preview
    // deployments and the *.pages.dev / *.workers.dev aliases get noindex.
    if (/\.(pages|workers)\.dev$/i.test(url.hostname)) {
      const r = new Response(res.body, res);
      r.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return r;
    }
    return res;
  },
};

/**
 * Yahoo Finance quote — Yahoo's v7/finance/quote endpoint started returning
 * 401 to server-side calls in 2024+ (requires session crumb). v8/finance/chart
 * is still open. We loop the requested symbols, hit v8/chart per-symbol in
 * parallel, and aggregate into the same response shape v7 used to return —
 * so the dashboard code that parses j.quoteResponse.result keeps working.
 */
async function handleYahooQuote(url, ctx) {
  const symbolsRaw = (url.searchParams.get('symbols') || '').trim();
  if (!symbolsRaw) return jsonError('Missing ?symbols= param', 400);
  if (!ALLOWED_SYMBOLS.test(symbolsRaw)) return jsonError('Invalid symbols characters', 400);
  if (symbolsRaw.length > 200) return jsonError('Too many symbols', 400);

  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cache = caches.default;
  let cached = await cache.match(cacheKey);
  if (cached) return cached;

  const symbols = symbolsRaw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);

  const fetchOne = async (sym) => {
    try {
      const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`;
      const r = await fetch(u, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; IIKO-Worker/1.0)',
          'Accept': 'application/json,text/plain,*/*',
        },
        cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
      });
      if (!r.ok) return null;
      const j = await r.json();
      const res = j && j.chart && j.chart.result && j.chart.result[0];
      if (!res) return null;
      const meta = res.meta || {};
      const quote = res.indicators && res.indicators.quote && res.indicators.quote[0];
      const closes = ((quote && quote.close) || []).filter(v => Number.isFinite(v));
      if (closes.length < 2) return null;
      const last = closes[closes.length - 1];
      const prev = closes[closes.length - 2];
      return {
        symbol: sym,
        shortName: meta.symbol || sym,
        regularMarketPrice: last,
        regularMarketPreviousClose: prev,
        regularMarketChange: last - prev,
        regularMarketChangePercent: ((last - prev) / prev) * 100,
        currency: meta.currency || 'USD',
      };
    } catch (_) {
      return null;
    }
  };

  const results = (await Promise.all(symbols.map(fetchOne))).filter(Boolean);

  const body = JSON.stringify({ quoteResponse: { result: results, error: null } });
  const response = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
      'Access-Control-Allow-Origin': '*',
      'X-Source': 'yahoo-v8-chart-aggregated',
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function handleStooq(url, ctx) {
  const sym = (url.searchParams.get('s') || '').trim();
  const interval = (url.searchParams.get('i') || 'd').trim();
  if (!sym) return jsonError('Missing ?s= param', 400);
  if (!ALLOWED_SYMBOLS.test(sym)) return jsonError('Invalid symbol', 400);
  if (interval !== 'd' && interval !== 'w' && interval !== 'm') {
    return jsonError('interval must be d/w/m', 400);
  }

  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cache = caches.default;
  let cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = `${STOOQ_BASE}/?s=${encodeURIComponent(sym)}&i=${interval}`;
  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IIKO-Worker/1.0)' },
      cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
    });
  } catch (e) {
    return jsonError('Stooq fetch failed: ' + e.message, 502);
  }

  if (!upstreamRes.ok) {
    return jsonError(`Stooq HTTP ${upstreamRes.status}`, 502);
  }

  const csv = await upstreamRes.text();
  const response = new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
      'Access-Control-Allow-Origin': '*',
      'X-Source': 'stooq-csv',
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

/**
 * Football fixtures + results — football-data.org v4, free tier (v3.30).
 *
 *   /api/football
 *
 * Covers Premier League, Championship and Champions League (plus World Cup
 * and Euros when they're on) for UK today −3 days to +3 days. Free tier is
 * 10 requests/minute with delayed scores, which is fine for fixtures and
 * results. Cached 5 minutes (60s while a match is in play). A 6-hour stale
 * copy is kept so a rate-limit or outage serves the last good data instead
 * of nothing.
 *
 * The response mimics TheSportsDB's event shape (strHomeTeam, strTimestamp,
 * intHomeScore…) so the page's football code handles both sources the same.
 * strTimestamp is UTC with a trailing Z.
 *
 * No Access-Control-Allow-Origin header on purpose: the page calls this
 * same-origin, and we don't want other sites spending our API quota.
 */
const FD_API = 'https://api.football-data.org/v4/matches';
// Numeric IDs, the documented form for /v4/matches?competitions=
// (PL 2021, Championship 2016, Champions League 2001, World Cup 2000, Euros 2018).
const FD_COMPETITIONS = '2021,2016,2001,2000,2018';
const FD_LEAGUE_NAMES = {
  PL:  'English Premier League',
  ELC: 'English League Championship',
  CL:  'UEFA Champions League',
  WC:  'FIFA World Cup',
  EC:  'UEFA European Championship',
};
const FD_FRESH_SECONDS = 300;
const FD_LIVE_SECONDS  = 60;
const FD_STALE_SECONDS = 21600;

// YYYY-MM-DD for UK "today" plus an offset in days.
function londonDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const base = Date.UTC(+p.year, +p.month - 1, +p.day) + offsetDays * 86400000;
  return new Date(base).toISOString().slice(0, 10);
}

function fdTeamName(t) {
  const n = (t && (t.name || t.shortName)) || '?';
  return String(n).replace(/\s+A?FC$/i, '').trim();
}

function fdToEvent(m) {
  const code = m.competition && m.competition.code;
  const utc = String(m.utcDate || '');
  const ft = (m.score && m.score.fullTime) || {};
  const finished = m.status === 'FINISHED' && ft.home != null && ft.away != null;
  return {
    idEvent:      'fd-' + m.id,
    strHomeTeam:  fdTeamName(m.homeTeam),
    strAwayTeam:  fdTeamName(m.awayTeam),
    strLeague:    FD_LEAGUE_NAMES[code] || (m.competition && m.competition.name) || 'Football',
    dateEvent:    utc.slice(0, 10),
    strTime:      utc.slice(11, 19),
    strTimestamp: utc,
    intHomeScore: finished ? String(ft.home) : null,
    intAwayScore: finished ? String(ft.away) : null,
    strStatus:    m.status || '',
    _src:         'fd',
  };
}

async function handleFootball(url, env, ctx) {
  const token = env && env.FOOTBALL_DATA_TOKEN;
  if (!token) return jsonError('football-data.org token not configured', 503);

  const from = londonDate(-3);
  const to   = londonDate(3);
  const cache = caches.default;
  const freshKey = new Request(`${url.origin}/api/football?_cache=fresh&w=${from}_${to}`);
  const staleKey = new Request(`${url.origin}/api/football?_cache=stale`);

  const hit = await cache.match(freshKey);
  if (hit) return hit;

  let payload = null;
  let ttl = FD_FRESH_SECONDS;
  let upstreamErr = '';
  try {
    const r = await fetch(`${FD_API}?competitions=${FD_COMPETITIONS}&dateFrom=${from}&dateTo=${to}`, {
      headers: { 'X-Auth-Token': token, 'Accept': 'application/json' },
    });
    if (r.ok) {
      const j = await r.json();
      const events = (Array.isArray(j.matches) ? j.matches : []).map(fdToEvent);
      if (events.some(e => e.strStatus === 'IN_PLAY' || e.strStatus === 'PAUSED')) ttl = FD_LIVE_SECONDS;
      payload = {
        live: true,
        source: 'football-data.org',
        from, to,
        fetchedAt: new Date().toISOString(),
        count: events.length,
        events,
      };
    } else {
      upstreamErr = `HTTP ${r.status}`;
    }
  } catch (e) {
    upstreamErr = e.message || 'fetch failed';
  }

  const respond = (body, maxAge, extra = {}) => new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${maxAge}`,
      'X-Source': 'football-data.org',
      ...extra,
    },
  });

  if (!payload) {
    const stale = await cache.match(staleKey);
    if (stale) {
      let body = await stale.text();
      try { const j = JSON.parse(body); j.stale = true; j.live = false; body = JSON.stringify(j); } catch (_) {}
      return respond(body, 60, { 'X-Stale': '1' });
    }
    return jsonError('football-data.org unavailable: ' + upstreamErr, 502);
  }

  const body = JSON.stringify(payload);
  ctx.waitUntil(Promise.all([
    cache.put(freshKey, respond(body, ttl)),
    cache.put(staleKey, respond(body, FD_STALE_SECONDS)),
  ]));
  return respond(body, ttl);
}

/**
 * Polymarket UK markets — proxies the public Gamma API and keeps only
 * markets that are genuinely about the UK, sorted by 24h volume.
 *
 *   /api/polymarket?limit=4
 *
 * v3.30: the old filter let almost anything through. 'uk' had no word
 * boundary (matched "Ukraine"), 'pm\b' matched "11:59 PM" in market
 * descriptions, and generic words (championship, interest rate, royal,
 * hunt, brown, cambridge, chancellor) pulled in Fed rates, the NFL and
 * Brazil's election. Now: whole words only, matched against the question
 * and event title (never the long description), a UK-specific term list,
 * and at most one market per event so one big outright can't fill the row.
 */
const UK_MARKET_TERMS = [
  // Country names. Lookarounds stop New England, New South Wales and
  // British Columbia counting.
  'uk', 'u\\.k\\.', 'britain', 'great\\s+britain', 'united\\s+kingdom',
  'british(?!\\s+columbia)', '(?<!new\\s)england', 'english',
  'scotland', 'scottish', '(?<!new\\s+south\\s)wales', 'welsh', 'northern\\s+ireland',
  // Places and institutions that only mean the UK
  'london', 'westminster', 'downing\\s+street', 'house\\s+of\\s+commons', 'house\\s+of\\s+lords',
  'holyrood', 'senedd', 'stormont', 'bank\\s+of\\s+england', 'boe', 'ftse', 'gilts?',
  'nhs', 'bbc', 'gb\\s+news', 'sky\\s+news', 'brexit',
  // Parties
  'tory', 'tories', 'reform\\s+uk', 'lib\\s+dems?', 'liberal\\s+democrats?', 'snp',
  'plaid\\s+cymru', 'restore\\s+britain',
  // Politicians (surnames that are unambiguous on Polymarket)
  'starmer', 'burnham', 'farage', 'badenoch', 'swinney', 'sunak', 'corbyn',
  'ed\\s+davey', 'rachel\\s+reeves', 'angela\\s+rayner', 'wes\\s+streeting',
  'zack\\s+polanski', 'rupert\\s+lowe', 'sadiq\\s+khan',
  // Royal family
  'king\\s+charles', 'prince\\s+william', 'prince\\s+harry', 'princess\\s+of\\s+wales',
  'kate\\s+middleton', 'meghan\\s+markle', 'duke\\s+of\\s+sussex', 'duchess\\s+of\\s+sussex',
  'buckingham\\s+palace', 'royal\\s+family',
  // Football (whole words, so Celtic ≠ Celtics; no 'spurs' or 'rangers',
  // which collide with US teams)
  'premier\\s+league', 'epl', 'fa\\s+cup', 'carabao\\s+cup', 'efl',
  '(?<!nuclear\\s)arsenal', 'chelsea', 'tottenham', 'liverpool', 'everton', 'man\\s+city', 'man\\s+utd',
  'man\\s+united', 'manchester\\s+city', 'manchester\\s+united', 'newcastle\\s+united',
  'aston\\s+villa', 'west\\s+ham', 'nottingham\\s+forest', 'crystal\\s+palace',
  'leeds\\s+united', 'celtic', 'old\\s+firm',
  // Other British sport and culture
  'six\\s+nations', 'wimbledon', 'grand\\s+national', 'cheltenham', 'royal\\s+ascot',
  'the\\s+ashes', 'silverstone', 'british\\s+grand\\s+prix', 'lando\\s+norris',
  'lewis\\s+hamilton', 'glastonbury',
];
// (?<!\w) / (?!\w) rather than \b, so terms ending in a full stop ("U.K.") match.
const UK_MARKET_RE = new RegExp('(?<!\\w)(?:' + UK_MARKET_TERMS.join('|') + ')(?!\\w)', 'i');
// Weaker words that are UK-specific only when no other country is in play
// (New Zealand and Australia have Labour/Labor parties, Canada has Conservatives).
const UK_WEAK_RE = /(?<!\w)(?:labour|conservatives?|tory\s+leader|next\s+prime\s+minister\s+of\s+the\s+uk)(?!\w)/i;
const NON_UK_RE = /(?<!\w)(?:new\s+zealand|nz|australia|australian|canada|canadian|norway|norwegian|israel|israeli|japan|japanese|netherlands|dutch)(?!\w)/i;

function isUKMarket(m) {
  const ev = Array.isArray(m.events) && m.events[0] ? m.events[0] : null;
  const text = `${m.question || ''} ${ev && ev.title ? ev.title : ''}`;
  if (UK_MARKET_RE.test(text)) return true;
  return UK_WEAK_RE.test(text) && !NON_UK_RE.test(text);
}

async function handlePolymarket(url, ctx) {
  const limit = Math.min(20, parseInt(url.searchParams.get('limit') || '4', 10) || 4);
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cache = caches.default;
  let cached = await cache.match(cacheKey);
  if (cached) return cached;

  // Pull the 500 most-traded active markets (two pages of 250, in parallel)
  // and filter server-side for UK relevance. The second page is best-effort.
  const page = (offset) => fetch(
    `https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=250&offset=${offset}`,
    {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IIKO-Worker/1.0)', 'Accept': 'application/json' },
      cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
    }
  );
  let firstRes, secondRes;
  try {
    [firstRes, secondRes] = await Promise.all([page(0), page(250).catch(() => null)]);
  } catch (e) {
    return jsonError('Polymarket fetch failed: ' + e.message, 502);
  }
  if (!firstRes.ok) return jsonError(`Polymarket HTTP ${firstRes.status}`, 502);

  const asList = (j) => Array.isArray(j) ? j : ((j && j.markets) || []);
  let markets = asList(await firstRes.json());
  if (secondRes && secondRes.ok) {
    try { markets = markets.concat(asList(await secondRes.json())); } catch (_) {}
  }

  // One market per event (the most-traded), so a single outright with a
  // market per team can't fill every slot.
  const seenEvents = new Set();
  const uk = markets
    .filter(m => m && m.question && isUKMarket(m))
    .sort((a, b) => (parseFloat(b.volume24hr || 0) || 0) - (parseFloat(a.volume24hr || 0) || 0))
    .filter(m => {
      const ev = Array.isArray(m.events) && m.events[0];
      const key = (ev && (ev.id || ev.slug)) || m.slug || m.question;
      if (seenEvents.has(key)) return false;
      seenEvents.add(key);
      return true;
    })
    .map(m => {
      // Yes-price extraction. Gamma returns 'outcomePrices' as a JSON-stringified array.
      let yesPrice = null;
      try {
        const prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
        if (Array.isArray(prices) && prices.length){
          const p0 = parseFloat(prices[0]);
          if (Number.isFinite(p0)) yesPrice = p0;
        }
      } catch(_){}
      // Event pages live at /event/<event-slug>; fall back to the market slug.
      const ev = Array.isArray(m.events) && m.events[0];
      const evSlug = (ev && ev.slug) || m.slug;
      return {
        question:    m.question,
        slug:        m.slug,
        url:         evSlug ? `https://polymarket.com/event/${evSlug}` : 'https://polymarket.com',
        yesPrice:    yesPrice,                        // 0..1
        yesPct:      yesPrice != null ? Math.round(yesPrice * 100) : null,
        volume24h:   parseFloat(m.volume24hr || 0) || 0,
        volumeTotal: parseFloat(m.volume || 0) || 0,
        endDate:     m.endDate || null,
        image:       m.image || null,
      };
    })
    .filter(m => Number.isFinite(m.yesPrice))
    .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
    .slice(0, limit);

  const response = new Response(JSON.stringify({ live: true, markets: uk, count: uk.length }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
      'Access-Control-Allow-Origin': '*',
      'X-Source': 'polymarket-gamma',
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function jsonError(msg, status = 500) {
  return jsonResponse({ error: msg }, status);
}
