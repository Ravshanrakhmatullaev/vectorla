# Vectorla — Project Context

## Project vision

Vectorla is **vectorla.app** — a browser-based image-to-vector platform for
designers, print shops, advertising agencies, CNC/laser users, sticker
makers, and branding companies. Users upload a raster image (logo, sketch,
signature, QR code, photo) and get back clean, production-ready vector
files (SVG/PDF/DXF/EPS) suitable for print and cutting workflows — not just
decorative web SVGs.

**Current state: frontend-only.** This repo is the marketing site plus a
fully interactive but *simulated* product UI (workspace, upload, before/after
preview). There is no real AI vectorization engine, no auth, and no billing
wired up yet. The UI is intentionally honest about this — see "Preview Mode"
under Current completed features.

## Tech stack

- React 19 + TypeScript (`strict: true`, plus `noUncheckedIndexedAccess` and
  `noImplicitOverride` — see `tsconfig.app.json`)
- Vite 8 (`vite.config.ts`), path alias `@` → `src/`
- Tailwind CSS v4 — CSS-first config via `@theme` in `src/styles/globals.css`,
  no `tailwind.config.js`. Dark mode via a custom `dark:` variant keyed off
  `[data-theme="dark"]` on `<html>` (not `prefers-color-scheme` alone)
- `framer-motion` for subtle animation (workflow stepper, fade-ins)
- `lucide-react` for icons
- `oxlint` for linting (`.oxlintrc.json`)
- No backend framework, no database, no server — pure static SPA

## Current completed features

- **Landing page** (`src/pages/LandingPage.tsx`): Hero → CompatibleWith →
  WorkspacePreview → Features → UseCases → Pricing → Faq, wrapped in
  `MainLayout` (Navbar + Footer).
- **Premium Hero section** (`src/components/Hero.tsx`): two-column layout,
  gradient/blob backdrop, primary/secondary CTAs, star-rating trust block,
  animated 3-step workflow indicator, and a before/after comparison slider.
- **Before/after artwork** (`src/components/BeforeAfterArt.tsx`): a single
  shared illustration rendered twice with different CSS filters (blurred/
  desaturated/noisy vs. sharp/saturated), revealed via `clip-path` so the
  slider shows one continuous artwork with no visual seam — used by both
  Hero and WorkspacePreview. **This artwork is being iterated on** — see
  Current TODOs.
- **Workspace preview** (`src/components/WorkspacePreview.tsx`): a fake
  "browser window" UI (presets, recent files, vector-setting sliders,
  print-ready checklist, export bar) demonstrating the intended product.
  Explicitly marked **"Preview Mode"** with a visible badge and a persistent
  disclosure banner: *"This is a frontend preview. Real AI vectorization
  will be connected in the next version."* Export buttons are disabled with
  the message *"Available after AI processing is connected."* This is a
  deliberate honesty requirement — do not reintroduce fake
  processing/loading animations that imply real AI work is happening.
