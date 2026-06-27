/* =====================================================
   history.js  — Gold Price Nepal Historical View
   Loads: data/history.json + data/prices.json
   Renders: ticker · period-filtered chart · data table
   ===================================================== */

const TOLA_GRAMS   = 11.664;
const PRICES_JSON  = 'data/prices.json';
const HISTORY_JSON = 'data/history.json';

// Earliest date that is REAL scraped data (not estimated seed)
const REAL_DATA_FROM = '2026-06-23';

/* ── tiny helpers ── */
const el  = id => document.getElementById(id);
const els = s  => document.querySelectorAll(s);
const set = (id, v) => { const e = el(id); if (e) e.textContent = v; };
const fmt = n  => (n != null && n !== 0) ? Math.round(n).toLocaleString('en-NP') : '—';

const PERIOD_DAYS = { '7d':7, '1m':30, '3m':90, '6m':180, '1y':365, 'all':Infinity };

const state = {
  history   : [],   // sorted oldest → newest
  period    : '1y',
  chartType : 'line',
  chart     : null,
  todayPrices: null
};

/* ── init ── */
document.addEventListener('DOMContentLoaded', async () => {
  setupNav();
  setupPeriodTabs();
  setupChartTypeTabs();

  try {
    const [pricesRes, histRes] = await Promise.all([
      fetch(PRICES_JSON  + '?v=' + Date.now()),
      fetch(HISTORY_JSON + '?v=' + Date.now())
    ]);

    const prices  = await pricesRes.json();
    const history = await histRes.json();

    state.todayPrices = prices;

    // Merge today's live price if not already recorded
    if (prices?.gold24kTola) {
      const today = new Date().toISOString().split('T')[0];
      const alreadyIn = history.some(h => h.date === today);
      if (!alreadyIn) {
        history.push({ date: today, gold24k: prices.gold24kTola, silver: prices.silverTola || 0 });
      }
    }

    // Keep sorted oldest → newest
    history.sort((a, b) => a.date.localeCompare(b.date));
    state.history = history;

    renderTicker(prices);
    renderSummaryStats();
    renderChart();
    renderTable();

  } catch (err) {
    console.error('History load failed:', err);
    showError();
  }
});

/* ── data slice ── */
function getSlice() {
  const days = PERIOD_DAYS[state.period];
  if (days === Infinity) return state.history;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  return state.history.filter(r => r.date >= cutoffStr);
}

/* ── summary stats ── */
function renderSummaryStats() {
  const data = state.history;
  if (!data.length) return;

  const latest   = data[data.length - 1];
  const prev     = data[data.length - 2];
  const oldest   = data[0];
  const highest  = data.reduce((a, b) => b.gold24k > a.gold24k ? b : a);
  const lowest   = data.reduce((a, b) => b.gold24k < a.gold24k ? b : a);

  const dayChange    = prev ? latest.gold24k - prev.gold24k : 0;
  const totalChange  = latest.gold24k - oldest.gold24k;
  const totalChangePct = ((totalChange / oldest.gold24k) * 100).toFixed(1);

  set('stat-current',       `NPR ${fmt(latest.gold24k)}`);
  set('stat-day-change',    (dayChange >= 0 ? '+' : '') + fmt(dayChange));
  set('stat-52w-high',      `NPR ${fmt(highest.gold24k)}`);
  set('stat-52w-low',       `NPR ${fmt(lowest.gold24k)}`);
  set('stat-ytd-change',    (totalChange >= 0 ? '+' : '') + totalChangePct + '%');
  set('stat-records',       `${data.length} days`);

  const dayEl = el('stat-day-change');
  if (dayEl) dayEl.style.color = dayChange >= 0 ? 'var(--green)' : 'var(--red)';
  const ytdEl = el('stat-ytd-change');
  if (ytdEl) ytdEl.style.color = totalChange >= 0 ? 'var(--green)' : 'var(--red)';
}

