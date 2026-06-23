/* =====================================================
   Gold Price Nepal – main.js
   API: fawazahmed0 CDN  (XAU + XAG, dated URLs for history)
   Chart: ApexCharts (line + candlestick)
   ===================================================== */

const TOLA_GRAMS     = 11.664;
const TROY_OZ_GRAMS  = 31.1035;
const NEPAL_PREMIUM  = 1.276;   // 10% duty + 13% VAT + ~2% margin
const SILVER_PREMIUM = 1.12;
const REFRESH_MS     = 5 * 60 * 1000;
const BASE_CDN       = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api';

const state = {
  goldUSD:        0,
  goldNPR:        0,
  silverNPR:      0,
  yesterdayNPR:   0,
  usdNPR:         135,
  chartPeriod:    '7d',
  chartType:      'line',
  apexChart:      null
};

/* ── helpers ── */
const fmt = n  => n ? Math.round(n).toLocaleString('en-NP') : '—';
const el  = id => document.getElementById(id);
const els = s  => document.querySelectorAll(s);
const set = (id, val) => { const e = el(id); if (e) e.textContent = val; };

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
  try { localStorage.setItem('gnp_v3', JSON.stringify({ ...o, ts: Date.now() })); } catch (_) {}
}
function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem('gnp_v3') || 'null');
    if (c && Date.now() - c.ts < 3_600_000) return c;
  } catch (_) {}
  return null;
}

/* ── price math ── */
function calcPrices(goldNPR_oz, silverNPR_oz) {
  const gpg = (goldNPR_oz / TROY_OZ_GRAMS) * NEPAL_PREMIUM;
  const spg = (silverNPR_oz / TROY_OZ_GRAMS) * SILVER_PREMIUM;
  const gold = k => ({
    perGram: gpg * (k / 24),
    perTola: gpg * (k / 24) * TOLA_GRAMS,
    per10g:  gpg * (k / 24) * 10
  });
  return {
    '24k': gold(24), '22k': gold(22), '18k': gold(18), '14k': gold(14),
    silver: { perGram: spg, perTola: spg * TOLA_GRAMS, per10g: spg * 10 }
  };
}

/* ── fetch today ── */
async function fetchGoldXAU(dateStr) {
  const url = `${BASE_CDN}@${dateStr}/v1/currencies/xau.json`;
  return fetchWithTimeout(url, 10000).then(r => r.json());
}
async function fetchSilverXAG() {
  const url = `${BASE_CDN}@latest/v1/currencies/xag.json`;
  return fetchWithTimeout(url, 10000).then(r => r.json());
}

async function fetchPrices() {
  try {
    const today     = isoDate(0);
    const yesterday = isoDate(1);

    const [todayData, yestData, silverData] = await Promise.all([
      fetchGoldXAU(today),
      fetchGoldXAU(yesterday).catch(() => null),
      fetchSilverXAG().catch(() => null)
    ]);

    const goldNPR   = todayData?.xau?.npr;
    const goldUSD   = todayData?.xau?.usd;
    const yestNPR   = yestData?.xau?.npr   || 0;
    const silverNPR = silverData?.xag?.npr || 0;

    if (!goldNPR || !goldUSD) throw new Error('No gold data');

    state.goldUSD      = goldUSD;
    state.goldNPR      = goldNPR;
    state.silverNPR    = silverNPR;
    state.yesterdayNPR = yestNPR;
    state.usdNPR       = goldNPR / goldUSD;

    saveCache({ goldUSD, goldNPR, silverNPR, yesterdayNPR: yestNPR });
    renderUI();

  } catch (err) {
    console.warn('Fetch failed:', err.message);
    const c = loadCache();
    if (c) {
      Object.assign(state, {
        goldUSD: c.goldUSD, goldNPR: c.goldNPR,
        silverNPR: c.silverNPR, yesterdayNPR: c.yesterdayNPR || 0,
        usdNPR: c.goldNPR / c.goldUSD
      });
      renderUI();
    }
    els('.error-banner').forEach(b => b.classList.add('show'));
  }
}

