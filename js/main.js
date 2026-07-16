/* =====================================================
   Gold Price Nepal – main.js
   Primary:  data/prices.json  (updated by GitHub Actions every 4h from FENEGOSIDA)
   Fallback: fawazahmed0 CDN XAU/NPR + 20% duty + 13% VAT
   Chart:    ApexCharts  (line + candlestick)
   ===================================================== */

const TOLA_GRAMS     = 11.664;
const TROY_OZ_GRAMS  = 31.1035;
const NEPAL_PREMIUM  = 1.382;   // fallback: 20% duty + 13% VAT + ~2% margin (no luxury tax)
const SILVER_PREMIUM = 1.12;
const REFRESH_MS     = 5 * 60 * 1000;

// Nepali traditional weight units
const AANA_PER_TOLA  = 16;
const LAL_PER_AANA   = 10;   // 1 Tola = 16 Aana = 160 Lal

const PRICES_JSON = './data/prices.json';
const RATES_JSON  = './data/rates.json';
const CDN_BASE    = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api';

const state = {
  goldUSD:          0,
  goldNPR:          0,       // international XAU/NPR (per troy oz)
  silverTolaNPR:    0,       // silver price per tola in NPR
  yesterdayNPR:     0,
  xagNPR:           0,       // today's XAG in NPR per troy oz
  xagYestNPR:       0,       // yesterday's XAG in NPR per troy oz
  usdNPR:           135,
  nepal24kTola:     0,       // FENEGOSIDA price (or fallback)
  nepal24kTolaPrev: 0,       // yesterday's FENEGOSIDA 24K price (from prices.json)
  silverTolaPrev:   0,       // yesterday's FENEGOSIDA silver price
  priceSource:      'loading',  // 'fenegosida' | 'international'
  chartPeriod:      '7d',
  chartType:        'line',
  apexChart:        null
};
window._gpnState = state;

/* ── helpers ── */
const fmt = n  => n ? Math.round(n).toLocaleString('en-NP') : '—';
const el  = id => document.getElementById(id);
const els = s  => document.querySelectorAll(s);
const set = (id, v) => { const e = el(id); if (e) e.textContent = v; };

function isoDate(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

async function fetchWithTimeout(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  } catch (e) { clearTimeout(t); throw e; }
}

/* ── cache ── */
function saveCache(o) {
  try { localStorage.setItem('gnp_v4', JSON.stringify({ ...o, ts: Date.now() })); } catch (_) {}
}
function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem('gnp_v4') || 'null');
    if (c && Date.now() - c.ts < 3_600_000) return c;
  } catch (_) {}
  return null;
}

/* ══════════════════════════════════════════
   FENEGOSIDA prices (served via GitHub Actions → data/prices.json)
   GitHub Actions runs every 4h, scrapes fenegosida.org, commits the JSON.
   Same-origin fetch — no CORS proxy needed.
══════════════════════════════════════════ */
async function fetchFENEGOSIDA() {
  try {
    const data = await fetchWithTimeout(`${PRICES_JSON}?v=${Date.now()}`, 8000).then(r => r.json());
    const g = data?.gold24kTola;
    if (!g || g < 80000 || g > 700000) throw new Error(`Invalid gold price in prices.json: ${g}`);
    return {
      gold24kTola:     g,
      silverTola:      data?.silverTola      || 0,
      gold24kTolaPrev: data?.gold24kTolaPrev || 0,
      silverTolaPrev:  data?.silverTolaPrev  || 0,
    };
  } catch (err) {
    console.error('Fetch failure context [prices.json]:', err);
    throw err;
  }
}

/* ══════════════════════════════════════════
   International fallback  (XAU / XAG CDN)
══════════════════════════════════════════ */
async function fetchXAU(dateStr) {
  const url = `${CDN_BASE}@${dateStr}/v1/currencies/xau.json`;
  return fetchWithTimeout(url, 10000).then(r => r.json());
}
async function fetchXAG(dateStr = 'latest') {
  return fetchWithTimeout(`${CDN_BASE}@${dateStr}/v1/currencies/xag.json`, 10000).then(r => r.json());
}

/* ══════════════════════════════════════════
   Master fetch – FENEGOSIDA primary, XAU fallback.
   IMPORTANT: XAU CDN failure must NOT block the gold price render.
   prices.json is same-origin and always reachable on the custom domain.
   XAU is only needed as a fallback when FENEGOSIDA itself fails.
══════════════════════════════════════════ */
async function fetchPrices() {
  try {
    const [fenegosidaRes, xauTodayRes, xauYestRes, xagTodayRes, xagYestRes] = await Promise.allSettled([
      fetchFENEGOSIDA(),
      fetchXAU(isoDate(0)),
      fetchXAU(isoDate(1)),
      fetchXAG(),
      fetchXAG(isoDate(1))
    ]);

    // Log every CDN failure verbosely so devtools shows the exact blocked URL
    if (xauTodayRes.status === 'rejected')
      console.error('Fetch failure context [XAU today CDN]:', xauTodayRes.reason);
    if (xauYestRes.status === 'rejected')
      console.error('Fetch failure context [XAU yesterday CDN]:', xauYestRes.reason);
    if (xagTodayRes.status === 'rejected')
      console.error('Fetch failure context [XAG today CDN]:', xagTodayRes.reason);
    if (xagYestRes.status === 'rejected')
      console.error('Fetch failure context [XAG yesterday CDN]:', xagYestRes.reason);

    // XAU is optional — used for USD rate display and international fallback only
    const xauToday   = xauTodayRes.status === 'fulfilled' ? xauTodayRes.value : null;
    const goldUSD    = xauToday?.xau?.usd  || 0;
    const goldNPR    = xauToday?.xau?.npr  || 0;
    const usdNPR     = goldUSD && goldNPR ? goldNPR / goldUSD : state.usdNPR;
    const yestNPR    = xauYestRes.status  === 'fulfilled' ? (xauYestRes.value?.xau?.npr  || 0) : 0;
    const xagNPR     = xagTodayRes.status === 'fulfilled' ? (xagTodayRes.value?.xag?.npr || 0) : 0;
    const xagYestNPR = xagYestRes.status  === 'fulfilled' ? (xagYestRes.value?.xag?.npr  || 0) : 0;

    const fData = fenegosidaRes.status === 'fulfilled' ? fenegosidaRes.value : null;

    let nepal24kTola, silverTolaNPR, nepal24kTolaPrev, silverTolaPrev, priceSource;

    if (fData?.gold24kTola) {
      // Primary path: FENEGOSIDA same-origin fetch — always works on custom domain
      nepal24kTola     = fData.gold24kTola;
      silverTolaNPR    = fData.silverTola      || 0;
      nepal24kTolaPrev = fData.gold24kTolaPrev || 0;
      silverTolaPrev   = fData.silverTolaPrev  || 0;
      priceSource      = 'fenegosida';
    } else if (goldNPR) {
      // Fallback: compute from international XAU rate if FENEGOSIDA is unreachable
      console.warn('Fetch failure context [FENEGOSIDA → switching to international]:', fenegosidaRes.reason);
      nepal24kTola     = (goldNPR / TROY_OZ_GRAMS) * TOLA_GRAMS * NEPAL_PREMIUM;
      silverTolaNPR    = xagNPR ? (xagNPR / TROY_OZ_GRAMS) * TOLA_GRAMS * SILVER_PREMIUM : 0;
      nepal24kTolaPrev = yestNPR ? (yestNPR / goldNPR) * nepal24kTola : 0;
      silverTolaPrev   = 0;
      priceSource      = 'international';
    } else {
      // Both sources failed — fall through to cache
      throw new Error('All price sources failed: FENEGOSIDA unreachable and XAU CDN blocked');
    }

    Object.assign(state, {
      goldUSD, goldNPR, silverTolaNPR, yesterdayNPR: yestNPR,
      xagNPR, xagYestNPR, usdNPR,
      nepal24kTola, nepal24kTolaPrev, silverTolaPrev,
      priceSource
    });
    saveCache({
      goldUSD, goldNPR, silverTolaNPR, yesterdayNPR: yestNPR,
      xagNPR, xagYestNPR, usdNPR,
      nepal24kTola, nepal24kTolaPrev, silverTolaPrev,
      priceSource
    });
    renderUI();

  } catch (err) {
    console.error('Fetch failure context [fetchPrices — loading from cache]:', err);
    const c = loadCache();
    if (c) {
      Object.assign(state, c);
      renderUI();
    }
    els('.error-banner').forEach(b => b.classList.add('show'));
  }
}

/* ══════════════════════════════════════════
   Price calculations
══════════════════════════════════════════ */
function calcPrices() {
  const base24kTola = state.nepal24kTola;
  const base24kGram = base24kTola / TOLA_GRAMS;

  // Silver: FENEGOSIDA gives per-tola directly; derive gram and 10g from it
  const silvTola = state.silverTolaNPR || 0;
  const silvGram = silvTola / TOLA_GRAMS;

  // Gold purities: proportional from 24K FENEGOSIDA price
  const gold = k => ({
    perTola: base24kTola * (k / 24),
    perGram: base24kGram * (k / 24),
    per10g:  base24kGram * (k / 24) * 10
  });

  return {
    '24k': gold(24), '22k': gold(22), '18k': gold(18), '14k': gold(14),
    silver: { perTola: silvTola, perGram: silvGram, per10g: silvGram * 10 }
  };
}

