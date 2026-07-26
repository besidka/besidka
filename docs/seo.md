# SEO

How search-engine surface area is wired, the brand-entity problem the setup is
shaped around, and the decisions that were made deliberately (including the
ones that look like omissions).

Companion reading: `docs/landing-studio.md` for how the landing copy is edited,
`CLAUDE.md` → "SEO and canonical host" for the short version.

## Canonical host

Canonical host is `www.besidka.com`. A Cloudflare redirect rule 301s the apex
(`besidka.com`) to `https://www.besidka.com/`, so every crawler-facing URL must
use `www` to match the post-redirect host — advertising apex URLs would publish
links that immediately redirect and split the signal.

`site.url` in `nuxt.config.ts` defaults to `https://www.besidka.com` and is
overridden at runtime by `NUXT_PUBLIC_BASE_URL`. **That variable must be set to
`https://www.besidka.com` in the production Worker env**, or sitemap, robots and
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
  `https://www.besidka.com/` — byte-identical to the `<loc>` that
  `@nuxtjs/sitemap` emits. The two used to disagree (canonical had no slash),
  which is exactly the signal split canonicalisation exists to prevent.

Schema URLs go through `buildLandingLdIds()` in `app/utils/landing-jsonld.ts`,
which applies the same normalisation, so JSON-LD `url`/`@id` values match the
canonical too.

## Indexable surface

Indexable: `/`, `/privacy`, `/terms`, and any `/shared/<publicId>` whose share
row has `indexable = true`.

`noindex, nofollow`: all authenticated routes (`/chats/**`, `/profile/**`),
`/signin`, `/signup`, `/reset-password`, `/new-password`, and shared chats with
`indexable = false`.

### Why the auth routes are noindex but NOT robots-disallowed

They used to be both, which is self-defeating: a `Disallow`-ed URL is never
fetched, so its `noindex` is never read — and the URL can still be indexed
without content if anything links to it. The landing hero's primary CTA links
straight to `/signup`, so crawlers discover it regardless.

The fix is to allow the crawl and let the `noindex` do the work. Each auth page
sets `robots: 'noindex, nofollow'` via `useSeoMeta`. **If you re-add these paths
to `robots.disallow` in `nuxt.config.ts`, you silently re-break this.**

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
   removed from `<title>`, `<h1>` and the meta description, and kept in the FAQ
   entry "What does Besidka mean?", phrased to co-locate `бесідка` with
   "open-source AI chat application" in one sentence.

### How the association is asserted

`app/utils/landing-jsonld.ts` emits one `application/ld+json` block containing an
`@graph` of four cross-referenced nodes — `Organization`, `WebSite`,
`SoftwareApplication`, `FAQPage`. All three entity nodes carry:

```ts
alternateName: ['Besidka AI', 'Бесідка', 'Бесідка AI']
```

That is the machine-readable half of the claim; the FAQ entry is the
human-readable half. **Keep the two in sync** — a self-asserted `alternateName`
with no on-page corroboration is a weak signal on its own.

Nodes are linked by `@id` (`#organization`, `#website`, `#software`, `#faq`)
rather than repeated. `tests/unit/utils/landing-jsonld.spec.ts` asserts that
every `publisher`/`isPartOf` reference resolves to a node actually present in
the graph, so a rename cannot silently produce a dangling reference.

## Deliberate non-actions

Each of these was investigated and rejected. Re-litigate with new evidence, not
by assuming it was overlooked.

- **`lastmod` in the sitemap.** No page has a real modification date — neither
  legal page carries a "last updated" date, and the landing content has no
  reliable timestamp. A build-time `lastmod` restamped on every deploy is a
  signal search engines learn to distrust. Add it only when backed by real dates.
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

1. **Create a Wikidata item.** Instance of *free software*, official website,
   GitHub repo, license, and a Ukrainian native label (`Бесідка`). This is the
   machine-readable entity anchor Google reconciles against, and it turns the
   Cyrillic alias into a third-party entity fact rather than a self-assertion.
2. **Get listed where the category is already indexed.** Besidka is absent from
   all three properties that currently rank for BYOK queries:
   `github.com/yatsyk/awesome-byok-apps`, `byokhub.com`, `byoklist.com`. Also
   AlternativeTo and a PR to `awesome-selfhosted`. Triple duty: backlink, entity
   corroboration, and presence in the corpus LLM answer engines cite.
3. **Close the `sameAs` loop.** Once the Wikidata QID and directory profiles
   exist, add them to the `Organization` node's `sameAs`, and make every profile
   bio agree *verbatim* on the positioning sentence. Entity reconciliation is
   corroboration-counting.
4. **One Ukrainian-language article** (DOU.ua is the natural fit, then ITC.ua /
   AIN.ua). A Ukrainian document about the product will itself rank for
   `бесідка ai`, and builds the Cyrillic association in a corpus that also feeds
   LLM training data. This is the real lever for the Cyrillic goal.
5. **Bing + IndexNow.** Bing's index feeds ChatGPT browsing. IndexNow is a
   single `POST https://api.indexnow.org/indexnow`; the right home is a
   post-deploy CI step gated on an `INDEXNOW_KEY` secret, not a Nuxt module.
   Not implemented — it needs a key the owner generates.

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
- **A BYOK explainer** — `byok ai chat`, `bring your own api key chat app`. The
  only competitor page confirmed to surface in a real BYOK SERP is a *docs*
  page (`chatboxai.app/en/guide/byok`), not a homepage. Natural landing target
  once the directory listings above exist.
- **Comparison pages** (`/vs/...`) rank for this category — Open WebUI maintains
  its own `/alternatives/` page — but they multiply factual claims about named
  third parties, which is the highest-risk content type here. Only with
  sourced, dated, verifiable figures.

Two known accuracy debts in `content/index.md` that matter for trust and should
be fixed by someone who can verify current vendor pricing: `priceDate` is stale,
and the comparison table contains at least one unverified competitor claim.

### Blocker: `/privacy` and `/terms` are empty stubs

Both pages are literally a single `<h1>` and nothing else — measured at 18 and 20
characters of body text respectively. **They are two of the three indexable URLs
on the site.**

They were deliberately left indexable rather than switched to `noindex`, because
a reachable privacy policy is required by Google OAuth verification and by the
cookie-consent flow, and hiding them from search does not make them less empty.
Their meta descriptions are written to describe the content those pages *will*
carry, so they become accurate as soon as the pages are filled in.

Until then this is the single largest content problem on the site: an empty page
ranking for a brand query looks broken, and two of three indexable URLs carrying
no content is a poor sitewide quality signal. Writing them is an owner action —
it is legal copy, not something to generate.

## Verification runbook

Robots rules are disabled in dev by design. To see production output locally:

```bash
curl 'http://localhost:3000/robots.txt?mockProductionEnv'
curl http://localhost:3000/sitemap.xml
```

Per-route head check (expect exactly one canonical, and `og:url` equal to it):

```bash
for p in / /privacy /terms /signin; do
  echo "### $p"
  curl -sS "http://localhost:3000$p" | grep -oE \
    '<title>[^<]*</title>|<link rel="canonical" href="[^"]*"|<meta property="og:url" content="[^"]*"|<meta name="robots" content="[^"]*"'
done
```

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
- `https://www.besidka.com/sitemap.xml` is submitted and last read without
  errors.
- The apex reporting "Page with redirect" is **expected and correct** — it is
  the 301 to `www` working as designed, not an indexing failure.
- Watch the `besidka` and `besidka ai` queries specifically for impressions and
  average position, which is how the entity work above gets measured.
