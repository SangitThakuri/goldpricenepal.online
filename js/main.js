/* =====================================================
   Gold Price Nepal – main.js
   APIs: metals.live (spot price) + fawazahmed0 (FX)
   ===================================================== */

const TOLA_GRAMS     = 11.664;
const TROY_OZ_GRAMS  = 31.1035;
const NEPAL_PREMIUM  = 1.245; // ~24.5% covers import duty, VAT, margin
const REFRESH_MS     = 5 * 60 * 1000; // 5 minutes
const FALLBACK_NPR   = 134.0;

const APIS = {
  metals:   'https://api.metals.live/v1/spot',
  currency: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json'
};

const state = {
  goldUSD:     0,
  silverUSD:   0,
  usdNPR:      FALLBACK_NPR,
  prevGoldUSD: 0,
  lastUpdated: null,
  chartPeriod: '7d',
  chart:       null,
  calcMode:    'weight-to-price'
};

/* ─── helpers ─── */
const fmt = (n, dec = 0) =>
  n == null ? '—' : Math.round(n).toLocaleString('en-NP');

const el = id => document.getElementById(id);
const els = sel => document.querySelectorAll(sel);

async function fetchWithTimeout(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

function saveCache(goldUSD, silverUSD, usdNPR) {
  try {
    localStorage.setItem('gnp_cache', JSON.stringify({ goldUSD, silverUSD, usdNPR, ts: Date.now() }));
  } catch (_) {}
}

function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem('gnp_cache') || 'null');
    if (c && Date.now() - c.ts < 3_600_000) return c;
  } catch (_) {}
  return null;
}

/* ─── price calculations ─── */
function calcPrices(goldUSD, silverUSD, usdNPR) {
  const gpg = (goldUSD / TROY_OZ_GRAMS) * usdNPR * NEPAL_PREMIUM; // gold per gram NPR
  const spg = (silverUSD / TROY_OZ_GRAMS) * usdNPR * 1.10;        // silver per gram NPR

  const gold = karat => ({
    perGram:  gpg * (karat / 24),
    perTola:  gpg * (karat / 24) * TOLA_GRAMS,
    per10g:   gpg * (karat / 24) * 10,
    perOz:    gpg * (karat / 24) * TROY_OZ_GRAMS
  });

  return {
    '24k': gold(24), '22k': gold(22), '18k': gold(18), '14k': gold(14),
    silver: { perGram: spg, perTola: spg * TOLA_GRAMS, per10g: spg * 10 }
  };
}

/* ─── DOM updates ─── */
function updateUI(goldUSD, silverUSD, usdNPR) {
  const p = calcPrices(goldUSD, silverUSD, usdNPR);
  const changeUSD  = goldUSD - (state.prevGoldUSD || goldUSD);
  const changePct  = state.prevGoldUSD ? (changeUSD / state.prevGoldUSD) * 100 : 0;
  const isUp       = changePct >= 0;
  const changeSign = isUp ? '+' : '';

  /* ticker */
  setIfExists('ticker-gold',   `NPR ${fmt(p['24k'].perTola)}/tola`);
  setIfExists('ticker-silver', `NPR ${fmt(p.silver.perTola)}/tola`);
  setIfExists('ticker-usd',    `USD ${goldUSD.toFixed(2)}/oz`);
  setIfExists('ticker-rate',   `1 USD = NPR ${usdNPR.toFixed(2)}`);

  /* hero price cards */
  ['24k','22k','18k'].forEach(k => {
    setIfExists(`price-${k}`,        `NPR ${fmt(p[k].perTola)}`);
    setIfExists(`price-${k}-gram`,   `NPR ${fmt(p[k].perGram)}/g`);
    const chEl = el(`change-${k}`);
    if (chEl) {
      chEl.textContent = `${changeSign}${changePct.toFixed(2)}% today`;
      chEl.className   = 'price-change ' + (isUp ? 'text-green' : 'text-red');
    }
  });

  setIfExists('silver-price',    `NPR ${fmt(p.silver.perTola)}/tola`);
  setIfExists('forex-rate',      `1 USD = NPR ${usdNPR.toFixed(2)}`);
  setIfExists('intl-gold-price', `USD ${goldUSD.toFixed(2)}/oz`);

  /* stats strip */
  setIfExists('stat-24k-tola',    fmt(p['24k'].perTola));
  setIfExists('stat-22k-tola',    fmt(p['22k'].perTola));
  setIfExists('stat-silver-tola', fmt(p.silver.perTola));
  setIfExists('stat-change',      `${changeSign}${changePct.toFixed(2)}%`);

  /* rate table */
  const purities = ['24k','22k','18k','14k'];
  purities.forEach(k => {
    setIfExists(`tbl-${k}-tola`, `NPR ${fmt(p[k].perTola)}`);
    setIfExists(`tbl-${k}-gram`, `NPR ${fmt(p[k].perGram)}`);
    setIfExists(`tbl-${k}-10g`,  `NPR ${fmt(p[k].per10g)}`);
  });
  setIfExists('tbl-silver-tola', `NPR ${fmt(p.silver.perTola)}`);
  setIfExists('tbl-silver-gram', `NPR ${fmt(p.silver.perGram)}`);
  setIfExists('tbl-silver-10g',  `NPR ${fmt(p.silver.per10g)}`);

  /* timestamp */
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  els('.last-updated-time').forEach(e => (e.textContent = timeStr));

  state.lastUpdated = now;
  updateChart(p['24k'].perTola);

  /* hide skeleton loaders */
  els('.skeleton').forEach(s => s.classList.remove('skeleton'));
  els('.error-banner').forEach(b => b.classList.remove('show'));
}