/* ══════════════════════════════════════════
   Render UI
══════════════════════════════════════════ */
function renderUI() {
  const { goldUSD, goldNPR, usdNPR, silverTolaNPR, yesterdayNPR,
          nepal24kTola, nepal24kTolaPrev, silverTolaPrev, priceSource } = state;
  if (!nepal24kTola) return;

  try {

  const p = calcPrices();

  // Yesterday 24K: prefer FENEGOSIDA prev (baked in prices.json), fall back to XAU ratio
  const yestTola  = nepal24kTolaPrev > 0
    ? nepal24kTolaPrev
    : (yesterdayNPR && goldNPR ? (yesterdayNPR / goldNPR) * nepal24kTola : 0);
  const changeAbs = yestTola ? nepal24kTola - yestTola : 0;
  const changePct = yestTola ? (changeAbs / yestTola) * 100 : 0;
  const isUp      = changePct >= 0;
  const sign      = isUp ? '+' : '';

  /* ticker */
  set('ticker-gold',   `NPR ${fmt(p['24k'].perTola)}/tola`);
  set('ticker-22k',    `NPR ${fmt(p['22k'].perTola)}/tola`);
  set('ticker-silver', silverTolaNPR ? `NPR ${fmt(p.silver.perTola)}/tola` : '—');
  set('ticker-usd',    `USD ${goldUSD.toFixed(2)}/oz`);
  set('ticker-rate',   `1 USD = NPR ${usdNPR.toFixed(2)}`);

  /* hero price cards */
  ['24k','22k','18k'].forEach(k => {
    set(`price-${k}`,      `NPR ${fmt(p[k].perTola)}`);
    set(`price-${k}-gram`, `NPR ${fmt(p[k].perGram)}/g`);
    const chEl = el(`change-${k}`);
    if (chEl) {
      chEl.className = 'price-change';
      chEl.innerHTML = yestTola
        ? `<span class="trend-pill ${isUp ? 'up' : 'down'}">${isUp ? '↑' : '↓'} ${sign}${changePct.toFixed(2)}% vs yesterday</span>`
        : '—';
    }
  });

  /* silver hero card change pill */
  const silverChEl = el('hero-silver-change');
  if (silverChEl && silverTolaNPR) {
    const { xagNPR, xagYestNPR } = state;
    // Prefer FENEGOSIDA prev-day silver (from prices.json), fall back to XAG ratio
    const silvYestTola = silverTolaPrev > 0
      ? silverTolaPrev
      : (xagNPR && xagYestNPR ? (xagYestNPR / xagNPR) * silverTolaNPR : 0);
    silverChEl.className = 'price-change';
    if (silvYestTola) {
      const silvChangePct = ((silverTolaNPR - silvYestTola) / silvYestTola) * 100;
      const silvUp   = silvChangePct >= 0;
      const silvSign = silvUp ? '+' : '';
      silverChEl.innerHTML = `<span class="trend-pill ${silvUp ? 'up' : 'down'}">${silvUp ? '↑' : '↓'} ${silvSign}${silvChangePct.toFixed(2)}% vs yesterday</span>`;
    } else {
      silverChEl.innerHTML = '—';
    }
  }

  set('silver-price',    silverTolaNPR ? `NPR ${fmt(p.silver.perTola)}/tola` : '—');
  set('forex-rate',      `1 USD = NPR ${usdNPR.toFixed(2)}`);
  set('intl-gold-price', `USD ${goldUSD.toFixed(2)}/oz`);

  /* stats strip */
  set('stat-24k-tola',    fmt(p['24k'].perTola));
  set('stat-yesterday',   yestTola ? fmt(yestTola) : '—');
  set('stat-22k-tola',    fmt(p['22k'].perTola));
  set('stat-silver-tola', silverTolaNPR ? fmt(p.silver.perTola) : '—');

  const statChEl = el('stat-change');
  if (statChEl) {
    if (yestTola) {
      statChEl.textContent = `${sign}${fmt(Math.abs(changeAbs))} (${sign}${changePct.toFixed(2)}%)`;
      statChEl.style.color = isUp ? 'var(--green)' : 'var(--red)';
    } else {
      statChEl.textContent = '—';
      statChEl.style.color = '';
    }
  }

  /* data source indicator */
  const srcEl = el('stat-source');
  if (srcEl) {
    if (priceSource === 'fenegosida') {
      srcEl.textContent = 'FENEGOSIDA ✓';
      srcEl.style.color = 'var(--green)';
    } else {
      srcEl.textContent = 'Intl. Est.';
      srcEl.style.color = 'var(--gold-500)';
    }
  }

  /* silver hero card */
  if (silverTolaNPR) {
    set('hero-silver-tola', `NPR ${fmt(p.silver.perTola)}`);
    set('hero-silver-gram', `NPR ${fmt(p.silver.perGram)}/g`);
  }

  /* rate table */
  ['24k','22k','18k','14k'].forEach(k => {
    set(`tbl-${k}-tola`, `NPR ${fmt(p[k].perTola)}`);
    set(`tbl-${k}-gram`, `NPR ${fmt(p[k].perGram)}`);
    set(`tbl-${k}-10g`,  `NPR ${fmt(p[k].per10g)}`);
  });
  if (silverTolaNPR) {
    set('tbl-silver-tola', `NPR ${fmt(p.silver.perTola)}`);
    set('tbl-silver-gram', `NPR ${fmt(p.silver.perGram)}`);
    set('tbl-silver-10g',  `NPR ${fmt(p.silver.per10g)}`);
  }

  /* refresh calculator, tracker, planner, schema, push notification, new features */
  updateShowroom();
  renderTracker();
  updateGoalPlanner();
  injectPriceSchema();
  maybeSendPriceNotification(nepal24kTola);
  renderPriceContext();
  renderGoldUSD();
  checkPriceAlerts();

  /* timestamps */
  const t = new Date().toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  els('.last-updated-time').forEach(e => (e.textContent = t));

  els('.skeleton').forEach(s => s.classList.remove('skeleton'));
  els('.error-banner').forEach(b => b.classList.remove('show'));

  } catch (err) {
    console.error('renderUI error:', err);
    // Always clear skeletons so users see partial data rather than endless shimmer
    els('.skeleton').forEach(s => s.classList.remove('skeleton'));
  }

  renderChart();
}

/* ══════════════════════════════════════════
   ApexCharts
══════════════════════════════════════════ */
// null = intraday (24 hourly pts), number = daily pts
const DAYS_MAP = { '1d': null, '7d': 7, '1m': 30, '3m': 90 };

function makeHourlyLine(base) {
  const vol = base * 0.0012, pts = [];
  let p = base * 0.988;
  const now = new Date();
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now); d.setMinutes(0,0,0); d.setHours(d.getHours() - i);
    p += (Math.random() - 0.47) * vol;
    if (i === 0) p = base;
    pts.push([d.getTime(), Math.round(Math.max(p, base * 0.978))]);
  }
  return pts;
}
function makeHourlyOHLC(base) {
  const vol = base * 0.0012, data = [];
  let close = base * 0.988;
  const now = new Date();
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now); d.setMinutes(0,0,0); d.setHours(d.getHours() - i);
    const open = close, move = i === 0 ? base - close : (Math.random() - 0.47) * vol;
    close = i === 0 ? base : Math.max(open + move, base * 0.978);
    data.push({ x: d.getTime(), y: [Math.round(open), Math.round(Math.max(open,close)+Math.random()*vol*.4), Math.round(Math.min(open,close)-Math.random()*vol*.4), Math.round(close)] });
  }
  return data;
}
function makeLineData(base, days) {
  const vol = base * 0.007, pts = [];
  let p = base;
  for (let i = days; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate()-i); d.setHours(10,0,0,0);
    if (i > 0) p -= (Math.random()-.48)*vol; else p = base;
    pts.push([d.getTime(), Math.round(Math.max(p, base*.85))]);
  }
  return pts;
}
function makeOHLC(base, days) {
  const vol = base * 0.008, data = [];
  let close = base * (1 - days * 0.001);
  for (let i = days; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate()-i); d.setHours(10,0,0,0);
    const open = i===0 ? close : close*(1+(Math.random()-.5)*0.003);
    const move = i===0 ? base-close : (Math.random()-.46)*vol;
    close = i===0 ? base : Math.max(open+move, base*.85);
    data.push({ x: d.getTime(), y: [Math.round(open), Math.round(Math.max(open,close)+Math.random()*vol*.35), Math.round(Math.min(open,close)-Math.random()*vol*.35), Math.round(close)] });
  }
  return data;
}

const apexFmt = v => v ? 'NPR ' + Math.round(v).toLocaleString('en-NP') + '/Tola' : '';

