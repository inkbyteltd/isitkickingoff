// scripts/tweet.mjs
//
// Daily kick-off index tweet. Runs on GitHub Actions cron.
// Reuses the same public APIs the site uses, computes the index,
// and posts to X. Pass --dry-run to print without tweeting.
//
// Required env vars:
//   TWITTER_API_KEY, TWITTER_API_SECRET,
//   TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET

import { TwitterApi } from 'twitter-api-v2';

const DRY = process.argv.includes('--dry-run');
const SITE_URL = 'https://isitkickingoff.com';

// --- same weights as the site ---
const WEIGHTS = {
  time: 0.20, football: 0.14, news: 0.13, weather: 0.11, booze: 0.11,
  bh: 0.08, transport: 0.06, roadrage: 0.05, daylight: 0.04,
  england: 0.03, moon: 0.03, greggs: 0.02,
};

const TIERS = [
  { max:15,  label:"HAVING A BREW" },
  { max:30,  label:"A BIT TENSE" },
  { max:45,  label:"GETTING LIPPY" },
  { max:60,  label:"HANDBAGS" },
  { max:75,  label:"PROPER SIMMERING" },
  { max:90,  label:"IT'S KICKING OFF" },
  { max:100, label:"ALL OUT SCRAP" },
];
const tierFor = s => TIERS.find(t => s <= t.max)?.label || TIERS[0].label;

const REGIONS = [
  ['sco','Scotland',       'SCO', 55.95,-3.19, 0.05],
  ['ne', 'North East',     'NE',  54.98,-1.62, 0.05],
  ['nw', 'North West',     'NW',  53.48,-2.24, 0.06],
  ['yh', 'Yorkshire & H.', 'YH',  53.80,-1.55, 0.03],
  ['wm', 'West Midlands',  'WM',  52.49,-1.89, 0.02],
  ['em', 'East Midlands',  'EM',  52.95,-1.16, 0.00],
  ['ee', 'East of England','EE',  52.21, 0.12,-0.01],
  ['wal','Wales',          'WAL', 51.48,-3.18,-0.01],
  ['sw', 'South West',     'SW',  51.45,-2.59,-0.03],
  ['se', 'South East',     'SE',  51.45,-0.97,-0.02],
  ['lon','London',         'LON', 51.51,-0.13, 0.04],
  ['nir','Northern Ireland','NIR',54.60,-5.93, 0.02],
];

