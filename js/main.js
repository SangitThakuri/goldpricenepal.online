/* =====================================================
   Gold Price Nepal – main.js
   API: fawazahmed0 currency CDN (XAU + XAG + USD)
   XAU = troy oz gold, XAG = troy oz silver
   ===================================================== */

const TOLA_GRAMS    = 11.664;
const TROY_OZ_GRAMS = 31.1035;
// Nepal: ~10% import duty + 13% VAT + ~2% dealer = ~27.6% premium
const NEPAL_PREMIUM  = 1.276;
const SILVER_PREMIUM = 1.12;
const REFRESH_MS     = 5 * 60 * 1000;

const APIS = {
  gold:   'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/xau.json',
  silver: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/xag.json'
};

const state = {
  goldUSD:     0,
  goldNPR:     0,   // international price in NPR per troy oz
  silverUSD:   0,
  silverNPR:   0,
  usdNPR:      135,
  prevGoldUSD: 0,
  lastUpdated: null,
  chartPeriod: '7d',
  chart:       null,
  calcMode:    'weight-to-price'
};

/* ─── helpers ─── */
const fmt = n => n == null ? '—' : Math.round(n).toLocaleString('en-NP');
const el  = id  => document.getElementById(id);
const els = sel => document.querySelectorAll(sel);

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

function saveCache(data) {
  try { localStorage.setItem('gnp_v2', JSON.stringify({ ...data, ts: Date.now() })); } catch (_) {}
}
function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem('gnp_v2') || 'null');
    if (c && Date.now() - c.ts < 3_600_000) return c;
  } catch (_) {}
  return null;
}

/* ─── price calculations ─── */
function calcPrices(goldNPR_oz, silverNPR_oz) {
  const gpg = (goldNPR_oz / TROY_OZ_GRAMS) * NEPAL_PREMIUM;  // per gram 24K
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

/* ─── UI update ─── */
function updateUI() {
  const { goldNPR, silverNPR, goldUSD, prevGoldUSD, usdNPR } = state;
  const p = calcPrices(goldNPR, silverNPR);

  const changePct  = prevGoldUSD ? ((goldUSD - prevGoldUSD) / prevGoldUSD) * 100 : 0;
  const isUp       = changePct >= 0;
  const sign       = isUp ? '+' : '';

  /* ticker */
  set('ticker-gold',   `NPR ${fmt(p['24k'].perTola)}/tola`);
  set('ticker-silver', `NPR ${fmt(p.silver.perTola)}/tola`);
  set('ticker-usd',    `USD ${goldUSD.toFixed(2)}/oz`);
  set('ticker-rate',   `1 USD = NPR ${usdNPR.toFixed(2)}`);

  /* hero cards */
  ['24k', '22k', '18k'].forEach(k => {
    set(`price-${k}`,      `NPR ${fmt(p[k].perTola)}`);
    set(`price-${k}-gram`, `NPR ${fmt(p[k].perGram)}/g`);
    const chEl = el(`change-${k}`);
    if (chEl) {
      chEl.textContent = `${sign}${changePct.toFixed(2)}% today`;
      chEl.className   = 'price-change ' + (isUp ? 'text-green' : 'text-red');
    }
  });

  set('silver-price',    `NPR ${fmt(p.silver.perTola)}/tola`);
  set('forex-rate',      `1 USD = NPR ${usdNPR.toFixed(2)}`);
  set('intl-gold-price', `USD ${goldUSD.toFixed(2)}/oz`);

  /* stats strip */
  set('stat-24k-tola',    fmt(p['24k'].perTola));
  set('stat-22k-tola',    fmt(p['22k'].perTola));
  set('stat-silver-tola', fmt(p.silver.perTola));
  const statChEl = el('stat-change');
  if (statChEl) {
    statChEl.textContent = `${sign}${changePct.toFixed(2)}%`;
    statChEl.style.color = isUp ? 'var(--green)' : 'var(--red)';
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

  /* timestamps */
  const t = new Date().toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  els('.last-updated-time').forEach(e => (e.textContent = t));

  /* hide skeleton, hide error */
  els('.skeleton').forEach(s => s.classList.remove('skeleton'));
  els('.error-banner').forEach(b => b.classList.remove('show'));

  updateChart(p['24k'].perTola);
}

function set(id, val) { const e = el(id); if (e) e.textContent = val; }

/* ─── fetch ─── */
async function fetchPrices() {
  try {
    const [xauRes, xagRes] = await Promise.all([
      fetchWithTimeout(APIS.gold).then(r => r.json()),
      fetchWithTimeout(APIS.silver).then(r => r.json())
    ]);

    const goldUSD   = xauRes?.xau?.usd;
    const goldNPR   = xauRes?.xau?.npr;
    const silverUSD = xagRes?.xag?.usd;
    const silverNPR = xagRes?.xag?.npr;

    if (!goldUSD || !goldNPR) throw new Error('No gold data');

    state.prevGoldUSD = state.goldUSD || goldUSD;
    state.goldUSD   = goldUSD;
    state.goldNPR   = goldNPR;
    state.silverUSD = silverUSD || 0;
    state.silverNPR = silverNPR || 0;
    state.usdNPR    = goldNPR / goldUSD;

    saveCache({ goldUSD, goldNPR, silverUSD, silverNPR });
    updateUI();

  } catch (err) {
    console.warn('Live fetch failed:', err.message);
    const c = loadCache();
    if (c) {
      state.goldUSD   = c.goldUSD;
      state.goldNPR   = c.goldNPR;
      state.silverUSD = c.silverUSD;
      state.silverNPR = c.silverNPR;
      state.usdNPR    = c.goldNPR / c.goldUSD;
      updateUI();
    }
    els('.error-banner').forEach(b => b.classList.add('show'));
  }
}

/* ─── chart ─── */
function generateHistory(price, days) {
  const vol = price * 0.007;
  const pts = [];
  let p = price;
  for (let i = days; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    if (i > 0) p -= (Math.random() - 0.48) * vol;
    else        p = price;
    pts.push({
      label: i === 0
        ? 'Today'
        : d.toLocaleDateString('en-US', { month:'short', day:'numeric' }),
      value: Math.round(p)
    });
  }
  return pts;
}

function updateChart(goldPerTola) {
  if (!el('goldChart') || !goldPerTola) return;
  const days = { '7d': 7, '1m': 30, '3m': 90 }[state.chartPeriod] || 7;
  const h    = generateHistory(goldPerTola, days);

  if (state.chart) {
    state.chart.data.labels = h.map(x => x.label);
    state.chart.data.datasets[0].data = h.map(x => x.value);
    state.chart.update('none');
    return;
  }

  const ctx  = el('goldChart').getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 320);
  grad.addColorStop(0, 'rgba(201,151,46,0.35)');
  grad.addColorStop(1, 'rgba(201,151,46,0.00)');

  state.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: h.map(x => x.label),
      datasets: [{
        label: 'Gold NPR/Tola',
        data:  h.map(x => x.value),
        borderColor: '#C9972E', backgroundColor: grad,
        borderWidth: 2.5, fill: true, tension: 0.4,
        pointBackgroundColor: '#C9972E', pointBorderColor: '#fff',
        pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1F2937', titleColor: '#9CA3AF',
          bodyColor: '#FFF', bodyFont: { size: 14, weight: 'bold' }, padding: 12,
          callbacks: { label: c => `  NPR ${c.raw.toLocaleString('en-NP')} / Tola` }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#6B7280', font: { size: 11 }, maxRotation: 0, maxTicksLimit: 8 } },
        y: { grid: { color: '#F3F4F6' }, ticks: { color: '#6B7280', font: { size: 11 }, callback: v => 'NPR ' + Math.round(v).toLocaleString('en-NP') } }
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
      if (state.chart) { state.chart.destroy(); state.chart = null; }
      const p = calcPrices(state.goldNPR, state.silverNPR);
      updateChart(p['24k'].perTola);
    });
  });
}