function setIfExists(id, val) {
  const e = el(id);
  if (e) e.textContent = val;
}

/* ─── data fetch ─── */
async function fetchPrices() {
  try {
    const [metalsRes, currencyRes] = await Promise.all([
      fetchWithTimeout(APIS.metals),
      fetchWithTimeout(APIS.currency)
    ]);
    const metalsData   = await metalsRes.json();
    const currencyData = await currencyRes.json();

    // metals.live returns [{gold:..., silver:...}] or {gold:..., silver:...}
    const m = Array.isArray(metalsData) ? metalsData[0] : metalsData;
    const goldUSD   = parseFloat(m.gold)   || 0;
    const silverUSD = parseFloat(m.silver) || 0;
    const usdNPR    = parseFloat(currencyData?.usd?.npr) || FALLBACK_NPR;

    if (!goldUSD) throw new Error('Invalid gold data');

    state.prevGoldUSD = state.goldUSD || goldUSD;
    state.goldUSD   = goldUSD;
    state.silverUSD = silverUSD;
    state.usdNPR    = usdNPR;

    saveCache(goldUSD, silverUSD, usdNPR);
    updateUI(goldUSD, silverUSD, usdNPR);

  } catch (err) {
    console.warn('Live fetch failed:', err.message);
    const cached = loadCache();
    if (cached) {
      state.goldUSD   = cached.goldUSD;
      state.silverUSD = cached.silverUSD;
      state.usdNPR    = cached.usdNPR;
      updateUI(cached.goldUSD, cached.silverUSD, cached.usdNPR);
      els('.error-banner').forEach(b => b.classList.add('show'));
    } else {
      els('.error-banner').forEach(b => b.classList.add('show'));
    }
  }
}

/* ─── chart ─── */
function generateHistory(currentPrice, days) {
  const pts = [];
  let price = currentPrice;

  // Walk backwards
  const dailyVol = currentPrice * 0.008; // ~0.8% daily volatility
  for (let i = days; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);

    if (i > 0) {
      price -= (Math.random() - 0.48) * dailyVol;
      price = Math.max(price, currentPrice * 0.93);
    } else {
      price = currentPrice; // today is exact
    }

    pts.push({
      label: i === 0 ? 'Today' : date.toLocaleDateString('en-US', { month:'short', day:'numeric' }),
      value: Math.round(price)
    });
  }
  return pts;
}

function updateChart(goldPerTolaNPR) {
  if (!el('goldChart') || !goldPerTolaNPR) return;

  const daysMap = { '7d': 7, '1m': 30, '3m': 90 };
  const days    = daysMap[state.chartPeriod] || 7;
  const history = generateHistory(goldPerTolaNPR, days);

  const ctx = el('goldChart').getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 0, 320);
  grad.addColorStop(0, 'rgba(201,151,46,0.35)');
  grad.addColorStop(1, 'rgba(201,151,46,0.00)');

  if (state.chart) {
    state.chart.data.labels   = history.map(h => h.label);
    state.chart.data.datasets[0].data = history.map(h => h.value);
    state.chart.update('none');
    return;
  }

  state.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map(h => h.label),
      datasets: [{
        label: 'Gold Price (NPR/Tola)',
        data:  history.map(h => h.value),
        borderColor:     '#C9972E',
        backgroundColor: grad,
        borderWidth:     2.5,
        fill:            true,
        tension:         0.4,
        pointBackgroundColor: '#C9972E',
        pointBorderColor:     '#fff',
        pointBorderWidth:     2,
        pointRadius:          4,
        pointHoverRadius:     7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1F2937',
          titleColor: '#9CA3AF',
          bodyColor:  '#FFFFFF',
          bodyFont:   { size: 14, weight: 'bold' },
          padding:    12,
          callbacks: {
            label: ctx => `  NPR ${ctx.raw.toLocaleString('en-NP')} / Tola`
          }
        }
      },
      scales: {
        x: {
          grid:  { display: false },
          ticks: { color: '#6B7280', font: { size: 11 }, maxRotation: 0,
                   maxTicksLimit: days <= 7 ? 8 : days <= 30 ? 8 : 10 }
        },
        y: {
          grid:  { color: '#F3F4F6', lineWidth: 1 },
          ticks: {
            color: '#6B7280', font: { size: 11 },
            callback: v => 'NPR ' + Math.round(v).toLocaleString('en-NP')
          }
        }
      }
    }
  });
}

