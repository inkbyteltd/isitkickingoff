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

async function handleYahooQuote(url, ctx) {
  const symbols = (url.searchParams.get('symbols') || '').trim();
  if (!symbols) return jsonError('Missing ?symbols= param', 400);
  if (!ALLOWED_SYMBOLS.test(symbols)) return jsonError('Invalid symbols characters', 400);
  if (symbols.length > 200) return jsonError('Too many symbols', 400);

  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cache = caches.default;

  let cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = `${YAHOO_QUOTE}?symbols=${encodeURIComponent(symbols)}`;
  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; IIKO-Worker/1.0)',
        'Accept': 'application/json,text/plain,*/*',
      },
      cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
    });
  } catch (e) {
    return jsonError('Yahoo fetch failed: ' + e.message, 502);
  }

  if (!upstreamRes.ok) {
    return jsonError(`Yahoo HTTP ${upstreamRes.status}`, 502);
  }

  const body = await upstreamRes.text();
  const response = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
      'Access-Control-Allow-Origin': '*',
      'X-Source': 'yahoo-v7-quote',
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
  const upstream = `https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=120`;
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
  const UK_KEYWORDS = /\b(uk|britain|british|england|english|scotland|scottish|wales|welsh|northern\s+ireland|london|westminster|labour|tory|tories|conservative|reform\s+uk|starmer|farage|badenoch|swinney|sunak|truss|davey|royal|monarchy|king\s+charles|prince|princess|brexit|nhs|premier\s+league|fa\s+cup|championship|grand\s+national|cheltenham|wimbledon|man\s+utd|man\s+city|liverpool|arsenal|chelsea|tottenham|spurs)\b/i;
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
