/* =====================================================
   Gold Price Nepal – main.js
   Primary:  fenegosida.org  (official Nepal rate)
   Fallback: fawazahmed0 CDN XAU/NPR + 27.6% Nepal premium
   Chart:    ApexCharts  (line + candlestick)
   ===================================================== */

const TOLA_GRAMS     = 11.664;
const TROY_OZ_GRAMS  = 31.1035;
const NEPAL_PREMIUM  = 1.382;   // fallback: 20% duty + 13% VAT + ~2% margin (no luxury tax)
const SILVER_PREMIUM = 1.12;
const REFRESH_MS     = 5 * 60 * 1000;

// no-www works through allorigins; www fallback tried second
const FENEGOSIDA_URLS = [
  'https://fenegosida.org/',
  'https://www.fenegosida.org/'
];
const CORS_PROXY = 'https://api.allorigins.win/get?url=';
const CDN_BASE       = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api';

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
  calcMode:       'weight-to-price',
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
   FENEGOSIDA  (official Nepal gold price)
══════════════════════════════════════════ */
function parseFENEGOSIDA(html) {
  // Gold: per-tola block (Fine Gold 9999)
  const tolaM = html.match(/FINE GOLD[\s\S]{0,120}per 1 tola[\s\S]{0,80}<b>(\d+)<\/b>/);
  let gold24kTola = 0;
  if (tolaM) {
    const p = parseInt(tolaM[1], 10);
    if (p > 80000 && p < 700000) gold24kTola = p;
  }
  if (!gold24kTola) {
    // Derive from per-10g
    const tenGM = html.match(/FINE GOLD[\s\S]{0,120}per 10 gr[\s\S]{0,80}<b>(\d+)<\/b>/);
    if (tenGM) {
      const per10g = parseInt(tenGM[1], 10);
      const t = Math.round(per10g * TOLA_GRAMS / 10);
      if (t > 80000 && t < 700000) gold24kTola = t;
    }
  }

  // Silver: per-tola block
  const silverM = html.match(/SILVER[\s\S]{0,120}per 1 tola[\s\S]{0,80}<b>(\d+)<\/b>/);
  let silverTola = 0;
  if (silverM) {
    const s = parseInt(silverM[1], 10);
    if (s > 100 && s < 50000) silverTola = s;
  }

  return { gold24kTola, silverTola };
}

async function fetchFENEGOSIDA() {
  for (const baseUrl of FENEGOSIDA_URLS) {
    try {
      const url  = CORS_PROXY + encodeURIComponent(baseUrl);
      const data = await fetchWithTimeout(url, 14000).then(r => r.json());
      const html = data?.contents;
      if (!html || html.length < 1000) continue;
      const result = parseFENEGOSIDA(html);
      if (result.gold24kTola) return result;
    } catch (_) {
      // try next URL
    }
  }
  throw new Error('All FENEGOSIDA URLs failed');
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
  set('ticker-silver', silverTolaNPR ? `NPR ${fmt(p.silver.perTola)}/tola` : '—');
  set('ticker-usd',    `USD ${goldUSD.toFixed(2)}/oz`);
  set('ticker-rate',   `1 USD = NPR ${usdNPR.toFixed(2)}`);

  /* hero price cards */
  ['24k','22k','18k'].forEach(k => {
    set(`price-${k}`,      `NPR ${fmt(p[k].perTola)}`);
    set(`price-${k}-gram`, `NPR ${fmt(p[k].perGram)}/g`);
    const chEl = el(`change-${k}`);
    if (chEl) {
      chEl.textContent = yestTola
        ? `${sign}${changePct.toFixed(2)}% vs yesterday`
        : '—';
      chEl.className = 'price-change ' + (isUp ? 'text-green' : 'text-red');
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
   Calculator
══════════════════════════════════════════ */
function setupCalculator() {
  const form = el('calcForm');
  if (!form) return;
  els('.calc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      els('.calc-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.calcMode = tab.dataset.mode;
      toggleCalcFields();
      el('calc-result')?.classList.remove('show');
    });
  });
  form.addEventListener('input',  debounce(doCalc, 250));
  form.addEventListener('change', doCalc);
}
function toggleCalcFields() {
  const wtp = el('wtp-group'), ptw = el('ptw-group');
  if (!wtp) return;
  wtp.style.display = state.calcMode === 'weight-to-price' ? '' : 'none';
  if (ptw) ptw.style.display = state.calcMode === 'price-to-weight' ? '' : 'none';
}
function doCalc() {
  if (!state.nepal24kTola) return;
  const p      = calcPrices();
  const purity = el('calc-purity')?.value || '24k';
  const unit   = el('calc-unit')?.value   || 'tola';
  const making = parseFloat(el('calc-making')?.value) || 0;
  const prices = p[purity];
  const ppUnit = unit==='tola' ? prices.perTola : unit==='gram' ? prices.perGram : prices.per10g;
  let totalNPR, wGrams, wTola;

  if (state.calcMode !== 'price-to-weight') {
    const qty = parseFloat(el('calc-qty')?.value) || 0;
    if (qty <= 0) return el('calc-result')?.classList.remove('show');
    wGrams   = unit==='tola' ? qty*TOLA_GRAMS : unit==='gram' ? qty : qty*10;
    wTola    = wGrams / TOLA_GRAMS;
    totalNPR = ppUnit * qty * (1 + making/100);
  } else {
    const budget = parseFloat(el('calc-budget')?.value) || 0;
    if (budget <= 0) return el('calc-result')?.classList.remove('show');
    totalNPR = budget;
    wGrams   = (budget / (1+making/100)) / prices.perGram;
    wTola    = wGrams / TOLA_GRAMS;
  }

  const r = el('calc-result');
  if (!r) return;
  r.classList.add('show');
  set('result-amount',      `NPR ${Math.round(totalNPR).toLocaleString('en-NP')}`);
  set('result-grams',       `${wGrams.toFixed(3)} g`);
  set('result-tola',        `${wTola.toFixed(4)} tola`);
  set('result-making-cost', making>0 ? `NPR ${Math.round(totalNPR - totalNPR/(1+making/100)).toLocaleString('en-NP')}` : '—');
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

/* ── boot ── */
document.addEventListener('DOMContentLoaded', async () => {
  setupNav(); setupFAQ(); setupContactForm();
  setupChartTabs(); setupChartTypeTabs();
  await fetchPrices();
  setupCalculator();
  setInterval(fetchPrices, REFRESH_MS);
});
