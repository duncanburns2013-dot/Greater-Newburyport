// main.js — Greater Newburyport market snapshot
// Single Deck.gl 2D choropleth zoomed to the 6-town bbox + town stat cards.

(function () {
  'use strict';

  if (!window.deck) return console.error('deck.gl not loaded');
  const { Deck, MapView, GeoJsonLayer } = window.deck;

  const mapEl = document.getElementById('map');
  const cardsEl = document.getElementById('cards');
  const legendEl = document.getElementById('legend');
  const metricBar = document.getElementById('metricBar');

  let payload, geojson;
  let activeMetric = 'median_sold';
  let hoveredTown = null;
  let deckInstance;

  // ---------- metric configs ----------
  const METRICS = {
    median_sold: {
      label: 'Median Sold Price',
      cardLabel: 'Sold (12 mo)',
      direction: 'higher-is-worse',  // i.e. red end of ramp at high values
      domain: [550000, 1100000],
      legendStops: [550, 700, 850, 1000, 1100],
      legendFormat: v => '$' + v + 'K',
      format: v => v == null ? '—' : '$' + (v >= 1e6 ? (v/1e6).toFixed(2)+'M' : (v/1e3).toFixed(0)+'K')
    },
    median_active_list: {
      label: 'Median Active List',
      cardLabel: 'Listed',
      direction: 'higher-is-worse',
      domain: [600000, 1600000],
      legendStops: [600, 800, 1000, 1300, 1600],
      legendFormat: v => '$' + v + 'K',
      format: v => v == null ? '—' : '$' + (v >= 1e6 ? (v/1e6).toFixed(2)+'M' : (v/1e3).toFixed(0)+'K')
    },
    median_dom: {
      label: 'Days on Market',
      cardLabel: 'DOM',
      direction: 'higher-is-worse',
      domain: [15, 50],
      legendStops: [15, 22, 30, 40, 50],
      legendFormat: v => v + 'd',
      format: v => v == null ? '—' : Math.round(v) + ' days'
    },
    sold_count: {
      label: 'Sales (12 mo)',
      cardLabel: 'Sales',
      direction: 'higher-is-better',
      domain: [20, 260],
      legendStops: [20, 60, 120, 200, 260],
      legendFormat: v => v + '',
      format: v => v == null ? '—' : v.toLocaleString()
    },
    median_sold_psf: {
      label: '$ / square foot',
      cardLabel: '$ / sqft',
      direction: 'higher-is-worse',
      domain: [300, 700],
      legendStops: [300, 400, 500, 600, 700],
      legendFormat: v => '$' + v,
      format: v => v == null ? '—' : '$' + Math.round(v) + '/sf'
    }
  };

  // ---------- color ramp ----------
  // Sequential pale-cream → deep navy at the "worse" end. Restrained,
  // realtor-marketing-appropriate (no cranberry alarm).
  const RAMP = [
    [243, 234, 213],   // pale cream
    [205, 195, 169],   // warm beige
    [184, 135, 70],    // gold mid
    [101,  74,  84],   // muted maroon
    [ 29,  58,  95]    // deep navy
  ];
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ramp(t, alpha = 230) {
    t = Math.max(0, Math.min(1, t));
    const i = t * (RAMP.length - 1);
    const i0 = Math.floor(i), i1 = Math.min(i0 + 1, RAMP.length - 1);
    const f = i - i0;
    const a = RAMP[i0], b = RAMP[i1];
    return [Math.round(lerp(a[0], b[0], f)), Math.round(lerp(a[1], b[1], f)), Math.round(lerp(a[2], b[2], f)), alpha];
  }
  function metricColor(v, cfg) {
    if (v == null) return [220, 215, 200, 200];
    let t = (v - cfg.domain[0]) / (cfg.domain[1] - cfg.domain[0]);
    if (cfg.direction === 'higher-is-better') t = 1 - t;
    return ramp(t);
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
        maxZoom: 13
      },
      controller: { dragRotate: false, doubleClickZoom: true, scrollZoom: { speed: 0.4, smooth: true } },
      views: new MapView({ id: 'map' }),
      onHover: ({ object }) => {
        const t = object && object.properties && object.properties.TOWN;
        if (t !== hoveredTown) { hoveredTown = t; deckInstance.setProps({ layers: buildLayers() }); }
      },
      getTooltip: ({ object }) => {
        if (!object) return null;
        const p = object.properties;
        const html = `
          <div class="tt-name">${titleCase(p.TOWN)}</div>
          <div class="tt-row"><span>Median sold</span><b>${fmt(p.median_sold)}</b></div>
          <div class="tt-row"><span>Sold last 12mo</span><b>${p.sold_count || '—'}</b></div>
          <div class="tt-row"><span>Days on market</span><b>${p.median_dom != null ? Math.round(p.median_dom)+' days' : '—'}</b></div>
          <div class="tt-row"><span>$ / sqft</span><b>${p.median_sold_psf != null ? '$'+Math.round(p.median_sold_psf) : '—'}</b></div>
          <div class="tt-row"><span>Active listings</span><b>${p.active_count || '—'}</b></div>
          <div class="tt-row"><span>Median list (active)</span><b>${fmt(p.median_active_list)}</b></div>
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
    wireControls();
    window.addEventListener('resize', () => deckInstance && deckInstance.redraw());
  }

  function buildLayers() {
    const cfg = METRICS[activeMetric];
    return [
      new GeoJsonLayer({
        id: 'towns',
        data: geojson,
        stroked: true,
        filled: true,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1,
        getLineColor: f => f.properties.TOWN === hoveredTown ? [29, 58, 95, 255] : [40, 50, 70, 90],
        getLineWidth: f => f.properties.TOWN === hoveredTown ? 3 : 1,
        getFillColor: f => {
          const v = f.properties[activeMetric];
          const c = metricColor(v, cfg);
          if (f.properties.TOWN === hoveredTown) return [c[0], c[1], c[2], 255];
          return c;
        },
        pickable: true,
        updateTriggers: {
          getFillColor: [activeMetric, hoveredTown],
          getLineColor: [hoveredTown],
          getLineWidth: [hoveredTown]
        },
        transitions: { getFillColor: { duration: 500, easing: t => 1 - Math.pow(1 - t, 3) } }
      })
    ];
  }

  function drawLegend() {
    const cfg = METRICS[activeMetric];
    const sw = cfg.legendStops.map((s, i) => {
      const t = i / (cfg.legendStops.length - 1);
      const c = ramp(cfg.direction === 'higher-is-better' ? 1 - t : t);
      return `<div class="legend-stop">
        <span class="legend-swatch" style="background:rgb(${c[0]},${c[1]},${c[2]})"></span>
        <span>${cfg.legendFormat(s)}</span>
      </div>`;
    }).join('');
    legendEl.innerHTML = `<div class="legend-title">${cfg.label}</div><div class="legend-row">${sw}</div>`;
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
      return `<article class="card">
        <div class="card-town">${titleCase(p.TOWN)}</div>
        <dl class="card-stats">
          <dt>Median sold</dt><dd class="accent">${fmt(p.median_sold)}</dd>
          <dt>Sales (12 mo)</dt><dd>${p.sold_count || '—'}</dd>
          <dt>Days on market</dt><dd>${p.median_dom != null ? Math.round(p.median_dom) : '—'}</dd>
          <dt>$ / sqft</dt><dd>${p.median_sold_psf != null ? '$'+Math.round(p.median_sold_psf) : '—'}</dd>
          <dt>Active listings</dt><dd>${p.active_count || '—'}</dd>
          <dt>Median list</dt><dd>${fmt(p.median_active_list)}</dd>
        </dl>
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