function buildLineOpts(data) {
  return {
    chart: { type:'area', height:320, toolbar:{show:false}, background:'transparent', fontFamily:'inherit', animations:{enabled:false} },
    colors: ['#C9972E'],
    dataLabels: { enabled:false },
    stroke: { curve:'smooth', width:2.5 },
    fill: { type:'gradient', gradient:{ shadeIntensity:1, opacityFrom:0.3, opacityTo:0, stops:[0,100] } },
    series: [{ name:'Gold (NPR/Tola)', data }],
    grid: { borderColor:'#F3F4F6', strokeDashArray:3, padding:{right:8} },
    xaxis: { type:'datetime', labels:{ style:{colors:'#6B7280',fontSize:'11px'}, datetimeUTC:false }, axisBorder:{show:false}, axisTicks:{show:false} },
    yaxis: { labels:{ style:{colors:'#6B7280',fontSize:'11px'}, formatter: v => 'NPR '+Math.round(v).toLocaleString('en-NP') } },
    tooltip: { theme:'dark', x:{format:'dd MMM yyyy'}, y:{formatter:apexFmt} },
    markers: { size:0, hover:{size:5} }
  };
}
function buildCandleOpts(data) {
  return {
    chart: { type:'candlestick', height:320, toolbar:{show:false}, background:'transparent', fontFamily:'inherit', animations:{enabled:false} },
    series: [{ name:'Gold', data }],
    plotOptions: { candlestick:{ colors:{upward:'#10B981',downward:'#EF4444'}, wick:{useFillColor:true} } },
    grid: { borderColor:'#F3F4F6', strokeDashArray:3, padding:{right:8} },
    xaxis: { type:'datetime', labels:{ style:{colors:'#6B7280',fontSize:'11px'}, datetimeUTC:false }, axisBorder:{show:false}, axisTicks:{show:false} },
    yaxis: { labels:{ style:{colors:'#6B7280',fontSize:'11px'}, formatter: v => 'NPR '+Math.round(v).toLocaleString('en-NP') } },
    tooltip: { theme:'dark', x:{format:'dd MMM yyyy'}, y:{formatter:apexFmt} }
  };
}

function renderChart() {
  const container = el('goldChart');
  if (!container || !state.nepal24kTola) return;

  const base = state.nepal24kTola;  // use FENEGOSIDA price as chart anchor
  const days = DAYS_MAP[state.chartPeriod];

  if (state.apexChart) { state.apexChart.destroy(); state.apexChart = null; }

  let opts;
  if (state.chartType === 'candlestick') {
    opts = buildCandleOpts(days === null ? makeHourlyOHLC(base) : makeOHLC(base, days));
  } else {
    opts = buildLineOpts(days === null ? makeHourlyLine(base) : makeLineData(base, days));
  }

  state.apexChart = new ApexCharts(container, opts);
  state.apexChart.render();
}

function setupChartTabs() {
  els('.chart-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      els('.chart-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.chartPeriod = tab.dataset.period;
      renderChart();
    });
  });
}
function setupChartTypeTabs() {
  els('.chart-type-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      els('.chart-type-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.chartType = tab.dataset.type;
      renderChart();
    });
  });
}

/* ══════════════════════════════════════════
   Nepali weight converter + showroom price
══════════════════════════════════════════ */
let _calcPurity = '24k';
let _lastTola   = 0;
let _updating   = false; // guard against programmatic-set → input event loops

function setupCalculator() {
  // purity toggle
  els('.purity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      els('.purity-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _calcPurity = btn.dataset.k;
      updateShowroom();
    });
  });

  // bidirectional weight inputs — direct (no debounce), guarded by _updating
  ['tola','aana','lal','gram'].forEach(f => {
    const inp = el('wc-' + f);
    if (!inp) return;
    inp.addEventListener('input', () => {
      if (_updating) return;
      handleWeightInput(f, inp.value);
    });
  });

  // making charges slider
  const slider = el('making-slider');
  if (slider) {
    slider.addEventListener('input', () => {
      set('making-pct-badge', slider.value + '%');
      updateSliderFill(slider);
      updateShowroom();
    });
    updateSliderFill(slider);
  }
}

function updateSliderFill(slider) {
  const pct = (slider.value / slider.max) * 100;
  slider.style.background =
    `linear-gradient(to right,var(--gold-500) 0%,var(--gold-500) ${pct}%,var(--dark-200) ${pct}%,var(--dark-200) 100%)`;
}

function handleWeightInput(field, raw) {
  const v = parseFloat(raw);

  // empty / invalid — clear other fields
  if (raw === '' || raw === null || isNaN(v) || v < 0) {
    _lastTola = 0;
    _updating = true;
    ['tola','aana','lal','gram'].forEach(f => { if (f !== field) setWCVal(f, ''); });
    _updating = false;
    updateShowroom();
    return;
  }

  // convert typed value to tola
  let tola;
  switch (field) {
    case 'tola': tola = v; break;
    case 'aana': tola = v / AANA_PER_TOLA; break;
    case 'lal':  tola = v / (AANA_PER_TOLA * LAL_PER_AANA); break;
    case 'gram': tola = v / TOLA_GRAMS; break;
    default: return;
  }
  _lastTola = tola;

  // update the other three fields without re-triggering input handler
  _updating = true;
  if (field !== 'tola') setWCVal('tola', fmt4(tola));
  if (field !== 'aana') setWCVal('aana', fmt4(tola * AANA_PER_TOLA));
  if (field !== 'lal')  setWCVal('lal',  fmt4(tola * AANA_PER_TOLA * LAL_PER_AANA));
  if (field !== 'gram') setWCVal('gram', fmt4(tola * TOLA_GRAMS));
  _updating = false;

  updateShowroom();
}

// set a wc-input value; prefix 'wc-' internally
function setWCVal(field, v) {
  const e = el('wc-' + field);
  if (!e) return;
  e.value = (v === '' || v === 0) ? '' : v;
}

// round to max 4 decimal places, strip trailing zeros
function fmt4(n) {
  if (!n || n === 0) return '';
  return parseFloat(n.toFixed(4));
}

function updateShowroom() {
  const isSilver   = _calcPurity === 'silver';
  const priceReady = isSilver ? state.silverTolaNPR > 0 : state.nepal24kTola > 0;
  const metalLabel = isSilver ? 'Silver Value' : 'Gold Value (Raw)';
  set('sr-metal-label', metalLabel);

  if (!priceReady || _lastTola <= 0) {
    set('sr-gold-value',  'Enter a weight above');
    set('sr-making-cost', '—');
    set('sr-total',       '—');
    return;
  }
  const p         = calcPrices();
  const pPerTola  = p[_calcPurity]?.perTola || 0;
  const slider    = el('making-slider');
  const makingPct = slider ? parseInt(slider.value, 10) : 12;
  const metalVal  = Math.round(pPerTola * _lastTola);
  const makeVal   = Math.round(metalVal * makingPct / 100);
  const total     = metalVal + makeVal;

  set('sr-gold-value',  `NPR ${metalVal.toLocaleString('en-NP')}`);
  set('sr-making-cost', makingPct > 0 ? `NPR ${makeVal.toLocaleString('en-NP')}` : 'None');
  set('sr-total',       `NPR ${total.toLocaleString('en-NP')}`);
}

