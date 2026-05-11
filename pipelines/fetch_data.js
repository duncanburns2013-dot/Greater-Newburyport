// fetch_data.js — pull the 6 Greater Newburyport towns from MLSPIN and
// merge into a single map-ready GeoJSON. Self-contained (no dependency
// on the housing-affordability repo).
//
//   1. Pulls active + closed-last-365d Residential + Residential Income
//      filtered to City in (Newburyport, Amesbury, Salisbury, Rowley,
//      West Newbury, Newbury).
//   2. Pulls those 6 town polygons from MassDOT (includes Median
//      Household Income as a feature property).
//   3. Aggregates MLSPIN by City and merges into the GeoJSON.
//   4. Writes data/processed/newburyport.json (slim + ship-ready) and
//      data/raw/{bridge_active,bridge_closed,towns}.json (gitignored).
//
// Usage:
//   node pipelines/fetch_data.js

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'data', 'processed');
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// Six "highlighted" Greater Newburyport towns get the rich treatment
// (colored fill, MassGIS assessor enrichment, full tooltip). All other MA
// municipalities render as gray-outline boundaries with basic MLS data
// available on hover but no color encoding.
const TOWNS = ['Newburyport', 'Amesbury', 'Salisbury', 'Rowley', 'West Newbury', 'Newbury'];
const TOWNS_UC = TOWNS.map(t => t.toUpperCase());
const TOWNS_UC_SET = new Set(TOWNS_UC);
const SINCE = new Date(Date.now() - 365 * 86400e3).toISOString().slice(0, 10);

// --------- env loader ---------
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) { console.error('Missing .env (copy from .env.example)'); process.exit(1); }
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

// --------- HTTP ---------
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'GreaterNewburyport/1.0' } }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}
async function getRetry(url, n = 4) {
  let last;
  for (let i = 0; i < n; i++) {
    try { return await get(url); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i))); }
  }
  throw last;
}

// --------- MLSPIN page through keyset ---------
async function pageMLS({ token, filter, select, label }) {
  const all = [];
  let lastKey = null;
  let pages = 0;
  if (!select.split(',').includes('ListingKey')) select = 'ListingKey,' + select;
  while (all.length < 100000) {
    const f = lastKey ? `${filter} and ListingKey gt '${lastKey}'` : filter;
    const u = new URL('https://api.bridgedataoutput.com/api/v2/OData/mlspin/Property');
    u.searchParams.set('access_token', token);
    u.searchParams.set('$filter', f);
    u.searchParams.set('$select', select);
    u.searchParams.set('$orderby', 'ListingKey asc');
    u.searchParams.set('$top', '200');
    const json = await getRetry(u.toString());
    const batch = json.value || [];
    if (!batch.length) break;
    all.push(...batch);
    pages++;
    process.stdout.write(`  ${label}: page ${pages}, total ${all.length}\r`);
    if (batch.length < 200) break;
    lastKey = batch[batch.length - 1].ListingKey;
  }
  process.stdout.write('\n');
  return all;
}

