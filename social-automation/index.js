/**
 * GoldPriceNepal — Social Media Automation
 *
 * Flow:
 *   1. Fetch live prices from goldpricenepal.online/data/prices.json
 *   2. Render a 1080×1080 PNG graphic via @napi-rs/canvas
 *   3. POST to Facebook Page via Graph API v24.0
 *
 * Usage:
 *   node index.js             → full run (post to Facebook)
 *   node index.js --dry-run   → render only, save PNG locally
 *
 * Required env vars (set in .env or GitHub Actions secrets):
 *   FB_PAGE_ID
 *   FB_PAGE_ACCESS_TOKEN
 */

import 'dotenv/config';
import { createCanvas } from '@napi-rs/canvas';
import { writeFile } from 'fs/promises';

/* ─────────────────────────────────────────
   Config
───────────────────────────────────────── */
const PRICES_URL   = 'https://goldpricenepal.online/data/prices.json';
const FB_API_BASE  = 'https://graph.facebook.com/v24.0';
const CANVAS_SIZE  = 1080;
const DRY_RUN      = process.argv.includes('--dry-run');

/* ─────────────────────────────────────────
   Helpers
───────────────────────────────────────── */
const fmt   = n  => Math.round(n).toLocaleString('en-NP');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function nepaliDate() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Asia/Kathmandu',
  });
}

/**
 * Fetch with exponential-backoff retry.
 * For POST requests with a FormData body the caller must pass a factory
 * function so a fresh body can be created on each attempt.
 */
async function fetchRetry(url, optionsOrFactory, retries = 3) {
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    const options = typeof optionsOrFactory === 'function'
      ? optionsOrFactory()
      : optionsOrFactory ?? {};

    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      console.warn(`  [retry ${i}/${retries}] ${err.message}`);
      if (i < retries) await sleep(2000 * i);
    }
  }
  throw lastErr;
}

/* ─────────────────────────────────────────
   Stage 1 — Fetch live prices
───────────────────────────────────────── */
async function fetchPrices() {
  console.log('\n[1/3] Fetching live prices…');
  const res  = await fetchRetry(`${PRICES_URL}?_=${Date.now()}`);
  const data = await res.json();

  const gold24k = Number(data?.gold24kTola);
  const silver  = Number(data?.silverTola);

  if (!gold24k || gold24k < 50_000 || gold24k > 800_000) {
    throw new Error(`Implausible gold price received: ${gold24k}`);
  }

  const gold22k  = Math.round(gold24k * (22 / 24));
  const gold24kG = Math.round(gold24k / 11.664);
  const gold22kG = Math.round(gold22k / 11.664);
  const silverG  = silver ? Math.round(silver / 11.664) : 0;

  console.log(`     24K: Rs. ${fmt(gold24k)} / tola  (Rs. ${fmt(gold24kG)}/g)`);
  console.log(`     22K: Rs. ${fmt(gold22k)} / tola  (Rs. ${fmt(gold22kG)}/g)`);
  console.log(`  Silver: Rs. ${fmt(silver)}  / tola  (Rs. ${fmt(silverG)}/g)`);

  return { gold24k, gold22k, silver, gold24kG, gold22kG, silverG };
}

/* ─────────────────────────────────────────
   Stage 2 — Render canvas graphic
───────────────────────────────────────── */
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}

