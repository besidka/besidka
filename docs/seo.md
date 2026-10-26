# SEO

How search-engine surface area is wired, the brand-entity problem the setup is
shaped around, and the decisions that were made deliberately (including the
ones that look like omissions).

Companion reading: `docs/landing-studio.md` for how the landing copy is edited,
`CLAUDE.md` → "SEO and canonical host" for the short version.

## Audience and message (2026-10-20)

The owner decided who the site is for, and the landing copy, the BYOK guide
and the README follow from it.

- **Audience.** People who use AI every day (search, translation, PDFs,
  images, code), do not want a subscription and are fine creating an API key:
  developers and IT-adjacent people. Not the mass non-technical audience.
- **Message.** Pay the provider only for what you use and see the price of
  every message; all models in one chat; no subscription, no ads, no markup;
  open source and self-hostable. The maintainer's own non-work use costs $1 to
  $5 a month. That figure is owner-supplied and may be quoted only as one
  person's usage, never as a promise or a typical bill.
- **Real price competitors** are ChatGPT Go ($8/month) and Google AI Plus
  ($4.99/month), not only the $20 plans, so both are now columns in the
  comparison table.
- **Activation is the first API key**, not sign-up (see `docs/analytics-utm.md`
  for the funnel). The easiest first key is a free Gemini key from Google AI
  Studio: no card or billing account. The CTA is therefore `Start free with a
  Gemini key`, deep-linking to `/signup?next=/profile/keys?provider=google`
  (written percent-encoded in `content/index.md`, since the inner `?` and `=`
  would otherwise be read as part of the outer query). The honest caveat ships
  with it: on Google's free tier, prompts may be used to improve Google's
  products. It appears in the FAQ (`Can I start for free?`) and in the guide.
- **Target queries**: `chatgpt byok`, `byok ai chat`, `byok chat app`,
  `chatgpt alternative without subscription`, `free gemini api key`, `how to
  get gemini api key`, `openrouter api key`. Volumes are unknown; write for the
  person searching and do not over-optimise.
- **Baseline for comparison.** Search Console, 3-month window
  2026-07-18 to 2026-10-17:

  | Query | Impressions | Avg position | Clicks |
  | --- | --- | --- | --- |
  | `chatgpt byok` | 41 | 17.3 | 0 |
  | `byok chatgpt` | 31 | 23.8 | 0 |
  | `byok chat app` | 17 | 23.8 | 1 |
  | `besidka` | 12 | 1.5 | 3 |
  | `byok chat` | 4 | 12.2 | 1 |
  | `byok ai chat` | 2 | 12.5 | 1 |

  | Page | Impressions | Clicks | Avg position |
  | --- | --- | --- | --- |
  | `/` | 475 | 26 | 9.3 |
  | `www.besidka.com/` | 135 | 9 | 8.6 |
  | `/byok` | 45 | 1 | 42.2 |

  The owner-quoted shorter window (data up to 2026-10-11) is a second
  line: `chatgpt byok`, average position 8.5, 20 impressions, 0 clicks.

  At this volume CTR comparisons are noise. Judge over at least four weeks
  and do not change the title again in the meantime.
- **Copy rules** for all landing, guide and README text: plain and specific, no
  em dashes, no marketing clichés, no invented user counts, costs or metrics.

Still deferred, unchanged by this decision:

- **No `/uk` locale.** The Ukrainian audience is a hypothesis. Revisit if
  Threads or Telegram traffic shows up as activations in the funnel.
