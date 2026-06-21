# Arkive marketing — prerender + SEO/GEO build (Phase 1)

**Goal:** keep the claude.ai/design page **pixel-identical** while putting the **content into the HTML
source** (crawlable + AI-citable), with SEO/GEO baked in. **Phase 1 = build on a Netlify _preview_ only.**
No production cutover, no DNS/Cloudflare/Worker/AASA changes, no touching the Squarespace legal pages.

## What's in here
```
scripts/prerender.mjs   Playwright prerender: render bundle → strip tweaks → swap dev→prod React
                        → inject SEO head → write dist/index.html (content baked into source)
seo/head.html           SEO/GEO <head> (title, meta, canonical=www.arkive-it.app, OG/Twitter, JSON-LD)
seo/jsonld.json         The JSON-LD graph (Organization · WebSite · SoftwareApplication · FAQPage)
static/robots.txt       ALLOW ALL incl. AI (Decision #257); Content-Signal ai-input=yes, ai-train=yes
static/sitemap.xml      Canonical pages (production host www.arkive-it.app)
netlify.toml            Build = run prerender; publish = dist; security headers
package.json            Dep: playwright
```

## Why a script, not a committed index.html
Prerendering must run **where the design bundle is reachable** (your machine / CI / the Netlify build).
The bundle is client-rendered React (React 18.3.1 dev + in-browser Babel compiling `app-core.jsx`,
`app-sections.jsx`, `waitlist-modal.jsx`, `tweaks-panel.jsx` into `#root`). The script renders it for real,
then serializes the finished DOM.

## Run locally
```bash
npm ci
npx playwright install chromium
SOURCE=https://arkive-preview.netlify.app node scripts/prerender.mjs
# → dist/index.html (+ dist/robots.txt, dist/sitemap.xml)
# Optional second variant:  ALSO_MOBILE=1 ... → dist/m/index.html
```
Then open `dist/index.html` **with JavaScript disabled** — the H1 and all section copy must be visible.

## Deploy (Founder — credentials are yours)
1. Put these files in the marketing repo alongside the design bundle (or keep `SOURCE` pointed at the
   preview). Connect the repo to a **new Netlify preview site** (NOT `arkive-it.app` yet).
2. Netlify runs `netlify.toml`'s build (installs Chromium, prerenders, publishes `dist/`).
3. Share the `*.netlify.app` preview URL with Operations for acceptance.

## Decisions already baked in
- **Canonical host:** `www.arkive-it.app` (kept consistent so App Store + legal URLs are unaffected at cutover).
- **AI crawlers:** ALLOW ALL incl. training (`ai-input=yes, ai-train=yes`). ⚠️ Cloudflare's *managed* AI-block
  toggle overrides robots.txt — it must ALSO be turned OFF in the dashboard (Founder/Ops, paired with Phase 2).
- **Structure:** one canonical crawlable page now (desktop render); use-case subpages + blog later.
- **Tweaks editor:** stripped from output (`tweaks-panel.jsx` dropped; tweak nodes removed).
- **Prod React:** dev→prod React builds swapped. **Deferred + flagged:** full JSX precompile + dropping
  in-browser Babel (needs the bundle's build step; do as a fast-follow once fidelity is confirmed).

## Acceptance checklist (verify on the preview)
- [ ] (a) View Source, JS disabled → H1 "ARKIVE … meaningful moments live on" + **all** section copy present
- [ ] (b) Rendered page **pixel-identical** to the claude.ai/design original (visual diff)
- [ ] (c) `<title>`/meta/canonical/OG + JSON-LD valid (Rich Results Test) + `sitemap.xml` + `robots.txt` (AI allowed)
- [ ] (d) No tweaks-panel / EDITMODE anywhere in the output
- [ ] (e) Reasonable first paint (content paints from static HTML before JS; prod React)

## Explicitly NOT this phase
No Cloudflare/DNS cutover; nothing points `arkive-it.app` at Netlify; no retiring Squarespace; no touching
the Worker, the AASA, or the four deep-link routes; no moving/editing the Squarespace legal pages. (All Phase 2.)