/* ══════════════════════════════════════════
   Dynamic JSON-LD price schema injection
   Runs after each price fetch so Google sees
   fresh numeric values, not placeholder zeros.
══════════════════════════════════════════ */
function injectPriceSchema() {
  const schemaEl = document.getElementById('priceSchema');
  if (!schemaEl || !state.nepal24kTola) return;

  const p     = calcPrices();
  const gold24 = Math.round(p['24k'].perTola);
  const gold22 = Math.round(p['22k'].perTola);
  const silver = Math.round(state.silverTolaNPR || 0);

  // priceValidUntil = end of today (Nepal is UTC+5:45, round to midnight UTC+6)
  const tomorrow = new Date();
  tomorrow.setUTCHours(18, 15, 0, 0);        // 18:15 UTC ≈ midnight Nepal (UTC+5:45)
  if (tomorrow <= new Date()) tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const validUntil = tomorrow.toISOString().split('T')[0];

  // Build graph with real numeric prices — no commas, no currency symbols
  const graph = [
    {
      '@type': 'Product',
      '@id': 'https://goldpricenepal.online/#gold-24k',
      'name': 'Fine Gold 24K Price in Nepal',
      'description': `Today's official FENEGOSIDA 24K Fine Gold price: NPR ${gold24} per tola. Updated every 4 hours.`,
      'image': 'https://goldpricenepal.online/logo.svg',
      'brand': { '@type': 'Brand', 'name': 'FENEGOSIDA' },
      'offers': {
        '@type': 'Offer',
        'priceCurrency': 'NPR',
        'price': gold24,
        'priceValidUntil': validUntil,
        'availability': 'https://schema.org/InStock',
        'url': 'https://goldpricenepal.online/',
        'seller': { '@type': 'Organization', 'name': 'goldpricenepal.online' },
        'shippingDetails': {
          '@type': 'OfferShippingDetails',
          'shippingRate': { '@type': 'MonetaryAmount', 'value': '0', 'currency': 'NPR' },
          'shippingDestination': { '@type': 'DefinedRegion', 'addressCountry': 'NP' },
          'deliveryTime': {
            '@type': 'ShippingDeliveryTime',
            'handlingTime': { '@type': 'QuantitativeValue', 'minValue': 0, 'maxValue': 1, 'unitCode': 'DAY' },
            'transitTime':  { '@type': 'QuantitativeValue', 'minValue': 1, 'maxValue': 3, 'unitCode': 'DAY' }
          }
        },
        'hasMerchantReturnPolicy': {
          '@type': 'MerchantReturnPolicy',
          'applicableCountry': 'NP',
          'returnPolicyCategory': 'https://schema.org/MerchantReturnNotPermitted'
        }
      }
    },
    {
      '@type': 'Product',
      '@id': 'https://goldpricenepal.online/#gold-22k',
      'name': 'Tejabi Gold 22K Price in Nepal',
      'description': `Today's FENEGOSIDA Tejabi 22K Gold price: NPR ${gold22} per tola. Updated every 4 hours.`,
      'image': 'https://goldpricenepal.online/logo.svg',
      'brand': { '@type': 'Brand', 'name': 'FENEGOSIDA' },
      'offers': {
        '@type': 'Offer',
        'priceCurrency': 'NPR',
        'price': gold22,
        'priceValidUntil': validUntil,
        'availability': 'https://schema.org/InStock',
        'url': 'https://goldpricenepal.online/',
        'seller': { '@type': 'Organization', 'name': 'goldpricenepal.online' },
        'shippingDetails': {
          '@type': 'OfferShippingDetails',
          'shippingRate': { '@type': 'MonetaryAmount', 'value': '0', 'currency': 'NPR' },
          'shippingDestination': { '@type': 'DefinedRegion', 'addressCountry': 'NP' },
          'deliveryTime': {
            '@type': 'ShippingDeliveryTime',
            'handlingTime': { '@type': 'QuantitativeValue', 'minValue': 0, 'maxValue': 1, 'unitCode': 'DAY' },
            'transitTime':  { '@type': 'QuantitativeValue', 'minValue': 1, 'maxValue': 3, 'unitCode': 'DAY' }
          }
        },
        'hasMerchantReturnPolicy': {
          '@type': 'MerchantReturnPolicy',
          'applicableCountry': 'NP',
          'returnPolicyCategory': 'https://schema.org/MerchantReturnNotPermitted'
        }
      }
    }
  ];

  if (silver > 0) {
    graph.push({
      '@type': 'Product',
      '@id': 'https://goldpricenepal.online/#silver',
      'name': 'Silver (Chandi) Price in Nepal',
      'description': `Today's FENEGOSIDA Silver price: NPR ${silver} per tola. Updated every 4 hours.`,
      'image': 'https://goldpricenepal.online/logo.svg',
      'brand': { '@type': 'Brand', 'name': 'FENEGOSIDA' },
      'offers': {
        '@type': 'Offer',
        'priceCurrency': 'NPR',
        'price': silver,
        'priceValidUntil': validUntil,
        'availability': 'https://schema.org/InStock',
        'url': 'https://goldpricenepal.online/',
        'seller': { '@type': 'Organization', 'name': 'goldpricenepal.online' },
        'shippingDetails': {
          '@type': 'OfferShippingDetails',
          'shippingRate': { '@type': 'MonetaryAmount', 'value': '0', 'currency': 'NPR' },
          'shippingDestination': { '@type': 'DefinedRegion', 'addressCountry': 'NP' },
          'deliveryTime': {
            '@type': 'ShippingDeliveryTime',
            'handlingTime': { '@type': 'QuantitativeValue', 'minValue': 0, 'maxValue': 1, 'unitCode': 'DAY' },
            'transitTime':  { '@type': 'QuantitativeValue', 'minValue': 1, 'maxValue': 3, 'unitCode': 'DAY' }
          }
        },
        'hasMerchantReturnPolicy': {
          '@type': 'MerchantReturnPolicy',
          'applicableCountry': 'NP',
          'returnPolicyCategory': 'https://schema.org/MerchantReturnNotPermitted'
        }
      }
    });
  }

  try {
    schemaEl.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
  } catch (_) {}
}

/* ══════════════════════════════════════════
   Gold Investment Tracker
══════════════════════════════════════════ */
const TRACKER_KEY = 'gnp_tracker_v1';
let _trackerPurity = '24k';

const PURITY_LABELS = { '24k': '24K Fine', '22k': '22K Tejabi', '18k': '18K', '14k': '14K', 'silver': 'Silver' };

function loadInvestments() {
  try { return JSON.parse(localStorage.getItem(TRACKER_KEY) || '[]'); }
  catch (_) { return []; }
}

function saveInvestments(list) {
  try { localStorage.setItem(TRACKER_KEY, JSON.stringify(list)); } catch (_) {}
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

function setupTracker() {
  // purity buttons
  els('#trackerPurityBtns .purity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      els('#trackerPurityBtns .purity-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _trackerPurity = btn.dataset.k;
    });
  });

  // "Use today's rate" button
  const todayBtn = el('trUseTodayBtn');
  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      if (!state.nepal24kTola) return;
      const p = calcPrices();
      const inp = el('tr-buy-price');
      if (inp) inp.value = Math.round(p[_trackerPurity]?.perTola || 0);
    });
  }

  // add button
  const addBtn = el('addInvestmentBtn');
  if (addBtn) addBtn.addEventListener('click', addInvestment);

  // delete via event delegation
  const listEl = el('trackerList');
  if (listEl) {
    listEl.addEventListener('click', e => {
      const btn = e.target.closest('.tracker-delete');
      if (btn) {
        const card = btn.closest('.tracker-card');
        if (card) deleteInvestment(card.dataset.id);
      }
    });
  }

  renderTracker();
}

function addInvestment() {
  const weightRaw   = el('tr-weight')?.value;
  const buyPriceRaw = el('tr-buy-price')?.value;
  const weightVal   = parseFloat(weightRaw);
  const buyPriceVal = parseFloat(buyPriceRaw);

  if (!weightRaw || isNaN(weightVal) || weightVal <= 0) {
    showTrackerError('Please enter a valid weight in tola (e.g. 1.5).');
    return;
  }
  if (!buyPriceRaw || isNaN(buyPriceVal) || buyPriceVal <= 0) {
    showTrackerError('Please enter the price per tola you paid (e.g. 250000).');
    return;
  }

  const dateVal  = el('tr-date')?.value || '';
  const labelVal = (el('tr-label')?.value || '').trim().slice(0, 60);

  const investments = loadInvestments();
  investments.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    purity: _trackerPurity,
    weightTola: weightVal,
    buyPricePerTola: buyPriceVal,
    date: dateVal,
    label: labelVal
  });
  saveInvestments(investments);

  // reset form fields
  ['tr-weight', 'tr-buy-price', 'tr-date', 'tr-label'].forEach(id => {
    const inp = el(id); if (inp) inp.value = '';
  });

  renderTracker();
}

function deleteInvestment(id) {
  saveInvestments(loadInvestments().filter(inv => inv.id !== id));
  renderTracker();
}

function showTrackerError(msg) {
  const errEl = el('trackerError');
  if (!errEl) return;
  errEl.textContent = msg;
  errEl.style.display = 'flex';
  setTimeout(() => { errEl.style.display = 'none'; }, 4000);
}

function renderTracker() {
  const investments = loadInvestments();
  const listEl    = el('trackerList');
  const emptyEl   = el('trackerEmpty');
  const summaryEl = el('trackerSummary');
  if (!listEl) return;

  if (investments.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl)   emptyEl.style.display   = 'block';
    if (summaryEl) summaryEl.style.display = 'none';
    return;
  }

  if (emptyEl)   emptyEl.style.display   = 'none';
  if (summaryEl) summaryEl.style.display = 'grid';

  const p = state.nepal24kTola ? calcPrices() : null;

  let totalInvested = 0, totalCurrentValue = 0;
  let html = '';

  investments.forEach(inv => {
    const invested = inv.weightTola * inv.buyPricePerTola;
    totalInvested += invested;

    let currentPerTola = 0, currentValue = 0, pnl = 0, pnlPct = 0;
    const hasPrice = !!p;
    if (p) {
      currentPerTola = p[inv.purity]?.perTola || 0;
      currentValue   = inv.weightTola * currentPerTola;
      totalCurrentValue += currentValue;
      pnl    = currentValue - invested;
      pnlPct = invested ? (pnl / invested) * 100 : 0;
    }

    const isUp    = pnl >= 0;
    const sign    = isUp ? '+' : '';
    const dateStr = fmtDate(inv.date);

    const pnlCell = hasPrice
      ? `<span class="trend-pill ${isUp ? 'up' : 'down'}">${isUp ? '▲' : '▼'} ${sign}NPR ${fmt(Math.abs(pnl))} (${sign}${pnlPct.toFixed(2)}%)</span>`
      : '—';

    html += `
      <div class="tracker-card" data-id="${escapeHtml(inv.id)}" role="listitem">
        <div class="tracker-card-header">
          <div class="tracker-card-meta">
            <span class="badge ${inv.purity === 'silver' ? 'badge-silver' : 'badge-gold'}">${escapeHtml(PURITY_LABELS[inv.purity] || inv.purity)}</span>
            ${inv.label  ? `<span class="tracker-inv-label">${escapeHtml(inv.label)}</span>` : ''}
            ${dateStr    ? `<span class="tracker-inv-date">${escapeHtml(dateStr)}</span>`     : ''}
          </div>
          <button class="tracker-delete" aria-label="Remove investment" title="Remove">✕</button>
        </div>
        <div class="tracker-card-body">
          <div>
            <div class="tracker-stat-label">Weight</div>
            <div class="tracker-stat-value">${inv.weightTola} Tola</div>
          </div>
          <div>
            <div class="tracker-stat-label">Buy Price / Tola</div>
            <div class="tracker-stat-value">NPR ${fmt(inv.buyPricePerTola)}</div>
          </div>
          <div>
            <div class="tracker-stat-label">Total Invested</div>
            <div class="tracker-stat-value">NPR ${fmt(invested)}</div>
          </div>
          <div>
            <div class="tracker-stat-label">Today's Price / Tola</div>
            <div class="tracker-stat-value">${hasPrice ? `NPR ${fmt(currentPerTola)}` : '<span class="tracker-loading">Loading…</span>'}</div>
          </div>
          <div>
            <div class="tracker-stat-label">Current Value</div>
            <div class="tracker-stat-value">${hasPrice ? `NPR ${fmt(currentValue)}` : '—'}</div>
          </div>
          <div>
            <div class="tracker-stat-label">Profit / Loss</div>
            <div class="tracker-stat-value">${pnlCell}</div>
          </div>
        </div>
      </div>`;
  });

  listEl.innerHTML = html;

  // summary bar
  const totalPnl    = totalCurrentValue - totalInvested;
  const totalPnlPct = totalInvested ? (totalPnl / totalInvested) * 100 : 0;
  const pnlUp       = totalPnl >= 0;
  const pnlSign     = pnlUp ? '+' : '';
  const pnlColor    = pnlUp ? 'text-green' : 'text-red';

  set('tr-total-invested', `NPR ${fmt(totalInvested)}`);
  set('tr-current-value',  p ? `NPR ${fmt(totalCurrentValue)}` : 'Loading…');

  const pnlEl = el('tr-pnl');
  if (pnlEl) {
    pnlEl.innerHTML = p
      ? `<span class="${pnlColor}">${pnlSign}NPR ${fmt(Math.abs(totalPnl))}<br><small style="font-size:.76rem;font-weight:500;opacity:.85">(${pnlSign}${totalPnlPct.toFixed(2)}%)</small></span>`
      : '—';
  }
  set('tr-holdings', `${investments.length} position${investments.length !== 1 ? 's' : ''}`);
}

