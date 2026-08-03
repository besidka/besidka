# Legal pages

The Privacy Policy, Terms of Use and Cookie Policy are Nuxt Content documents in
`content/legal/`, rendered by `app/components/LegalDocument.vue` through three
thin pages under `app/pages/(legal)/`. They are Studio-editable like the landing
page.

Structural facts worth knowing before editing:

- **Three separate documents, deliberately.** Google OAuth verification requires
  a privacy policy on its own URL, and GDPR Art. 7(2) expects consent matters to
  be "clearly distinguishable" from contract terms.
- Slugs are `/privacy-policy`, `/terms-of-use`, `/cookie-policy`. The old
  `/privacy` and `/terms` were indexed, so `nuxt.config.ts` `routeRules` 301s
  them. Keep those redirects.
- **The published contact address is configuration, not content.**
  `NUXT_PUBLIC_PRIVACY_EMAIL` → `runtimeConfig.public.privacyEmail` → passed to
  `ContentRenderer` as `:data` → written `{{ privacyEmail }}` in the markdown.
  If the env var is unset the value resolves to an empty string and the address
  silently disappears from the page rather than erroring — so any verification
  must assert the address is *present*, not merely that no `{{ }}` remains.
- Frontmatter is **not** interpolated. `description` becomes a meta tag and
  `summary` renders as plain text, so `{{ privacyEmail }}` there would publish
  literally. Keep the email out of frontmatter.
- `updatedAt` is a real editorial date. Bump it when the substance changes.
- `server/api/v1/events/index.post.ts` has a `CLIENT_ALLOWED_PATHS` allowlist
  that must track these slugs, or client analytics events from a legal page 400.
- **The Turnstile Privacy Addendum link is a compliance obligation, not
  a nice-to-have.** Enabling Cloudflare Turnstile (the `captcha` plugin —
  see `docs/auth-security.md`) requires this site's Privacy Policy to
  reference Cloudflare's Turnstile Privacy Addendum
  (https://www.cloudflare.com/en-gb/turnstile-privacy-policy/). It lives
  in the "Who else receives your data" section, right after the
  recipients table. A future edit to that section must keep this link —
  removing it silently breaks the condition Cloudflare attaches to using
  Turnstile at all.

## Why no postal address is published

This is load-bearing. Do not "tidy" the identity block without reading it.

The identity block above deliberately omits a postal address. That is only
defensible while the service generates no revenue at all:

- Ustawa o świadczeniu usług drogą elektroniczną (UŚUDE) Art. 5(2) is the only
  provision that would force a natural person to publish `miejsce zamieszkania
  i adres`. It applies to a `usługodawca`, defined in Art. 2 pkt 6 as someone
  providing the service while conducting, even incidentally, `działalność
  zarobkową lub zawodową` — gainful, not merely `gospodarcza`. With structurally
  zero revenue the gain-orientation element fails, so UŚUDE Arts. 5 and 8 do not
  attach. Failing Art. 5 is fineable under Art. 23.
- GDPR Art. 13(1)(a) prescribes no form for contact details; WP29 WP260 rev.01
  lists a postal address only in an illustrative "preferably / e.g." list. A
  monitored email plus the country of establishment satisfies it, and naming the
  country is what identifies the competent authority for Art. 13(2)(d).
- DSA Arts. 11 and 12 both require reachability `by electronic means`; an email
  address satisfies both. Art. 12(2) preserves existing ECD duties, it does not
  import an address duty onto someone outside their scope.

Consequences of monetising in any form (ads, sponsorship, donations, a paid
tier, data monetisation):
1. The activity becomes `zarobkowa`, so UŚUDE Art. 5(2) attaches and a postal
   address MUST be published.
2. The operator may become a `przedsiębiorca` (KC Art. 43-1), which creates a
   `konsument` counterparty (KC Art. 22-1) and pulls in the abusive-clause
   regime (KC Art. 385-1 to 385-3) and UOKiK's jurisdiction. Directive
   2019/770's data-as-consideration route can reach the same result.
So: before adding any monetisation, revisit this file, the Privacy Policy and
the Cookie Policy.
## Status of the underlying research

The above rests on primary sources (Dz.U. 2024 poz. 1513 for UŚUDE; WP29 WP260
rev.01 for GDPR Art. 13; the verbatim text of DSA Arts. 11–12). Two honest gaps:
Polish doctrinal commentary on Art. 2 pkt 6 is paywalled and was not read, and no
case law was found in open sources on whether a free hobby site is a
`usługodawca`. The strongest part of the argument does not depend on either — UŚUDE
Art. 23 is a penal provision tried under *wykroczenia* procedure, so stretching
`zarobkowa` to reach a zero-revenue operator and fine them would be extensive
interpretation *in malam partem*.

The conclusion is also conditional on the operator having **no paid self-employed
activity**. Salaried employment does not count (the employer conducts that
activity, not the operator). Paid freelance or B2B side work would reopen it.

`.github/FUNDING.yml` was removed for this reason — it advertised Patreon, Ko-fi
and Buy Me a Coffee under the `besidka` name. Gain *orientation* is the test, not
gain received, so an open donation channel breaks the analysis even at zero
lifetime income.

## Not legal advice

These documents were drafted from a requirements analysis, not by a lawyer. The
items most worth a Polish `radca prawny`'s eye are the address conclusion above
and the Art. 9 special-category position.