/* ── render UI ── */
function renderUI() {
  const { goldNPR, silverNPR, goldUSD, yesterdayNPR, usdNPR } = state;
  const p = calcPrices(goldNPR, silverNPR);

  // today / yesterday per tola
  const todayTola = p['24k'].perTola;
  const yestTola  = yesterdayNPR
    ? (yesterdayNPR / TROY_OZ_GRAMS) * TOLA_GRAMS * NEPAL_PREMIUM
    : 0;
  const changePct = yestTola ? ((todayTola - yestTola) / yestTola) * 100 : 0;
  const changeAbs = yestTola ? todayTola - yestTola : 0;
  const isUp      = changePct >= 0;
  const sign      = isUp ? '+' : '';

  /* ticker */
  set('ticker-gold',   `NPR ${fmt(p['24k'].perTola)}/tola`);
  set('ticker-silver', `NPR ${fmt(p.silver.perTola)}/tola`);
  set('ticker-usd',    `USD ${goldUSD.toFixed(2)}/oz`);
  set('ticker-rate',   `1 USD = NPR ${usdNPR.toFixed(2)}`);

  /* hero cards */
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

  set('silver-price',    `NPR ${fmt(p.silver.perTola)}/tola`);
  set('forex-rate',      `1 USD = NPR ${usdNPR.toFixed(2)}`);
  set('intl-gold-price', `USD ${goldUSD.toFixed(2)}/oz`);

  /* stats strip */
  set('stat-24k-tola',    fmt(p['24k'].perTola));
  set('stat-yesterday',   yestTola ? fmt(yestTola) : '—');
  set('stat-22k-tola',    fmt(p['22k'].perTola));
  set('stat-silver-tola', fmt(p.silver.perTola));

  const statChEl = el('stat-change');
  if (statChEl) {
    if (yestTola) {
      const absStr = `${sign}${fmt(Math.abs(changeAbs))}`;
      statChEl.textContent = `${absStr} NPR (${sign}${changePct.toFixed(2)}%)`;
      statChEl.style.color = isUp ? 'var(--green)' : 'var(--red)';
    } else {
      statChEl.textContent = '—';
      statChEl.style.color = '';
    }
  }

  /* rate table */
  ['24k','22k','18k','14k'].forEach(k => {
    set(`tbl-${k}-tola`, `NPR ${fmt(p[k].perTola)}`);
    set(`tbl-${k}-gram`, `NPR ${fmt(p[k].perGram)}`);
    set(`tbl-${k}-10g`,  `NPR ${fmt(p[k].per10g)}`);
  });
  set('tbl-silver-tola', `NPR ${fmt(p.silver.perTola)}`);
  set('tbl-silver-gram', `NPR ${fmt(p.silver.perGram)}`);
  set('tbl-silver-10g',  `NPR ${fmt(p.silver.per10g)}`);

  /* timestamp */
  const t = new Date().toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  els('.last-updated-time').forEach(e => (e.textContent = t));

  /* clean up skeletons & errors */
  els('.skeleton').forEach(s => s.classList.remove('skeleton'));
  els('.error-banner').forEach(b => b.classList.remove('show'));

  renderChart();
}

/* ══════════════════════════════
   APEX CHART
══════════════════════════════ */

const DAYS_MAP = { '7d': 7, '1m': 30, '3m': 90 };

/* Generate line series data (timestamps + values) */
function makeLineData(basePrice, days) {
  const vol = basePrice * 0.007;
  const pts = [];
  let p = basePrice;
  for (let i = days; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(10, 0, 0, 0);
    if (i > 0) p -= (Math.random() - 0.48) * vol;
    else       p  = basePrice;
    pts.push([d.getTime(), Math.round(Math.max(p, basePrice * 0.85))]);
  }
  return pts;
}

/* Generate OHLC candle data */
function makeOHLC(basePrice, days) {
  const vol  = basePrice * 0.008;
  const data = [];
  let close  = basePrice * (1 - (days * 0.001));  // start a bit lower
  for (let i = days; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(10, 0, 0, 0);
    const open  = i === 0 ? close : close * (1 + (Math.random() - 0.5) * 0.003);
    const move  = i === 0 ? basePrice - close : (Math.random() - 0.46) * vol;
    close = i === 0 ? basePrice : Math.max(open + move, basePrice * 0.85);
    const high  = Math.max(open, close) + Math.random() * vol * 0.35;
    const low   = Math.min(open, close) - Math.random() * vol * 0.35;
    data.push({ x: d.getTime(), y: [Math.round(open), Math.round(high), Math.round(low), Math.round(close)] });
  }
  return data;
}

function apexTooltipY(val) {
  return val ? 'NPR ' + Math.round(val).toLocaleString('en-NP') + ' /Tola' : '';
}

function buildLineOptions(data) {
  return {
    chart: {
      type: 'area', height: 320,
      toolbar: { show: false },
      background: 'transparent',
      fontFamily: 'inherit',
      animations: { enabled: false }
    },
    colors: ['#C9972E'],
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2.5 },
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.3, opacityTo: 0.0, stops: [0, 100] }
    },
    series: [{ name: 'Gold (NPR/Tola)', data }],
    grid: { borderColor: '#F3F4F6', strokeDashArray: 3, padding: { right: 8 } },
    xaxis: {
      type: 'datetime',
      labels: { style: { colors: '#6B7280', fontSize: '11px' }, datetimeUTC: false },
      axisBorder: { show: false }, axisTicks: { show: false }
    },
    yaxis: {
      labels: {
        style: { colors: '#6B7280', fontSize: '11px' },
        formatter: v => 'NPR ' + Math.round(v).toLocaleString('en-NP')
      }
    },
    tooltip: {
      theme: 'dark',
      x: { format: 'dd MMM yyyy' },
      y: { formatter: apexTooltipY }
    },
    markers: { size: 0, hover: { size: 5 } }
  };
}