/* ══════════════════════════════════════════
   FEATURE 1 — Share Rates
   Web Share API → clipboard → execCommand
══════════════════════════════════════════ */
function setupShareBtn() {
  const btn = el('shareRatesBtn');
  if (!btn) return;
  btn.addEventListener('click', shareRates);
}

async function shareRates() {
  if (!state.nepal24kTola) return;
  const p   = calcPrices();
  const g24 = fmt(p['24k'].perTola);
  const g22 = fmt(p['22k'].perTola);

  const text =
    `🌟 Today's Gold Price in Nepal:\n` +
    `Fine Gold (24K): Rs. ${g24} per tola\n` +
    `Tejabi (22K):    Rs. ${g22} per tola\n\n` +
    `Check live trends & calculate showroom costs:\nhttps://goldpricenepal.online`;

  const shareData = {
    title : "Today's Gold Price in Nepal",
    text,
    url   : 'https://goldpricenepal.online'
  };

  try {
    if (navigator.share && navigator.canShare?.(shareData)) {
      await navigator.share(shareData);
      return;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      showShareToast('✓ Copied to clipboard');
      return;
    }
    legacyCopy(text);
  } catch (err) {
    if (err.name !== 'AbortError') legacyCopy(text);
  }
}

function legacyCopy(str) {
  const ta = document.createElement('textarea');
  ta.value = str;
  ta.style.cssText = 'position:fixed;top:-200px;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); showShareToast('✓ Copied to clipboard'); } catch (_) {}
  document.body.removeChild(ta);
}

function showShareToast(msg) {
  const t = el('shareToast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

/* ══════════════════════════════════════════
   FEATURE 2 — Push Notifications
   Uses browser Notifications API for local
   alerts; OneSignal slot ready in sw.js for
   true background push (configure App ID).
══════════════════════════════════════════ */
const PUSH_DISMISSED_KEY = 'gnp_push_dismissed';

function setupPushNotifications() {
  const prompt     = el('pushPrompt');
  const toggle     = el('pushToggle');
  const dismissBtn = el('pushDismiss');
  if (!prompt || !('Notification' in window)) return;

  // Don't re-show if user dismissed
  if (sessionStorage.getItem(PUSH_DISMISSED_KEY)) return;

  // Restore checked state if already granted
  if (toggle && Notification.permission === 'granted') toggle.checked = true;

  setTimeout(() => { prompt.removeAttribute('hidden'); }, 3000);

  toggle?.addEventListener('change', async () => {
    if (!toggle.checked) return;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') toggle.checked = false;
  });

  dismissBtn?.addEventListener('click', () => {
    prompt.setAttribute('hidden', '');
    sessionStorage.setItem(PUSH_DISMISSED_KEY, '1');
  });
}

// Fires from renderUI() each time prices refresh
function maybeSendPriceNotification(gold24k) {
  if (Notification.permission !== 'granted') return;
  const last = parseInt(sessionStorage.getItem('gnp_last_notif_price') || '0', 10);
  if (!last) { sessionStorage.setItem('gnp_last_notif_price', String(gold24k)); return; }
  if (last === gold24k) return;
  sessionStorage.setItem('gnp_last_notif_price', String(gold24k));
  try {
    new Notification('Gold Price Nepal — Rate Updated', {
      body : `Today’s 24K Gold: NPR ${fmt(gold24k)} per tola`,
      icon : '/apple-touch-icon.png',
      badge: '/favicon-32x32.png',
      tag  : 'gnp-price-update',
      renotify: true
    });
  } catch (_) {}
}

/* ══════════════════════════════════════════
   FEATURE 3 — Remittance Exchange Rate Cards
   Single CDN fetch (already trusted in codebase).
   USD as base → cross-rates vs NPR derived inline.
══════════════════════════════════════════ */
// unit > 1 means "show N units = Rs. X" for small-denomination currencies
const REMIT_PAIRS = [
  { code: 'usd', flag: '🇺🇸', name: 'US Dollar',          abbr: 'USD', unit: 1    },
  { code: 'aed', flag: '🇦🇪', name: 'UAE Dirham',          abbr: 'AED', unit: 1    },
  { code: 'jpy', flag: '🇯🇵', name: 'Japanese Yen',        abbr: 'JPY', unit: 100  },
  { code: 'qar', flag: '🇶🇦', name: 'Qatari Riyal',        abbr: 'QAR', unit: 1    },
  { code: 'gbp', flag: '🇬🇧', name: 'British Pound',       abbr: 'GBP', unit: 1    },
  { code: 'eur', flag: '🇪🇺', name: 'Euro',                abbr: 'EUR', unit: 1    },
  { code: 'aud', flag: '🇦🇺', name: 'Australian Dollar',   abbr: 'AUD', unit: 1    },
  { code: 'sar', flag: '🇸🇦', name: 'Saudi Riyal',         abbr: 'SAR', unit: 1    },
  { code: 'cad', flag: '🇨🇦', name: 'Canadian Dollar',     abbr: 'CAD', unit: 1    },
  { code: 'inr', flag: '🇮🇳', name: 'Indian Rupee',        abbr: 'INR', unit: 1    },
  { code: 'myr', flag: '🇲🇾', name: 'Malaysian Ringgit',   abbr: 'MYR', unit: 1    },
  { code: 'krw', flag: '🇰🇷', name: 'South Korean Won',    abbr: 'KRW', unit: 1000 },
  { code: 'kwd', flag: '🇰🇼', name: 'Kuwaiti Dinar',       abbr: 'KWD', unit: 1    },
  { code: 'bhd', flag: '🇧🇭', name: 'Bahraini Dinar',      abbr: 'BHD', unit: 1    },
];

async function fetchRemitRates() {
  let usdRates = null, rateDate = null;

  // Primary: same-origin rates.json baked by GitHub Actions — no CORS, no CDN dependency
  try {
    const data = await fetchWithTimeout(`${RATES_JSON}?v=${Date.now()}`, 8000).then(r => r.json());
    if (!data?.usd?.npr) throw new Error('rates.json missing usd.npr field');
    usdRates = data.usd;
    rateDate = data.date;
  } catch (localErr) {
    console.error('Fetch failure context [rates.json local]:', localErr);

    // CDN fallback — may be blocked on some mobile networks
    try {
      const data = await fetchWithTimeout(
        `${CDN_BASE}@latest/v1/currencies/usd.json`, 10000
      ).then(r => r.json());
      if (!data?.usd?.npr) throw new Error('CDN usd.json missing npr field');
      usdRates = data.usd;
      rateDate = data.date;
    } catch (cdnErr) {
      console.error('Fetch failure context [remittance CDN fallback]:', cdnErr);
      return;
    }
  }

  const nprPerUsd = usdRates.npr;
  const rates = {};
  REMIT_PAIRS.forEach(({ code }) => {
    rates[code] = code === 'usd' ? nprPerUsd : (nprPerUsd / (usdRates[code] || 1));
  });
  renderRemitCards(rates, rateDate);
}

function renderRemitCards(rates, date) {
  const track = el('remitGrid');
  if (!track) return;

  const dateStr = date
    ? new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';

  const cardsHTML = REMIT_PAIRS.map(({ code, flag, name, abbr, unit }) => {
    const rate = rates[code];
    if (!rate) return '';
    const displayRate = (rate * unit).toFixed(2);
    const unitLabel   = unit > 1 ? `${unit}&nbsp;` : '1&nbsp;';
    return `
      <div class="remit-card">
        <div class="remit-flag" aria-hidden="true">${flag}</div>
        <div class="remit-info">
          <div class="remit-pair">${unitLabel}<strong>${abbr}</strong></div>
          <div class="remit-rate">Rs.&nbsp;${displayRate}</div>
          <div class="remit-name">${name}</div>
        </div>
      </div>`;
  }).join('');

  track.innerHTML = cardsHTML;

  // Clone the track for seamless infinite scroll (purge ALL stale clones first)
  const outer = track.parentElement;
  outer?.querySelectorAll('.remit-scroll-clone').forEach(c => c.remove());
  if (outer) {
    const clone = track.cloneNode(true);
    clone.id = '';
    clone.classList.add('remit-scroll-clone');
    clone.setAttribute('aria-hidden', 'true');
    outer.appendChild(clone);
  }

  set('remitUpdated', dateStr ? `Rates: ${dateStr}` : '');
}

/* ══════════════════════════════════════════
   FEATURE 4 — PWA: Service Worker + Install
══════════════════════════════════════════ */
let _deferredInstallPrompt = null;

function setupPWAInstall() {
  const bar        = el('pwaInstallBar');
  const installBtn = el('pwaInstallBtn');
  const dismissBtn = el('pwaDismissBtn');
  if (!bar) return;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _deferredInstallPrompt = e;
    bar.removeAttribute('hidden');
  });

  installBtn?.addEventListener('click', async () => {
    if (!_deferredInstallPrompt) return;
    _deferredInstallPrompt.prompt();
    const { outcome } = await _deferredInstallPrompt.userChoice;
    _deferredInstallPrompt = null;
    bar.setAttribute('hidden', '');
  });

  dismissBtn?.addEventListener('click', () => {
    bar.setAttribute('hidden', '');
    _deferredInstallPrompt = null;
  });

  // Already installed in standalone mode — keep bar hidden
  if (window.matchMedia('(display-mode: standalone)').matches) {
    bar.setAttribute('hidden', '');
  }
}

