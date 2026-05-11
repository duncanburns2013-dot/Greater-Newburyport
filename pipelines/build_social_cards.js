// build_social_cards.js — generates landscape + vertical social-share cards
// using the aerial Newburyport photo as the background.
//
// Source: assets/newburyport-aerial.jpg  (save the aerial harbor photo here)
// Outputs:
//   assets/social-landscape.jpg  — 1200x630 (X / Facebook / LinkedIn / iMessage)
//   assets/social-vertical.jpg   — 1080x1920 (Instagram Stories / Reels / TikTok)
//
// Run:  node pipelines/build_social_cards.js

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'newburyport-aerial.jpg');
const OUT_DIR = path.join(ROOT, 'assets');

if (!fs.existsSync(SRC)) {
  console.error('Missing ' + SRC);
  console.error('Save the aerial photo to assets/newburyport-aerial.jpg first.');
  process.exit(1);
}

// ----- shared brand tokens -----
const NAVY  = '#1e335e';
const CYAN  = '#c9ebfc';
const CREAM = '#f3eede';
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS  = '"Helvetica Neue", Helvetica, Arial, sans-serif';

// ----- LANDSCAPE 1200x630 -----
async function buildLandscape() {
  const W = 1200, H = 630;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="darken" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"  stop-color="rgba(10,18,32,0.18)"/>
        <stop offset="45%" stop-color="rgba(10,18,32,0.30)"/>
        <stop offset="100%" stop-color="rgba(10,18,32,0.92)"/>
      </linearGradient>
      <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stop-color="${NAVY}"/>
        <stop offset="100%" stop-color="${CYAN}"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#darken)"/>
    <!-- thin gradient rule -->
    <rect x="60" y="${H - 175}" width="100" height="3" fill="url(#rule)" rx="1.5"/>
    <!-- title block -->
    <text x="60" y="${H - 110}" font-family='${SERIF}' font-style="italic" font-weight="500"
          font-size="72" fill="${CREAM}" letter-spacing="-1">Greater Newburyport</text>
    <text x="60" y="${H - 60}" font-family='${SERIF}' font-style="italic" font-weight="400"
          font-size="28" fill="${CYAN}" opacity="0.95">Real Estate Market Snapshot</text>
    <!-- right-side meta -->
    <text x="${W - 60}" y="${H - 60}" text-anchor="end" font-family='${SANS}' font-weight="600"
          font-size="13" letter-spacing="3" fill="${CREAM}" opacity="0.78">RE/MAX BENTLEY'S</text>
    <text x="${W - 60}" y="${H - 38}" text-anchor="end" font-family='${SANS}' font-weight="400"
          font-size="11" letter-spacing="2" fill="${CREAM}" opacity="0.55">LIVE MLSPIN DATA · REFRESHED WEEKLY</text>
    <!-- top kicker -->
    <text x="60" y="48" font-family='${SANS}' font-weight="600" font-size="11" letter-spacing="4"
          fill="${CYAN}" opacity="0.85">NEWBURYPORT · AMESBURY · SALISBURY · NEWBURY · ROWLEY · WEST NEWBURY</text>
  </svg>`;

  await sharp(SRC)
    .resize(W, H, { fit: 'cover', position: 'attention' })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(path.join(OUT_DIR, 'social-landscape.jpg'));
  const bytes = fs.statSync(path.join(OUT_DIR, 'social-landscape.jpg')).size;
  console.log(`  social-landscape.jpg   ${W}x${H}   ${(bytes/1024).toFixed(0)} KB`);
}

// ----- VERTICAL 1080x1920 -----
async function buildVertical() {
  const W = 1080, H = 1920;
  // For the vertical card we show the photo in the top 55% and a navy
  // gradient block holds the title in the bottom 45%.
  const photoH = Math.round(H * 0.62);
  const photoBuf = await sharp(SRC)
    .resize(W, photoH, { fit: 'cover', position: 'attention' })
    .toBuffer();

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="fadeOut" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"  stop-color="rgba(10,18,32,0.0)"/>
        <stop offset="55%" stop-color="rgba(10,18,32,0.0)"/>
        <stop offset="80%" stop-color="rgba(10,18,32,0.55)"/>
        <stop offset="100%" stop-color="rgba(10,18,32,1.0)"/>
      </linearGradient>
      <linearGradient id="ruleBig" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stop-color="${NAVY}"/>
        <stop offset="100%" stop-color="${CYAN}"/>
      </linearGradient>
    </defs>
    <!-- bottom navy block, fades into the photo -->
    <rect x="0" y="${photoH - 200}" width="${W}" height="${H - photoH + 200}" fill="${NAVY}"/>
    <rect x="0" y="${photoH - 200}" width="${W}" height="${H - photoH + 200}" fill="url(#fadeOut)"/>

    <!-- top kicker over photo -->
    <text x="${W/2}" y="120" text-anchor="middle" font-family='${SANS}' font-weight="700"
          font-size="22" letter-spacing="9" fill="${CREAM}" opacity="0.92"
          style="text-shadow: 0 2px 12px rgba(0,0,0,0.6)">RE/MAX BENTLEY'S</text>

    <!-- gradient rule -->
    <rect x="${(W - 160) / 2}" y="${photoH + 80}" width="160" height="4" fill="url(#ruleBig)" rx="2"/>

    <!-- title -->
    <text x="${W/2}" y="${photoH + 230}" text-anchor="middle" font-family='${SERIF}'
          font-style="italic" font-weight="500" font-size="112" fill="${CREAM}"
          letter-spacing="-2">Greater</text>
    <text x="${W/2}" y="${photoH + 360}" text-anchor="middle" font-family='${SERIF}'
          font-style="italic" font-weight="500" font-size="112" fill="${CYAN}"
          letter-spacing="-2">Newburyport</text>

    <!-- subtitle -->
    <text x="${W/2}" y="${photoH + 440}" text-anchor="middle" font-family='${SERIF}'
          font-style="italic" font-size="38" fill="${CREAM}" opacity="0.85">Real Estate Market Snapshot</text>

    <!-- towns list -->
    <text x="${W/2}" y="${photoH + 540}" text-anchor="middle" font-family='${SANS}' font-weight="500"
          font-size="22" letter-spacing="4" fill="${CYAN}" opacity="0.78">NEWBURYPORT · AMESBURY · SALISBURY</text>
    <text x="${W/2}" y="${photoH + 574}" text-anchor="middle" font-family='${SANS}' font-weight="500"
          font-size="22" letter-spacing="4" fill="${CYAN}" opacity="0.78">NEWBURY · ROWLEY · WEST NEWBURY</text>

    <!-- bottom meta -->
    <text x="${W/2}" y="${H - 60}" text-anchor="middle" font-family='${SANS}' font-weight="400"
          font-size="20" letter-spacing="3" fill="${CREAM}" opacity="0.65">LIVE MLSPIN DATA · REFRESHED WEEKLY</text>
  </svg>`;

  await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 30, g: 51, b: 94, alpha: 1 } }
  })
    .composite([
      { input: photoBuf, top: 0, left: 0 },
      { input: Buffer.from(svg), top: 0, left: 0 }
    ])
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(path.join(OUT_DIR, 'social-vertical.jpg'));
  const bytes = fs.statSync(path.join(OUT_DIR, 'social-vertical.jpg')).size;
  console.log(`  social-vertical.jpg    ${W}x${H}   ${(bytes/1024).toFixed(0)} KB`);
}

(async () => {
  console.log('Building social share cards...');
  await buildLandscape();
  await buildVertical();
  console.log('Done.');
})().catch(e => { console.error(e); process.exit(1); });
