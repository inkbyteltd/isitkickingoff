/**
 * Cloudflare Worker for isitkickingoff.com
 *
 * Handles two responsibilities:
 *
 *   1. /api/* — server-side proxy for finance data sources that don't ship
 *      browser-friendly CORS headers. Server-side fetching has no CORS limits
 *      and we can edge-cache aggressively (5 min) so Yahoo isn't hammered.
 *
 *   2. Everything else — delegates to env.ASSETS (the static assets bundle)
 *      so the dashboard / news / changelog / etc continue to be served
 *      exactly as before.
 *
 * No secrets, no API keys, no upstream auth required. Yahoo Finance v7's
 * public quote endpoint is what we hit.
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

    if (url.pathname === '/api/health') {
      return jsonResponse({ ok: true, ts: Date.now() });
    }

    return env.ASSETS.fetch(request);
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
 * Polymarket UK markets — proxies the public Gamma API. Filters server-side
 * for UK-related markets (anything tagged 'United-Kingdom' or whose question
 * mentions UK / Britain / Westminster / Starmer / etc), sorted by volume.
 *
 *   /api/polymarket?limit=4
 */
async function handlePolymarket(url, ctx) {
  const limit = Math.min(20, parseInt(url.searchParams.get('limit') || '4', 10) || 4);
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cache = caches.default;
  let cached = await cache.match(cacheKey);
  if (cached) return cached;

  // Pull a wide batch of active markets, filter server-side for UK relevance.
  // Gamma supports ?tag_slug filters — we try United-Kingdom first, then fall
  // back to keyword filtering on a broader list.
  // 250 is a good balance: enough markets to find ≥4 UK-relevant ones, not so
  // many that the worker invocation gets slow.
  const upstream = `https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=250`;
  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IIKO-Worker/1.0)', 'Accept': 'application/json' },
      cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
    });
  } catch (e) {
    return jsonError('Polymarket fetch failed: ' + e.message, 502);
  }
  if (!upstreamRes.ok) return jsonError(`Polymarket HTTP ${upstreamRes.status}`, 502);

  const j = await upstreamRes.json();
  const markets = Array.isArray(j) ? j : (j.markets || []);

  // UK-relevance filter — broad net, then narrow to top by volume.
  // Keep this list aggressive — Polymarket cycles markets fast and a tight
  // filter routinely returns <4 results during quieter UK news weeks. Better
  // to let a few near-misses through than show empty cards.
  const UK_KEYWORDS = new RegExp([
    // Country names + adjectives
    'uk','u\\.k\\.','britain','british','england','english','scotland','scottish','wales','welsh',
    'northern\\s+ireland','great\\s+britain','united\\s+kingdom',
    // Major cities
    'london','manchester','birmingham','liverpool','glasgow','edinburgh','cardiff','belfast',
    'leeds','sheffield','newcastle','bristol','nottingham',
    // Westminster & political institutions
    'westminster','downing\\s+street','no\\.?\\s*10','number\\s*10','parliament','commons','lords',
    'pm\\b','prime\\s+minister','chancellor','home\\s+secretary','foreign\\s+secretary',
    'general\\s+election','by-election','manifesto',
    // Parties
    'labour','tory','tories','conservative','conservatives','reform\\s+uk','reform\\s+party',
    'lib\\s+dem','liberal\\s+democrat','lib-dem','snp','plaid\\s+cymru','green\\s+party\\s+uk',
    // UK politicians (current + recent)
    'starmer','farage','badenoch','swinney','sunak','truss','davey','rayner','reeves','lammy',
    'corbyn','jeremy\\s+corbyn','hunt','blair','cameron','brown','milne','mcdonnell','kemi',
    'rishi','keir',
    // Royal family
    'royal','royals','monarchy','king\\s+charles','prince\\s+william','prince\\s+harry',
    'kate\\s+middleton','princess\\s+kate','princess\\s+of\\s+wales','meghan','sussex','cambridge',
    'queen\\s+camilla','prince\\s+andrew','windsor',
    // Brexit & EU
    'brexit','rejoin','single\\s+market','customs\\s+union',
    // NHS & public services
    'nhs','national\\s+health','bbc','itv','channel\\s+4','sky\\s+news','gb\\s+news',
    // Football — leagues, clubs, fixtures
    'premier\\s+league','epl','english\\s+football','fa\\s+cup','league\\s+cup','carabao\\s+cup',
    'efl\\b','championship','community\\s+shield','wembley',
    'man\\s+utd','manchester\\s+united','man\\s+city','manchester\\s+city',
    'liverpool\\s+fc','arsenal','chelsea','tottenham','spurs','newcastle\\s+united',
    'aston\\s+villa','west\\s+ham','everton','leeds\\s+united','leicester','wolves',
    'brighton','crystal\\s+palace','fulham','brentford','nottingham\\s+forest',
    'celtic','rangers','old\\s+firm',
    // Other British sports
    'six\\s+nations','rugby\\s+world\\s+cup','england\\s+cricket','ashes','t20\\s+world\\s+cup',
    'cricket\\s+world\\s+cup','wimbledon','grand\\s+national','cheltenham\\s+festival','royal\\s+ascot',
    'epsom\\s+derby','epsom\\b','silverstone','british\\s+gp','british\\s+grand\\s+prix','open\\s+championship',
    'cheltenham','gold\\s+cup','goodwood','aintree',
    // Cultural events / venues
    'glastonbury','eurovision','euros','euro\\s+202','world\\s+cup\\s+202',
    // Economy
    'pound\\b','gbp','sterling','ftse','bank\\s+of\\s+england','boe\\b','interest\\s+rate'
  ].join('|'), 'i');
  const uk = markets
    .filter(m => m && m.question)
    .filter(m => {
      const text = `${m.question || ''} ${m.description || ''} ${(m.tags || []).join(' ')}`;
      return UK_KEYWORDS.test(text);
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
      return {
        question:    m.question,
        slug:        m.slug,
        url:         m.slug ? `https://polymarket.com/event/${m.slug}` : 'https://polymarket.com',
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
