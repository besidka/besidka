# Home page: Nuxt Content + Studio

The home page (`/`) is now an editable **Nuxt Content** document instead of a
hardcoded TypeScript object. The copy and the order of the "conversation" live
in `content/index.md`; the complex UI pieces (chat bubbles, carousel, stats,
FAQ, …) are custom Vue components embedded in the markdown via MDC.

This document explains the architecture, how to edit the page, the component
reference, and how to run Nuxt Studio for visual editing.

---

## 1. How it works (architecture)

```
content/index.md                     ← the editable home page
  frontmatter: title, description, hero, faqs   (typed → Studio form fields)
  body:        the chat conversation as MDC components
        │  queryCollection('landing').path('/').first()
        ▼
app/pages/index.vue                  ← renders the hero from frontmatter,
                                       then <ContentRenderer> for the body,
                                       then SEO meta + JSON-LD
        │  MDC resolves ::home-*  →
        ▼
app/components/content/Home*.vue     ← thin wrappers that delegate to the
                                       existing app/components/landing/* UI
```

- **Collection schema** lives in `content.config.ts` (`landing` collection).
  The `.describe()` text on each field becomes the field label in Studio's
  editor.
- **Database**: Nuxt Content stores parsed content in SQL. On the Cloudflare
  `cloudflare_module` preset it must use **D1**, bound as `CONTENT_DB` (a
  dedicated database — never the app's `DB` binding). Local `pnpm run dev` and
  `pnpm run preview` use wrangler's **local D1 emulation**, so you do **not**
  need a real Cloudflare database to develop.
- **Rendering**: the page is **server-rendered at runtime** (verified working
  on the real Worker via `pnpm run preview`). We do **not** prerender it — the
  Nitro prerenderer runs in Node and cannot load the `cloudflare:workers`
  imports used by the app's server utilities.

---

## 2. Editing the content

### Option A — edit the file directly (always works)

Edit `content/index.md` and save. With `pnpm run dev` running, the page hot
reloads.

- **Text & conversation flow**: edit the markdown body. Each turn is a
  `::home-bubble` block; reorder/add/remove them freely.
- **Hero, SEO description, FAQ list**: edit the **frontmatter** at the top of
  the file (between the `---` fences).

### Option B — Nuxt Studio (visual editor)

Studio gives a Notion-like editor and commits changes back to the GitHub repo.
See section 4 for setup. Once connected, you edit the same `content/index.md`
visually; frontmatter shows as form fields, and the body is a rich editor where
the `::home-*` components appear as editable blocks.

---

## 3. The editing model: data in frontmatter, prose in the body

Structured data (hero, carousel, steps, features, useCases, benefits,
comparison, video, faqs) lives in the **frontmatter** so Studio edits it as
clean **Page Settings forms**. The markdown **body** holds the editable
conversation prose and **data-less widget placeholders** that pull from that
frontmatter. This split exists on purpose: Studio's inline property popover
clips off-screen for complex array/object props, but frontmatter forms render
full-width — so the structured lists are edited as forms, and the body stays a
clean, reorderable conversation.

- **Edit a stat label, a feature, an FAQ answer, a carousel image** → Page
  Settings (frontmatter forms).
- **Edit the conversation wording, reorder turns, add/remove a bubble** → the
  body.

### `::home-bubble` — a chat turn (body)

```md
::home-bubble{role="user" sr-label="User question"}
Short user question goes here.
::
```

| Prop       | Type                  | Notes                                            |
| ---------- | --------------------- | ------------------------------------------------ |
| `role`     | `user` \| `assistant` | default `assistant`                              |
| `wide`     | boolean (presence)    | full-width bubble (for bubbles holding a widget) |
| `heading`  | string                | adds a visually-hidden `<h2>` (SEO/a11y/anchors) |
| `id`       | string                | anchor target for nav links (e.g. `features`)    |
| `sr-label` | string                | screen-reader label for the turn                 |

A bubble may contain prose and/or a widget placeholder. Nest the widget with
more colons, indented two spaces:

```md
::home-bubble{wide heading="Features" id="features" role="assistant"}
  :::home-features{set="features"}
  :::
::
```

### Widget placeholders (body) — they read data from the frontmatter

| Placeholder                          | Reads frontmatter                      | Notes                                            |
| ------------------------------------ | -------------------------------------- | ------------------------------------------------ |
| `:home-carousel`                     | `carousel`                             | click-to-zoom lightbox                           |
| `:home-stats`                        | — (live from `/api/v1/stats`)          | numbers always live, KV-cached 24 h              |
| `:home-features{set="steps"}`        | `steps`                                | the "How it works" grid                          |
| `:home-features{set="features"}`     | `features`                             | the full feature grid                            |
| `:home-features{set="benefits"}`     | `benefits`                             | customer-outcome benefits grid (3 items)         |
| `:home-testimonials`                 | `useCases`                             | use-case cards (renamed from `testimonials`)     |
| `:home-comparison`                   | `comparison`                           | competitor comparison table with cost footnote   |
| `:home-video`                        | `video`                                | demo video streamed from R2_LANDING              |
| `:home-faq`                          | `faqs`                                 | also emitted as FAQPage structured data          |
| `:home-stars`                        | — (live from `/api/v1/github/stars`)   | live GitHub star count                           |
| `:::home-cta`                        | inline `primary`/`secondary`/`align`   | small CTA block, edited in place; each CTA accepts optional `icon` |

### Frontmatter keys — Studio editability

| Key          | Studio form type     | Notes                                                      |
| ------------ | -------------------- | ---------------------------------------------------------- |
| `title`      | text                 | Page `<title>` tag                                         |
| `description`| textarea             | SEO meta description and OG description                    |
| `hero`       | object               | headline, subheadline, eyebrow, CTAs (each CTA: `label`, `href`, optional `icon`) |
| `carousel`   | array of objects     | `src`, `alt`, `caption` per slide                          |
| `steps`      | array of objects     | `icon`, `title`, `body` per step                           |
| `features`   | array of objects     | `icon`, `title`, `body` per feature                        |
| `benefits`   | array of objects     | `icon`, `title`, `body` — customer-outcome wording         |
| `useCases`   | array of objects     | `icon`, `persona`, `scenario`, `payoff`                    |
| `comparison` | object               | `caption`, `columns[]`, `rows[]{label, values[]}`          |
| `video`      | object               | `src` (R2 path), `poster` (optional), `caption` (optional) |
| `faqs`       | array of objects     | `question`, `answer` — also powers FAQPage JSON-LD         |

So to change the carousel images you edit the **`carousel`** list in Page
Settings; the `::home-carousel` placeholder in the body just marks where it
appears. To move the demo earlier in the conversation, drag the
`::home-carousel` bubble up in the body.

Icons use [Lucide](https://lucide.dev) names, e.g. `lucide:layers`. Links
starting with `http(s)://` open in a new tab automatically; `#anchors` and
`/paths` stay in the same tab.

---

## 4. Running Nuxt Studio

Studio (`nuxt-studio`) is **self-hosted** in this app — there is no dependency
on the nuxt.studio cloud. It behaves differently in dev vs production:

### Local editing (development) — the "Edit this page" button

```bash
pnpm run dev          # http://localhost:3000
```

Open the site and look for the **"Edit this page"** floating button in the
**bottom-left** corner. Click it to open the visual editor. In dev, edits sync
**straight to your local files** (`content/index.md`) — no account, no OAuth,
no env vars required.

> There is **no `/_studio` route in development** — that route only exists in a
> production build (so `http://localhost:3000/_studio` returning 404 is
> expected). Likewise, **Publish (Git commit) is disabled in dev**: you save to
> the local file and commit with git yourself.

You can of course also just edit `content/index.md` in your code editor — both
paths write the same file, and the page hot-reloads.

### Production editing — the `/_studio` route

On a deployed build, the editor lives at **`/_studio`** (the default
`studio.route`). To enable sign-in and publishing, set GitHub OAuth credentials
as deployment secrets (names verified against the module source):

```
STUDIO_GITHUB_CLIENT_ID=...
STUDIO_GITHUB_CLIENT_SECRET=...
```

Create them at GitHub → Settings → Developer settings → OAuth Apps → New OAuth
App, with **Authorization callback URL** `https://<your-domain>/_studio`. The
repository is already configured in `nuxt.config.ts`:

```ts
studio: {
  repository: {
    provider: 'github',
    owner: 'besidka',
    repo: 'besidka',
    branch: 'main',
  },
},
```

Then deploy. Visit `https://<your-domain>/_studio`, sign in with GitHub, edit
visually, and **Publish** — which commits the change to the `main` branch. Your
deploy pipeline rebuilds and ships it.

> Studio publishes by committing to Git, so a content change goes live the same
> way a code change does: commit → build → deploy.

> **Alternative**: the nuxt.studio cloud editor can also connect to this repo
> (it's the same module). Self-hosting `/_studio` keeps everything on your own
> domain; check <https://nuxt.studio> if you prefer the hosted route.

---

## 5. Production deploy — create the CONTENT_DB database

Local dev/preview use a local D1 emulation, but production needs a real,
**dedicated** D1 database for content (kept separate from the app's `DB`).

```bash
# 1. Create the production content database
pnpm wrangler d1 create besidka-content
#    → copy the printed database_id

# 2. (optional) a separate database for the preview environment
pnpm wrangler d1 create besidka-content-preview
```

Then replace the `"database_id": "TO_BE_CREATED"` placeholders in
`wrangler.jsonc` for the `CONTENT_DB` binding — there are **two** blocks (the
preview env around line 39 and the production env around line 107). Use the
real ids you just created.

Build and deploy as usual:

```bash
pnpm run build
pnpm run deploy
```

On the first request after deploy, Nuxt Content loads its content dump into
`CONTENT_DB` automatically (no manual migration step). After a content change
is published in Studio, the rebuild + redeploy refreshes it.

> **Studio production editing (optional)** also needs GitHub OAuth credentials
> so editors can authenticate and publish. If you enable it, create a GitHub
> OAuth app and provide its client id/secret to the deployment as secrets, per
> the current <https://nuxt.studio> docs. This is **not** required for the site
> to build, deploy, or be edited locally.

---

## 6. Gotchas / notes for maintainers

- **Never point `CONTENT_DB` at the `DB` binding.** They are isolated on
  purpose; Content writes its own tables.
- **Do not prerender `/`.** It fails on this preset because the Node
  prerenderer can't load `cloudflare:workers` imports. Runtime SSR already
  produces full HTML for SEO.
- **MDC nesting**: in `content/index.md` the bubble uses `::home-bubble` and the
  nested widget is indented two spaces with one extra colon (`:::home-widget`).
- **Adding a new widget**: create `app/components/content/HomeX.vue` (delegating
  to a real UI component), then use it as `::home-x` in the markdown.

## 7. Troubleshooting

### "table _content_landing has N columns but M values" / content vanishes in Studio

This means **`content.config.ts`'s schema changed** (a frontmatter field was
added/removed) while Studio still has a **browser-cached draft DB on the old
schema**. Studio keeps a SQLite mirror + drafts in the browser (IndexedDB); the
server can't reset it. After any schema change, reset the browser state once:

1. Stop & restart `pnpm run dev` (rebuilds the server DB on the new schema — we
   also `rm -rf .data` to be sure).
2. In the browser: DevTools → **Application → Storage → Clear site data** for
   `http://localhost:3000`, then hard-reload. (Or use Studio's "discard local
   changes" if shown.) This makes Studio re-download the new schema + content.

The page itself (server-rendered) is unaffected — only Studio's local editor
cache needs the reset. Keep the schema stable to avoid repeating this.

### Studio reverts a change I made in the file

Opening the dev editor syncs Studio's draft back to the file. Edit a value in
**either** the file **or** Studio in a given session, not both. The file is the
build source of truth; if it drifts, restart dev or edit the field in Studio.

### `<svg> attribute width/height: Expected length, "xs"` console errors

These come from **Studio's own editor chrome** (its toolbar icons), not the
site — none of the landing components pass `size="xs"`. Harmless.