- **i18n**: custom-built (no external library) — `src/lib/language.tsx`
  (`LanguageProvider`/`useLanguage`, mirrors `src/lib/theme.tsx`'s pattern),
  translations in `src/data/i18n.ts`. Three languages: English (`en`,
  default), Uzbek (`uz`), Russian (`ru`). Persisted to `localStorage`
  (`vectorla-lang`). Language switcher in navbar (desktop, next to theme
  toggle) and in the mobile menu.
- **Dark/light theme**: `src/lib/theme.tsx`, persisted to `localStorage`
  (`vectorla-theme`), defaults to `prefers-color-scheme` on first visit.
  Theme is applied via a **blocking inline script in `index.html`** before
  React mounts, specifically to avoid a flash-of-wrong-theme (FOUC) — the
  React provider reads the already-applied `data-theme` attribute rather
  than recomputing it.
- **SEO/PWA basics**: `public/robots.txt`, `public/sitemap.xml`,
  `public/manifest.webmanifest`, `public/favicon.svg`.
- **`.env.example`**: placeholders for future `VITE_API_BASE_URL`,
  `VITE_AUTH_PUBLISHABLE_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`,
  `VITE_ANALYTICS_DOMAIN`, `VITE_SENTRY_DSN`. Real `.env`/`.env.local` are
  gitignored.

## UI principles

- **Modern minimal SaaS aesthetic** in the style of Vercel/Framer/Linear/
  Raycast: soft gradient blobs, glassmorphism (`backdrop-blur` + translucent
  borders), generous whitespace, restrained motion.
- **Every visible string goes through the i18n `Translation` object**
  (`src/data/i18n.ts`) — never hardcode UI copy in components. Brand names
  and universal acronyms (e.g. "Adobe Illustrator", "SVG", "PDF") are the
  exception — they stay in plain data files since they don't need
  translating.
- **Data/text separation**: components read structural metadata (icons,
  ids, numeric values) from `src/data/*.ts`, and display text from
  `t.<section>` via `useLanguage()`. Data files type their arrays against
  id unions exported from `src/data/i18n.ts` (e.g. `FeatureId`,
  `PricingPlanId`) so TypeScript's `Record<Id, T>` typing forces every
  language to define every key — a missing translation is a compile error,
  not a silent runtime gap.
- **Honesty over illusion**: do not simulate fake processing/loading delays
  that imply a real backend is doing work. If something isn't wired up yet,
  say so visibly (see WorkspacePreview's "Preview Mode").
- **Excellent dark mode is not optional** — every new visual element must
  be checked in both themes before considering the work done.
- **Responsive by default** — verify both a mobile viewport (~375px) and a
  real desktop width (1280px) in the browser preview, not just by reading
  Tailwind breakpoints.

## Code principles

- Keep `tsconfig.app.json`/`tsconfig.node.json` `strict: true` +
  `noUncheckedIndexedAccess` + `noImplicitOverride` — never disable these to
  make an error go away. Fix the underlying type issue (see git history:
  array indexing under `noUncheckedIndexedAccess` returns `T | undefined`
  and must be guarded, not asserted away).
  before making any changes.
- No external i18n library — the hand-rolled context in `src/lib/language.tsx`
  is intentional (mirrors `src/lib/theme.tsx`). Don't replace it with
  react-i18next/etc. without being asked.
- `src/utils/cn.ts` is a tiny hand-rolled className combiner — intentional,
  do not pull in `clsx`/`tailwind-merge` for this.
- No comments explaining *what* code does; only *why*, when non-obvious
  (see the FOUC fix in `src/lib/theme.tsx` for the expected style).
- Don't add abstractions, error handling, or validation for scenarios that
  can't happen in this codebase (no backend yet — there is nothing to
  validate against).
- Remove dead code/translations when a feature changes shape (e.g. when the
  fake processing pipeline was replaced by Preview Mode, its now-unused
  `WorkspaceStageId` type, `processingStages` data, and `stages`/
  `processingLabel` translation keys were deleted, not left orphaned).
- Before committing to a new dependency, check if the existing stack
  already covers the need (`framer-motion` is already installed for
  animation; no need for a second animation library).

## Deployment information

- **Target: Cloudflare Pages** (static site, no `wrangler.toml` needed
  unless/until Pages Functions are introduced for a real backend).
- Build settings for Cloudflare: Framework preset **Vite**, build command
  `npm run build`, output directory `dist`.
- `npm run build` runs `tsc -b && vite build` — type-checks before bundling.
- Repo is on GitHub: `github.com/Ravshanrakhmatullaev/vectorla`, default
  branch `main`.
- No CI pipeline configured yet (no `.github/workflows`).
- Domain: `vectorla.app` (referenced in SEO meta tags and `sitemap.xml`; not
  confirmed live/attached in this repo).

## Current roadmap

From the README's "what to build next" (still accurate):

1. **Real vectorization engine** — decide client-side (Web Worker + tracing
   library) vs. server-side (AI-based), then wire up `WorkspacePreview` and
   Hero's upload flow. All current "processing" UI is Preview Mode only.
2. **Auth** — Sign in / Start free currently render but do nothing. Needs a
   real provider (Clerk, Auth.js, Supabase Auth, or Cloudflare Access).
3. **Billing** — Stripe is the likely choice once Pro/Business plans go live.
4. **API** — nav has an "API" link and the Business plan promises API
   access; needs real endpoints (likely Cloudflare Workers) plus docs.
5. **File export** — SVG/PDF/DXF/EPS export buttons need real export logic
   once tracing exists. They are currently always disabled by design.
6. **Analytics + error tracking** — before public launch (e.g. Plausible,
   Sentry). Env var placeholders already exist in `.env.example`.
7. **Legal pages** — Privacy Policy and Terms are linked in the footer but
   not written yet; needed before real signups, especially given the
   "private processing" trust badge claim on the homepage.

## Current TODOs

- **Before/after demo artwork** (`src/components/BeforeAfterArt.tsx`) is
  actively being redesigned. It must remain **one continuous artwork**
  rendered twice (blurred/desaturated "before" vs. sharp/vibrant "after")
  revealed via `clip-path` across the slider — never two different images.
  The subject should read as a premium/professional illustration, not a
  cartoon icon.
- Both `src/components/Hero.tsx` (drag & drop) and
  `src/components/WorkspacePreview.tsx` (Preview Mode) have
  `TODO(backend)` comments marking exactly where real upload/processing
  needs to be wired in later — read those comments before touching that code.
- No test suite exists yet.

## Assets structure

```
src/
  App.tsx                 ThemeProvider > LanguageProvider > MainLayout > LandingPage
  main.tsx                React root
  pages/
    LandingPage.tsx        Composes all sections, in render order
  layouts/
    MainLayout.tsx         Navbar + <main> + Footer
  components/
    Navbar.tsx             Nav links, language switcher, theme toggle, mobile menu
    Hero.tsx                Premium two-column hero + before/after slider
    BeforeAfterArt.tsx      Shared before/after illustration (see roadmap TODO)
    CompatibleWith.tsx      "Compatible with" logo-cloud strip
    WorkspacePreview.tsx    Simulated product UI, explicitly "Preview Mode"
    Features.tsx / UseCases.tsx / Pricing.tsx / Faq.tsx / Footer.tsx
    LogoMark.tsx            Brand mark (also mirrored in public/favicon.svg)
    ThemeToggle.tsx / LanguageSwitcher.tsx
    ui/Button.tsx / ui/SectionHeading.tsx   Small shared primitives
  lib/
    theme.tsx               Dark/light ThemeProvider + useTheme
    language.tsx            i18n LanguageProvider + useLanguage
  data/
    i18n.ts                 Language type, all id unions, full EN/UZ/RU translations
    nav.ts / features.ts / useCases.ts / pricing.ts / faq.ts / trustBadges.ts /
    workspace.ts / compatibleApps.ts
                            Structural metadata only (icons, ids, values) — no display text
  utils/
    cn.ts                   Tiny className combiner
  styles/
    globals.css             Tailwind v4 import, @theme tokens, light/dark CSS variables
public/
  favicon.svg / manifest.webmanifest / robots.txt / sitemap.xml
```

## Rules for future development

1. Read this file, the README, and the relevant component before making
   changes — don't assume prior session context carries over.
2. Never hardcode user-facing copy — add it to `src/data/i18n.ts` for all
   three languages, typed against an id union so missing translations fail
   the build.
3. Never simulate fake backend work (progress bars, fake AI stages) without
   an explicit, visible disclosure that it's a preview — see WorkspacePreview.
4. Keep `strict` TypeScript green — fix type errors properly, never
   suppress with `any`/`ts-ignore`/relaxed compiler flags.
5. Always run `npm run build` and `npm run lint` after changes and treat
   both as required, not optional.
6. Check both light and dark mode, and both mobile (~375px) and desktop
   (1280px) viewports, before calling a UI change done.
7. Don't add a new dependency without checking whether `framer-motion`,
   `lucide-react`, or the existing hand-rolled utilities already cover it.
8. Don't commit or push unless explicitly asked to in that specific turn —
   treat each request's git instructions as scoped to that request only.
9. When replacing a feature (like the fake processing pipeline → Preview
   Mode), delete the old translations/types/data it leaves behind instead
   of leaving dead code.

---

Always read PROJECT_CONTEXT.md before making any code changes.
