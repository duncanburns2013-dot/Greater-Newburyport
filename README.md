# Greater Newburyport — Market Snapshot

An interactive map of the local Massachusetts real estate market: **Newburyport, Amesbury, Salisbury, Rowley, West Newbury, and Newbury**.

### **→ Live: [duncanburns2013-dot.github.io/Greater-Newburyport](https://duncanburns2013-dot.github.io/Greater-Newburyport/)**

Embed-friendly. Designed to drop into a Squarespace Code Block at any width from ~360px to ~1400px.

## Embed code (Squarespace, WordPress, anywhere)

```html
<iframe
  src="https://duncanburns2013-dot.github.io/Greater-Newburyport/"
  width="100%"
  height="900"
  frameborder="0"
  loading="lazy"
  style="border:0;display:block;width:100%;"
  title="Greater Newburyport — Market Snapshot">
</iframe>
```

In Squarespace: **Edit page → Add block → Code → paste the snippet above → Save**. Adjust the `height` value to suit your layout (700–1000 is the sweet spot).

### Making it edge-to-edge on Squarespace

If the embed looks too narrow on your Squarespace site, the constraint is Squarespace's outer column width, not the iframe. Two ways to widen it:

1. **Squarespace 7.1**: place the Code Block in a section, then set **Section → Edit → Width → Inset: None** (or "Full Bleed" depending on template). That removes the inner padding.
2. **Any template**: in the Code Block, wrap the iframe with a div that breaks out of the container:
   ```html
   <div style="width:100vw;position:relative;left:50%;right:50%;margin-left:-50vw;margin-right:-50vw;">
     <iframe src="..." width="100%" height="900" frameborder="0" style="border:0;display:block;"></iframe>
   </div>
   ```
   That forces the iframe to span the full browser viewport even inside a narrow column.

## What it shows

- All six town polygons, accurate to MassGIS / MassDOT boundaries
- Color-coded by your choice of metric:
  - **Median Sold Price** (default)
  - **Median Active List Price**
  - **Days on Market**
  - **Sales count (last 12 months)**
  - **$ per square foot**
- Hover any town for full stats; click metric buttons to recolor
- Town stat cards beneath the map for non-map readers
- Refreshed weekly from MLSPIN

## Stack

- Static HTML / vanilla JS / CSS
- [Deck.gl 9](https://deck.gl/) for the choropleth
- Node-only ETL (no Python)
- Deployed via GitHub Pages
- Auto-refreshed weekly by GitHub Actions

## Data sources

| Source | What it provides |
|---|---|
| MLSPIN | Active + closed-last-365-day residential transactions |
| MassDOT Boundaries/Towns | Six town polygons + median household income (state-attached) |

## Local development

```bash
# 1. Drop your MLSPIN access token into .env (copy from .env.example)
# 2. Pull and aggregate
node pipelines/fetch_data.js

# 3. Preview
npx serve .
# open http://localhost:3000
```

## Auto-refresh

A GitHub Actions workflow (`.github/workflows/refresh.yml`) runs every Sunday at 06:30 UTC and refreshes the MLSPIN data. Setup:

1. Go to **Settings → Secrets and variables → Actions**
2. Add a new repository secret named `BRIDGE_TOKEN`
3. Value: your MLSPIN server access token

The workflow picks it up next run. Click "Run workflow" in the Actions tab for an on-demand refresh.

## Disclaimer

Aggregate market statistics. Not a guarantee of value or terms of any individual property. Single-family, condominium, and 2–3 family residential transactions only. MLSPIN coverage may exclude some private or off-market transactions.

---

**Duncan Burns · REMAX Bentleys**