/* ══════════════════════════════════════════
   CONNECTION STATUS BANNER
   Tracks online/offline browser events and
   injects a warning strip in the header.
══════════════════════════════════════════ */
function setupConnectionStatus() {
  const banner = el('connBanner');
  const timeEl = el('connBannerTime');
  if (!banner) return;

  function showOffline() {
    const ts = new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    if (timeEl) timeEl.textContent = ts;
    banner.removeAttribute('hidden');
  }

  function showOnline() {
    banner.setAttribute('hidden', '');
  }

  window.addEventListener('offline', showOffline);
  window.addEventListener('online',  showOnline);

  if (!navigator.onLine) showOffline();
}

/* ══════════════════════════════════════════
   GOLD PURCHASE GOAL PLANNER
   Calculates monthly savings needed to buy
   a target weight of gold within N months.
══════════════════════════════════════════ */
let _plannerPurity = '24k';

function setupGoalPlanner() {
  els('#plannerPurityBtns .purity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      els('#plannerPurityBtns .purity-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _plannerPurity = btn.dataset.k;
      updateGoalPlanner();
    });
  });

  ['pl-weight', 'pl-months'].forEach(id => {
    const inp = el(id);
    if (inp) inp.addEventListener('input', updateGoalPlanner);
  });
}

function updateGoalPlanner() {
  const monthlyEl  = el('pl-monthly');
  const subEl      = el('pl-monthly-sub');
  const totalEl    = el('pl-total-cost');
  const wOutEl     = el('pl-target-weight-out');
  const rateEl     = el('pl-current-rate');
  const dateEl     = el('pl-completion-date');

  if (!monthlyEl) return;

  if (!state.nepal24kTola) {
    monthlyEl.textContent = '—';
    if (rateEl) rateEl.textContent = 'Loading…';
    return;
  }

  const p = calcPrices();
  const pricePerTola = p[_plannerPurity]?.perTola || 0;
  if (rateEl) rateEl.textContent = `NPR ${fmt(pricePerTola)}`;

  const weight = parseFloat(el('pl-weight')?.value);
  const months = parseInt(el('pl-months')?.value, 10);

  if (!weight || isNaN(weight) || weight <= 0 || !months || isNaN(months) || months <= 0) {
    monthlyEl.textContent = '—';
    if (subEl)   subEl.textContent   = 'Enter your target above';
    if (totalEl) totalEl.textContent = '—';
    if (wOutEl)  wOutEl.textContent  = '—';
    if (dateEl)  dateEl.textContent  = '—';
    return;
  }

  const totalCost = Math.round(weight * pricePerTola);
  const monthly   = Math.round(totalCost / months);

  const completionDate = new Date();
  completionDate.setMonth(completionDate.getMonth() + months);
  const dateStr = completionDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  monthlyEl.textContent = `NPR ${monthly.toLocaleString('en-NP')}`;
  if (subEl)   subEl.textContent   = `per month for ${months} month${months !== 1 ? 's' : ''}`;
  if (totalEl) totalEl.textContent = `NPR ${totalCost.toLocaleString('en-NP')}`;
  if (wOutEl)  wOutEl.textContent  = `${weight} Tola (${(weight * TOLA_GRAMS).toFixed(2)}g)`;
  if (dateEl)  dateEl.textContent  = dateStr;
}

/* ── view toggle (Table ↔ Chart) ── */
function setupViewToggle() {
  els('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      els('.view-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed','false'); });
      btn.classList.add('active'); btn.setAttribute('aria-pressed','true');
      const view = btn.dataset.view;
      const tableEl = el('view-table'), chartEl = el('view-chart');
      if (tableEl) tableEl.style.display = view === 'table' ? '' : 'none';
      if (chartEl) chartEl.style.display = view === 'chart' ? '' : 'none';
      if (view === 'chart') renderChart();
    });
  });
}

/* ── nav ── */
function setupNav() {
  const toggle = el('navToggle'), menu = el('navMenu');
  if (!toggle || !menu) return;
  toggle.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    toggle.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open);
  });
  document.addEventListener('click', e => {
    if (!toggle.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.remove('open'); toggle.classList.remove('open');
    }
  });
  const cur = location.pathname.split('/').pop() || 'index.html';
  els('.nav-menu a').forEach(a => { if (a.getAttribute('href')===cur) a.classList.add('active'); });
}

/* ── FAQ ── */
function setupFAQ() {
  els('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const open = item.classList.contains('open');
      els('.faq-item').forEach(i => i.classList.remove('open'));
      if (!open) item.classList.add('open');
    });
  });
}

/* ── Contact form ── */
function setupContactForm() {
  const form = el('contactForm');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const msg = el('contactSuccess');
    if (msg) { msg.classList.add('show'); form.reset(); }
    setTimeout(() => msg?.classList.remove('show'), 5000);
  });
}

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

/* ── ticker scroll init ── */
function initTickerScroll() {
  const track = document.getElementById('tickerTrack');
  if (!track || track.parentElement.querySelectorAll('.ticker-track').length > 1) return;
  const clone = track.cloneNode(true);
  clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  clone.removeAttribute('id');
  track.parentElement.appendChild(clone);
}

/* ══════════════════════════════════════════
   BIKRAM SAMBAT CALENDAR
══════════════════════════════════════════ */
const BS_DATA = {
  2080: { start: '2023-04-14', days: [31,32,31,32,31,30,30,30,29,29,30,31] },
  2081: { start: '2024-04-13', days: [31,31,31,32,31,31,30,29,30,29,30,30] },
  2082: { start: '2025-04-14', days: [31,31,32,31,31,31,30,29,30,29,30,30] },
  2083: { start: '2026-04-14', days: [31,31,32,32,31,30,30,29,30,29,30,30] },
  2084: { start: '2027-04-14', days: [31,32,31,32,31,30,30,29,30,29,30,30] },
  2085: { start: '2028-04-12', days: [31,31,32,32,31,30,30,29,30,29,30,31] },
};
const BS_MONTHS_EN = ['Baisakh','Jestha','Ashadh','Shrawan','Bhadra','Ashwin','Kartik','Mangsir','Poush','Magh','Falgun','Chaitra'];
const BS_MONTHS_NP = ['बैशाख','जेठ','असार','श्रावण','भाद्र','आश्विन','कार्तिक','मंसिर','पुष','माघ','फाल्गुन','चैत्र'];

function adToBS(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const entries = Object.entries(BS_DATA).sort((a, b) => b[0] - a[0]);
  for (const [yr, { start, days }] of entries) {
    const s = new Date(start);
    if (d >= s) {
      const diff = Math.floor((d - s) / 86400000);
      let rem = diff;
      for (let m = 0; m < 12; m++) {
        if (rem < days[m]) return { year: parseInt(yr), month: m + 1, day: rem + 1 };
        rem -= days[m];
      }
    }
  }
  return null;
}

function renderBSDate() {
  const bs = adToBS(new Date());
  if (!bs) return;
  const enEl = el('bs-date-en');
  const npEl = el('bs-date-np');
  if (enEl) enEl.textContent = `${bs.day} ${BS_MONTHS_EN[bs.month - 1]} ${bs.year} BS`;
  if (npEl) npEl.textContent = `${bs.day} ${BS_MONTHS_NP[bs.month - 1]} ${bs.year} बि.सं.`;
}