/* ── chart ── */
function renderChart() {
  const container = el('histChart');
  if (!container) return;

  const slice = getSlice();
  if (!slice.length) {
    container.innerHTML = '<p style="text-align:center;padding:40px;color:#9CA3AF">No data for this period</p>';
    return;
  }

  const timestamps = slice.map(r => new Date(r.date + 'T10:00:00').getTime());
  const gold24k    = slice.map(r => r.gold24k);
  const gold22k    = slice.map(r => Math.round(r.gold24k * 22 / 24));
  const silver     = slice.map(r => r.silver || null);

  if (state.chart) { state.chart.destroy(); state.chart = null; }

  const isMobile = window.innerWidth < 640;
  const chartH   = isMobile ? 280 : 400;

  const baseOpts = {
    chart: {
      height: chartH,
      toolbar: {
        show: true,
        tools: { download: true, selection: false, zoom: true, zoomin: true, zoomout: true, pan: false, reset: true }
      },
      background: 'transparent',
      fontFamily: 'inherit',
      animations: { enabled: false },
      events: {
        mounted: () => els('.skeleton').forEach(s => s.classList.remove('skeleton'))
      }
    },
    colors: ['#C9972E', '#D4A849', '#A0AEC0'],
    dataLabels: { enabled: false },
    xaxis: {
      type: 'datetime',
      labels: { style: { colors: '#6B7280', fontSize: '11px' }, datetimeUTC: false },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    grid: { borderColor: '#F3F4F6', strokeDashArray: 3, padding: { right: 8 } },
    tooltip: {
      theme: 'dark',
      shared: true,
      x: { format: 'dd MMM yyyy' },
      y: { formatter: v => v ? 'NPR ' + Math.round(v).toLocaleString('en-NP') + '/Tola' : '—' }
    },
    legend: {
      position: 'top', horizontalAlign: 'right', fontSize: '12px',
      markers: { size: 8, shape: 'circle' },
      itemMargin: { horizontal: 12 }
    },
    yaxis: [
      {
        seriesName: '24K Fine Gold',
        title: { text: 'Gold (NPR/Tola)', style: { color: '#C9972E', fontSize: '11px', fontWeight: 600 } },
        labels: {
          style: { colors: '#6B7280', fontSize: '10px' },
          formatter: v => 'NPR ' + Math.round(v / 1000) + 'k'
        }
      },
      {
        seriesName: '22K Tejabi',
        show: false
      },
      {
        seriesName: 'Silver',
        opposite: true,
        title: { text: 'Silver (NPR/Tola)', style: { color: '#A0AEC0', fontSize: '11px', fontWeight: 600 } },
        labels: {
          style: { colors: '#6B7280', fontSize: '10px' },
          formatter: v => 'NPR ' + Math.round(v).toLocaleString('en-NP')
        }
      }
    ],
    markers: { size: 0, hover: { size: 4 } },
    responsive: [{
      breakpoint: 640,
      options: {
        chart: { height: 280 },
        legend: { position: 'bottom', horizontalAlign: 'center' },
        yaxis: [
          { labels: { formatter: v => Math.round(v/1000) + 'k' } },
          { show: false },
          { show: false }
        ]
      }
    }]
  };

  let opts;
  if (state.chartType === 'area') {
    opts = {
      ...baseOpts,
      chart: { ...baseOpts.chart, type: 'area' },
      stroke: { curve: 'smooth', width: [2.5, 2, 1.5] },
      fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.18, opacityTo: 0, stops: [0, 100] } },
      series: [
        { name: '24K Fine Gold', data: timestamps.map((t, i) => [t, gold24k[i]]) },
        { name: '22K Tejabi',    data: timestamps.map((t, i) => [t, gold22k[i]]) },
        { name: 'Silver',        data: timestamps.map((t, i) => silver[i] ? [t, silver[i]] : null).filter(Boolean) }
      ]
    };
  } else {
    opts = {
      ...baseOpts,
      chart: { ...baseOpts.chart, type: 'line' },
      stroke: { curve: 'smooth', width: [2.5, 2, 1.5] },
      series: [
        { name: '24K Fine Gold', data: timestamps.map((t, i) => [t, gold24k[i]]) },
        { name: '22K Tejabi',    data: timestamps.map((t, i) => [t, gold22k[i]]) },
        { name: 'Silver',        data: timestamps.map((t, i) => silver[i] ? [t, silver[i]] : null).filter(Boolean) }
      ]
    };
  }

  state.chart = new ApexCharts(container, opts);
  state.chart.render();
}

/* ── table ── */
const PAGE_SIZE   = 50;
let   currentPage = 1;

