// main.js — Greater Newburyport market snapshot
// Single Deck.gl 2D choropleth zoomed to the 6-town bbox + town stat cards.

(function () {
  'use strict';

  if (!window.deck) return console.error('deck.gl not loaded');
  const { Deck, MapView, GeoJsonLayer, TileLayer, BitmapLayer } = window.deck;

  // ---------- map overlay registry ----------
  // Each overlay = a toggleable raster layer pulled live from a public ArcGIS
  // MapServer. ArcGIS dynamic services expose /export?bbox=...&size=... which
  // we use as the tile source via Deck.gl TileLayer's getTileData callback.
  //
  // For the seacoast Greater-Newburyport market, flood + sea-level-rise are
  // the most consequential overlays. Wetlands and NHESP rare-species habitats
  // are universal buildability constraints. Coastal Zone marks the regulatory
  // boundary inside which CZM jurisdiction applies.
  const OVERLAYS = [
    {
      id: 'parcels',
      name: 'Property parcels',
      sub: 'MassGIS · zoom to street level',
      color: '#94a3b8',
      kind: 'export',
      // Layer 0 is a group that includes "Other Legal Interests" + "Misc
      // Features" — those render filled colored polygons (conservation
      // easements, ROWs) over the parcels and look like green/olive globs.
      // Layer 1 is the pure Tax Parcels outline layer — what we want.
      base: 'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/MassachusettsPropertyTaxParcels/MapServer',
      layers: 'show:1',
      minZoom: 14, opacity: 0.95
    },
    {
      id: 'fema',
      name: 'FEMA flood zones',
      sub: 'FIRM · 100-yr & 500-yr',
      color: '#0ea5e9',
      kind: 'export',
      base: 'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/FEMA/FEMA_National_Flood_Hazard_Layer/MapServer',
      minZoom: 9, opacity: 0.55, noLabels: true
    },
    {
      id: 'slr',
      name: 'Sea level rise (NOAA)',
      sub: 'CZM · 1–6 ft scenarios',
      color: '#0d9488',
      kind: 'export',
      base: 'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/CZM_NOAA_SLR_Data_Combined/MapServer',
      minZoom: 9, opacity: 0.55, noLabels: true
    },
    {
      id: 'wetlands',
      name: 'Wetlands',
      sub: 'MassDEP',
      color: '#65a30d',
      kind: 'export',
      base: 'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/DEP_Wetlands/MapServer',
      minZoom: 9, opacity: 0.55, noLabels: true
    },
    {
      id: 'nhesp',
      name: 'Rare species habitat',
      sub: 'NHESP Priority Habitats',
      color: '#d97706',
      kind: 'export',
      base: 'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/NHESP_Priority_Habitats/MapServer',
      minZoom: 9, opacity: 0.5, noLabels: true
    },
    {
      id: 'czm',
      name: 'Coastal zone (CZM)',
      sub: 'state regulatory boundary',
      color: '#1e335e',
      kind: 'export',
      base: 'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/Coastal_Zone/MapServer',
      minZoom: 8, opacity: 0.45, noLabels: true
    }
  ];
  const overlayState = Object.fromEntries(OVERLAYS.map(o => [o.id, false]));

  // MIMAP (Merrimack Valley Planning Commission) per-town interactive viewers.
  // Each town has its own VertiGIS Studio app with 30-140 layers — full parcel
  // detail, zoning, FEMA flood, NHESP habitats, wetlands buffers, sea-level
  // rise projections, building footprints, etc. The app IDs below are the
  // six MIMAP URLs Duncan provided; the town→app mapping is a best guess
  // (alphabetical order). If a link opens the wrong town, swap the app IDs
  // until they match.
  const MIMAP_URL = {
    AMESBURY:     'https://mimap2.mvpc.org/vertigisstudio/web/?app=3e949ad988ce44ce8d59fa2725953232',
    NEWBURY:      'https://mimap2.mvpc.org/vertigisstudio/web/?app=d67d053bfc7440729f9dc25fa6df96d6',
    NEWBURYPORT:  'https://mimap2.mvpc.org/vertigisstudio/web/?app=ce916a96c79549069a0b2432d91814f1',
    ROWLEY:       'https://mimap2.mvpc.org/vertigisstudio/web/?app=55915caf392541e58e5d742971a1a4d4',
    SALISBURY:    'https://mimap2.mvpc.org/vertigisstudio/web/?app=0f11a337dd2d4d2f85cfcdf8ffcb1f9e',
    'WEST NEWBURY': 'https://mimap2.mvpc.org/vertigisstudio/web/?app=24cc4950ce0347b0a454c12ea1c5760e'
  };

  const mapEl = document.getElementById('map');
  const cardsEl = document.getElementById('cards');
  const legendEl = document.getElementById('legend');
  const metricBar = document.getElementById('metricBar');

  let payload, geojson;
  let activeMetric = 'median_sold';
  let hoveredTown = null;
  let deckInstance;
  let currentZoom = 10.5;

  // helper available to all closures: jump the map to a target zoom over the centroid
  function zoomTo(targetZoom) {
    if (!deckInstance) return;
    const vs = deckInstance.viewManager.getViewState ? deckInstance.viewManager.getViewState() : null;
    const b = payload.meta.bbox;
    deckInstance.setProps({
      initialViewState: {
        longitude: (b.minLng + b.maxLng) / 2,
        latitude: (b.minLat + b.maxLat) / 2,
        zoom: targetZoom,
        pitch: 0,
        bearing: 0,
        transitionDuration: 700
      }
    });
  }

  // shown only when parcels overlay is on AND zoom is below the visible threshold
  function updateZoomHint() {
    const el = document.getElementById('zoomHint');
    if (!el) return;
    const need = overlayState.parcels && currentZoom < 14;
    el.style.display = need ? 'flex' : 'none';
  }

  // ---------- metric configs ----------
  const METRICS = {
    median_sold: {
      label: 'Median Sold Price (MLSPIN, 12 mo)',
      cardLabel: 'Sold (12 mo)',
      direction: 'higher-is-worse',
      domain: [550000, 1100000],
      legendStops: [550, 700, 850, 1000, 1100],
      legendFormat: v => '$' + v + 'K',
      format: v => v == null ? '—' : '$' + (v >= 1e6 ? (v/1e6).toFixed(2)+'M' : (v/1e3).toFixed(0)+'K')
    },
    median_active_list: {
      label: 'Median Active List (MLSPIN)',
      cardLabel: 'Listed',
      direction: 'higher-is-worse',
      domain: [600000, 1600000],
      legendStops: [600, 800, 1000, 1300, 1600],
      legendFormat: v => '$' + v + 'K',
      format: v => v == null ? '—' : '$' + (v >= 1e6 ? (v/1e6).toFixed(2)+'M' : (v/1e3).toFixed(0)+'K')
    },
    median_dom: {
      label: 'Days on Market (MLSPIN, 12 mo)',
      cardLabel: 'DOM',
      direction: 'higher-is-worse',
      domain: [15, 50],
      legendStops: [15, 22, 30, 40, 50],
      legendFormat: v => v + 'd',
      format: v => v == null ? '—' : Math.round(v) + ' days'
    },
    sold_count: {
      label: 'Sales (MLSPIN, last 12 mo)',
      cardLabel: 'Sales',
      direction: 'higher-is-better',
      domain: [20, 260],
      legendStops: [20, 60, 120, 200, 260],
      legendFormat: v => v + '',
      format: v => v == null ? '—' : v.toLocaleString()
    },
    median_sold_psf: {
      label: 'Sold $ / square foot (MLSPIN)',
      cardLabel: '$ / sqft',
      direction: 'higher-is-worse',
      domain: [300, 700],
      legendStops: [300, 400, 500, 600, 700],
      legendFormat: v => '$' + v,
      format: v => v == null ? '—' : '$' + Math.round(v) + '/sf'
    },
    parcel_count: {
      label: 'Residential Parcels (MassGIS Assessor)',
      cardLabel: 'Parcels',
      direction: 'higher-is-better',
      domain: [1000, 13000],
      legendStops: [1000, 4000, 7000, 10000, 13000],
      legendFormat: v => v >= 1000 ? (v/1000)+'K' : v,
      format: v => v == null ? '—' : v.toLocaleString()
    },
    parcel_avg_value: {
      label: 'Avg Residential Assessment (MassGIS)',
      cardLabel: 'Avg Assessment',
      direction: 'higher-is-worse',
      domain: [200000, 1100000],
      legendStops: [200, 400, 600, 850, 1100],
      legendFormat: v => '$' + v + 'K',
      format: v => v == null ? '—' : '$' + Math.round(v/1000) + 'K'
    }
  };

  // ---------- per-town color identity ----------
  // Each town gets a distinct brand-friendly hue. The selected metric
  // modulates SATURATION/LIGHTNESS within the town's hue — so a town's
  // identity is always visible and metric value reads as intensity.
  // Hues drawn from corporate navy + complementary realtor-friendly tones.
  const TOWN_HUES = {
    'NEWBURYPORT':  { h: 215, s: 56, l: 28, name: 'Navy' },     // brand navy
    'AMESBURY':     { h:  18, s: 60, l: 42, name: 'Rust' },     // Indian red / warm rust
    'SALISBURY':    { h: 180, s: 48, l: 38, name: 'Teal' },     // ocean / beach
    'NEWBURY':      { h:  90, s: 35, l: 38, name: 'Sage' },     // rural / agricultural
    'ROWLEY':       { h: 120, s: 35, l: 30, name: 'Forest' },   // rural / forested
    'WEST NEWBURY': { h: 320, s: 35, l: 38, name: 'Plum' }      // rolling hills
  };

  function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  }

  // Town color: town's base hue, but lightness + saturation strongly modulated
  // by the metric value. Range is wide so changing metrics produces a visible
  // shift in each town's appearance, not just a subtle tonal change.
  function metricColor(v, cfg, townName) {
    const hue = TOWN_HUES[townName] || { h: 220, s: 30, l: 50 };
    if (v == null || cfg == null) {
      const [r, g, b] = hslToRgb(hue.h, hue.s * 0.3, Math.min(hue.l + 30, 88));
      return [r, g, b, 180];
    }
    let t = (v - cfg.domain[0]) / (cfg.domain[1] - cfg.domain[0]);
    if (cfg.direction === 'higher-is-better') t = 1 - t;
    t = Math.max(0, Math.min(1, t));
    // Wide range: low values nearly desaturated + very light;
    // high values fully saturated + darker than base.
    const targetL = hue.l + (1 - t) * 42 - (t * 8);     // span ~50 lightness pts
    const targetS = hue.s * (0.25 + t * 0.95);          // span ~70% of base sat
    const [r, g, b] = hslToRgb(hue.h, targetS, targetL);
    return [r, g, b, 235];
  }
  // Backwards-compat exposing the per-town hue at full strength (for legend swatches)
  function townSwatch(townName) {
    const hue = TOWN_HUES[townName] || { h: 220, s: 30, l: 45 };
    return hslToRgb(hue.h, hue.s, hue.l);
  }

  function fmt(v) {
    if (v == null || Number.isNaN(v)) return '—';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
    return String(v);
  }

  // ---------- init ----------
  async function init() {
    payload = await fetch('data/processed/newburyport.json').then(r => r.json());
    geojson = payload.geojson;

    // populate header counts + footer stamp
    document.getElementById('head-counts').textContent =
      `${payload.meta.closed_records.toLocaleString()} closed / ${payload.meta.active_records.toLocaleString()} active`;
    const stamp = new Date(payload.meta.generated);
    document.getElementById('foot-stamp').textContent =
      'refreshed ' + stamp.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    // compute view from bbox
    const b = payload.meta.bbox;
    const center = [(b.minLng + b.maxLng) / 2, (b.minLat + b.maxLat) / 2];
    // pick zoom so the bbox fits roughly within view
    const lngSpan = b.maxLng - b.minLng;
    const latSpan = b.maxLat - b.minLat;
    // rough heuristic: 360 degrees / 2^zoom = world tile width; tune empirically
    const zoom = Math.min(11.4, 10 - Math.log2(Math.max(lngSpan, latSpan * 1.4) / 0.10));

    deckInstance = new Deck({
      parent: mapEl,
      width: '100%',
      height: '100%',
      initialViewState: {
        longitude: center[0],
        latitude: center[1],
        zoom: zoom,
        pitch: 0,
        bearing: 0,
        minZoom: 9.5,
        maxZoom: 18
      },
      onViewStateChange: ({ viewState }) => {
        currentZoom = viewState.zoom;
        updateZoomHint();
        return viewState;
      },
      controller: { dragRotate: false, doubleClickZoom: true, scrollZoom: { speed: 0.6, smooth: true } },
      views: new MapView({ id: 'map' }),
      onHover: ({ object }) => {
        const t = object && object.properties && object.properties.TOWN;
        if (t !== hoveredTown) { hoveredTown = t; deckInstance.setProps({ layers: buildLayers() }); }
      },
      // Picking has to traverse two town layers (background + highlighted),
      // and ArcGIS BitmapLayers should not capture hover events.
      pickingRadius: 1,
      getTooltip: ({ object }) => {
        if (!object) return null;
        const p = object.properties;
        // For the 6 Greater Newburyport towns: full rich tooltip with selected
        // metric pinned at the top + MassGIS assessor section.
        // For all OTHER MA towns: lightweight tooltip with just basic MLS stats.
        if (!p.is_highlighted) {
          const noData = !p.sold_count;
          const html = `
            <div class="tt-name tt-name-other">${titleCase(p.TOWN)}</div>
            <div class="tt-other-sub">MLSPIN · last 12 months</div>
            ${noData ? `
              <div class="tt-row"><span>data</span><b>not in MLSPIN window</b></div>
            ` : `
              <div class="tt-row"><span>Median sold</span><b>${fmt(p.median_sold)}</b></div>
              <div class="tt-row"><span>Sales</span><b>${p.sold_count.toLocaleString()}</b></div>
              <div class="tt-row"><span>Days on market</span><b>${p.median_dom != null ? Math.round(p.median_dom)+' days' : '—'}</b></div>
              <div class="tt-row"><span>$ / sqft</span><b>${p.median_sold_psf != null ? '$'+Math.round(p.median_sold_psf) : '—'}</b></div>
              <div class="tt-row"><span>Active listings</span><b>${p.active_count || '—'}</b></div>
            `}
          `;
          return { html, className: 'tt' };
        }

        // Rich tooltip for the 6 highlighted towns
        const sel = METRICS[activeMetric];
        const selValue = p[activeMetric];
        const selDisplay = sel.format(selValue);
        const mlspinRow = (label, key, fmtFn) => {
          const active = activeMetric === key;
          const val = p[key];
          const display = fmtFn(val);
          const cls = active ? 'tt-row tt-active' : 'tt-row';
          return `<div class="${cls}"><span>${label}</span><b>${display}</b></div>`;
        };
        const html = `
          <div class="tt-name">${titleCase(p.TOWN)}</div>
          <div class="tt-selected">
            <div class="tt-selected-label">${sel.label}</div>
            <div class="tt-selected-value">${selDisplay}</div>
          </div>
          <div class="tt-section">MLSPIN · last 12 months</div>
          ${mlspinRow('Median sold', 'median_sold', v => fmt(v))}
          ${mlspinRow('Median list (active)', 'median_active_list', v => fmt(v))}
          ${mlspinRow('Sales', 'sold_count', v => v == null ? '—' : v.toLocaleString())}
          ${mlspinRow('Days on market', 'median_dom', v => v == null ? '—' : Math.round(v) + ' days')}
          ${mlspinRow('$ / sqft', 'median_sold_psf', v => v == null ? '—' : '$' + Math.round(v))}
          <div class="tt-row"><span>Active listings</span><b>${p.active_count || '—'}</b></div>
          <div class="tt-section">MassGIS assessor · residential</div>
          ${mlspinRow('Residential parcels', 'parcel_count', v => v == null ? '—' : v.toLocaleString())}
          ${mlspinRow('Avg assessment', 'parcel_avg_value', v => v == null ? '—' : '$' + Math.round(v/1000) + 'K')}
          <div class="tt-row"><span>Avg building</span><b>${p.parcel_avg_bld != null ? p.parcel_avg_bld.toLocaleString()+' sf' : '—'}</b></div>
          <div class="tt-row"><span>Oldest on record</span><b>${p.parcel_oldest || '—'}</b></div>
        `;
        return { html, className: 'tt' };
      },
      layers: buildLayers()
    });

    // remove loading indicator
    const ld = mapEl.querySelector('.map-loading');
    if (ld) ld.remove();

    drawLegend();
    drawCards();
    drawLayerToggles();
    wireControls();
    window.addEventListener('resize', () => deckInstance && deckInstance.redraw());
  }

  // build a TileLayer for an ArcGIS dynamic MapServer (via /export endpoint).
  // Tiles are rendered server-side at the requested bbox + size.
  //
  // Some MA-hosted ArcGIS map services bake labelingInfo into their renderers
  // (FLD_ZONE labels on FEMA, habitat names on NHESP, etc). Those labels
  // clash with our CartoDB labels sandwich. We use the ArcGIS dynamicLayers
  // parameter to override drawingInfo per layer and zero out labelingInfo.
  function buildSuppressLabelsDyn(layerIds) {
    return JSON.stringify(layerIds.map(id => ({
      id,
      source: { type: 'mapLayer', mapLayerId: id },
      drawingInfo: { labelingInfo: [] }
    })));
  }

  function exportTileLayer(o) {
    return new TileLayer({
      id: `ov-${o.id}`,
      minZoom: o.minZoom || 8,
      maxZoom: 19,
      tileSize: 512,
      opacity: o.opacity || 0.55,
      getTileData: async ({ bbox }) => {
        const { west, south, east, north } = bbox;
        const u = new URL(o.base + '/export');
        u.searchParams.set('bbox', `${west},${south},${east},${north}`);
        u.searchParams.set('bboxSR', '4326');
        u.searchParams.set('imageSR', '4326');
        u.searchParams.set('size', '512,512');
        u.searchParams.set('format', 'png32');
        u.searchParams.set('transparent', 'true');
        u.searchParams.set('dpi', '96');
        u.searchParams.set('f', 'image');
        if (o.layers) u.searchParams.set('layers', o.layers);
        if (o.noLabels) {
          // Suppress labels across layers 0-9 (covers all the MA-hosted
          // services we use, none has more than ~6 sublayers).
          const ids = [0,1,2,3,4,5,6,7,8,9];
          u.searchParams.set('dynamicLayers', buildSuppressLabelsDyn(ids));
        }
        try {
          const r = await fetch(u.toString());
          if (!r.ok) return null;
          const blob = await r.blob();
          return await createImageBitmap(blob);
        } catch { return null; }
      },
      renderSubLayers: props => {
        if (!props.data) return null;
        const { boundingBox } = props.tile;
        return new BitmapLayer(props, {
          data: null,
          image: props.data,
          bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]]
        });
      }
    });
  }

  // cached tile layer for services with pre-rendered /tile/{z}/{y}/{x} endpoint
  function cachedTileLayer(o) {
    return new TileLayer({
      id: `ov-${o.id}`,
      data: o.url,
      minZoom: o.minZoom || 10,
      maxZoom: o.maxZoom || 19,
      tileSize: 256,
      opacity: o.opacity || 0.55,
      renderSubLayers: props => {
        const { boundingBox } = props.tile;
        return new BitmapLayer(props, {
          data: null,
          image: props.data,
          bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]]
        });
      }
    });
  }

  function buildLayers() {
    const cfg = METRICS[activeMetric];
    const layers = [];
    const anyOverlayActive = Object.values(overlayState).some(v => v);

    // Basemap split into TWO layers (NYT-style):
    //   1. light_nolabels — streets, water, terrain  (bottom)
    //   2. light_only_labels — pure transparent label layer (TOP, above
    //      town polygons + overlays so place names stay readable)
    // Without this trick, our semi-transparent town fill washes the labels
    // out and users can't see street names.
    layers.push(new TileLayer({
      id: 'basemap-roads',
      data: [
        'https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
        'https://d.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png'
      ],
      minZoom: 0, maxZoom: 19, tileSize: 256, opacity: 0.95,
      renderSubLayers: props => {
        const { boundingBox } = props.tile;
        return new BitmapLayer(props, {
          data: null, image: props.data,
          bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]]
        });
      }
    }));

    // Overlays render BELOW the town polygons so the choropleth stays primary
    for (const o of OVERLAYS) {
      if (!overlayState[o.id]) continue;
      layers.push(o.kind === 'tile-cached' ? cachedTileLayer(o) : exportTileLayer(o));
    }

    // Split geojson into two render sets:
    //   - background: 345 non-highlighted MA municipalities (gray outlines,
    //     transparent fill, hover-able for basic MLS tooltip)
    //   - highlighted: 6 Greater Newburyport towns (colored fill, strong
    //     stroke, full tooltip)
    const allFeatures = geojson.features;
    const backgroundData = { type: 'FeatureCollection', features: allFeatures.filter(f => !f.properties.is_highlighted) };
    const highlightData  = { type: 'FeatureCollection', features: allFeatures.filter(f =>  f.properties.is_highlighted) };

    // background layer: all OTHER MA towns
    layers.push(new GeoJsonLayer({
      id: 'towns-bg',
      data: backgroundData,
      stroked: true,
      filled: true,
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: 0.8,
      getLineColor: f => f.properties.TOWN === hoveredTown ? [30, 51, 94, 220] : [30, 51, 94, 60],
      getLineWidth: f => f.properties.TOWN === hoveredTown ? 2 : 0.8,
      getFillColor: f => f.properties.TOWN === hoveredTown ? [201, 235, 252, 80] : [255, 255, 255, 0],
      pickable: true,
      updateTriggers: {
        getLineColor: [hoveredTown],
        getLineWidth: [hoveredTown],
        getFillColor: [hoveredTown]
      }
    }));

    // highlighted: the 6 Greater Newburyport towns
    layers.push(new GeoJsonLayer({
      id: 'towns',
      data: highlightData,
      stroked: true,
      filled: true,
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: 1.5,
      getLineColor: f => f.properties.TOWN === hoveredTown ? [30, 51, 94, 255] : [30, 51, 94, 180],
      getLineWidth: f => f.properties.TOWN === hoveredTown ? 3 : 1.6,
      getFillColor: f => {
        const v = f.properties[activeMetric];
        const c = metricColor(v, cfg, f.properties.TOWN);
        const a = anyOverlayActive ? 80 : 150;
        if (f.properties.TOWN === hoveredTown) return [c[0], c[1], c[2], anyOverlayActive ? 160 : 210];
        return [c[0], c[1], c[2], a];
      },
      pickable: true,
      updateTriggers: {
        getFillColor: [activeMetric, hoveredTown, anyOverlayActive],
        getLineColor: [hoveredTown],
        getLineWidth: [hoveredTown]
      },
      transitions: { getFillColor: { duration: 500, easing: t => 1 - Math.pow(1 - t, 3) } }
    }));

    // labels-only basemap layer on TOP so street names stay readable above
    // the semi-transparent town fill + any active overlays
    layers.push(new TileLayer({
      id: 'basemap-labels',
      data: [
        'https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png',
        'https://d.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png'
      ],
      minZoom: 0, maxZoom: 19, tileSize: 256, opacity: 1.0,
      renderSubLayers: props => {
        const { boundingBox } = props.tile;
        return new BitmapLayer(props, {
          data: null, image: props.data,
          bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]]
        });
      }
    }));

    return layers;
  }

  // ---------- render overlay toggles ----------
  function drawLayerToggles() {
    const grid = document.getElementById('layersGrid');
    if (!grid) return;
    grid.innerHTML = OVERLAYS.map(o => `
      <label class="layer-toggle${overlayState[o.id] ? ' active' : ''}" data-layer="${o.id}">
        <input type="checkbox" ${overlayState[o.id] ? 'checked' : ''} />
        <span class="layer-swatch" style="background:${o.color}"></span>
        <span class="layer-name">${o.name}<small>${o.sub}</small></span>
      </label>`).join('');
    grid.querySelectorAll('.layer-toggle').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        const id = el.getAttribute('data-layer');
        overlayState[id] = !overlayState[id];
        el.classList.toggle('active', overlayState[id]);
        el.querySelector('input').checked = overlayState[id];
        deckInstance.setProps({ layers: buildLayers() });
        updateZoomHint();
        // when the user turns parcels on, auto-zoom in so they actually see them
        if (id === 'parcels' && overlayState[id] && currentZoom < 14) {
          zoomTo(15);
        }
      });
    });
  }

  function drawLegend() {
    // Legend now shows the 6 town colors (categorical, not metric ramp).
    // Metric value is encoded as intensity within each town's hue —
    // darker = higher value, lighter = lower value.
    const cfg = METRICS[activeMetric];
    const swatches = Object.entries(TOWN_HUES).map(([town, hue]) => {
      const [r, g, b] = hslToRgb(hue.h, hue.s, hue.l);
      return `<div class="legend-stop">
        <span class="legend-swatch" style="background:rgb(${r},${g},${b})"></span>
        <span>${titleCase(town)}</span>
      </div>`;
    }).join('');
    legendEl.innerHTML = `
      <div class="legend-title">Towns &middot; intensity = ${cfg.label}</div>
      <div class="legend-row">${swatches}</div>
    `;
  }

  function drawCards() {
    // sort towns by selected metric descending; ties broken alphabetically
    const cfg = METRICS[activeMetric];
    const features = geojson.features.slice().sort((a, b) => {
      const av = a.properties[activeMetric] || 0;
      const bv = b.properties[activeMetric] || 0;
      if (bv !== av) return bv - av;
      return a.properties.TOWN.localeCompare(b.properties.TOWN);
    });
    cardsEl.innerHTML = features.map(f => {
      const p = f.properties;
      const town = titleCase(p.TOWN);
      const mimap = MIMAP_URL[p.TOWN];
      const massGisLink = `https://massgis.maps.arcgis.com/apps/instant/sidebar/index.html?appid=3108befad2974590a8f40016de73ae31`;
      return `<article class="card">
        <div class="card-town">${town}</div>
        <div class="card-section">Sales (MLSPIN, last 12 mo)</div>
        <dl class="card-stats">
          <dt>Median sold</dt><dd class="accent">${fmt(p.median_sold)}</dd>
          <dt>Sales</dt><dd>${p.sold_count || '—'}</dd>
          <dt>Days on market</dt><dd>${p.median_dom != null ? Math.round(p.median_dom) : '—'}</dd>
          <dt>$ / sqft</dt><dd>${p.median_sold_psf != null ? '$'+Math.round(p.median_sold_psf) : '—'}</dd>
          <dt>Active listings</dt><dd>${p.active_count || '—'}</dd>
          <dt>Median list</dt><dd>${fmt(p.median_active_list)}</dd>
        </dl>
        <div class="card-section">Assessor (MassGIS, residential)</div>
        <dl class="card-stats">
          <dt>Residential parcels</dt><dd>${p.parcel_count != null ? p.parcel_count.toLocaleString() : '—'}</dd>
          <dt>Avg assessed</dt><dd>${p.parcel_avg_value != null ? '$'+Math.round(p.parcel_avg_value/1000)+'K' : '—'}</dd>
          <dt>Avg building</dt><dd>${p.parcel_avg_bld != null ? p.parcel_avg_bld.toLocaleString()+' sf' : '—'}</dd>
          <dt>Oldest on record</dt><dd>${p.parcel_oldest || '—'}</dd>
        </dl>
        <div class="card-links">
          ${mimap ? `<a class="card-link card-link-primary" href="${mimap}" target="_blank" rel="noopener">${town} MIMAP &rarr;</a>` : ''}
          <a class="card-link" href="${massGisLink}" target="_blank" rel="noopener">MA Property Map &rarr;</a>
        </div>
      </article>`;
    }).join('');
  }

  function wireControls() {
    metricBar.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = btn.getAttribute('data-metric');
        if (m === activeMetric) return;
        metricBar.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
        activeMetric = m;
        deckInstance.setProps({ layers: buildLayers() });
        drawLegend();
        drawCards();
      });
    });
  }

  function titleCase(s) {
    if (!s) return '';
    return s.toLowerCase().replace(/(^|\s)\S/g, ch => ch.toUpperCase());
  }

  init().catch(err => {
    console.error(err);
    const ld = mapEl.querySelector('.map-loading');
    if (ld) ld.textContent = 'Map failed to load: ' + err.message;
  });
})();