/* ══════════════════════════════════════════
   MARKET STATUS
══════════════════════════════════════════ */
const NEPAL_HOLIDAYS = new Set([
  '2026-01-11','2026-01-15','2026-02-19','2026-03-08','2026-04-14',
  '2026-05-12','2026-08-27','2026-09-17','2026-10-02','2026-10-09',
  '2026-10-10','2026-10-11','2026-10-12','2026-10-15','2026-10-26',
  '2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-11-28',
  '2027-01-11','2027-01-14','2027-03-10','2027-04-14','2027-05-11',
]);

function getMarketStatus() {
  const now = new Date();
  if (now.getDay() === 6) return { open: false, reason: 'Saturday', reasonNP: 'शनिबार' };
  const ds = isoDate(0);
  if (NEPAL_HOLIDAYS.has(ds)) return { open: false, reason: 'Public Holiday', reasonNP: 'सार्वजनिक बिदा' };
  return { open: true };
}

function renderMarketStatus() {
  const banner = el('market-closed-banner');
  if (!banner) return;
  const status = getMarketStatus();
  if (!status.open) {
    banner.hidden = false;
    const r = el('market-closed-reason');
    if (r) r.textContent = status.reason;
  }
}

/* ══════════════════════════════════════════
   SHARE BUTTONS (WhatsApp / Viber / Copy / X)
══════════════════════════════════════════ */
function buildShareText() {
  const p = state.nepal24kTola;
  const s = state.silverTolaNPR;
  const bs = adToBS(new Date());
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const bsStr = bs ? ` (${bs.day} ${BS_MONTHS_EN[bs.month - 1]} ${bs.year} BS)` : '';
  return (
    `🏅 Gold Price Nepal — ${today}${bsStr}\n\n` +
    `24K Fine Gold:  NPR ${Math.round(p).toLocaleString('en-NP')}/tola\n` +
    `22K Tejabi:    NPR ${Math.round(p * 22 / 24).toLocaleString('en-NP')}/tola\n` +
    (s ? `Silver (Chandi): NPR ${Math.round(s).toLocaleString('en-NP')}/tola\n` : '') +
    `\nSource: FENEGOSIDA (Official Rate)\n🔗 goldpricenepal.online`
  );
}

