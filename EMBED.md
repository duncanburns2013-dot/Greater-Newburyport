# Squarespace embed — copy & paste

> **You do NOT paste `index.html` into Squarespace.** That's the *whole site*. Squarespace just needs a tiny `<iframe>` snippet that loads the live site from GitHub Pages.

## The embed code

Open the Squarespace page where you want the map → **Edit** → **Add Block** → **Code** (look for `</>` icon) → paste:

```html
<iframe
  src="https://duncanburns2013-dot.github.io/Greater-Newburyport/"
  width="100%"
  height="1100"
  frameborder="0"
  loading="lazy"
  style="border:0;display:block;width:100%;"
  title="Greater Newburyport — Market Snapshot">
</iframe>
```

**Save.** Done. The map loads inside your page automatically. Every Sunday it auto-refreshes with new MLSPIN data — your Squarespace page updates with zero effort on your end.

## If it looks too narrow on Squarespace

Squarespace caps content width by template (often 800–960px). To make the embed go full-width:

### Squarespace 7.1 (most common)

1. After adding the Code block, click the **section** the block lives in
2. **Edit Section** → **Width** → pick **Inset: None** or **Full Bleed**
3. The map now spans edge-to-edge

### Any template (universal trick)

Wrap the iframe in a viewport-breakout div:

```html
<div style="width:100vw;position:relative;left:50%;right:50%;margin-left:-50vw;margin-right:-50vw;">
  <iframe
    src="https://duncanburns2013-dot.github.io/Greater-Newburyport/"
    width="100%"
    height="1100"
    frameborder="0"
    loading="lazy"
    style="border:0;display:block;">
  </iframe>
</div>
```

The wrapper forces the iframe to span the full browser viewport regardless of column constraints.

## Tweaking the height

- **`height="1100"`** is a good starting point — fits the map + metric toggles + 6 town cards + footer comfortably on most desktops.
- Make it **shorter** (e.g. `800`) if you only want the map and a couple cards visible.
- Make it **taller** (e.g. `1400`) if you want everything visible without scroll on a wide page.

## Mobile / responsive embed

If you want the iframe height to adapt — taller on desktop, shorter on phones — Squarespace 7.1 lets you wrap the Code Block in a section and the section will lay out responsively, but the iframe `height` attribute stays fixed. The cleanest mobile pattern is:

```html
<style>
  .gnb-embed { width: 100%; aspect-ratio: 1320/1100; min-height: 720px; }
  @media (max-width: 600px) { .gnb-embed { aspect-ratio: 360/900; min-height: 900px; } }
</style>
<iframe class="gnb-embed"
  src="https://duncanburns2013-dot.github.io/Greater-Newburyport/"
  frameborder="0" loading="lazy"
  style="border:0;display:block;"
  title="Greater Newburyport — Market Snapshot">
</iframe>
```

The `aspect-ratio` CSS property scales the iframe to its container width. The page itself reflows to a single column at narrow widths (the inner site has explicit breakpoints at 720 px and 520 px to handle phones).

**Touch UX inside the iframe** (already configured):
- One-finger drag = pans the page (so users don't get trapped scrolling inside the map)
- Two fingers / pinch = pans and zooms the map
- Tap a town = shows the stat tooltip
- Tap a metric button / layer toggle = same as desktop click

## Tweaking what's pre-shown

Add URL hash params to pre-select a metric. For example:

```html
<iframe src="https://duncanburns2013-dot.github.io/Greater-Newburyport/?metric=median_dom" ...>
```

(Currently the app ignores URL params — but if you want this functionality I can add it in 10 minutes.)

## Updating the embed when the site changes

You don't have to. The iframe always shows the **live** site. When the auto-refresh workflow updates data on Sunday, every embed everywhere updates automatically.

If you change the URL (e.g. moved the repo, renamed it), you'd have to update the `src=` in your Squarespace Code Block.

## TL;DR

1. Copy the iframe block above
2. Squarespace → Edit page → Add Block → Code → paste → Save
3. Done forever

That's it. The repo's `index.html` is the *application*; the snippet above is the *embed shim*.
