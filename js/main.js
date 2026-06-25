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

const PRICES_JSON = 'data/prices.json';
const CDN_BASE    = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api';

const state = {
  goldUSD:        0,
  goldNPR:        0,       // international XAU/NPR (per troy oz)
  silverTolaNPR:  0,       // silver price per tola in NPR
  yesterdayNPR:   0,
  usdNPR:         135,
  nepal24kTola:   0,       // FENEGOSIDA price (or fallback)
  priceSource:    'loading',  // 'fenegosida' | 'international'
  chartPeriod:    '7d',
  chartType:      'line',
  apexChart:      null
};

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
  const data = await fetchWithTimeout(PRICES_JSON + '?v=' + Date.now(), 8000).then(r => r.json());
  const g = data?.gold24kTola;
  if (!g || g < 80000 || g > 700000) throw new Error('Invalid price in prices.json');
  return { gold24kTola: g, silverTola: data?.silverTola || 0 };
}

/* ══════════════════════════════════════════
   International fallback  (XAU / XAG CDN)
══════════════════════════════════════════ */
async function fetchXAU(dateStr) {
  const url = `${CDN_BASE}@${dateStr}/v1/currencies/xau.json`;
  return fetchWithTimeout(url, 10000).then(r => r.json());
}
async function fetchXAG() {
  return fetchWithTimeout(`${CDN_BASE}@latest/v1/currencies/xag.json`, 10000).then(r => r.json());
}

/* ══════════════════════════════════════════
   Master fetch – tries FENEGOSIDA first
══════════════════════════════════════════ */
async function fetchPrices() {
  try {
    // Fetch FENEGOSIDA + XAU(today+yesterday) + XAG simultaneously
    const [fenegosidaRes, xauTodayRes, xauYestRes, xagRes] = await Promise.allSettled([
      fetchFENEGOSIDA(),
      fetchXAU(isoDate(0)),
      fetchXAU(isoDate(1)),
      fetchXAG()
    ]);

    const xauToday = xauTodayRes.value;
    const goldUSD  = xauToday?.xau?.usd;
    const goldNPR  = xauToday?.xau?.usd ? xauToday.xau.npr : null;

    if (!goldUSD) throw new Error('XAU data missing');

    const usdNPR  = goldNPR / goldUSD;
    const yestNPR = xauYestRes.value?.xau?.npr || 0;

    // Decide price source
    let nepal24kTola, silverTolaNPR, priceSource;
    const fData = fenegosidaRes.status === 'fulfilled' ? fenegosidaRes.value : null;
    if (fData?.gold24kTola) {
      nepal24kTola  = fData.gold24kTola;
      silverTolaNPR = fData.silverTola || 0;
      priceSource   = 'fenegosida';
    } else {
      nepal24kTola  = (goldNPR / TROY_OZ_GRAMS) * TOLA_GRAMS * NEPAL_PREMIUM;
      const xagNPR  = xagRes.value?.xag?.npr || 0;
      silverTolaNPR = xagNPR ? (xagNPR / TROY_OZ_GRAMS) * TOLA_GRAMS * SILVER_PREMIUM : 0;
      priceSource   = 'international';
      console.warn('FENEGOSIDA failed, using international:', fenegosidaRes.reason?.message);
    }

    Object.assign(state, {
      goldUSD, goldNPR, silverTolaNPR, yesterdayNPR: yestNPR, usdNPR, nepal24kTola, priceSource
    });
    saveCache({ goldUSD, goldNPR, silverTolaNPR, yesterdayNPR: yestNPR, nepal24kTola, priceSource });
    renderUI();

  } catch (err) {
    console.warn('Fetch failed:', err.message);
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
  const { goldUSD, goldNPR, usdNPR, silverTolaNPR, yesterdayNPR, nepal24kTola, priceSource } = state;
  if (!nepal24kTola) return;

  const p = calcPrices();

  // Yesterday 24K tola estimate
  const yestTola  = yesterdayNPR && goldNPR
    ? (yesterdayNPR / goldNPR) * nepal24kTola   // scale yesterday's intl ratio to today's Nepal price
    : 0;
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

  /* refresh calculator showroom price when prices update */
  updateShowroom();

  /* timestamps */
  const t = new Date().toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  els('.last-updated-time').forEach(e => (e.textContent = t));

  els('.skeleton').forEach(s => s.classList.remove('skeleton'));
  els('.error-banner').forEach(b => b.classList.remove('show'));

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

/* ── boot ── */
document.addEventListener('DOMContentLoaded', async () => {
  setupNav(); setupFAQ(); setupContactForm();
  setupViewToggle(); setupChartTabs(); setupChartTypeTabs();
  await fetchPrices();
  initTickerScroll();
  setupCalculator();
  setInterval(fetchPrices, REFRESH_MS);
});