function setupWhatsAppShare() {
  const wa  = el('share-whatsapp');
  const vib = el('share-viber');
  const cp  = el('share-copy');
  const tw  = el('share-twitter');

  if (wa)  wa.addEventListener('click',  () => window.open(`https://wa.me/?text=${encodeURIComponent(buildShareText())}`, '_blank', 'noopener'));
  if (vib) vib.addEventListener('click', () => window.open(`viber://forward?text=${encodeURIComponent(buildShareText())}`, '_blank', 'noopener'));
  if (tw)  tw.addEventListener('click',  () => {
    const price = Math.round(state.nepal24kTola).toLocaleString('en-NP');
    const tweet = `Gold price in Nepal today: NPR ${price}/tola (24K Fine Gold) 🏅 Source: FENEGOSIDA #GoldPriceNepal #Nepal`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent('https://goldpricenepal.online')}`, '_blank', 'noopener');
  });
  if (cp)  cp.addEventListener('click', async () => {
    const text = buildShareText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    cp.textContent = '✓ Copied!';
    setTimeout(() => { cp.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy'; }, 2000);
  });
}

/* ══════════════════════════════════════════
   PRICE CONTEXT (day-over-day + trend)
══════════════════════════════════════════ */
function renderPriceContext() {
  const curr = state.nepal24kTola;
  const prev = state.nepal24kTolaPrev;
  const ctxEl = el('price-context');
  if (!ctxEl || !curr || !prev) return;

  const changePct = ((curr - prev) / prev) * 100;
  let msg, cls;

  if (Math.abs(changePct) < 0.05) {
    msg  = '≡  Unchanged from yesterday';
    cls  = 'ctx-flat';
  } else if (changePct > 0) {
    msg  = `▲ ${changePct.toFixed(2)}% above yesterday — price is rising`;
    cls  = 'ctx-up';
  } else {
    msg  = `▼ ${Math.abs(changePct).toFixed(2)}% below yesterday — may be a buying window`;
    cls  = 'ctx-down';
  }

  ctxEl.textContent = msg;
  ctxEl.className   = 'price-context ' + cls;
  ctxEl.hidden      = false;
}

/* ══════════════════════════════════════════
   GOLD-TO-USD INLINE CONVERTER
══════════════════════════════════════════ */
function renderGoldUSD() {
  const usd = el('gold-usd-val');
  if (!usd || !state.nepal24kTola || !state.usdNPR) return;
  const usdPerTola = state.nepal24kTola / state.usdNPR;
  usd.textContent = `≈ $${usdPerTola.toFixed(0)} USD / tola`;
}

/* ══════════════════════════════════════════
   FESTIVAL COUNTDOWN
══════════════════════════════════════════ */
const FESTIVALS = [
  { name:'Teej',         nameNP:'तीज',           date:'2026-08-27', desc:'Gold demand rises sharply',      descNP:'सुनको माग बढ्छ' },
  { name:'Dashain',      nameNP:'दशैं',           date:'2026-10-12', desc:"Nepal's biggest gold buying season", descNP:'नेपालको सबैभन्दा ठूलो सुन मौसम' },
  { name:'Tihar',        nameNP:'तिहार',          date:'2026-10-28', desc:'Gold gifting tradition',         descNP:'सुन उपहार दिने परम्परा' },
  { name:'Chhath',       nameNP:'छठ',             date:'2026-10-30', desc:'Gold ornament demand rises',     descNP:'सुन गहनाको माग बढ्छ' },
  { name:'Baisakh 1',    nameNP:'बैशाख १',        date:'2027-04-14', desc:'New Year — auspicious for gold', descNP:'नयाँ वर्ष — सुन किन्न शुभ' },
  { name:'Buddha Jayanti', nameNP:'बुद्ध जयन्ती', date:'2027-05-11', desc:'Gold gifting occasion',         descNP:'सुन दिने अवसर' },
];

function renderFestivalCountdown() {
  const container = el('festival-countdown');
  if (!container) return;
  const now = Date.now();
  const upcoming = FESTIVALS
    .map(f => ({ ...f, ms: new Date(f.date) - now }))
    .filter(f => f.ms > 0)
    .sort((a, b) => a.ms - b.ms)
    .slice(0, 3);

  if (!upcoming.length) { container.closest?.('.festival-section')?.remove(); return; }

  container.innerHTML = upcoming.map(f => {
    const days = Math.ceil(f.ms / 86400000);
    const nm   = currentLang === 'np' ? f.nameNP : f.name;
    const dc   = currentLang === 'np' ? f.descNP : f.desc;
    const hot  = days <= 14 ? ' festival-hot' : days <= 45 ? ' festival-warm' : '';
    return `<div class="festival-card${hot}">
      <div class="festival-days-wrap"><div class="festival-days">${days}</div><div class="festival-days-label">${currentLang === 'np' ? 'दिन' : 'days'}</div></div>
      <div class="festival-info"><div class="festival-name">${nm}</div><div class="festival-desc">${dc}</div></div>
    </div>`;
  }).join('');
}

/* ══════════════════════════════════════════
   NEPALI LANGUAGE TOGGLE
══════════════════════════════════════════ */
let currentLang = localStorage.getItem('gpn_lang') || 'en';

const TRANS = {
  en: {
    'nav.home':'Home','nav.rates':"Today's Rate",'nav.calculator':'Calculator',
    'nav.chart':'Chart','nav.history':'History','nav.tracker':'Tracker',
    'nav.about':'About','nav.contact':'Contact',
    'hero.h1':"Today's Gold Price<br>in <span>Nepal</span>",
    'hero.sub':'Live gold rates from <strong>FENEGOSIDA</strong>, updated every 5 minutes',
    'hero.auto':'Auto-updated · Last:',
    'card.24k':'Fine Gold (24K)','card.22k':'Tejabi Gold (22K)','card.silver':'Silver (Chandi)',
    'pertola.lg':'per tola (11.664g)','pertola.sm':'per tola',
    'sec.rates':'Gold &amp; Silver Rates — Nepal Today',
    'sec.calc':'Gold &amp; Silver Price Calculator — Nepal',
    'sec.calc.sub':'Type in any unit — Tola, Aana, Lal, or Grams — all values update automatically',
    'sec.planner':'Gold Purchase Planner',
    'sec.planner.sub':'Set a savings target — find out exactly how much to put away each month to reach your gold ownership goal',
    'sec.tracker':'Gold Investment Tracker',
    'sec.tracker.sub':'Save your gold purchases and see live profit/loss against today\'s FENEGOSIDA rate',
    'sec.faq':'Frequently Asked Questions — Gold Price Nepal',
    'sec.faq.sub':'Common questions about today\'s gold rate in Nepal, FENEGOSIDA, tola to gram conversion, and buying gold',
    'calc.metal':'Metal / Purity','calc.weight':'Weight',
    'calc.making':'Making Charges / Banauni (बनाउनी)',
    'calc.gold-val':'Gold Value (Raw)','calc.making-lbl':'Making Charges',
    'calc.total':'Estimated Showroom Price',
    'calc.note':'Indicative estimate only. Actual showroom price may vary by dealer.',
    'share.label':'Share today\'s rate:',
    'share.wa':'WhatsApp','share.viber':'Viber','share.copy':'Copy','share.x':'X / Twitter',
    'mkt.closed':'Market closed today —','mkt.last':'Showing last traded rate.',
    'festival.heading':'Upcoming Festivals & Gold Demand',
    'alert.heading':'Price Alerts','alert.placeholder':'e.g. 175000',
    'alert.title':'Price Alerts',
    'alert.label':'Alert me when 24K gold reaches (NPR / tola)',
    'alert.dir':'Direction',
    'alert.above':'Above threshold',
    'alert.below':'Below threshold',
    'alert.add':'Add Alert','alert.empty':'No alerts set.',
  },
  np: {
    'nav.home':'गृहपृष्ठ','nav.rates':'आजको भाउ','nav.calculator':'क्याल्कुलेटर',
    'nav.chart':'चार्ट','nav.history':'इतिहास','nav.tracker':'ट्र्याकर',
    'nav.about':'हाम्रोबारे','nav.contact':'सम्पर्क',
    'hero.h1':'नेपालमा<br>आजको सुनको भाउ',
    'hero.sub':'<strong>फेनेगोसिडा</strong>को आधिकारिक सुन भाउ, प्रत्येक ५ मिनेटमा अद्यावधिक',
    'hero.auto':'स्वत: अद्यावधिक · अन्तिम:',
    'card.24k':'असल सुन (२४ क्यारेट)','card.22k':'तेजाबी सुन (२२ क्यारेट)','card.silver':'चाँदी',
    'pertola.lg':'प्रति तोला (११.६६४ ग्राम)','pertola.sm':'प्रति तोला',
    'sec.rates':'नेपालमा सुन र चाँदीको भाउ — आज',
    'sec.calc':'सुन र चाँदी मूल्य क्याल्कुलेटर — नेपाल',
    'sec.calc.sub':'तोला, आना, लाल वा ग्राम — जुनसुकै एकाइमा टाइप गर्नुहोस्',
    'sec.planner':'सुन खरिद योजना',
    'sec.planner.sub':'बचत लक्ष्य तय गर्नुहोस् — आफ्नो सुन स्वामित्व लक्ष्य पुग्न प्रत्येक महिना कति बचत गर्ने थाहा पाउनुहोस्',
    'sec.tracker':'सुन लगानी ट्र्याकर',
    'sec.tracker.sub':'आफ्नो सुन खरिद रेकर्ड गर्नुहोस् र आजको फेनेगोसिडा भाउमा नाफा/नोक्सान हेर्नुहोस्',
    'sec.faq':'बारम्बार सोधिने प्रश्नहरू — नेपाल सुन भाउ',
    'sec.faq.sub':'नेपालमा आजको सुन भाउ, फेनेगोसिडा, तोला र ग्राम रूपान्तरण र सुन खरिद बारे सामान्य प्रश्नहरू',
    'calc.metal':'धातु / शुद्धता','calc.weight':'तौल',
    'calc.making':'बनाउनी शुल्क',
    'calc.gold-val':'सुनको मूल्य (कच्चा)','calc.making-lbl':'बनाउनी शुल्क',
    'calc.total':'अनुमानित शोरूम मूल्य',
    'calc.note':'अनुमानित मूल्य मात्र। वास्तविक मूल्य पसलअनुसार फरक हुन सक्छ।',
    'share.label':'आजको भाउ साझा गर्नुहोस्:',
    'share.wa':'ह्वाट्सएप','share.viber':'भाइबर','share.copy':'कपी गर्नुहोस्','share.x':'ट्विटर/X',
    'mkt.closed':'आज बजार बन्द छ —','mkt.last':'अन्तिम कारोबार भाउ देखाइएको छ।',
    'festival.heading':'आगामी चाडपर्व र सुन माग',
    'alert.heading':'भाउ सूचना','alert.placeholder':'जस्तै: १७५०००',
    'alert.title':'भाउ सूचना',
    'alert.label':'२४ क्यारेट सुन यो भाउमा पुग्दा सूचना दिनुहोस् (NPR / तोला)',
    'alert.dir':'दिशा',
    'alert.above':'थ्रेसहोल्डभन्दा माथि',
    'alert.below':'थ्रेसहोल्डभन्दा तल',
    'alert.add':'सूचना थप्नुहोस्','alert.empty':'कुनै सूचना छैन।',
  },
};

function tl(key) { return TRANS[currentLang]?.[key] ?? TRANS.en[key] ?? key; }

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(node => {
    const k = node.dataset.i18n;
    const v = TRANS[currentLang]?.[k];
    if (v !== undefined) node.innerHTML = v;
  });
  document.documentElement.lang = currentLang === 'np' ? 'ne' : 'en';
  const btn = el('lang-toggle-btn');
  if (btn) btn.textContent = currentLang === 'en' ? 'नेपाली' : 'English';
  renderFestivalCountdown();
}

function setupLanguageToggle() {
  const btn = el('lang-toggle-btn');
  if (!btn) return;
  if (currentLang === 'np') { document.documentElement.lang = 'ne'; applyTranslations(); }
  btn.textContent = currentLang === 'en' ? 'नेपाली' : 'English';
  btn.addEventListener('click', () => {
    currentLang = currentLang === 'en' ? 'np' : 'en';
    localStorage.setItem('gpn_lang', currentLang);
    applyTranslations();
  });
}

/* ══════════════════════════════════════════
   PRICE ALERTS (localStorage-based)
══════════════════════════════════════════ */
const ALERT_STORE = 'gpn_price_alerts_v1';
function loadAlerts() { try { return JSON.parse(localStorage.getItem(ALERT_STORE) || '[]'); } catch { return []; } }
function saveAlerts(a) { try { localStorage.setItem(ALERT_STORE, JSON.stringify(a)); } catch {} }

function renderAlertList() {
  const list = el('alert-list');
  if (!list) return;
  const alerts = loadAlerts();
  if (!alerts.length) { list.innerHTML = `<p class="alert-empty" data-i18n="alert.empty">${tl('alert.empty')}</p>`; return; }
  list.innerHTML = alerts.map(a =>
    `<div class="alert-item">
      <span class="alert-icon">${a.dir === 'below' ? '📉' : '📈'}</span>
      <span>Alert when 24K goes <strong>${a.dir}</strong> NPR <strong>${Math.round(a.threshold).toLocaleString('en-NP')}</strong>/tola</span>
      <button class="alert-del" data-id="${a.id}" aria-label="Remove alert">✕</button>
    </div>`
  ).join('');
  list.querySelectorAll('.alert-del').forEach(b => b.addEventListener('click', () => {
    saveAlerts(loadAlerts().filter(a => a.id !== parseInt(b.dataset.id)));
    renderAlertList();
  }));
}

function setupPriceAlerts() {
  const addBtn = el('alert-add-btn');
  if (!addBtn) return;
  renderAlertList();
  addBtn.addEventListener('click', () => {
    const inp = el('alert-threshold');
    const dir = el('alert-direction');
    const val = parseFloat(inp?.value);
    if (!val || val < 50000 || val > 900000) { inp?.focus(); return; }
    const alerts = loadAlerts();
    alerts.push({ id: Date.now(), threshold: val, dir: dir?.value || 'below' });
    saveAlerts(alerts);
    if (inp) inp.value = '';
    renderAlertList();
  });
}

function checkPriceAlerts() {
  const curr = state.nepal24kTola;
  if (!curr) return;
  loadAlerts().forEach(a => {
    const hit = (a.dir === 'below' && curr < a.threshold) || (a.dir === 'above' && curr > a.threshold);
    if (!hit) return;
    const notif = el('alert-notification');
    if (notif) {
      notif.textContent = `🔔 Gold price alert: 24K is NPR ${Math.round(curr).toLocaleString('en-NP')}/tola — ${a.dir} your target of NPR ${Math.round(a.threshold).toLocaleString('en-NP')}`;
      notif.hidden = false;
      setTimeout(() => { notif.hidden = true; }, 10000);
    }
    if (Notification.permission === 'granted') {
      new Notification('Gold Price Alert — Nepal', {
        body: `24K is now NPR ${Math.round(curr).toLocaleString('en-NP')}/tola`,
        icon: '/favicon.svg',
      });
    }
  });
}

/* ── boot ── */
document.addEventListener('DOMContentLoaded', async () => {
  setupNav(); setupFAQ(); setupContactForm();
  setupViewToggle(); setupChartTabs(); setupChartTypeTabs();
  setupTracker();
  setupShareBtn();
  setupPushNotifications();
  setupPWAInstall();
  setupConnectionStatus();
  setupGoalPlanner();
  /* new features */
  renderBSDate();
  renderMarketStatus();
  setupWhatsAppShare();
  setupLanguageToggle();
  setupPriceAlerts();
  renderFestivalCountdown();
  await fetchPrices();
  fetchRemitRates();           // parallel — doesn't block price render
  initTickerScroll();
  setupCalculator();
  setInterval(fetchPrices, REFRESH_MS);
});