// --------- aggregator ---------
function median(arr) {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function aggregate(records, fields) {
  const byTown = new Map();
  for (const r of records) {
    const c = (r.City || '').trim();
    if (!c) continue;
    if (!byTown.has(c)) byTown.set(c, []);
    byTown.get(c).push(r);
  }
  const out = [];
  for (const [city, recs] of byTown) {
    const row = { city, count: recs.length };
    for (const f of fields) {
      const v = recs.map(r => r[f]).filter(x => x != null && !Number.isNaN(Number(x))).map(Number);
      row[`median_${f}`] = median(v);
    }
    out.push(row);
  }
  return out;
}

// --------- centroid of a polygon (for label / map view) ---------
function centroid(coords) {
  // input: GeoJSON polygon coordinates [[[lng,lat], ...]] or MultiPolygon [[[[..]]], ...]
  let rings = coords;
  if (Array.isArray(coords[0][0][0])) rings = coords[0]; // multipolygon → first polygon's outer ring
  const ring = rings[0];
  let x = 0, y = 0, n = ring.length;
  for (const [lng, lat] of ring) { x += lng; y += lat; }
  return [x / n, y / n];
}

// --------- main ---------
(async () => {
  const env = loadEnv();
  const token = env.BRIDGE_TOKEN;
  if (!token || token === 'your_server_access_token_here') {
    console.error('BRIDGE_TOKEN missing in .env'); process.exit(1);
  }

  // ---- pull MLSPIN closed + active for ALL of MA ----
  // Then aggregate by city — the 6 highlighted towns get a fuller record,
  // every other municipality gets a basic record for hover-only display.
  const propTypeFilter = `(PropertyType eq 'Residential' or PropertyType eq 'Residential Income')`;
  const selectClosed = 'City,PropertyType,ClosePrice,ListPrice,OriginalListPrice,LivingArea,MLSPIN_MARKET_TIME,MLSPIN_SOLD_PRICE_PER_SQFT,CloseDate,YearBuilt';
  const selectActive = 'City,PropertyType,ListPrice,LivingArea,MLSPIN_MARKET_TIME,MLSPIN_LIST_PRICE_PER_SQFT,YearBuilt';

  console.log(`\nPulling MLSPIN for ALL Massachusetts (closed since ${SINCE})...`);
  const closed = await pageMLS({
    token,
    filter: `StandardStatus eq 'Closed' and StateOrProvince eq 'MA' and ${propTypeFilter} and CloseDate ge ${SINCE}`,
    select: selectClosed, label: 'closed'
  });
  const active = await pageMLS({
    token,
    filter: `StandardStatus eq 'Active' and StateOrProvince eq 'MA' and ${propTypeFilter}`,
    select: selectActive, label: 'active'
  });
  fs.writeFileSync(path.join(RAW, 'bridge_closed.json'), JSON.stringify(closed));
  fs.writeFileSync(path.join(RAW, 'bridge_active.json'), JSON.stringify(active));

  // ---- pull ALL 351 MA town polygons from MassDOT ----
  // MassDOT FeatureServer has a paging cap (typically 1000-2000 features per
  // request, but with 351 we should be under it). We pull in one shot.
  console.log(`\nPulling all 351 MA town polygons from MassDOT...`);
  const ARC = 'https://gis.massdot.state.ma.us/arcgis/rest/services/Boundaries/Towns/MapServer/0/query';
  const u = new URL(ARC);
  u.searchParams.set('where', '1=1');               // every row
  u.searchParams.set('outFields', '*');
  u.searchParams.set('outSR', '4326');
  u.searchParams.set('f', 'geojson');
  u.searchParams.set('geometryPrecision', '5');     // ~1m precision, smaller payload
  const towns = await getRetry(u.toString());
  fs.writeFileSync(path.join(RAW, 'towns.geojson'), JSON.stringify(towns));
  console.log(`  pulled ${towns.features.length} polygons`);

  // ---- aggregate ----
  const closedAgg = aggregate(closed, ['ClosePrice', 'ListPrice', 'OriginalListPrice', 'LivingArea', 'MLSPIN_MARKET_TIME', 'MLSPIN_SOLD_PRICE_PER_SQFT', 'YearBuilt']);
  const activeAgg = aggregate(active, ['ListPrice', 'LivingArea', 'MLSPIN_MARKET_TIME', 'MLSPIN_LIST_PRICE_PER_SQFT']);
  const closedByName = new Map(closedAgg.map(r => [r.city.toUpperCase(), r]));
  const activeByName = new Map(activeAgg.map(r => [r.city.toUpperCase(), r]));

  // ---- merge MLSPIN aggregates into every town in the geojson ----
  // Flag the 6 Greater Newburyport towns with is_highlighted so the map can
  // render them differently. Everyone else gets basic stats for hover.
  for (const f of towns.features) {
    const name = f.properties.TOWN;
    const c = closedByName.get(name);
    const a = activeByName.get(name);
    f.properties.centroid = centroid(f.geometry.coordinates);
    f.properties.is_highlighted = TOWNS_UC_SET.has(name);
    if (c) {
      f.properties.sold_count = c.count;
      f.properties.median_sold = Math.round(c.median_ClosePrice);
      f.properties.median_orig_list = Math.round(c.median_OriginalListPrice || 0);
      f.properties.median_dom = c.median_MLSPIN_MARKET_TIME;
      f.properties.median_sold_psf = c.median_MLSPIN_SOLD_PRICE_PER_SQFT;
      f.properties.median_living_area = Math.round(c.median_LivingArea || 0);
      f.properties.median_year_built = Math.round(c.median_YearBuilt || 0);
    }
    if (a) {
      f.properties.active_count = a.count;
      f.properties.median_active_list = Math.round(a.median_ListPrice || 0);
      f.properties.median_active_dom = a.median_MLSPIN_MARKET_TIME;
      f.properties.median_active_psf = a.median_MLSPIN_LIST_PRICE_PER_SQFT;
    }
    // price-to-income ratio
    if (f.properties.median_sold && f.properties.Median_Household_Income) {
      f.properties.price_to_income = +(f.properties.median_sold / f.properties.Median_Household_Income).toFixed(2);
    }
  }

  // ---- MassGIS parcel-level enrichment ----
  // Pulls aggregate stats from the MA Property Tax Parcels FeatureServer
  // (residential only) for each town. Adds count of parcels + avg assessed
  // value + avg lot size + avg year built per town.
  console.log(`\nPulling MassGIS parcel aggregates (residential only)...`);
  // MA TOWN_ID mapping for the 6 towns
  const TOWN_ID = { 'AMESBURY': 9, 'NEWBURY': 209, 'NEWBURYPORT': 215, 'ROWLEY': 248, 'SALISBURY': 257, 'WEST NEWBURY': 320 };
  // Massachusetts USE_CODEs for residential. Some towns use the old 3-digit
  // format (101 single-fam, 102 condo, 104 two-fam, 105 three-fam, 109
  // multiple-on-parcel, 111 apartment), others use the modern 4-digit MAO
  // classification (1010, 1020, 1021, 1040, etc). Match anything starting
  // with '10' or '11' to capture both formats — residential class 1.
  // Wrapping in LIKE clause via the REST API.
  const RESIDENTIAL_PRED = "(USE_CODE LIKE '10%' OR USE_CODE LIKE '11%')";
  const ids = Object.values(TOWN_ID).join(',');
  const stats = [
    { statisticType: 'count', onStatisticField: 'OBJECTID',  outStatisticFieldName: 'n' },
    { statisticType: 'avg',   onStatisticField: 'TOTAL_VAL', outStatisticFieldName: 'avg_val' },
    { statisticType: 'sum',   onStatisticField: 'TOTAL_VAL', outStatisticFieldName: 'sum_val' },
    { statisticType: 'avg',   onStatisticField: 'LOT_SIZE',  outStatisticFieldName: 'avg_lot' },
    { statisticType: 'avg',   onStatisticField: 'BLD_AREA',  outStatisticFieldName: 'avg_bld' },
    { statisticType: 'avg',   onStatisticField: 'YEAR_BUILT',outStatisticFieldName: 'avg_year' },
    { statisticType: 'min',   onStatisticField: 'YEAR_BUILT',outStatisticFieldName: 'min_year' }
  ];
  const url = new URL('https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0/query');
  url.searchParams.set('where', `TOWN_ID IN (${ids}) AND ${RESIDENTIAL_PRED}`);
  url.searchParams.set('groupByFieldsForStatistics', 'TOWN_ID');
  url.searchParams.set('outStatistics', JSON.stringify(stats));
  url.searchParams.set('f', 'json');
  const aggResp = await getRetry(url.toString());
  const aggByTownId = new Map((aggResp.features || []).map(f => [f.attributes.TOWN_ID, f.attributes]));
  console.log(`  pulled ${aggResp.features?.length || 0} town aggregates`);

  // Merge into geojson features
  for (const f of towns.features) {
    const tid = TOWN_ID[f.properties.TOWN];
    if (!tid) continue;
    const a = aggByTownId.get(tid);
    if (!a) continue;
    f.properties.parcel_count = a.n;
    f.properties.parcel_avg_value = Math.round(a.avg_val);
    f.properties.parcel_sum_value = Math.round(a.sum_val);
    f.properties.parcel_avg_lot = +(a.avg_lot || 0).toFixed(2);
    f.properties.parcel_avg_bld = Math.round(a.avg_bld);
    f.properties.parcel_avg_year = Math.round(a.avg_year);
    f.properties.parcel_oldest = a.min_year;
    f.properties.massgis_town_id = tid;
  }

  // ---- compute bounding box for map camera (centered on the 6 GN towns) ----
  let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
  for (const f of towns.features) {
    if (!f.properties.is_highlighted) continue;
    const [lng, lat] = f.properties.centroid;
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  const bbox = { minLng, maxLng, minLat, maxLat };

  // ---- output ship-ready JSON ----
  const out = {
    meta: {
      generated: new Date().toISOString(),
      source: 'MLSPIN',
      window_days: 365,
      since: SINCE,
      towns_pulled: towns.features.length,
      closed_records: closed.length,
      active_records: active.length,
      bbox
    },
    geojson: towns
  };
  fs.writeFileSync(path.join(OUT, 'newburyport.json'), JSON.stringify(out, null, 2));
  console.log(`\nWrote newburyport.json — ${closed.length} closed + ${active.length} active across ${towns.features.length} towns`);

  // ---- summary print: 6 highlighted towns + overall stats ----
  console.log('\n  HIGHLIGHTED — Greater Newburyport');
  console.log('  Town           sold n   median sold   median DOM   active n   active list');
  for (const f of towns.features) {
    if (!f.properties.is_highlighted) continue;
    const p = f.properties;
    const fmt = (v) => v == null ? '—' : '$' + Math.round(v/1000) + 'K';
    console.log(`  ${(p.TOWN || '').padEnd(15)} ${String(p.sold_count || 0).padStart(5)}   ${fmt(p.median_sold).padStart(7)}     ${String(p.median_dom || 0).padStart(4)}        ${String(p.active_count || 0).padStart(4)}      ${fmt(p.median_active_list).padStart(7)}`);
  }
  const withData = towns.features.filter(f => f.properties.sold_count).length;
  console.log(`\n  All MA: ${towns.features.length} polygons total, ${withData} with MLSPIN sales data`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
