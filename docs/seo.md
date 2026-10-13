# SEO

How search-engine surface area is wired, the brand-entity problem the setup is
shaped around, and the decisions that were made deliberately (including the
ones that look like omissions).

Companion reading: `docs/landing-studio.md` for how the landing copy is edited,
`CLAUDE.md` → "SEO and canonical host" for the short version.

## Canonical host

Canonical host is the bare apex `besidka.com`. A Cloudflare redirect rule 301s
`www.besidka.com` to the apex (`https://besidka.com/`), so every crawler-facing
URL must use the apex to match the post-redirect host — advertising `www` URLs
would publish links that immediately redirect and split the signal.

`site.url` in `nuxt.config.ts` defaults to `https://besidka.com` and is
overridden at runtime by `NUXT_PUBLIC_BASE_URL`. **That variable must be set to
`https://besidka.com` in the production Worker env**, or sitemap, robots and
canonical all resolve to the wrong host.

Verified DNS state (no action needed): Cloudflare nameservers, SPF via
`_spf.mx.cloudflare.net`, `DMARC p=reject`, MX via Cloudflare Email Routing, and
the Google Search Console `google-site-verification` TXT record. There is no CAA
record — that is a certificate-issuance hardening gap, not an SEO one.

## One canonical, derived per route

`app/app.vue` computes the canonical URL from `useRoute()` and emits **both**
`<link rel="canonical">` and `og:url` from it:

```ts
const canonicalUrl = computed<string>(() => {
  return new URL(route.path, baseUrl as string).href
})
```

This is the single source of truth. Do **not** add a per-page canonical or
`ogUrl` — pages inherit the correct one automatically, and a second tag risks
a duplicate.

Two properties this deliberately buys:

- **Every route self-canonicalises.** Previously `app.vue` set a fixed
  `ogUrl: baseUrl`, so all 15 routes advertised the home page as their `og:url`,
  and `/privacy` + `/terms` shipped no canonical at all.
- **Trailing-slash agreement.** `new URL('/', base).href` normalises to
  `https://besidka.com/` — byte-identical to the `<loc>` that
  `@nuxtjs/sitemap` emits. The two used to disagree (canonical had no slash),
  which is exactly the signal split canonicalisation exists to prevent.

Schema URLs go through `buildLandingLdIds()` in `app/utils/landing-jsonld.ts`,
which applies the same normalisation, so JSON-LD `url`/`@id` values match the
canonical too.

## Indexable surface

Indexable: `/`, `/byok`, `/privacy-policy`, `/terms-of-use`, `/cookie-policy`,
and any `/shared/<publicId>` whose share row has `indexable = true`. The old
`/privacy` and `/terms` URLs 301 to the `-policy`/`-of-use` routes
(`routeRules` in `nuxt.config.ts`).

`noindex, nofollow`: all authenticated routes (`/chats/**`, `/profile/**`),
`/signin`, `/signup`, `/reset-password`, `/new-password`, and shared chats with
`indexable = false`.

### Why most auth routes are noindex but NOT robots-disallowed

They used to be both, which is self-defeating: a `Disallow`-ed URL is never
fetched, so its `noindex` is never read — and the bare URL can still be indexed
without content if anything links to it. Crawlers reach these pages regardless:
the landing hero's primary CTA links to `/signup`, and `/signin` links to
`/reset-password`.

So for `/signin`, `/signup` and `/reset-password` the fix is to allow the crawl
and let the `noindex` do the work. Each sets `robots: 'noindex, nofollow'` via
`useSeoMeta`. **If you re-add those paths to `robots.disallow` in
`nuxt.config.ts`, you silently re-break this.**

`/new-password` is deliberately the exception and remains disallowed. It is only
ever reached through a tokened link in an email, so nothing crawlable points at
it and there is no discovery for a `noindex` to prevent. Keeping it disallowed
also keeps a token-bearing URL out of scope for crawlers and link prefetchers —
worth noting because this site serves Cloudflare `speculation-rules`.

`/api/`, `/chats/`, `/files/`, `/profile/`, `/_studio`, `/__nuxt_studio` and
`/__nuxt_content/` remain disallowed — those either require auth (so a crawler
gets a redirect anyway) or are machinery.