- No `llms.txt`, no dynamic OG images, no `/shared` URLs in the sitemap (see
  [Deliberate non-actions](#deliberate-non-actions)).

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

Indexable: `/`, `/byok`, `/memory`, `/privacy-policy`, `/terms-of-use`,
`/cookie-policy`, every `/guides/<slug>` key guide, and any `/shared/<publicId>` whose share row has `indexable = true`. The old
`/privacy` and `/terms` URLs 301 to the `-policy`/`-of-use` routes
(`routeRules` in `nuxt.config.ts`).

`noindex, nofollow`: all authenticated routes (`/chats/**`, `/profile/**`),
`/signin`, `/signup`, `/reset-password`, `/new-password`, and shared chats with
`indexable = false`.

### Why most auth routes are noindex but NOT robots-disallowed

They used to be both, which is self-defeating: a `Disallow`-ed URL is never
fetched, so its `noindex` is never read — and the bare URL can still be indexed
without content if anything links to it. Crawlers reach these pages regardless:
the landing hero's primary CTA links to `/signup?next=<path>`, and `/signin` links to
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
`@graph` of four cross-referenced nodes: `Organization`, `WebSite`,
`SoftwareApplication`, `FAQPage`. The `Organization`, `WebSite` and
`SoftwareApplication` descriptions come from the `description` in
`app/app.config.ts` (passed as `entityDescription`), not from the page meta
description. All three entity nodes carry:

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

- **`lastmod` in the sitemap, except for key guides.** Most pages have no
  real modification date: the landing content has no reliable timestamp, and
  legal and explainer pages carry an `updatedAt` that is not wired into the
  sitemap. A build-time `lastmod` restamped on every deploy is a signal search
  engines learn to distrust, so those pages still emit none. Key guides are
  the one accepted exception: they are the first sitemap entries with
  `<lastmod>`, taken from `updatedAt`, which is a hand-maintained real date
  (bump it only on a substantive change, never as a deploy stamp). Add
  `lastmod` for any other page only when it is backed by a real date like
  that.
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
   Status per target as of 2026-10-13:
   - `github.com/yatsyk/awesome-byok-apps`: PR opened 2026-10-12,
     <https://github.com/yatsyk/awesome-byok-apps/pull/25> (Chat UIs). The
     list caps descriptions under 100 chars, so the entry reads "Open-source
     chat app for GPT, Claude, Gemini and more; pay providers directly, no
     markup." The maintainer merges rarely (1 PR merged ever, ~17 open), so
     it may sit.
   - `byokhub.com`: listed
     (<https://www.byokhub.com/products/besidka>, submitted 2026-07-26); the
     wrong copy ("desktop and mobile" client, "no API key or subscription
     needed", "usage-based app charges") was fixed on 2026-10-13 from the
     original submitter's account. A listing only shows under "My
     submissions" for the sign-in that created it: a different provider sees
     an empty list, which looks like the listing is not yours. Now set:
     website `https://besidka.com` (was `www`); tagline = the first two
     sentences of the positioning sentence; the full description; pricing
     model "Free with your key"; free tier; starting price "Free"; "No extra
     app-side metered charges"; setup "Beginner-friendly"; a "Best for" line;
     thumbnail on the apex host. The site's feedback widget returned "Failed
     to send feedback email" on every try that day, so edit through My
     submissions → Edit, not feedback.
   - `byoklist.com`: already listed at
     <https://byoklist.com/tool/www.besidka.com> on the old `www` host, with
     only OpenAI/Google named. There is no edit flow and re-submission is a
     $4.99 non-refundable fee. Decision: keep as is. `www` 301s to the apex,
     so the link still counts, and the copy is incomplete rather than false.
   - AlternativeTo: submitted 2026-10-13,
     <https://alternativeto.net/software/besidka/about/>, in the free review
     queue (priority review $5 and human content review $15 not bought; the
     owner's call). Listing: Free, Open Source (MIT), source
     `https://github.com/besidka/besidka`, platforms Online + Self-Hosted
     (self-hosting requires a Cloudflare account: Workers, D1, KV, R2),
     author "Serhii Chernenko" (existing author entry, website
     chernenko.digital, country Ukraine), tags `ai-enabled-chatbots`,
     `ai-chat`, `byok`, `self-hosted` (category AI Tools & Services).
     Features are limited to verifiable ones: AI-Powered, syntax
     highlighting, text-to-image, ad-free, dark mode, no coding required,
     cloud sync, Markdown; deliberately not "no tracking", "privacy focused"
     or "no registration". Nine alternatives: LibreChat, ChatGPT, Open WebUI,
     AnythingLLM, Typing Mind, Cherry Studio, Chatbox AI, Poe, DeepSeek. Two
     real UI screenshots (desktop and narrow window). Descriptions cannot
     contain URLs. The owner's AlternativeTo profile is filled (name, bio
     with the positioning sentence, X `besidka_ai`, GitHub
     `serhii-chernenko`).
   - `awesome-selfhosted`: **not eligible.** awesome-selfhosted-data requires
     a first tagged release older than 4 months (Besidka has none) and
     excludes "software that depends on a specific cloud provider"
     (Workers/D1/KV/R2). Their CONTRIBUTING also bans machine/LLM-generated
     submissions, so if it ever qualifies a human writes the entry.
   - Screenshots: `public/preview-*.svg` are illustrative mockups (they
     still show "Gemini 2.5 Pro"), not screenshots; do not submit them to
     directories as screenshots. The real UI screenshots used for both
     listings live on byokhub's blob storage; keeping real screenshots in
     the repo would avoid that dependency.
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
two or three, with one exception: the owner lifted the cap on 2026-10-20 for
public key guides (see [Public key guides](#public-key-guides)).

- **Cost-comparison utility** — `chatgpt plus vs api cost`, `cheaper than
  chatgpt plus`, `openai api cost calculator`. Highest achievability: this
  cluster demonstrably ranks for non-authority domains because a working
  calculator is a functional-utility page, and calculators attract links. Also
  the closest match to an existing product feature (per-message cost breakdown).
- **A BYOK explainer** — **built** as `/byok`, see
  [The BYOK guide](#the-byok-guide-byok). It is the first of the two or three
  new routes the cap allows. Key guides are counted separately.
- **A memory explainer** — **built** as `/memory`, see
  [The memory explainer](#the-memory-explainer-memory). It is the second of
  the two or three, so one slot is left.
- **Comparison pages** (`/vs/...`) rank for this category — Open WebUI maintains
  its own `/alternatives/` page — but they multiply factual claims about named
  third parties, which is the highest-risk content type here. Only with
  sourced, dated, verifiable figures.

### The comparison table is a dated factual claim

The `comparison` block in `content/index.md` names six third-party plans
(ChatGPT Go, ChatGPT Plus, Google AI Plus, Google AI Pro, Claude Pro, T3 Chat)
and states their prices and features. Every cell was re-checked against the
vendors' own pricing pages and help-centre articles on 2026-10-20 and
`priceDate` is the ISO date `2026-10-20`, rendered as "Prices checked 20
October 2026". Changes in that pass:

- **Sources are rendered.** The optional `comparison.sources` list
  (`label` and `url`) shows as a "Sources" line of links under the note, in
  `app/components/content/HomeComparison.vue`. Add a source whenever a new
  cell depends on a page.
- **T3 Chat was restored on 2026-10-21** at the owner's request, and its
  cells were then checked signed in on the same day. Its public pricing page
  returns 404 and plans show only after sign-in. Signed in, the plans are Free,
  Pro and Premier, and the paid prices read "Price shown at checkout", so the
  price cell says `Shown at checkout` instead of a figure. Pro includes image
  generation, web search and file uploads, so image generation says `Paid
  plans`. The API Keys settings say "Bring your own API keys for select
  models" and mark it a "Paid Feature", so bring-your-own-keys first said `Paid
  plans, select models`. Settings → Models then marks exactly four models
  BYOK instead of a price tier (Claude 4.1 Opus, GPT 5.2 Pro, GPT 5.5 Pro and
  o3 Pro), so the bring-your-own-keys cell names them; this restores the
  pre-#426 claim that T3 BYOK covers only expensive models, now with a source
  (`T3 Chat models (signed in)`). Re-check that list when re-checking the
  column. These three cells come from an account view, not a public page,
  and `priceDate` was not bumped for them: it still covers the
  other columns, which were not re-checked on 2026-10-21. The other cells that
  could be verified cite the T3 FAQ, the T3 terms and Theo's 2025 post on keys
  and images; everything else says `Not listed by T3`, per the table's rule for
  unverifiable cells. Re-check the column, and replace the price cell, when T3
  publishes a public pricing page.
- **The `Message caps from the app` row was removed.** ChatGPT Free text chats
  have been unlimited, subject to abuse-prevention safeguards, since mid-August
  2026, so "usage limits apply" no longer held for every plan, and no plan
  publishes a comparable number. The real differences are files, images and
  which model you get, and those are covered in the `#subscriptions` copy.
- **Cells that could not be verified say `Not listed`**, not a guess. On
  2026-10-20 that is deep research on ChatGPT Go. Shared links on ChatGPT Go and
  Google AI Plus are marked the same as Plus and AI Pro because the vendors'
  sharing help pages describe the feature without any plan restriction.

Rules for the next refresh:

- Re-verify **every** competitor cell, not only the prices, and bump
  `priceDate` in the same commit. A stale date on a pricing table is a trust
  problem for readers and for anything that quotes the page.
- A claim that can only be sourced from forum posts, feedback boards or a
  founder's social posts is softened to what those sources actually show, or
  the column is dropped, never stated more strongly.
- Use exact list prices (`$19.99/mo`), and a range when monthly and annual
  billing differ (`$17–20/mo`), instead of a rounded "from $20" that is
  wrong in both directions. Prices are US list prices.
- Besidka's own cost example (`note`) names the model and its per-token rates
  so the arithmetic can be re-checked against `providers/data`; "a flagship
  model" was unfalsifiable and, on Opus-class pricing, wrong.

### Public key guides

Pages at `/guides/<slug>` (for example `/guides/gemini-api-key`), one per
provider, each answering a distinct query (for example `how to get gemini api
key`, `openrouter api key`). They are a separate content type from the
explainers above:

- Collection `keyGuides` in `content.config.ts`, files in
  `content/key-guides/*.md`, route `app/pages/guides/[slug].vue`. The
  collection sets `source.prefix: '/guides'`, so the content path IS the public
  URL `/guides/<slug>`. No `/key-guides` URL ever exists; that name is only the
  folder on disk.
- A missing slug is a 404, and so are `/guides/byok` and `/guides/memory`:
  those files belong to the `guides` collection and are not key guides. `/byok`
  and `/memory` stay the canonical URLs of the explainers.
- `TechArticle` JSON-LD always; `VideoObject` only when a guide has a video.
- **`VideoObject` datetime rule.** Google rejects a date-only `uploadDate`
  ("missing a timezone", "invalid datetime"). `toIsoDateTimeWithOffset()` in
  `shared/utils/iso-datetime.ts` turns the frontmatter `video.uploadDate`
  `YYYY-MM-DD` into `YYYY-MM-DDT00:00:00+00:00` and passes through a full
  datetime that already has `Z` or `±hh:mm`. The schema in
  `shared/utils/key-guide-schema.ts` accepts only those two shapes (it calls
  the same function), so content files can keep the short date. A value the
  helper rejects omits the whole `VideoObject` rather than emitting an
  invalid one. `dateModified` on the `TechArticle` is not covered: it is
  not part of the video report and the date-only form is accepted there.
- **`Clip` url / `?t=` contract.** Every `Clip` in `VideoObject.hasPart`
  needs a `url` (Search Console: `Missing field "url" (in "hasPart")`). It is
  the canonical page URL plus `?t=<startOffset seconds>`, for example
  `https://besidka.com/guides/gemini-api-key?t=7`, built in
  `buildClipsLd()` from the same `buildCanonicalUrl(siteOrigin, route.path)`
  the page uses for `url`, with any other query or hash dropped. The page
  honors it: `app/pages/guides/[slug].vue` reads `route.query.t`, accepts
  only one plain non-negative integer below the video duration
  (`parseVideoStartOffset()` in `shared/utils/video.ts`; `0` is valid, a
  repeated, negative, decimal or too-large value is ignored), passes it to
  `LandingVideoPlayer` as `startAt` and scrolls the video block into view on
  mount. The player seeks once, when the native `<video>` reports a known
  duration (`loadedmetadata`, or the player's `ready` if metadata arrived
  first), and never calls `play()`, so there is no autoplay.
  `?t=` URLs are not separate pages: `app.vue` derives canonical and
  `og:url` from `route.path` and `buildCanonicalUrl()` strips the query, and
  the sitemap comes from the `keyGuides` collection, so no `?t=` URL is
  listed. The home video has no `VideoObject` or `Clip` markup, so none of
  this applies to it.
- **Sitemap.** The collection schema includes `sitemap: defineSitemapSchema()`
  (from `@nuxtjs/sitemap/content`), so entries come from the collection with
  no rewrite. `asSitemapCollection` is deprecated since `@nuxtjs/sitemap` 9.1
  and is not used. `<lastmod>` comes from `updatedAt` (see
  [Deliberate non-actions](#deliberate-non-actions)).
- **Footer.** `LandingFooter.vue` generates the key-guide links from the
  `keyGuides` collection, so a new guide appears there without a code change.
  The home page links `/guides/gemini-api-key` from the hero (a "How to get
  the key" text link, the optional `hero.guideLink` frontmatter field), the
  "Can I start for free?" FAQ answer and the subscriptions answer, and `/byok`
  links it from its free Gemini key section. `buildFaqPageLd()` strips
  markdown links so the FAQPage JSON-LD answer text stays plain.
- **Gateway guides.** A guide's `provider` may be a gateway id (for example
  `openrouter`). The "Add your key" deep link then opens the Gateways tab and
  that gateway's card; see [Sign-up redirect (`next`)](#sign-up-redirect-next).
- The owner lifted the two-or-three-route cap for these on 2026-10-20: one
  templated page type, each page a distinct query. The condition is that every
  guide carries `checkedAt` and sources, so a guide whose provider UI has
  changed is visibly dated rather than silently wrong.
- **Per-guide FAQ.** The optional `faq` frontmatter field renders
  `LandingFaqAccordion` on the guide page only, with a slug-scoped
  `group-name` (`key-guide-faq-<slug>`). The accordion builds its cache key as
  `${groupName}-${index}`, so two pages never share a `useAsyncData` key. No
  `FAQPage` JSON-LD is emitted, because FAQ rich results were retired on
  2026-05-07 (see above).
- **Gemini guide title change, 2026-10-24.** The title changed from
  `How to get a Google AI Studio (Gemini) API key` to `How to get a free
  Gemini API key in Google AI Studio`, and a description and FAQ were added.
  Search Console showed about 4.3K impressions for `gemini api key`, almost
  all as AI Overview citations (Generative AI features report), with 0
  clicks. Judge the effect over at least four weeks and do not change the
  title again in the meantime.
- **Status:** live guides are `content/key-guides/gemini-api-key.md` and
  `openrouter-api-key.md`. The same files feed the "How to get a key" guide on
  each `/profile/keys` card; schema, video and keys-page behavior are in
  `docs/key-guides.md`.

### Sign-up redirect (`next`)

The key guides and the landing CTA send visitors to `/signup?next=<path>` (and
`/signin?next=<path>`), so the first screen after authentication is the place
to add an API key rather than an empty chat. `shared/utils/auth-redirect.ts`
owns the rule:

- `resolveSafeNextPath` is an open-redirect guard. It accepts only same-origin
  relative paths whose pathname is allowlisted: `/profile/keys` and
  `/chats/new`. On `/profile/keys` it keeps only `provider` (a direct provider,
  an enabled gateway or a search provider id from `provider-meta`) and `tab`
  (`providers`, `search`, `gateways`); every other query key is dropped, as are
  the hash and anything on `/chats/new`. Anything else resolves to `null` and
  the normal default applies.
- `next` is threaded through the email verification callback, OAuth, passkey
  and 2FA sign-in, and the guest middleware (`app/middleware/00.auth.global.ts`),
  and the sign-in and sign-up pages link to each other with it preserved.
- The same middleware sends a signed-out visitor on a user-only page to
  `/signin?next=<that page>` when `resolveSafeNextPath` accepts it and it is
  not the default `/chats/new`, so an opened `/profile/keys?provider=google`
  link survives sign-in. Other protected pages go to bare `/signin`.
- On `/profile/keys`, `provider` forces the matching tab and opens that card,
  then scrolls it into view.
- UTM keys stay top-level on the sign-up URL and are never nested in `next`
  (see `docs/analytics-utm.md`).

### Legal pages are no longer stubs

`/privacy-policy`, `/terms-of-use` and `/cookie-policy` were once empty `<h1>`
stubs (then at `/privacy` and `/terms`). They are now full documents in
`content/legal/` — see `docs/legal.md`. The blocker that used to sit here is
resolved.

## Homepage title and meta description (BYOK demand)

This section records two decisions: the 2026-10-11 pass (columns "Before" and
"After") and the 2026-10-20 revision described under it, which is the
current state.

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

### 2026-10-20: final title, H1 and entity description

| Field | Current value |
| --- | --- |
| `<title>` | `Besidka: BYOK AI chat app for GPT, Claude and Gemini` (52 chars; the frontmatter `title` is the 43 chars after `Besidka: `) |
| Meta description | `Open-source BYOK AI chat app. Use GPT, Claude and Gemini with your own API key, see the price of every message, no subscription. Start free with Gemini.` (152 chars) |
| `<h1>` | `Besidka: BYOK AI chat. Pay only for the AI you use` (50 chars) |
| Hero eyebrow | `OPEN SOURCE · SELF-HOSTABLE · NO SUBSCRIPTION` |
| Entity description | `app/app.config.ts` `description`, used by the JSON-LD (see below) |

- **Title: the live title with its em dash changed to a colon, nothing else.** The page
  already ranks (see the baseline above), so the title takes the minimum
  change. The join is `Besidka: `, not an em dash: `app/pages/index.vue`
  joins the site name to the content `title` with a colon and a space, so the
  frontmatter `title` is the part after the brand. Do not put the brand in
  the frontmatter.
- **Decision: "GPT", not "ChatGPT", in the title and description.**
  Evidence:
  - [OpenAI brand guidelines](https://openai.com/brand/): for API developers,
    names and taglines should be free of OpenAI product names. Besidka calls
    GPT models through the API and does not run ChatGPT.
  - Google rewrites titles it judges inaccurate
    ([title links](https://developers.google.com/search/blog/2021/09/more-info-about-titles)),
    and a title that names a product the page does not offer is that risk.
  - Search Console shows the page already earns `chatgpt byok` and
    `byok chatgpt` impressions with the GPT title (41 and 31 in the
    3-month window), so the query is matched without the trademark.
  - "ChatGPT" stays in nominative body copy: the FAQ, the comparison table
    and the `#subscriptions` heading.
- **This reverses the brief that asked for ChatGPT in the title.** To
  override it, change `title` in `content/index.md` only. Nothing else
  depends on the wording, but the regression guard in
  `tests/unit/config/seo-pages.spec.ts` expects the title to start with
  `BYOK AI chat app`.
- **H1: brand and BYOK adjacent (owner rule).** `Besidka: BYOK AI chat. Pay
  only for the AI you use` keeps "Besidka" next to "BYOK" for the
  brand-entity association (see [The brand-entity
  problem](#the-brand-entity-problem)), as the title does. Its first 21
  characters, `Besidka: BYOK AI chat`, are also the start of the title, and
  title and H1 agreement lowers rewrite rates
  ([Zyppy title rewrite study](https://zyppy.com/seo/google-title-rewrite-study/)).
  It fits on 3 lines at 390px. "Open source" moved out of the H1 into the
  eyebrow, which no longer repeats BYOK.
- **Entity description decoupled from the meta description.** The
  `Organization`, `WebSite` and `SoftwareApplication` nodes used to reuse the
  page meta description, so a call to action (`Start free with Gemini`) ended
  up as the entity description. `buildLandingGraphLd` now takes
  `entityDescription`, which `app/pages/index.vue` fills from
  `useAppConfig().description`. Google's [structured data
  policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
  ask for markup that describes the entity, and an Organization description
  should describe the organization. `app/app.vue` also uses the same app
  config value as the global fallback meta description, which is intended.
- **`SoftwareApplication` links the repository through `sameAs`.** It used to
  carry `codeRepository`, which the schema.org validator flagged because that
  property does not belong to `SoftwareApplication`. A unit test asserts
  `sameAs` is set and `codeRepository` is absent.
- **The hero primary CTA links to `/signup?next=...`**, not bare `/signup`
  (see [Sign-up redirect](#sign-up-redirect-next)).
- **No gazebo metaphor** in title, H1 or description (unchanged rule).

Edge cases to expect:

- Google may hide the repeated "Besidka" from the visible title link, because
  it shows the site name separately above the result. The adjacency of
  "Besidka" and "BYOK" then remains in the HTML `<title>`, `og:title` and H1,
  which is where the association is asserted, but not in the snippet.
- Search Console reports `www.besidka.com/_scripts` and `/_nuxt/` as 404. Those
  are the known asset-path 404s covered in [Asset-path 404s on
  `www`](#asset-path-404s-on-www-_nuxt-_scripts); no action.
- "Page with redirect" for `www` URLs is the intentional www to apex 301.
- Titles shown in results can lag a deploy by weeks. Compare against the
  baseline in [Audience and message](#audience-and-message-2026-10-20) after at
  least four weeks.

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
  three new routes stands; `/byok` is the first and `/memory` the second.

## The memory explainer (`/memory`)

`/memory` is the second page in the `guides` collection
(`content/guides/memory.md`, rendered by `app/pages/memory.vue` through
`LegalDocument.vue` in the `legal` layout). English only. It explains what
memory holds, how to see, edit, export and delete it, profile versus project
memory, project knowledge, chat search, the per-chat exclusion, what runs on
the user's key, what is never stored, what the optional TypeSafe AI checks
(memory and the per-role smart checks) send and where, and what the user agrees to. Every product claim was
checked against `docs/memory-architecture.md` (3.1 to 3.19),
`docs/project-knowledge-design.md`, `content/legal/privacy-policy.md` and the
UI strings in `app/components/Profile/Memory/**`,
`app/components/Projects/MemoryCard.vue`, the chat menu and the consent modal.
Re-check the copy against those when any of them changes, and bump
`updatedAt`.

Wiring, the same as `/byok`:

- **Indexable and canonical by default.** No robots meta, no per-page
  `canonical` or `ogUrl` (the global rule in `app/app.vue` derives it), not in
  `robots.disallow` or `sitemap.exclude`, and `@nuxtjs/sitemap` picks it up
  from `app/pages/`. `tests/unit/config/seo-pages.spec.ts` guards this.
- **Linked from** the footer ("Guides → Memory guide" in `LandingFooter.vue`),
  the home page FAQ ("Does Besidka remember things about me?"), and
  `/profile/memory` ("How memory works" under the page heading).
- **FAQ as headings, no FAQPage JSON-LD.** The questions are `##` headings in
  the body (twelve today, the spec allows 8 to 12). FAQ rich results were
  retired by Google on 2026-05-07, and a real heading section beats an
  accordion for the page itself. The page emits `TechArticle` only, through
  `buildKeyGuidePageLd()` (the same builder as the key guides; without a video
  it emits the article alone). The landing FAQPage in
  `app/utils/landing-jsonld.ts` is unchanged.
- **Optional video slot.** The `guides` collection accepts the same `video`
  object as key guides (`guideVideoSchema` in
  `shared/utils/key-guide-schema.ts`). `LegalDocument.vue` has a `media` slot
  between the summary and the body, and `memory.vue` fills it with the lean
  `GuideVideo.client.vue` player (`explainer="memory"`) when `video` is set.
  The video went live on 2026-10-26: `memory.mp4` (720), `memory-1080.mp4`
  and `memory-360.mp4` in `CMS_BUCKET` (uploaded with
  `pnpm run cms:files:upload`; its pattern accepts `memory` and the two
  suffixes, and `server/routes/videos/[name].ts` allow-lists the three names),
  the poster at `public/memory/poster.webp` (the composed title slide, the same
  image as frame 0, see "First frame" in `docs/key-guides.md`), and a `video`
  block in `content/guides/memory.md` with 11 chapter markers. These URLs were
  never replaced, so they carry no `?v` query; a later replacement follows
  "Replacing a video or poster" in `docs/key-guides.md`.

  The `Clip` URLs the builder emits for the markers (`/memory?t=<seconds>`)
  seek: `memory.vue` reads `route.query.t` with the same
  `parseVideoStartOffset()` as `app/pages/guides/[slug].vue`, scrolls the video
  block into view on mount and passes the offset to `GuideVideo.client.vue` as
  `startAt`. With `startAt` set the lean player preloads metadata (otherwise it
  stays `preload="none"`) and seeks once when the duration is known
  (`loadedmetadata`, or the player's `ready` if metadata arrived first). A
  quality switch before that lands on `startAt`, not on 0. It never calls
  `play()` for the offset; its usual muted autoplay rules still apply.
- **Analytics.** The video does not use the key-guide or demo events: it sends
  `guide_video_play` and `video_watch` with `target: 'memory'` (see
  `docs/analytics-utm.md`), and `/memory` is its own `memory` surface. Without
  that surface the events endpoint answers 400 to every event sent from the
  page, including footer clicks.

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
`scripts/indexnow-submit.mjs` after the `deploy` job:

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

Known gap: `production.yml` queues instead of cancelling, but a pending run
that a newer push replaces never starts, so it never submits; the next run
diffs from its own `before` SHA and can miss the replaced push's page changes.
Re-run with `workflow_dispatch` if that matters.

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
      `byokhub.com` copy is fixed, AlternativeTo is submitted (awaiting
      review), the `awesome-byok-apps` PR (#25) is open and unmerged,
      `byoklist.com` is kept as is, and `awesome-selfhosted` is not
      eligible. Link `https://besidka.com/byok` where a listing allows a
      docs/guide URL, and reuse the positioning sentence verbatim where
      length allows.
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
for p in / /byok /memory /privacy-policy /terms-of-use /signin; do
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