// ---- Fetch live data ----
async function fetchWeather(){
  const lats = REGIONS.map(r=>r[2]).join(',');
  const lons = REGIONS.map(r=>r[3]).join(',');
  const url  = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,precipitation&timezone=Europe%2FLondon`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('weather HTTP '+r.status);
  const j = await r.json();
  return Array.isArray(j) ? j : [j];
}
async function fetchFootball(d){
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  const leagues = ['English_Premier_League','English_League_Championship','UEFA_Champions_League','UEFA_Europa_League'];
  const events = [];
  for (const L of leagues){
    try {
      const r = await fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${date}&l=${L}`);
      if (!r.ok) continue;
      const j = await r.json();
      if (j?.events) events.push(...j.events);
    } catch(_) {}
  }
  return events;
}
async function fetchNews(){
  const feeds = [
    'http://feeds.bbci.co.uk/news/uk/rss.xml',
    'http://feeds.bbci.co.uk/news/politics/rss.xml',
  ];
  const items = [];
  for (const f of feeds){
    try {
      const r = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(f)}`);
      const j = await r.json();
      if (j?.status==='ok' && j.items) for (const it of j.items) items.push((it.title||'')+' '+(it.description||''));
    } catch(_) {}
  }
  return items;
}
async function fetchBankHolidays(){
  try {
    const r = await fetch('https://www.gov.uk/bank-holidays.json');
    if (!r.ok) throw new Error('bh http');
    return await r.json();
  } catch(_){ return null; }
}

// ---- Scoring (mirrors the dashboard's client-side logic) ----
function scoreTime(d){
  const h = d.getHours()+d.getMinutes()/60, w = d.getDay();
  const dm = [0.55,0.40,0.45,0.55,0.75,1.00,0.95][w];
  let hs;
  if (h>=23||h<2.5) hs=1;
  else if (h>=21) hs=0.85;
  else if (h>=19) hs=0.60;
  else if (h>=16) hs=0.50;
  else if (h>=13) hs=0.35;
  else if (h>=8)  hs=0.18;
  else            hs=0.10;
  return Math.min(1, hs*dm*1.05);
}
function scoreBooze(d){
  const day = d.getDay(), date = d.getDate();
  const h = d.getHours()+d.getMinutes()/60;
  const ld = new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
  let s=0.1;
  if (date >= ld-3) s+=0.25;
  if (day===4 && h>=18 && h<=23.5) s+=0.15;
  if ((day===5||day===6) && (h>=19||h<3)) s+=0.35;
  if ((day===5||day===6) && (h>=23||h<2.5)) s+=0.20;
  if (day===0 && h>=13 && h<=17) s+=0.10;
  if (day===3 && h<20) s = Math.max(s-0.05, 0.05);
  return Math.min(1,s);
}
function scoreTempAndRain(t, p){
  let ts;
  if (t>=26) ts=1.00;
  else if (t>=22) ts=0.90;
  else if (t>=18) ts=0.70;
  else if (t>=14) ts=0.45;
  else if (t>=10) ts=0.30;
  else if (t>=5)  ts=0.18;
  else            ts=0.10;
  return Math.max(0, Math.min(1, ts - Math.min(0.25, p*0.12)));
}
function scoreMoon(d){
  const ref = Date.UTC(2000,0,6,18,14), syn = 29.530588853;
  const age = (((d.getTime()-ref)/86400000) % syn + syn) % syn;
  const p = age/syn;
  return Math.max(0, 1 - Math.abs(p-0.5)*2);
}
function scoreNews(items){
  if (!items.length) return 0.5;
  const THEMES = [
    /(immigration|asylum|migrant|channel crossing|small boat|refugee|deport)/i,
    /(stabbing|knife crime|riot|grooming|attack|assault|murder|killed|violence)/i,
    /(election|farage|starmer|tory|tories|labour|lib dem|parliament)/i,
    /(strike|picket|walkout|rail strike|tube strike)/i,
    /(protest|demonstration|march|clash|disorder)/i,
  ];
  let tense = 0;
  for (const t of items){ if (THEMES.some(re => re.test(t))) tense++; }
  return Math.max(0.08, Math.min(0.95, (tense/items.length) * 1.3));
}
function scoreBankHoliday(data){
  const events = data?.['england-and-wales']?.events || [];
  const today = new Date(); today.setHours(0,0,0,0);
  let diff = 9999;
  for (const e of events){
    const d = new Date(e.date);
    const delta = Math.round((d - today)/86400000);
    if (Math.abs(delta) < Math.abs(diff)) diff = delta;
  }
  const ad = Math.abs(diff);
  if (diff===0) return 1.0;
  if (ad<=1) return 0.85;
  if (ad<=3) return 0.55;
  if (ad<=7) return 0.30;
  return 0.10;
}
function rushHour(d){
  const h = d.getHours()+d.getMinutes()/60, dow = d.getDay();
  const wd = dow>=1 && dow<=5;
  if (wd && h>=7.5 && h<=9.5) return 0.60;
  if (wd && h>=16.5 && h<=19) return 0.75;
  if (dow===5 && h>=14 && h<=20) return 0.70;
  return 0.15;
}
function scoreGreggs(d){
  const h = d.getHours()+d.getMinutes()/60, dow = d.getDay(), mo = d.getMonth();
  let x = 0.20;
  if (h>=7 && h<=9.5) x=0.70;
  else if (h>=11.5 && h<=14) x=0.95;
  else if (h>=14 && h<=16.5) x=0.55;
  if (mo===11||mo<=1) x+=0.08;
  if (dow>=1 && dow<=5) x+=0.05;
  return Math.max(0.05, Math.min(1, x));
}
function scoreDaylight(m){ return 0.5 + Math.sin((m-3)/12*Math.PI*2)*0.3; }
function scoreFootball(events, rid){
  const pool = rid ? events.filter(e => {
    // crude region match by substring in home team name
    const h = (e.strHomeTeam||'').toLowerCase(), a = (e.strAwayTeam||'').toLowerCase();
    if (rid==='nw') return /manchester|liverpool|everton|burnley|blackburn/.test(h+a);
    if (rid==='lon')return /arsenal|tottenham|chelsea|west ham|palace|fulham|brentford/.test(h+a);
    if (rid==='sco')return /celtic|rangers|aberdeen|hearts|hibernian|motherwell|dundee|kilmarnock/.test(h+a);
    return true;
  }) : events;
  if (pool.length) return Math.min(1, 0.40 + (pool.length>3?0.2:0));
  return 0.25;
}

function regionIndex(rg, weatherRow, events, news, bh, now){
  const [id,name,abbr,lat,lon,char] = rg;
  const temp = weatherRow?.current?.temperature_2m ?? 14;
  const precip = weatherRow?.current?.precipitation ?? 0;
  const s = {
    time:      scoreTime(now),
    football:  scoreFootball(events, id),
    news:      scoreNews(news),
    weather:   scoreTempAndRain(temp, precip),
    booze:     scoreBooze(now),
    bh:        scoreBankHoliday(bh),
    transport: id==='lon' ? Math.min(1, rushHour(now)+0.1) : rushHour(now),
    roadrage:  rushHour(now),
    daylight:  scoreDaylight(now.getMonth()),
    england:   0.25,
    moon:      scoreMoon(now),
    greggs:    scoreGreggs(now),
  };
  let idx = 0;
  for (const [k,v] of Object.entries(s)) idx += v * (WEIGHTS[k]||0);
  return { id, name, abbr, score: Math.max(0, Math.min(100, Math.round((idx+char)*100))), signals:s, temp, precip };
}

function composeTweet(national, hotRegions, now){
  const tier = tierFor(national.score);
  const emoji = national.score>=76 ? '🔴' : national.score>=46 ? '🟠' : national.score>=31 ? '🟡' : '🟢';
  const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()];
  const topThree = hotRegions.slice(0,3).map(r => `${r.abbr} ${r.score}`).join(' · ');
  // Rotate through a handful of voice variants so feed doesn't feel robotic
  const variants = [
    `${emoji} UK Kick-Off Index now: ${national.score}/100 — ${tier}.\nHottest: ${topThree}.\nLive: ${SITE_URL}`,
    `${emoji} ${dayName} reading: ${national.score}/100 — ${tier} across the UK.\nTop spots: ${topThree}.\n${SITE_URL}`,
    `${emoji} ${tier}. ${national.score}/100.\n🔥 ${topThree}\nGauge → ${SITE_URL}`,
  ];
  const pick = variants[now.getDate() % variants.length];
  // Keep within 280 chars
  return pick.length > 280 ? pick.slice(0, 277)+'...' : pick;
}

// ---- main ----
async function main(){
  const now = new Date();
  const [weather, football, news, bh] = await Promise.all([
    fetchWeather().catch(e => { console.error('weather:',e.message); return []; }),
    fetchFootball(now).catch(e => { console.error('football:',e.message); return []; }),
    fetchNews().catch(e => { console.error('news:',e.message); return []; }),
    fetchBankHolidays().catch(e => { console.error('bh:',e.message); return null; }),
  ]);

  // Per-region
  const regional = REGIONS.map((rg,i) => regionIndex(rg, weather[i], football, news, bh, now));
  regional.sort((a,b) => b.score - a.score);
  // National = population-weighted average of regional scores.
  // Rough weights: LON 0.14, SE 0.14, NW 0.11, EE 0.10, YH 0.08, SCO 0.08, SW 0.09, WM 0.09, EM 0.07, WAL 0.05, NE 0.04, NIR 0.03
  const popW = { lon:.14, se:.14, nw:.11, ee:.10, yh:.08, sco:.08, sw:.09, wm:.09, em:.07, wal:.05, ne:.04, nir:.03 };
  const nationalScore = Math.round(regional.reduce((acc,r)=> acc + r.score*(popW[r.id]||0), 0));
  const national = { score: nationalScore };

  const text = composeTweet(national, regional, now);
  console.log('--- Tweet ---');
  console.log(text);
  console.log('--- ----- ---');
  console.log(`(${text.length} chars)`);

  if (DRY){ console.log('DRY RUN — not posting.'); return; }

  const required = ['TWITTER_API_KEY','TWITTER_API_SECRET','TWITTER_ACCESS_TOKEN','TWITTER_ACCESS_SECRET'];
  for (const k of required){ if (!process.env[k]){ throw new Error(`Missing env: ${k}`); } }
  const client = new TwitterApi({
    appKey:       process.env.TWITTER_API_KEY,
    appSecret:    process.env.TWITTER_API_SECRET,
    accessToken:  process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
  });
  const result = await client.v2.tweet(text);
  console.log('Posted:', result?.data?.id);
}

main().catch(e => { console.error(e); process.exit(1); });