async function renderGraphic(prices) {
  console.log('\n[2/3] Rendering 1080×1080 graphic…');

  const { gold24k, gold22k, silver, gold24kG, gold22kG, silverG } = prices;
  const W = CANVAS_SIZE, H = CANVAS_SIZE;
  const cx = W / 2;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  /* ── Background ── */
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0,   '#0D1520');
  bgGrad.addColorStop(0.5, '#111827');
  bgGrad.addColorStop(1,   '#0E1C2F');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  /* Subtle crosshatch grid */
  ctx.save();
  ctx.strokeStyle = 'rgba(201,151,46,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 54) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 54) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();

  /* Gold glow radial — top-centre */
  const glow = ctx.createRadialGradient(cx, 0, 0, cx, 0, 620);
  glow.addColorStop(0,   'rgba(201,151,46,0.14)');
  glow.addColorStop(0.5, 'rgba(201,151,46,0.04)');
  glow.addColorStop(1,   'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  /* ── Top / bottom accent bars ── */
  const barGrad = ctx.createLinearGradient(0, 0, W, 0);
  barGrad.addColorStop(0,   'transparent');
  barGrad.addColorStop(0.2, '#C9972E');
  barGrad.addColorStop(0.8, '#E4B84D');
  barGrad.addColorStop(1,   'transparent');
  ctx.fillStyle = barGrad;
  ctx.fillRect(0, 0, W, 5);
  ctx.fillRect(0, H - 5, W, 5);

  /* ── LIVE badge ── */
  const badgeX = W - 46, badgeY = 50;
  rrect(ctx, badgeX - 80, badgeY - 20, 114, 32, 16);
  ctx.fillStyle = 'rgba(16,185,129,0.14)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(16,185,129,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(badgeX - 60, badgeY - 4, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#10B981';
  ctx.fill();

  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = '#10B981';
  ctx.textAlign = 'left';
  ctx.fillText('LIVE', badgeX - 50, badgeY + 1);

  /* ── Date ── */
  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#6B7280';
  ctx.textAlign = 'center';
  ctx.fillText(nepaliDate(), cx, 78);

  /* ── Main title ── */
  ctx.font = 'bold 58px sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText("TODAY'S GOLD PRICE", cx, 164);

  ctx.font = 'bold 58px sans-serif';
  const titleGrad = ctx.createLinearGradient(200, 0, W - 200, 0);
  titleGrad.addColorStop(0, '#C9972E');
  titleGrad.addColorStop(0.5, '#E4B84D');
  titleGrad.addColorStop(1, '#C9972E');
  ctx.fillStyle = titleGrad;
  ctx.fillText('IN NEPAL', cx, 232);

  /* Divider */
  const divGrad = ctx.createLinearGradient(0, 0, W, 0);
  divGrad.addColorStop(0,   'transparent');
  divGrad.addColorStop(0.15, '#C9972E');
  divGrad.addColorStop(0.85, '#C9972E');
  divGrad.addColorStop(1,   'transparent');
  ctx.fillStyle = divGrad;
  ctx.fillRect(100, 260, W - 200, 2);

  /* Source label */
  ctx.font = '18px sans-serif';
  ctx.fillStyle = '#4B5563';
  ctx.fillText('Official rate by FENEGOSIDA  ·  Per tola (11.664 g)', cx, 298);

  /* ── Price cards ── */
  const cards = [
    {
      label: 'Fine Gold',
      sub:   '24K · 99.9% Pure',
      tola:  gold24k,
      gram:  gold24kG,
      fg:    '#E4B84D',
      bg:    'rgba(228,184,77,0.10)',
      border:'rgba(228,184,77,0.35)',
    },
    {
      label: 'Tejabi Gold',
      sub:   '22K · 91.7% Pure',
      tola:  gold22k,
      gram:  gold22kG,
      fg:    '#C9972E',
      bg:    'rgba(201,151,46,0.07)',
      border:'rgba(201,151,46,0.28)',
    },
    {
      label: 'Silver',
      sub:   'Chandi · 99.9% Pure',
      tola:  silver,
      gram:  silverG,
      fg:    '#9CA3AF',
      bg:    'rgba(156,163,175,0.09)',
      border:'rgba(156,163,175,0.28)',
    },
  ];

  const cW = 296, cH = 218, cGap = 26;
  const totalW = cW * 3 + cGap * 2;
  const cX0    = (W - totalW) / 2;
  const cY0    = 326;

  cards.forEach((card, i) => {
    const x = cX0 + i * (cW + cGap);
    const y = cY0;
    const mx = x + cW / 2;

    rrect(ctx, x, y, cW, cH, 18);
    ctx.fillStyle = card.bg;
    ctx.fill();
    ctx.strokeStyle = card.border;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    /* Label */
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = card.fg;
    ctx.textAlign = 'center';
    ctx.fillText(card.label, mx, y + 46);

    /* Sub-label */
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#6B7280';
    ctx.fillText(card.sub, mx, y + 68);

    /* Thin rule inside card */
    ctx.fillStyle = card.border;
    ctx.fillRect(x + 30, y + 80, cW - 60, 1);

    /* Price — dynamic font size so long numbers don't overflow */
    const priceStr = `Rs. ${fmt(card.tola)}`;
    const pSize    = priceStr.length > 14 ? 26 : 30;
    ctx.font       = `bold ${pSize}px sans-serif`;
    ctx.fillStyle  = '#FFFFFF';
    ctx.fillText(priceStr, mx, y + 128);

    /* Per-tola label */
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#6B7280';
    ctx.fillText('per tola', mx, y + 152);

    /* Per-gram */
    ctx.font = '15px sans-serif';
    ctx.fillStyle = '#9CA3AF';
    ctx.fillText(`Rs. ${fmt(card.gram)} / gram`, mx, y + 178);

    /* Purity dot */
    ctx.beginPath();
    ctx.arc(mx, y + 200, 4, 0, Math.PI * 2);
    ctx.fillStyle = card.fg;
    ctx.fill();
  });

  /* ── Info strip ── */
  const infoY = 578;
  rrect(ctx, 80, infoY, W - 160, 90, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = '#E4B84D';
  ctx.textAlign = 'center';
  ctx.fillText('💡 Quick Reference', cx, infoY + 32);

  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#6B7280';
  ctx.fillText('1 Tola = 11.664 g  ·  1 Aana = 0.729 g  ·  10% duty + 13% VAT on imports', cx, infoY + 60);

  /* ── CTA card ── */
  const ctaY = 700;
  const ctaBg = ctx.createLinearGradient(80, ctaY, W - 80, ctaY + 188);
  ctaBg.addColorStop(0, 'rgba(201,151,46,0.16)');
  ctaBg.addColorStop(1, 'rgba(201,151,46,0.05)');
  rrect(ctx, 80, ctaY, W - 160, 188, 18);
  ctx.fillStyle = ctaBg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(201,151,46,0.32)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = 'bold 26px sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.fillText('Calculate Your Gold Value — Free', cx, ctaY + 54);

  ctx.font = '18px sans-serif';
  ctx.fillStyle = '#9CA3AF';
  ctx.fillText('Weight converter  ·  Making charges  ·  Investment tracker', cx, ctaY + 90);
  ctx.fillText('Price history  ·  Live chart  ·  Remittance rates', cx, ctaY + 118);

  /* URL */
  const urlGrad = ctx.createLinearGradient(cx - 200, 0, cx + 200, 0);
  urlGrad.addColorStop(0, '#C9972E');
  urlGrad.addColorStop(0.5, '#F0D080');
  urlGrad.addColorStop(1, '#C9972E');
  ctx.fillStyle = urlGrad;
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('goldpricenepal.online', cx, ctaY + 162);

  /* ── Footer ── */
  ctx.font = '14px sans-serif';
  ctx.fillStyle = '#374151';
  ctx.textAlign = 'center';
  ctx.fillText(
    'Live tracking · Weight calculator · Investment portfolio · Daily FENEGOSIDA rates',
    cx, H - 24,
  );

  const buffer = await canvas.encode('png');
  console.log(`     Graphic rendered (${(buffer.length / 1024).toFixed(1)} KB)`);
  return buffer;
}

/* ─────────────────────────────────────────
   Stage 3 — Post to Facebook Graph API
───────────────────────────────────────── */
function buildCaption(prices) {
  const { gold24k, gold22k, silver } = prices;
  const today = nepaliDate();

  return [
    `🏅 Today's Official Gold & Silver Price in Nepal`,
    `📅 ${today}`,
    '',
    `🥇 Fine Gold (24K):   Rs. ${fmt(gold24k)} per tola`,
    `🥈 Tejabi Gold (22K): Rs. ${fmt(gold22k)} per tola`,
    `⚪ Silver (Chandi):   Rs. ${fmt(silver)} per tola`,
    '',
    `📍 Rates announced by FENEGOSIDA (Federation of Nepal Gold & Silver Dealers' Association)`,
    '',
    `🔢 Calculate your jewellery price with our free tool — weight converter, making charges, investment tracker, and live chart:`,
    `👉 https://goldpricenepal.online`,
    '',
    `#GoldPriceNepal #SunaKoBhaau #सुनकोभाउ #NepalGold #FENEGOSIDA #GoldRateNepal #SilverNepal #NepalJewellery #GoldInvestment #NepalFinance #TodayGoldRate`,
  ].join('\n');
}

async function postToFacebook(imageBuffer, prices) {
  const { FB_PAGE_ID, FB_PAGE_ACCESS_TOKEN } = process.env;

  if (!FB_PAGE_ID)            throw new Error('FB_PAGE_ID env var is not set');
  if (!FB_PAGE_ACCESS_TOKEN)  throw new Error('FB_PAGE_ACCESS_TOKEN env var is not set');

  const caption  = buildCaption(prices);
  const endpoint = `${FB_API_BASE}/${FB_PAGE_ID}/photos`;
  const filename = `gold-price-nepal-${new Date().toISOString().split('T')[0]}.png`;

  console.log('\n[3/3] Publishing to Facebook Graph API…');
  console.log(`     Endpoint : ${endpoint}`);
  console.log(`     Filename : ${filename}`);

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      /* Rebuild FormData on every attempt — streams cannot be re-read */
      const form = new FormData();
      form.append('source', new Blob([imageBuffer], { type: 'image/png' }), filename);
      form.append('caption', caption);
      form.append('access_token', FB_PAGE_ACCESS_TOKEN);

      const res = await fetch(endpoint, {
        method : 'POST',
        body   : form,
        signal : AbortSignal.timeout(30_000),
      });

      const json = await res.json();

      if (json.error) {
        throw new Error(
          `Graph API error [${json.error.code}] ${json.error.type}: ${json.error.message}`
        );
      }

      const postId = json.post_id || json.id;
      console.log(`\n✅  Published successfully!`);
      console.log(`     Post ID : ${postId}`);
      console.log(`     URL     : https://www.facebook.com/${postId}`);
      return json;

    } catch (err) {
      lastErr = err;
      console.warn(`  [attempt ${attempt}/3] Failed: ${err.message}`);
      if (attempt < 3) {
        console.log(`  Retrying in ${attempt * 3}s…`);
        await sleep(attempt * 3000);
      }
    }
  }

  throw lastErr;
}

/* ─────────────────────────────────────────
   Main
───────────────────────────────────────── */
async function main() {
  console.log('══════════════════════════════════════════════');
  console.log('  GoldPriceNepal — Social Automation  v1.0.0 ');
  console.log('══════════════════════════════════════════════');
  if (DRY_RUN) {
    console.log('  Mode: DRY RUN — graphic saved locally, no post');
  }

  try {
    const prices      = await fetchPrices();
    const imageBuffer = await renderGraphic(prices);

    if (DRY_RUN) {
      const out = `preview-${Date.now()}.png`;
      await writeFile(out, imageBuffer);
      console.log(`\n[dry-run] Saved → ${out}`);
      console.log('  Open the file to verify the graphic before going live.\n');
      return;
    }

    await postToFacebook(imageBuffer, prices);

  } catch (err) {
    console.error(`\n❌ Fatal: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

main();