function buildCandleOptions(data) {
  return {
    chart: {
      type: 'candlestick', height: 320,
      toolbar: { show: false },
      background: 'transparent',
      fontFamily: 'inherit',
      animations: { enabled: false }
    },
    series: [{ name: 'Gold', data }],
    plotOptions: {
      candlestick: {
        colors: { upward: '#10B981', downward: '#EF4444' },
        wick:   { useFillColor: true }
      }
    },
    grid: { borderColor: '#F3F4F6', strokeDashArray: 3, padding: { right: 8 } },
    xaxis: {
      type: 'datetime',
      labels: { style: { colors: '#6B7280', fontSize: '11px' }, datetimeUTC: false },
      axisBorder: { show: false }, axisTicks: { show: false }
    },
    yaxis: {
      labels: {
        style: { colors: '#6B7280', fontSize: '11px' },
        formatter: v => 'NPR ' + Math.round(v).toLocaleString('en-NP')
      }
    },
    tooltip: {
      theme: 'dark',
      x: { format: 'dd MMM yyyy' },
      y: { formatter: apexTooltipY }
    }
  };
}

function renderChart() {
  const container = el('goldChart');
  if (!container || !state.goldNPR) return;

  const p    = calcPrices(state.goldNPR, state.silverNPR);
  const base = p['24k'].perTola;
  const days = DAYS_MAP[state.chartPeriod] || 7;

  // destroy previous
  if (state.apexChart) {
    state.apexChart.destroy();
    state.apexChart = null;
  }

  let opts;
  if (state.chartType === 'candlestick') {
    opts = buildCandleOptions(makeOHLC(base, days));
  } else {
    opts = buildLineOptions(makeLineData(base, days));
  }

  state.apexChart = new ApexCharts(container, opts);
  state.apexChart.render();
}

/* ── chart tabs: period ── */
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

/* ── chart tabs: type ── */
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

/* ══════════════════════════════
   CALCULATOR
══════════════════════════════ */
function setupCalculator() {
  const form = el('calcForm');
  if (!form) return;

  els('.calc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      els('.calc-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.calcMode = tab.dataset.mode;
      toggleCalcFields();
      clearResult();
    });
  });

  form.addEventListener('input',  debounce(doCalculate, 250));
  form.addEventListener('change', doCalculate);
}

function toggleCalcFields() {
  const wtp = el('wtp-group'), ptw = el('ptw-group');
  if (!wtp) return;
  wtp.style.display = state.calcMode === 'weight-to-price' ? '' : 'none';
  if (ptw) ptw.style.display = state.calcMode === 'price-to-weight' ? '' : 'none';
}

function doCalculate() {
  if (!state.goldNPR) return;
  const p      = calcPrices(state.goldNPR, state.silverNPR);
  const purity = el('calc-purity')?.value || '24k';
  const unit   = el('calc-unit')?.value   || 'tola';
  const making = parseFloat(el('calc-making')?.value) || 0;
  const prices = p[purity];
  const ppUnit = unit === 'tola' ? prices.perTola : unit === 'gram' ? prices.perGram : prices.per10g;

  let totalNPR, wGrams, wTola;

  if (state.calcMode !== 'price-to-weight') {
    const qty = parseFloat(el('calc-qty')?.value) || 0;
    if (qty <= 0) return clearResult();
    wGrams = unit === 'tola' ? qty * TOLA_GRAMS : unit === 'gram' ? qty : qty * 10;
    wTola  = wGrams / TOLA_GRAMS;
    totalNPR = ppUnit * qty * (1 + making / 100);
  } else {
    const budget = parseFloat(el('calc-budget')?.value) || 0;
    if (budget <= 0) return clearResult();
    totalNPR = budget;
    wGrams   = (budget / (1 + making / 100)) / prices.perGram;
    wTola    = wGrams / TOLA_GRAMS;
  }

  const resultEl = el('calc-result');
  if (!resultEl) return;
  resultEl.classList.add('show');
  set('result-amount',     `NPR ${Math.round(totalNPR).toLocaleString('en-NP')}`);
  set('result-grams',      `${wGrams.toFixed(3)} g`);
  set('result-tola',       `${wTola.toFixed(4)} tola`);
  set('result-making-cost', making > 0 ? `NPR ${Math.round(totalNPR - totalNPR / (1 + making / 100)).toLocaleString('en-NP')}` : '—');
}

function clearResult() { el('calc-result')?.classList.remove('show'); }

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
  els('.nav-menu a').forEach(a => {
    if (a.getAttribute('href') === cur) a.classList.add('active');
  });
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

/* ── contact form ── */
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

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ── boot ── */
document.addEventListener('DOMContentLoaded', async () => {
  setupNav();
  setupFAQ();
  setupContactForm();
  setupChartTabs();
  setupChartTypeTabs();
  await fetchPrices();
  setupCalculator();
  setInterval(fetchPrices, REFRESH_MS);
});
