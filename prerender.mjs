/**
 * Arkive marketing — prerender pipeline (Phase 1 · self-contained fidelity build)
 * --------------------------------------------------------------------------------
 * Renders the claude.ai/design bundle in headless Chromium and serializes a FULLY
 * SELF-CONTAINED static page: content in the HTML source (crawlable) AND pixel-correct
 * with JavaScript disabled. No external CSS, no runtime JS required to look right.
 *
 * Fidelity fixes (vs the first build):
 *   1. INLINE all same-origin stylesheets (styles.css + the head <style>) into one <style>;
 *      keep cross-origin sheets (Google Fonts) as absolute <link>s.
 *   2. BAKE the post-applyTweaks design tokens — the :root custom properties applyTweaks
 *      writes onto <html> at runtime (--bg, --ink, --serif, --gap, …) — statically onto <html>.
 *   3. ABSOLUTIZE every relative asset URL (CSS url(), img src/srcset, etc.) to the SOURCE origin.
 *   4. FORCE entrance-reveal elements to their final shown state (.reveal is opacity:0 until a
 *      JS scroll-observer flips it — invisible with JS off). A tiny override bakes the shown state.
 *
 * Layout: flattened repo (head.html, robots.txt, sitemap.xml at root; build = node prerender.mjs).
 * RUN:  SOURCE=https://arkive-preview.netlify.app node prerender.mjs   → dist/index.html
 * --------------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url)); // flattened: assets live beside this file

const SOURCE        = process.env.SOURCE || 'https://arkive-preview.netlify.app';
const CANONICAL_PAGE= process.env.CANONICAL_PAGE || '/desktop.html';
const OUT_DIR       = resolve(ROOT, process.env.OUT_DIR || 'dist');
const KEEP_JS       = process.env.KEEP_JS !== '0';   // re-attach app JS (optional); page is correct without it
const VIEWPORT      = { width: 1440, height: 900 };
const SEO_HEAD      = readFileSync(resolve(ROOT, 'head.html'), 'utf8');

// Entrance-reveal elements (.reveal) are opacity:0 + transform until a JS scroll-observer
// flips them. With JS off they'd be invisible — force their final shown state statically.
// (opacity/transform only — never `display`, so JS-gated modals stay hidden.)
const REVEAL_FIX = '\n/* prerender: force entrance-reveal elements to final shown state (JS-off fidelity) */\n.reveal{opacity:1 !important;transform:none !important;}\n';