## The brand-entity problem

This is the actual constraint the content and schema are shaped around, and it
is worth understanding before "optimising" anything.

`besidka` is not an available brand token. It collides with:

- **`besidka.cz`** — a hotel/restaurant in Slavonice, Czechia, holding the
  exact-match ccTLD with ~15 years of TripAdvisor/Booking/Kayak corroboration.
- **`besídka`** — a Czech common noun (a children's recital; also a gazebo), plus
  a well-known Divadlo Sklep theatre revue. Also a real surname.
- **`бесідка`** — the generic Ukrainian noun for a garden gazebo. That SERP is
  Wikipedia, dictionaries, gazebo manufacturers and a village in Kyiv Oblast.

Consequences that drive real decisions:

1. **Bare `besidka` is not a target.** The site already appears on page 1 for it
   with near-zero backlinks; displacing an entrenched hotel entity is not
   achievable and not where the users are. `besidka ai` already resolves to the
   product — consolidate that, and compete on category terms.
2. **Bare `бесідка` is unwinnable and worthless** — it is a dictionary query
   with commercial furniture intent, not product intent.
3. **The gazebo metaphor is positional.** As a *tagline* ("your digital besidka
   for all AI chats") it fed gazebo topicality into the highest-visibility
   snippet field while telling a searcher nothing. As an explicit *definitional*
   statement it does the opposite — it disambiguates. So the metaphor was
   removed from `<title>`, `<h1>` and the meta description, and kept in the
   dedicated `#about-the-name` landing section, phrased to co-locate `бесідка`
   with "open-source AI chat application" in one sentence.

   That explanation used to be duplicated as an FAQ entry as well, and the FAQ
   was briefly the preferred single home for it on the theory that `FAQPage`
   markup earned something a plain section did not. It does not: Google
   restricted FAQ rich results to authoritative government and health sites in
   August 2023 (Besidka was never eligible) and **retired the feature entirely
   on 7 May 2026**. Google still parses `FAQPage` for entity understanding, but
   that parsing is not location-specific — it reads ordinary prose the same way.
   Meanwhile the structures differ: a `HomeBubble` with `heading` set emits a
   real, visible `<h2>` (the user turn's own question text, doubling as the
   anchor target), whereas an FAQ item emits only a `<summary>` inside
   `<details>` and no heading tag at all — see WHATWG issue #8864: a heading
   inside `<summary>` isn't exposed with heading role, and a closed
   `<details>` excludes its content from the accessibility tree, so per-item
   FAQ headings would be inert either way. So the section is the stronger
   placement. Do not "consolidate" it back into the FAQ.

### How the association is asserted

`app/utils/landing-jsonld.ts` emits one `application/ld+json` block containing an
`@graph` of four cross-referenced nodes — `Organization`, `WebSite`,
`SoftwareApplication`, `FAQPage`. All three entity nodes carry:

```ts
alternateName: ['Besidka AI', 'Бесідка', 'Бесідка AI']
```

That is the machine-readable half of the claim; the `#about-the-name` section is
the human-readable half. **Keep the two in sync** — a self-asserted
`alternateName` with no on-page corroboration is a weak signal on its own. Note
that since the FAQ entry was removed, no node in the `@graph` connects `бесідка`
to "open-source AI chat application" in a sentence any more; `alternateName`
carries the string bare, and that section carries the only sentence.

Nodes are linked by `@id` (`#organization`, `#website`, `#software`, `#faq`)
rather than repeated. `tests/unit/utils/landing-jsonld.spec.ts` asserts that
every `publisher`/`isPartOf` reference resolves to a node actually present in
the graph, so a rename cannot silently produce a dangling reference.

## Deliberate non-actions

Each of these was investigated and rejected. Re-litigate with new evidence, not
by assuming it was overlooked.

- **`lastmod` in the sitemap.** No page has a real modification date — legal
  pages carry an `updatedAt` date and the landing content has no reliable
  timestamp. A build-time `lastmod` restamped on every deploy is a signal
  search engines learn to distrust. Add it only when backed by real dates.
- **`/shared/*` in the sitemap.** Tempting (it is the only scalable source of
  unique content) but rejected. In August 2025 roughly 4,500 opt-in-shared
  ChatGPT conversations were indexed by Google, became a privacy incident, and
  OpenAI removed the feature entirely. The same checkbox mechanic carries the
  same risk here, with none of the domain authority that buffered ShareGPT-style
  UGC. On a three-page site, bulk thin AI-generated pages would dominate
  sitewide quality signals and fit the "scaled content abuse" profile. The
  per-share opt-in remains as a **user feature**; it is not a growth channel.
  If ever revisited: substantive-length floor, a separate `sitemap-shared.xml`
  so it can be watched and withdrawn independently, and 12+ months of accrued
  authority first.
- **`llms.txt` / `nuxt-llms`.** The module calls `addPrerenderRoutes('/llms.txt')`,
  and Nitro runs its prerender crawl during a normal server-target build — the
  handler would execute in the build environment where the `CONTENT_DB` D1
  binding does not exist. This project deliberately does not prerender. The
  payoff is also poor: Google has stated nothing reads `llms.txt`, and one study
  found ~97% are never fetched.
- **`nuxt-og-image` (dynamic OG images).** On Workers the browser renderer is
  prerender-only, leaving Satori or Takumi — multi-MB non-tree-shakeable WASM
  (~8 MB unpacked for Satori + resvg) against a Worker script-size budget. Not
  worth it for a static preview card. Static `/og-image.png` stays.
- **`nuxt-schema-org`.** Would be a migration rather than an addition: its
  `useSchemaOrg()` builds and dedupes its own `@id` graph, so running it beside
  the existing hand-rolled block would likely emit a second `Organization` node.
  The module's value is automatic graph relations across many pages; this is one
  page with four static nodes. Hand-rolled stays.
- **A `/uk` locale.** Three thin translated pages buy hreflang maintenance, a
  second Studio content surface and duplicate-content dilution — and still zero
  chance at bare `бесідка`. Build it when Ukrainian users are a real segment,
  not as an SEO play. Ukrainian-language *off-page* coverage (below) is the
  cheaper and more effective route to the same association.
- **A Wikipedia article.** Would fail notability; a deletion log is a lasting
  negative signal. Wikidata (below) has a much lower bar and is the item that
  actually feeds the Knowledge Graph.

## Off-page: where the ceiling actually is

A three-page site's ranking limit is set by links and mentions, not on-page
tuning. Everything above makes the site *ready* to receive entity status; the
items below are what earn it. These require accounts/outreach and are owner
actions, roughly in leverage order:

1. **Create a Wikidata item — but not yet.** Instance of *free software*,
   official website, GitHub repo, license, and a Ukrainian native label
   (`Бесідка`). This is the machine-readable entity anchor Google reconciles
   against, and it turns the Cyrillic alias into a third-party entity fact
   rather than a self-assertion.
   - **State (2026-10-12):** no Besidka item exists. Per
     [Wikidata:Notability](https://www.wikidata.org/wiki/Wikidata:Notability)
     the only route is criterion 2, "serious and publicly available
     references". The project's own site and repo are self-published, so an
     item created now would likely be deleted. Create it only once
     independent references exist: directory listings (item 2), the
     Ukrainian article (item 4), press.
   - **Name collisions** the description must disambiguate: Q112017868 (hotel
     in Slavonice), Q4085573 (village in Kyiv Oblast), Q961082 (gazebo).
   - **Draft statements** for then:
     - P31 Q341 (free software) and Q189210 (web application);
     - P856 `https://besidka.com`;
     - P1324 `https://github.com/besidka/besidka`;
     - P275 Q334661 (MIT License);
     - P277 Q978185 (TypeScript);
     - P400 Q6368 (web browser);
     - P571 2025-06-16 (GitHub repo creation);
     - P2037 `besidka`;
     - labels: en `Besidka`, uk `Бесідка`; alias `Besidka AI`.
     - Omit P348 (software version): there are no releases.
2. **Get listed where the category is already indexed.** Triple duty:
   backlink, entity corroboration, and presence in the corpus LLM answer
   engines cite. Positioning sentence, to reuse verbatim where length allows:
   "Open-source BYOK AI chat app. Use GPT, Claude, Gemini, Grok and more with
   your own API key. Pay the provider directly: no subscription, no markup."
   Status per target as of 2026-10-12:
   - `github.com/yatsyk/awesome-byok-apps`: PR opened 2026-10-12,
     <https://github.com/yatsyk/awesome-byok-apps/pull/25> (Chat UIs). The
     list caps descriptions under 100 chars, so the entry reads "Open-source
     chat app for GPT, Claude, Gemini and more; pay providers directly, no
     markup." The maintainer merges rarely (1 PR merged ever, ~17 open), so
     it may sit.
   - `byokhub.com`: already listed
     (<https://www.byokhub.com/products/besidka>, submitted 2026-07-26) but
     the copy is wrong: it calls Besidka a "desktop and mobile" client and
     says "no API key or subscription needed" / "usage-based app charges".
     Needs an edit while signed in as the original submitter. Corrected copy:
     tagline "Open-source BYOK AI chat app. Use GPT, Claude, Gemini, Grok and
     more with your own API key."; pricing "Free / open source (MIT), AI
     usage billed directly by the provider"; platform "Web app + PWA".
   - `byoklist.com`: already listed at
     <https://byoklist.com/tool/www.besidka.com> on the old `www` host, with
     only OpenAI/Google named. There is no edit flow and re-submission is a
     $4.99 non-refundable fee. Decision: keep as is. `www` 301s to the apex,
     so the link still counts, and the copy is incomplete rather than false.
   - AlternativeTo: not listed as far as could be checked. Needs an account
     with a verified email; descriptions cannot contain URLs. Use the
     positioning sentence and "alternative to" ChatGPT, Claude, Google Gemini,
     LibreChat, Open WebUI, TypingMind.
   - `awesome-selfhosted`: **not eligible.** awesome-selfhosted-data requires
     a first tagged release older than 4 months (Besidka has none) and
     excludes "software that depends on a specific cloud provider"
     (Workers/D1/KV/R2). Their CONTRIBUTING also bans machine/LLM-generated
     submissions, so if it ever qualifies a human writes the entry.
3. **Close the `sameAs` loop.** Once the Wikidata QID and directory profiles
   exist, add them to the `Organization` node's `sameAs`, and make every profile
   bio agree *verbatim* on the positioning sentence. Entity reconciliation is
   corroboration-counting.
4. **One Ukrainian-language article** (DOU.ua is the natural fit, then ITC.ua /
   AIN.ua). A Ukrainian document about the product will itself rank for
   `бесідка ai`, and builds the Cyrillic association in a corpus that also feeds
   LLM training data. This is the real lever for the Cyrillic goal.
5. **Bing + IndexNow.** Bing's index feeds ChatGPT browsing. IndexNow is
   implemented as a post-deploy CI step (see [IndexNow](#indexnow)); it stays
   a no-op until the owner creates the key. Import the Search Console property
   into Bing Webmaster Tools as well — IndexNow tells Bing *when* to crawl,
   Webmaster Tools is where you see what it did.

## Content roadmap

The keyword clusters with real, evidenced intent that the current copy does not
match. Not built — deliberately, because each is a page someone has to write
well; thin pages on a three-page site dilute rather than help. Cap new routes at
two or three.

- **Cost-comparison utility** — `chatgpt plus vs api cost`, `cheaper than
  chatgpt plus`, `openai api cost calculator`. Highest achievability: this
  cluster demonstrably ranks for non-authority domains because a working
  calculator is a functional-utility page, and calculators attract links. Also
  the closest match to an existing product feature (per-message cost breakdown).
- **A BYOK explainer** — **built** as `/byok`, see
  [The BYOK guide](#the-byok-guide-byok). It is the first of the two or three
  new routes the cap allows.
- **Comparison pages** (`/vs/...`) rank for this category — Open WebUI maintains
  its own `/alternatives/` page — but they multiply factual claims about named
  third parties, which is the highest-risk content type here. Only with
  sourced, dated, verifiable figures.

### The comparison table is a dated factual claim

The `comparison` block in `content/index.md` names four third-party products
and states their prices and features. Every cell was re-checked against the
vendors' own pricing pages and help-centre articles in October 2026 and
`priceDate` moved to `October 2026` (sources are listed in the PR that made the
change). Rules for the next refresh:

- Re-verify **every** competitor cell, not only the prices, and bump
  `priceDate` in the same commit. A stale date on a pricing table is a trust
  problem for readers and for anything that quotes the page.
- A claim that can only be sourced from forum posts, feedback boards or a
  founder's social posts is softened to what those sources actually show
  (e.g. T3 Chat's sharing is just "Share links"), never stated more strongly.
- Use exact list prices (`$19.99/mo`), and a range when monthly and annual
  billing differ (`$17–20/mo`), instead of a rounded "from $20" that is
  wrong in both directions.
- Besidka's own cost example (`note`) names the model and its per-token rates
  so the arithmetic can be re-checked; "a flagship model" was unfalsifiable and,
  on Opus-class pricing, wrong.

### Legal pages are no longer stubs

`/privacy-policy`, `/terms-of-use` and `/cookie-policy` were once empty `<h1>`
stubs (then at `/privacy` and `/terms`). They are now full documents in
`content/legal/` — see `docs/legal.md`. The blocker that used to sit here is
resolved.

## Homepage title and meta description (BYOK demand)

Search Console showed the homepage already on page 1 for `chatgpt byok` and
`byok chatgpt` with zero clicks, and on page 2 for `byok chat app`,
`byok chat` and `byok ai chat`. The page ranked; the snippet did not answer
the query. Before → after:

| Field | Before | After |
| --- | --- | --- |
| `<title>` | `Besidka — Open-source, self-hostable AI chat (BYOK)` | `Besidka — BYOK AI chat app for GPT, Claude and Gemini` |
| Meta description | `Besidka is an open-source, self-hostable AI chat app. Bring your own key for Anthropic, OpenAI, Google, xAI and more, or an AI gateway. No subscriptions, no markup, no lock-in.` (176 chars, truncated) | `Open-source BYOK AI chat app. Use GPT, Claude, Gemini, Grok and more with your own API key. Pay the provider directly: no subscription, no markup.` (146 chars) |
| `<h1>` | `Besidka — open-source AI chat. Your keys, your costs.` | `Besidka — open-source BYOK AI chat. Your keys, your costs.` |

Decisions:

- **Brand first, then the category phrase searchers type.** "BYOK AI chat
  app" contains `byok ai chat`, `byok chat app` and (loosely) `byok chat`;
  "GPT, Claude and Gemini" names the three model families people search for.
  The title is 53 characters, inside the ~60 that render without truncation.
- **"GPT", not "ChatGPT", in the title and description.** ChatGPT is OpenAI's
  product name and Besidka does not run it — Besidka calls OpenAI's GPT
  models through the API. Using the trademark as a headline claim would
  misdescribe the product. "ChatGPT" appears only in factual body copy, e.g.
  "an alternative to a ChatGPT Plus subscription" on `/byok` and the existing
  pricing comparison. Google still matches `chatgpt byok` to "GPT" plus
  "BYOK" plus "API key" in the snippet.
- **"Self-hostable" and "gateway" left the snippet.** Both are true and stay in
  the hero eyebrow and body, but neither answers the BYOK query, and the old
  description truncated mid-sentence. Gateways are never the default path, so
  they do not belong in the one-line pitch either.
- **No gazebo metaphor** anywhere in title, H1 or description (unchanged rule,
  see [The brand-entity problem](#the-brand-entity-problem)).
- The H1 gains "BYOK" so the visible headline and the title agree.

Options considered and not chosen:

- `Besidka — Use GPT, Claude and Gemini with your own API key` (58 chars).
  Answers the "use GPT with my own key" phrasing literally, but drops "AI
  chat app" — the category phrase for three of the five queries — and does
  not contain "BYOK" at all, which is the token in every query.
- `Besidka — BYOK AI chat: GPT, Claude, Gemini on your own key` (59 chars).
  Covers both intents but is at the truncation edge, and the colon-plus-list
  shape reads as keyword stuffing next to the brand.

Measure in Search Console: CTR on the five BYOK queries above, and whether
the page-2 queries move. Titles shown in SERPs can lag deploys by weeks.

## The BYOK guide (`/byok`)

`/byok` is a Nuxt Content page in the `guides` collection
(`content/guides/byok.md`, rendered by `app/pages/byok.vue` through
`LegalDocument.vue` in the `legal` layout). English only. It answers what BYOK
is, how to get a key and add it, how cost works (direct billing, per-message
cost breakdown, prompt caching), where keys are stored, and gateways as an
optional layer. Every product claim was checked against the code:

- Key storage: `useEncryptText()` (`server/utils/encryption.ts`) uses
  `crypto-shield` defaults — AES-256-GCM, a key derived with PBKDF2-SHA512
  (5,000 iterations) from `NUXT_ENCRYPTION_KEY`, random salt and IV per
  value. The key-status endpoints return only `hasKey`.
- Cost UI: the message menu (`app/components/Chat/ContextMenu.client.vue`)
  shows tokens, current-message cost, search cost, cost up to the message and
  chat total, with `~` marking estimates.
- Prompt caching: `docs/providers/general.md` → "Prompt caching".

Wiring:

- **Indexable and canonical by default.** It sets no robots meta (inherits
  `index, follow` from `app/app.vue`), inherits the per-route canonical, is
  not in `robots.disallow` or `sitemap.exclude`, and `@nuxtjs/sitemap` picks
  it up from `app/pages/`. `tests/unit/config/seo-pages.spec.ts` guards this.
- **Linked from the homepage body** (the BYOK summary bubble) **and the footer**
  ("Guides → BYOK guide" in `LandingFooter.vue`, on every landing-layout page).
- **JSON-LD**: a single `TechArticle` from `buildGuidePageLd()` in
  `app/utils/landing-jsonld.ts`. It references the homepage graph's
  `#website`, `#organization` and `#software` ids instead of declaring its own
  nodes, so there is still exactly one `Organization` across the site.
- `updatedAt` in the frontmatter is shown to readers and emitted as
  `dateModified` — bump it only when the substance changes.
- New explainer routes go in the same `guides` collection. The cap of two or
  three new routes stands; `/byok` is the first.

## Asset-path 404s on `www` (`/_nuxt/`, `/_scripts`)

Search Console's only "Not found (404)" URLs were
`https://www.besidka.com/_nuxt/` and `https://www.besidka.com/_scripts`.

Finding: **no change needed.** The `www` → apex rule (see
`docs/domain-migration-www-to-apex.md`) matches on `Hostname equals
www.besidka.com` and redirects to `concat("https://besidka.com",
http.request.uri.path)` with the query string preserved, so it covers every
path, these two included. The 404 is what the apex correctly returns at the
end of that redirect: `/_nuxt/` is Vite's build-asset *directory* (the hashed
files under it exist; the bare directory has no index) and `/_scripts` is the
`@nuxt/scripts` asset prefix, likewise not a page. Googlebot discovers these
prefixes from asset references in the HTML and JS and probes them; a 404 for a
non-page URL is the right answer and does not hurt the site. Search Console
reports it against the URL it started from, which is why the `www` form
appears.

Do **not** add `/_nuxt/` or `/_scripts` to `robots.disallow` to silence the
report: Google needs those assets to render the pages.

Confirmed live on 2026-10-12 with `curl -sI`:

| Request | Result |
| --- | --- |
| `https://www.besidka.com/_nuxt/` | 301 → `https://besidka.com/_nuxt/` |
| `https://www.besidka.com/_scripts` | 301 → `https://besidka.com/_scripts` |
| `https://www.besidka.com/byok?x=1` | 301 → `https://besidka.com/byok?x=1` (path and query kept) |
| `https://besidka.com/_nuxt/` | 404 |
| `https://besidka.com/_scripts` | 404 |

To re-check:

```bash
curl -sI https://www.besidka.com/_nuxt/   # expect 301 → https://besidka.com/_nuxt/
curl -sI https://www.besidka.com/_scripts # expect 301 → https://besidka.com/_scripts
curl -sI https://besidka.com/_nuxt/       # expect 404
```

## IndexNow

A post-deploy job, `indexnow` in `.github/workflows/production.yml`, runs
`scripts/indexnow-submit.mjs` after `build-production`:

1. **Gate.** No `INDEXNOW_KEY` secret → the job logs a skip and passes. Forks
   and unconfigured deploys are unaffected.
2. **Only when a public page changed.** On a push it diffs
   `github.event.before..github.sha` and submits only if `content/`, a public
   `app/pages/` file, or a landing/prose component changed. IndexNow asks
   for changed URLs only, and most deploys change no public page. A
   `workflow_dispatch` run (or an unresolvable `before` SHA) submits
   everything.
3. **Key check.** It fetches `https://besidka.com/indexnow-key.txt` and fails
   if the body is not the same key. That route
   (`server/routes/indexnow-key.txt.ts`) serves runtime config
   `indexnowKey` (`NUXT_INDEXNOW_KEY`) as `text/plain`, and 404s when it is
   unset or not a valid key (8–128 of `a-zA-Z0-9-`).
4. **Submit.** It reads the live `sitemap.xml` (following a sitemap index if
   there is one), keeps same-host URLs and POSTs them to
   `https://api.indexnow.org/indexnow` with `keyLocation` set to the key file.
   The spec allows a key file at any path on the host when `keyLocation` is
   given, which is what lets the key live in runtime config instead of a
   committed `public/<key>.txt`.
5. **Failure policy.** 400/403/422 (bad request or key) fail the job; 429 and
   5xx only warn, so an IndexNow outage never turns a good deploy red. The
   deploy itself has already finished either way.

The key is public by design: IndexNow verifies ownership by fetching it from
the site. It is stored as a secret only so it is not committed before the
owner chooses one.

Known gap: `production.yml` has `cancel-in-progress: true`, so a run cancelled
by a newer push never submits; the next run diffs from its own `before` SHA
and can miss the cancelled push's page changes. Re-run with
`workflow_dispatch` if that matters.

## Owner action checklist

None of these can be done from the repository.

- [x] **Bing Webmaster Tools.** Sign in at `bing.com/webmasters` and use
      "Import from Google Search Console" to bring over the `besidka.com`
      property and sitemap. Imported; the `besidka.com/` site is present as
      of 2026-10-12. `https://besidka.com/sitemap.xml` was submitted in Bing
      on 2026-10-12 (status Processing).
- [x] **IndexNow key.** Done 2026-10-12. Recipe, also for a future key
      rotation:
  - generate a key with `openssl rand -hex 16` (8–128 chars of
    `a-zA-Z0-9-`);
  - set it on the production Worker:
    `pnpm exec wrangler secret put NUXT_INDEXNOW_KEY --env production`
    (or as a plain `vars` entry under `env.production` in `wrangler.jsonc` —
    the value is public by design). Writing a secret creates a new Worker
    version from the already-deployed code, so no redeploy is needed;
  - check `curl https://besidka.com/indexnow-key.txt` returns exactly the key
    as `text/plain`;
  - set the same value as the GitHub Actions secret `INDEXNOW_KEY`
    (`gh secret set INDEXNOW_KEY --repo besidka/besidka`);
  - keep the same value in the gitignored local `.dev.vars`,
    `.dev.vars.preview` and `.dev.vars.production` so it is not lost (done
    2026-10-12); `.dev.vars.example` carries an empty `NUXT_INDEXNOW_KEY=`;
  - run the first submission locally, not via `workflow_dispatch` of
    `production.yml` (that redeploys and applies migrations):
    `INDEXNOW_KEY=<key> SITE_URL=https://besidka.com node scripts/indexnow-submit.mjs --all`
    printed `IndexNow accepted 5 URL(s) (HTTP 202)`. HTTP 202 means received
    with key verification pending. Later deploys that change a public page
    submit through the `indexnow` CI job.
- [ ] **Wikidata item** — deferred until independent references exist; see
      the notability note in item 1 under
      [Off-page](#off-page-where-the-ceiling-actually-is).
- [ ] **Directory listings** — per-target status is in item 2 under
      [Off-page](#off-page-where-the-ceiling-actually-is): the
      `awesome-byok-apps` PR is open, the `byokhub.com` copy fix is pending
      owner sign-in, AlternativeTo is pending, `byoklist.com` is kept as is,
      and `awesome-selfhosted` is not eligible. Link
      `https://besidka.com/byok` where a listing allows a docs/guide URL, and
      reuse the positioning sentence verbatim where length allows.
- [ ] **`sameAs`.** Once the Wikidata QID and profiles exist, add them to the
      `Organization` node in `app/utils/landing-jsonld.ts`.
- [x] **Search Console.** URL Inspection → Request Indexing done for `/` and
      `/byok` on 2026-10-12 (`/` was already indexed; `/byok` was "URL is
      unknown to Google" before the request).
      `https://besidka.com/sitemap.xml` is submitted and last read
      successfully (Sep 20, 2026, before `/byok` existed). On 2026-10-12 the
      stale `https://www.besidka.com/sitemap.xml` entry was removed and
      `https://besidka.com/sitemap.xml` resubmitted so Google re-reads it
      with `/byok`. Watching CTR on the five BYOK queries is ongoing.
- [x] **Confirm the `www` asset-path redirects.** Confirmed live on
      2026-10-12; results in
      [Asset-path 404s](#asset-path-404s-on-www-_nuxt-_scripts).

## Verification runbook

Robots rules are disabled in dev by design. To see production output locally:

```bash
curl 'http://localhost:3000/robots.txt?mockProductionEnv'
curl http://localhost:3000/sitemap.xml
```

Per-route head check (expect exactly one canonical, and `og:url` equal to it):

```bash
for p in / /byok /privacy-policy /terms-of-use /signin; do
  echo "### $p"
  curl -sS "http://localhost:3000$p" | grep -oE \
    '<title>[^<]*</title>|<link rel="canonical" href="[^"]*"|<meta property="og:url" content="[^"]*"|<meta name="robots" content="[^"]*"'
done
```

### Preview deployments are already protected

A Cloudflare Preview (`pr-<n>-besidka.chernenko.workers.dev`, or the
long-lived `preview-besidka.chernenko.workers.dev`; see
`docs/cloudflare-previews.md`) serves
`robots: index, follow` in the page **and** `x-robots-tag: noindex` as an HTTP
header (added by Cloudflare on `workers.dev` Preview URLs). The header is the more restrictive signal and wins, so previews are not
indexable — this is not a bug to fix. Previews also self-canonicalise to the
preview host rather than to production, which is harmless precisely because the
header keeps them out of the index.

Note the asymmetry when reading preview output: `robots.txt` and `sitemap.xml`
on a preview host correctly advertise the **production** `https://besidka.com`
URLs (they come from `site.url`), while the in-page canonical comes from the
runtime `baseUrl` and therefore shows the preview host. Both are expected.

### The post-deploy trap

`/` is SWR-cached in Cloudflare KV, keyed on `buildId`. After a deploy, curling
the new title or JSON-LD and seeing **old** values does not mean the deploy
failed — you may be reading a stale cached render. Compare the `buildId` inlined
in the HTML against the deployed commit SHA before concluding anything, then
re-request. An already-open browser tab will likewise keep serving old JS until
reloaded.

Separately: the title shown in live SERPs can lag the deployed title by weeks —
search engines re-crawl on their own schedule. Use Search Console's URL
Inspection → Request Indexing to prompt a re-crawl rather than assuming a bug.

## Search Console checklist

Not verifiable from this repo (it needs the owner's Google account). Worth
confirming manually:

- Property type: a **Domain** property (`besidka.com`) covers apex + `www` +
  all subdomains; a URL-prefix property covers only the exact host. If only a
  URL-prefix property for one host exists, data is partial.
- `https://besidka.com/sitemap.xml` is submitted and last read without
  errors. It should be the only sitemap listed: no `www` one.
- `www` reporting "Page with redirect" is **expected and correct** — it is
  the 301 to the apex working as designed, not an indexing failure.
- Watch the `besidka` and `besidka ai` queries specifically for impressions and
  average position, which is how the entity work above gets measured.