function renderTable() {
  const slice  = [...getSlice()].reverse(); // newest first
  const tbody  = el('histTbody');
  if (!tbody) return;

  // Slice to page
  const total  = slice.length;
  const pages  = Math.ceil(total / PAGE_SIZE);
  const start  = (currentPage - 1) * PAGE_SIZE;
  const pageData = slice.slice(start, start + PAGE_SIZE);

  set('histRecordCount', `${total.toLocaleString()} records`);

  if (!pageData.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="hist-empty-cell">No data for this period</td></tr>`;
    renderPagination(0, 0);
    return;
  }

  tbody.innerHTML = pageData.map((row, idx) => {
    const globalIdx = start + idx;
    // "previous" in newest-first means index+1 in slice
    const prevRow   = slice[globalIdx + 1];
    const change    = prevRow ? row.gold24k - prevRow.gold24k : null;
    const changeStr = change === null ? '—' : (change >= 0 ? '+' : '') + fmt(Math.abs(change));
    const changeCls = change === null ? '' : change > 0 ? 'hist-up' : change < 0 ? 'hist-down' : '';

    const isEstimated = row.date < REAL_DATA_FROM;
    const dateLabel   = formatDate(row.date);
    const gold22k     = Math.round(row.gold24k * 22 / 24);

    return `<tr>
      <td class="hist-td-date">
        <span>${dateLabel}</span>
        ${isEstimated ? '<span class="hist-est-badge">Est.</span>' : ''}
      </td>
      <td class="hist-td-price">NPR&nbsp;${fmt(row.gold24k)}</td>
      <td class="hist-td-price">NPR&nbsp;${fmt(gold22k)}</td>
      <td class="hist-td-price">${row.silver ? 'NPR&nbsp;' + fmt(row.silver) : '—'}</td>
      <td class="hist-td-change ${changeCls}">${changeStr}</td>
    </tr>`;
  }).join('');

  renderPagination(pages, total);
}

function renderPagination(pages, total) {
  const wrap = el('histPagination');
  if (!wrap) return;
  if (pages <= 1) { wrap.innerHTML = ''; return; }

  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end   = Math.min(currentPage * PAGE_SIZE, total);

  let html = `<div class="hist-page-info">Showing ${start}–${end} of ${total}</div><div class="hist-page-btns">`;

  if (currentPage > 1) {
    html += `<button class="hist-page-btn" onclick="goPage(${currentPage - 1})">‹ Prev</button>`;
  }

  // Show up to 5 page buttons around current
  const startPg = Math.max(1, currentPage - 2);
  const endPg   = Math.min(pages, currentPage + 2);
  for (let p = startPg; p <= endPg; p++) {
    html += `<button class="hist-page-btn${p === currentPage ? ' active' : ''}" onclick="goPage(${p})">${p}</button>`;
  }

  if (currentPage < pages) {
    html += `<button class="hist-page-btn" onclick="goPage(${currentPage + 1})">Next ›</button>`;
  }

  html += '</div>';
  wrap.innerHTML = html;
}

window.goPage = function(p) {
  currentPage = p;
  renderTable();
  el('histTableSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/* ── period tabs ── */
function setupPeriodTabs() {
  els('.hist-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      els('.hist-period-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed','false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      state.period = btn.dataset.period;
      currentPage  = 1;
      renderChart();
      renderTable();
    });
  });
}

/* ── chart type tabs ── */
function setupChartTypeTabs() {
  els('.hist-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      els('.hist-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.chartType = btn.dataset.type;
      renderChart();
    });
  });
}

/* ── ticker ── */
function renderTicker(prices) {
  if (!prices?.gold24kTola) return;
  const g24 = prices.gold24kTola;
  const g22 = Math.round(g24 * 22 / 24);
  set('ticker-gold',   `NPR ${fmt(g24)}/tola`);
  set('ticker-22k',    `NPR ${fmt(g22)}/tola`);
  set('ticker-silver', prices.silverTola ? `NPR ${fmt(prices.silverTola)}/tola` : '—');
  const t = new Date().toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  els('.last-updated-time').forEach(e => e.textContent = t);
  // duplicate track for seamless scroll
  const track = el('tickerTrack');
  if (track && track.parentElement.querySelectorAll('.ticker-track').length < 2) {
    const clone = track.cloneNode(true);
    clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    clone.removeAttribute('id');
    track.parentElement.appendChild(clone);
  }
  els('.skeleton').forEach(s => s.classList.remove('skeleton'));
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
      menu.classList.remove('open');
      toggle.classList.remove('open');
    }
  });
}

/* ── error ── */
function showError() {
  els('.error-banner').forEach(b => b.classList.add('show'));
}

/* ── date formatter ── */
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
}