/* Runs INSIDE the page (post-render, after applyTweaks). Captures a self-contained snapshot. */
function captureInPage() {
  const ORIGIN = location.origin;
  const absUrl = u => { u = String(u).trim().replace(/^['"]|['"]$/g, '');
    if (/^(https?:|data:|#|mailto:|tel:)/i.test(u)) return u;
    if (u.startsWith('//')) return 'https:' + u;
    if (u.startsWith('/')) return ORIGIN + u;
    return ORIGIN + '/' + u; };
  const absCss = css => css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g,
    (m, q, u) => /^(data:|#)/i.test(u.trim()) ? m : `url("${absUrl(u)}")`);

  let inlinedCss = ''; const crossLinks = [];
  for (const ss of document.styleSheets) {
    if (ss.href && !ss.href.startsWith(ORIGIN)) { const el = ss.ownerNode; if (el) crossLinks.push(el.outerHTML); continue; }
    try { inlinedCss += '\n' + [...ss.cssRules].map(r => r.cssText).join('\n'); }
    catch (e) { const el = ss.ownerNode; if (el && el.tagName === 'LINK') crossLinks.push(el.outerHTML); } // cross-origin → keep as <link>
  }
  inlinedCss = absCss(inlinedCss);

  const headLinks = [...document.head.querySelectorAll('link[rel=preconnect],link[href*="googleapis"],link[href*="gstatic"]')].map(l => l.outerHTML);
  const bclone = document.body.cloneNode(true);
  bclone.querySelectorAll('script,[id*="tweak" i],[class*="tweak" i]').forEach(s => s.remove());
  const bodyHTML = bclone.innerHTML
    .replace(/(\s(?:src|href|poster|srcset)=)(['"])(?!https?:|data:|#|\/\/|mailto:|tel:)([^'"]+)\2/gi, (m, p, q, u) => p + q + absUrl(u) + q)
    .replace(/url\(\s*(['"]?)(?!https?:|data:|#)([^'")]+)\1\s*\)/gi, (m, q, u) => `url("${absUrl(u)}")`);
  const scripts = [...document.querySelectorAll('script')].map(s => ({ src: s.src || null, type: s.type || '', inline: s.src ? null : s.textContent }));

  return {
    lang: document.documentElement.lang || 'en',
    rootStyle: document.documentElement.getAttribute('style') || '', // post-applyTweaks design tokens
    bodyClass: document.body.className || '',
    headLinks, crossLinks, inlinedCss, bodyHTML, scripts,
  };
}

function rebuildScripts(scripts) {
  const STRIP = [/tweaks-panel/i, /tweak/i];
  const SWAP = [[/react\.development\.js/g, 'react.production.min.js'], [/react-dom\.development\.js/g, 'react-dom.production.min.js']];
  const out = [];
  for (const s of scripts) {
    if (s.src) {
      if (STRIP.some(rx => rx.test(s.src))) continue;           // drop the design-time editor
      let src = s.src; for (const [rx, rep] of SWAP) src = src.replace(rx, rep);
      const type = /\.jsx(\?|$)/.test(src) ? ' type="text/babel"' : '';
      out.push(`<script${type} src="${src}" crossorigin></script>`);
    } else if (s.inline) {
      if (/TweaksPanel|useTweaks|__TWEAKS/.test(s.inline) && s.inline.length < 4000) continue;
      out.push(`<script${/text\/babel/.test(s.type) ? ' type="text/babel"' : ''}>${s.inline}</script>`);
    }
  }
  return out.join('\n');
}

function compose(data, { keepJs = true } = {}) {
  const links = (data.headLinks || []).concat(data.crossLinks || []).join('\n');
  const scripts = keepJs ? rebuildScripts(data.scripts || []) : '';
  return `<!doctype html>
<html lang="${data.lang || 'en'}" style="${(data.rootStyle || '').replace(/"/g, '&quot;')}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
${SEO_HEAD.trim()}
${links}
<style>
${data.inlinedCss || ''}${REVEAL_FIX}</style>
</head>
<body class="${data.bodyClass || ''}">
${data.bodyHTML || ''}
${scripts}
</body>
</html>
`;
}

async function renderPage(browser, pagePath) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const url = SOURCE.replace(/\/$/, '') + pagePath;
  console.log('→ rendering', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => { const r = document.querySelector('#root'); return r && r.children.length > 0 && document.body.innerText.length > 1000; }, { timeout: 30000 });
  // wait until applyTweaks has written the :root design tokens onto <html>
  await page.waitForFunction(() => /--bg|--ink|--serif/.test(document.documentElement.getAttribute('style') || ''), { timeout: 15000 })
    .catch(() => console.warn('  ⚠ design tokens not detected on <html> — check applyTweaks timing'));
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(1000);
  const data = await page.evaluate(captureInPage);
  await page.close();
  return data;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const desktop = await renderPage(browser, CANONICAL_PAGE);
  writeFileSync(resolve(OUT_DIR, 'index.html'), compose(desktop, { keepJs: KEEP_JS }));
  console.log(`✓ dist/index.html  (inlined CSS ${desktop.inlinedCss.length} · body ${desktop.bodyHTML.length} chars · JS ${KEEP_JS ? 'kept (optional)' : 'dropped'})`);
  await browser.close();
  for (const f of ['robots.txt', 'sitemap.xml', 'og-image.png']) {
    const src = resolve(ROOT, f); if (existsSync(src)) cpSync(src, resolve(OUT_DIR, f));
  }
  console.log('✓ copied static assets → dist/\nDONE. Open dist/index.html with JS disabled — hero + all copy must be visible AND fully styled.');
}

export { compose, rebuildScripts, captureInPage, REVEAL_FIX };
const isDirect = process.argv[1] && process.argv[1].endsWith('prerender.mjs');
if (isDirect) main().catch(e => { console.error(e); process.exit(1); });
