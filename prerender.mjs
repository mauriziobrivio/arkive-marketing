/**
 * Arkive marketing — prerender pipeline (Phase 1)
 * --------------------------------------------------------------------------
 * WHAT IT DOES
 *   Loads the claude.ai/design bundle in a real headless Chromium, waits for
 *   React to finish rendering, then SERIALIZES the final DOM to static HTML so
 *   the H1 + all section copy live in the HTML source (crawlable / AI-citable).
 *   Pixels stay exact because we keep the bundle's own CSS + fonts verbatim.
 *
 *   It also:
 *     - injects the SEO/GEO <head> (seo/head.html)
 *     - STRIPS the tweaks-panel / EDITMODE editor from the output
 *     - swaps React *development* builds -> *production* builds (perf)
 *     - re-attaches the app's interactivity scripts so the page stays live
 *     - copies static/ (robots.txt, sitemap.xml) into dist/
 *
 * WHY A SCRIPT (not a pre-built index.html in this repo)
 *   Prerendering must run where the bundle is reachable (your machine / CI /
 *   Netlify build). Point SOURCE at the existing preview or a local server.
 *
 * RUN
 *   npm ci && npx playwright install chromium
 *   SOURCE=https://arkive-preview.netlify.app node scripts/prerender.mjs
 *   # output -> dist/index.html  (+ dist/robots.txt, dist/sitemap.xml)
 * --------------------------------------------------------------------------
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

// ---- Config (override via env) -------------------------------------------
const SOURCE        = process.env.SOURCE || 'https://arkive-preview.netlify.app';
const CANONICAL     = process.env.CANONICAL_PAGE || '/desktop.html'; // canonical crawlable page
const ALSO_MOBILE   = process.env.ALSO_MOBILE === '1';               // optionally emit /m/
const OUT_DIR       = resolve(ROOT, process.env.OUT_DIR || 'dist');
const VIEWPORT      = { width: 1440, height: 900 };
// Scripts to DROP from production output (the design-time editor):
const STRIP_SCRIPT_MATCH = [/tweaks-panel/i, /tweak/i];
// dev -> prod React swap:
const REACT_SWAP = [
  [/react\.development\.js/g, 'react.production.min.js'],
  [/react-dom\.development\.js/g, 'react-dom.production.min.js'],
];

const SEO_HEAD = readFileSync(resolve(ROOT, 'head.html'), 'utf8');

async function renderPage(browser, pagePath) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const url = SOURCE.replace(/\/$/, '') + pagePath;
  console.log('→ rendering', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

  // Wait for React to populate #root, then for fonts + a short settle.
  await page.waitForFunction(
    () => { const r = document.querySelector('#root'); return r && r.children.length > 0 && document.body.innerText.length > 1000; },
    { timeout: 30000 }
  );
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(800);

  const data = await page.evaluate(() => {
    // Defensive: remove any tweaks/editor UI that happens to be in the DOM.
    document.querySelectorAll('[id*="tweak" i],[class*="tweak" i],[id^="__TWEAKS"],[class*="editmode" i]').forEach(e => e.remove());
    const headStyleLinks = [...document.head.querySelectorAll('style,link')]
      .map(e => e.outerHTML)
      .filter(h => !/__TWEAKS/i.test(h));         // keep design CSS + fonts; drop tweak styles
    const scripts = [...document.querySelectorAll('script')].map(s => ({
      src: s.src || null,
      inline: s.src ? null : s.textContent,
    }));
    return {
      lang: document.documentElement.lang || 'en',
      bodyClass: document.body.className || '',
      headStyleLinks,
      bodyHTML: document.body.innerHTML,
      scripts,
    };
  });
  await page.close();
  return data;
}

function rebuildScripts(scripts) {
  // Drop the tweaks editor; swap dev->prod React; keep everything else so the
  // page stays interactive. (Full JSX precompile + Babel removal = deferred, see README.)
  const out = [];
  for (const s of scripts) {
    if (s.src) {
      if (STRIP_SCRIPT_MATCH.some(rx => rx.test(s.src))) { console.log('  - stripped script', s.src); continue; }
      let src = s.src;
      for (const [rx, rep] of REACT_SWAP) src = src.replace(rx, rep);
      const type = /\.jsx(\?|$)/.test(src) ? ' type="text/babel"' : '';
      out.push(`<script${type} src="${src}" crossorigin></script>`);
    } else if (s.inline) {
      if (/TweaksPanel|useTweaks|__TWEAKS/.test(s.inline) && s.inline.length < 4000) { console.log('  - stripped small inline tweak script'); continue; }
      const isBabel = /</.test(s.inline) && /react|jsx|=>|function/i.test(s.inline);
      out.push(`<script${isBabel ? ' type="text/babel"' : ''}>${s.inline}</script>`);
    }
  }
  return out.join('\n');
}

function compose(data) {
  const head = data.headStyleLinks.filter(h => !/__TWEAKS/i.test(h)).join('\n'); // drop injected tweak <style> (id-anchored; never the design CSS)
  const scripts = rebuildScripts(data.scripts);
  return `<!doctype html>
<html lang="${data.lang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
${SEO_HEAD.trim()}
${head}
</head>
<body class="${data.bodyClass}">
${data.bodyHTML}
${scripts}
</body>
</html>
`;
}

async function main(){
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();

  const desktop = await renderPage(browser, CANONICAL);
  writeFileSync(resolve(OUT_DIR, 'index.html'), compose(desktop));
  console.log('✓ wrote dist/index.html  (body chars:', desktop.bodyHTML.length + ')');

  if (ALSO_MOBILE) {
    const mobile = await renderPage(browser, '/mobile.html');
    mkdirSync(resolve(OUT_DIR, 'm'), { recursive: true });
    writeFileSync(resolve(OUT_DIR, 'm/index.html'), compose(mobile));
    console.log('✓ wrote dist/m/index.html');
  }

  await browser.close();

  // Copy static assets (robots.txt, sitemap.xml, og-image.png if present).
  for (const f of ['robots.txt', 'sitemap.xml', 'og-image.png']) {
    const src = resolve(ROOT, f);
    if (existsSync(src)) cpSync(src, resolve(OUT_DIR, f));
  }
  console.log('✓ copied static assets → dist/');
  console.log('\nDONE. Acceptance: open dist/index.html with JS disabled — H1 + all copy must be visible.');
}

export { compose, rebuildScripts, main };

const isDirect = process.argv[1] && process.argv[1].endsWith('prerender.mjs');
if (isDirect) main().catch(e => { console.error(e); process.exit(1); });