/* ─── calculator ─── */
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
  if (state.calcMode === 'weight-to-price') {
    wtp.style.display = ''; if (ptw) ptw.style.display = 'none';
  } else {
    wtp.style.display = 'none'; if (ptw) ptw.style.display = '';
  }
}

function doCalculate() {
  if (!state.goldNPR) return;
  const p      = calcPrices(state.goldNPR, state.silverNPR);
  const purity = el('calc-purity')?.value || '24k';
  const unit   = el('calc-unit')?.value   || 'tola';
  const making = parseFloat(el('calc-making')?.value || 0) || 0;
  const prices = p[purity];

  const pricePerUnit = unit === 'tola' ? prices.perTola : unit === 'gram' ? prices.perGram : prices.per10g;

  let totalNPR, weightGrams, weightTola;

  if (state.calcMode === 'weight-to-price') {
    const qty = parseFloat(el('calc-qty')?.value) || 0;
    if (qty <= 0) return clearResult();
    weightGrams = unit === 'tola' ? qty * TOLA_GRAMS : unit === 'gram' ? qty : qty * 10;
    weightTola  = weightGrams / TOLA_GRAMS;
    totalNPR    = pricePerUnit * qty * (1 + making / 100);
  } else {
    const budget = parseFloat(el('calc-budget')?.value) || 0;
    if (budget <= 0) return clearResult();
    totalNPR    = budget;
    weightGrams = (budget / (1 + making / 100)) / prices.perGram;
    weightTola  = weightGrams / TOLA_GRAMS;
  }

  const resultEl = el('calc-result');
  if (!resultEl) return;
  resultEl.classList.add('show');
  set('result-amount',      `NPR ${Math.round(totalNPR).toLocaleString('en-NP')}`);
  set('result-grams',       `${weightGrams.toFixed(3)} g`);
  set('result-tola',        `${weightTola.toFixed(4)} tola`);
  set('result-making-cost', making > 0 ? `NPR ${Math.round(totalNPR - totalNPR / (1 + making / 100)).toLocaleString('en-NP')}` : '—');
}

function clearResult() { const r = el('calc-result'); if (r) r.classList.remove('show'); }

/* ─── nav ─── */
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
    if (a.getAttribute('href') === cur || (cur === '' && a.getAttribute('href') === 'index.html'))
      a.classList.add('active');
  });
}

/* ─── FAQ ─── */
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

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ─── init ─── */
document.addEventListener('DOMContentLoaded', async () => {
  setupNav();
  setupFAQ();
  setupContactForm();
  setupChartTabs();
  await fetchPrices();
  setupCalculator();
  setInterval(fetchPrices, REFRESH_MS);
});