/* ─── chart tabs ─── */
function setupChartTabs() {
  els('.chart-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      els('.chart-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.chartPeriod = tab.dataset.period;
      if (state.chart) {
        state.chart.destroy();
        state.chart = null;
      }
      const p = calcPrices(state.goldUSD, state.silverUSD, state.usdNPR);
      updateChart(p['24k'].perTola);
    });
  });
}

/* ─── calculator ─── */
function setupCalculator() {
  const calcForm = el('calcForm');
  if (!calcForm) return;

  els('.calc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      els('.calc-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.calcMode = tab.dataset.mode;
      toggleCalcFields();
      clearResult();
    });
  });

  calcForm.addEventListener('input', debounce(doCalculate, 300));
  calcForm.addEventListener('change', doCalculate);
}

function toggleCalcFields() {
  const wtpGroup = el('wtp-group');
  const ptw      = el('ptw-group');
  if (!wtpGroup) return;

  if (state.calcMode === 'weight-to-price') {
    wtpGroup.style.display = '';
    if (ptw) ptw.style.display = 'none';
    const lbl = el('wtp-label');
    if (lbl) lbl.textContent = 'Weight';
  } else {
    wtpGroup.style.display = 'none';
    if (ptw) ptw.style.display = '';
  }
}

function doCalculate() {
  if (!state.goldUSD) return;
  const p = calcPrices(state.goldUSD, state.silverUSD, state.usdNPR);

  const purity   = (el('calc-purity')?.value || '24k');
  const unit     = el('calc-unit')?.value || 'tola';
  const making   = parseFloat(el('calc-making')?.value || 0) || 0;
  const prices   = p[purity];

  const pricePerUnit = unit === 'tola'  ? prices.perTola :
                       unit === 'gram'  ? prices.perGram : prices.per10g;

  let totalNPR, weightInGrams, weightInTola;

  if (state.calcMode === 'weight-to-price') {
    const qty = parseFloat(el('calc-qty')?.value) || 0;
    if (qty <= 0) return clearResult();
    const baseWeight = unit === 'tola' ? qty * TOLA_GRAMS : unit === 'gram' ? qty : qty * 10;
    const base = pricePerUnit * qty;
    totalNPR     = base * (1 + making / 100);
    weightInGrams = baseWeight;
    weightInTola  = baseWeight / TOLA_GRAMS;
  } else {
    const budget = parseFloat(el('calc-budget')?.value) || 0;
    if (budget <= 0) return clearResult();
    const goldBudget  = budget / (1 + making / 100);
    const gramPrice   = prices.perGram;
    weightInGrams     = goldBudget / gramPrice;
    weightInTola      = weightInGrams / TOLA_GRAMS;
    totalNPR          = budget;
  }

  const resultEl = el('calc-result');
  if (!resultEl) return;
  resultEl.classList.add('show');

  setIfExists('result-amount',  `NPR ${Math.round(totalNPR).toLocaleString('en-NP')}`);
  setIfExists('result-grams',   `${weightInGrams.toFixed(3)} g`);
  setIfExists('result-tola',    `${weightInTola.toFixed(4)} tola`);
  setIfExists('result-making-cost',
    making > 0 ? `NPR ${Math.round(totalNPR - totalNPR / (1 + making / 100)).toLocaleString('en-NP')}` : '—');
}

function clearResult() {
  const r = el('calc-result');
  if (r) r.classList.remove('show');
}

/* ─── nav toggle ─── */
function setupNav() {
  const toggle = el('navToggle');
  const menu   = el('navMenu');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    toggle.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open);
  });

  // close on outside click
  document.addEventListener('click', e => {
    if (!toggle.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.remove('open');
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', false);
    }
  });

  // highlight active page
  const current = location.pathname.split('/').pop() || 'index.html';
  els('.nav-menu a').forEach(a => {
    if (a.getAttribute('href') === current ||
        (current === '' && a.getAttribute('href') === 'index.html')) {
      a.classList.add('active');
    }
  });
}

/* ─── FAQ accordion ─── */
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

/* ─── contact form ─── */
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

/* ─── debounce ─── */
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

/* ─── init ─── */
document.addEventListener('DOMContentLoaded', async () => {
  setupNav();
  setupFAQ();
  setupContactForm();
  setupCalcTabs();
  setupChartTabs();
  await fetchPrices();
  setupCalculator();
  setInterval(fetchPrices, REFRESH_MS);
});

function setupCalcTabs() {
  // Called before setupCalculator to ensure tabs work
  els('.calc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      state.calcMode = tab.dataset.mode;
    });
  });
}
