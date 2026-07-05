# Vectorla — AI Print-Ready Vector Platform

Frontend foundation for **vectorla.app** — a browser-based image-to-vector
platform positioned for designers, print shops, advertising agencies,
CNC/laser users, sticker makers, and branding companies.

This is **v1.0**: a production-quality marketing site + realistic,
interactive workspace *mockup*. There is no real AI/vectorization backend
wired in yet — see the `TODO(backend)` comments in the code for where that
connects later.

---

## Tech stack

- React 19 + TypeScript
- Vite 8
- Tailwind CSS v4 (CSS-first config via `@theme`, no `tailwind.config.js` needed)
- lucide-react (icons)
- framer-motion (installed, ready for richer motion — current animations use
  plain CSS transitions to keep the bundle lean)

## Project structure

```
src/
  components/       Reusable UI: Navbar, Hero, WorkspacePreview, Features,
                     UseCases, Pricing, Faq, Footer, LogoMark, ThemeToggle
  components/ui/     Small primitives: Button, SectionHeading
  pages/            LandingPage.tsx — composes all sections for v1.0
  layouts/          MainLayout.tsx — Navbar + Footer wrapper
  lib/              theme.tsx — dark/light ThemeProvider + useTheme hook
  utils/            cn.ts — tiny className combiner
  data/             Real copy: features.ts, useCases.ts, pricing.ts, faq.ts,
                     nav.ts, trustBadges.ts, workspace.ts
  styles/           globals.css — Tailwind import + design tokens (light/dark)
```

---

## 1. Run locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`.

## 2. Build for production

```bash
npm run build
```

Type-checks with `tsc -b`, then builds with Vite. Output goes to `dist/`.

```bash
npm run preview   # serve the production build locally to sanity-check it
```

## 3. Deploy to Cloudflare Pages

**Option A — Dashboard**
1. Push this project to a GitHub/GitLab repo.
2. In the Cloudflare dashboard: Workers & Pages → Create → Pages → connect
   the repo.
3. Build settings:
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. Deploy. Attach your `vectorla.app` domain under the project's custom
   domains once the first deploy succeeds.

**Option B — Wrangler CLI**
```bash
npm install -g wrangler
npm run build
wrangler pages deploy dist --project-name=vectorla
```

No `wrangler.toml` is required for a static Vite site like this one; add one
later only if you introduce Pages Functions (e.g. for the real API/backend).

---

## 4. Files created (high-level)

- `index.html` — SEO meta tags (title, description, Open Graph, Twitter card,
  canonical URL), favicon.
- `src/styles/globals.css` — Tailwind v4 import, `@theme` design tokens, and
  the light/dark CSS variable sets switched via `data-theme`.
- `src/lib/theme.tsx` — theme context, persists choice in `localStorage`,
  respects `prefers-color-scheme` on first visit.
- `src/components/*` — every section listed in the brief: Navbar (responsive
  mobile menu), Hero (headline, CTAs, draggable before/after demo, trust
  badges), WorkspacePreview (left/center/right/bottom panel mockup with
  presets, sliders, print-ready toggle, export row), Features (10 cards),
  UseCases (9 cards), Pricing (3 plans), Faq (accordion), Footer (4 link
  columns).
- `src/data/*` — all real copy from the brief, kept out of components so it's
  easy to edit without touching markup.

The project type-checks cleanly (`tsc -b`) and builds cleanly
(`npm run build`) as of this version.

## 5. What to build next

1. **Real vectorization engine** — the Hero and WorkspacePreview demos are
   currently illustrative UI state (see `TODO(backend)` in
   `WorkspacePreview.tsx`). Decide whether tracing runs client-side (Web
   Worker + a tracing library) or server-side (for heavier AI-based
   vectorization), then wire the upload buttons to it.
2. **Auth** — Sign in / Start free currently render but don't do anything.
   Add a real auth provider (Clerk, Auth.js, Supabase Auth, or Cloudflare
   Access) before connecting billing.
3. **Billing** — Pricing CTAs need a checkout flow (Stripe is the common
   choice) once Pro/Business plans go live.
4. **API** — the nav has an "API" link and Business plan promises API access;
   this needs actual endpoints (likely Cloudflare Workers) plus docs.
5. **File export** — SVG/PDF/DXF/EPS export buttons in the workspace need
   real export logic once tracing is implemented.
6. **Analytics + error tracking** — add before public launch (e.g. Plausible
   for privacy-friendly analytics, Sentry for errors).
7. **Legal pages** — Privacy Policy and Terms are linked in the footer but
   not yet written; needed before accepting real signups, especially given
   the "private processing" claim made on the homepage.
