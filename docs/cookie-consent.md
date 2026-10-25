# Cookie Consent — Integration Guide

This document explains how to use the headless `cookie-consent` module from
within the Besidka app: reading consent state, subscribing to changes,
server-side gating, SSR/edge-cache constraints, and extending the manifest.

## Overview

The module is auto-discovered (no entry in `modules` array required). It ships
composables and headless primitives. The styled layer lives in
`app/components/Cookies/Banner.client.vue` and is mounted once in `app/app.vue`
via `<LazyCookiesBanner />`.

---

## Legal requirements (EU / Poland)

This section is an engineering summary of primary sources, not legal advice.
Research date: 2026-10-09. Citations give article and paragraph numbers so you
can check each claim against the source. Items marked **[secondary]** come from
reporting or commentary, not from the primary text. Items marked
**[paraphrase]** are a paraphrase of a court ruling that was not re-read in the
original. Re-check both kinds before relying on them for a legal decision.

Use this section when you change the consent UI. It records what the law
requires, what it forbids, and where the room to manoeuvre is.

### Legal frame

**ePrivacy Directive 2002/58, Art. 5(3)** (as amended by 2009/136). Storing
information on a terminal, or accessing information already stored there,
needs the user's consent. Two exceptions apply: storage or access for the sole
purpose of transmission, and storage or access that is strictly necessary for a
service the user explicitly requested.

- The rule covers **any** information, not only personal data: CJEU Planet49
  C-673/17 ¶¶61-65 [paraphrase]; EDPB Guidelines 2/2023 ¶¶9-12.
- `localStorage` and `sessionStorage` count the same as cookies (EDPB 2/2023
  ¶¶37-38; WP29 WP194 §1).
- Purely browser-local processing that never leaves the device is outside
  Art. 5(3) (EDPB 2/2023 ¶44). Reading that data or transmitting it brings it
  back inside.

**Consent standard.** The standard is GDPR Art. 4(11): freely given, specific,
informed, unambiguous, expressed by a clear affirmative act. GDPR Art. 7 adds
the conditions: 7(1) the controller must demonstrate consent, 7(3) withdrawal
must be as easy as giving consent, 7(4) conditionality is taken into account.
This standard applies to Art. 5(3) consent (EDPB Cookie Banner Taskforce
report, Jan 2023, ¶33; EDPB Guidelines 05/2020 fn 27).

**Which law applies to what.**

- Placing or reading the cookie falls under national ePrivacy law. Later
  processing falls under the GDPR (Taskforce ¶¶1-2).
- The GDPR one-stop-shop does not apply to ePrivacy (Taskforce ¶4). Each
  national authority applies its own rules. The Taskforce positions are a
  minimum, not a safe harbour.

**Poland.** The Prawo komunikacji elektronicznej (PKE, Dz.U. 2024 poz. 1221)
has been in force since 10 Nov 2024 [secondary for the date].

- **Art. 399** implements Art. 5(3). Ust. 1 requires prior clear information
  plus consent. Ust. 3 pkt 2 is the "konieczne" exemption for a service the
  user requested. The Polish text omits "strictly"; read it in line with the
  Directive.
- **Art. 399 ust. 2** allows consent through software or browser settings. This
  is a Polish carry-over that is in tension with Planet49's active-behaviour
  requirement. CNIL ld ¶¶43-45 says browser settings did not meet the standard
  in France.
- **Art. 400**: consent follows the data-protection rules "odpowiednio".
- **Enforcer for cookies: Prezes UKE** (Art. 444 ust. 1 pkt 82, Art. 446
  ust. 1, up to 3% of prior-year revenue). Art. 446 ust. 3 caps the fine at
  15,000 zł when revenue is nil or at most 500,000 zł. That cap is the one
  relevant to a sole trader.
- The "3% or 1,000,000 zł" tier (Art. 446 ust. 5) applies only to Art. 398
  direct marketing. Some Polish blogs wrongly apply it to cookies.
- **UODO** covers the GDPR side (later processing). Its PKE fines under
  Art. 445 cover Arts. 401, 402 and 405, not 399.
- A UKE-versus-UODO jurisdiction debate exists [secondary: prawo.pl].
- The amending acts 2025 poz. 637 and 820, and 2026 poz. 252, 815 and 1296,
  were text-searched with no hits on Arts. 399, 444 or 446. That was a text
  search, not a legal review.
- No published UKE or UODO cookie-banner fine was found.

### What is exempt from consent

The exemption test has two limbs:

1. The service was explicitly requested by the user.
2. The storage is strictly necessary for that service, judged from the user's
   point of view (WP194 §§2.2, 5).

A multi-purpose cookie is exempt only if every purpose is exempt (WP194 §2.4).
Lifespan must be tied to purpose (WP194 §2.3).

| Item | EU / WP29 view | National view | Verdict for Besidka |
|------|----------------|---------------|---------------------|
| Auth session | Exempt for the session (WP194 §3.2). Persistent "remember me" cookies are not exempt without an explicit user choice. | CNIL ld ¶49: exempt, with no session/persistent split. Do not reuse for other purposes (¶48). | Exempt (Better Auth session, 7 days). A long default lifetime is a grey zone under the stricter WP29 reading. |
| CSRF | Not named in any source. Fits "security of the requested service" (WP194 §3.3). | Fits CNIL ld ¶49. | Exempt by inference, single purpose. |
| Consent-record cookie | No EU text. | CNIL ld ¶49 expressly exempts it. | Exempt (`cookies_consent`). Store no identifier beyond the choice (EDPB 05/2020 ¶106). |
| Load balancing | Exempt (WP194 §3.5). | Exempt (CNIL ld ¶49). | Exempt. |
| Security / bot protection | Exempt only for the security of the requested service (WP194 §3.3). | CNIL FAQ Q17: a CAPTCHA is consent-free only if solely for security or authentication. Provider reuse of the data needs consent. | Turnstile on sign-in, sign-up and reset-password is defensible as exempt. A site-wide `__cf_bm` is a grey zone: it serves the provider's bot management. No DPA decision was found on `__cf_bm` or Turnstile. Cloudflare's own "strictly necessary" label is vendor opinion. |
| UI customisation (theme, language, layout) | Exempt only if set by an explicit user act AND session or short-lived (WP194 §3.6, §5 item 6). Longer lifespans need a prominent notice. | CNIL ld ¶49: exempt when intrinsic and expected, with no lifetime cap. | Besidka keeps these consent-gated under `preferences` (conservative choice). This is the WP29-versus-CNIL split. |
| First-party audience analytics | WP194 §4.3: not exempt, but low-risk. | CNIL ld ¶¶49-51 exempts strictly limited measurement. | This is an EU split. Besidka's server-side landing counter is cookieless and identifier-free and runs without consent. The client-side Cloudflare Web Analytics beacon is gated behind the optional `analytics` category, the conservative reading. |

### MUST

- **No non-exempt storage or reads before a positive act.** Art. 5(3); PKE
  Art. 399 ust. 1; Taskforce ¶7.
- **Consent per purpose.** EDPB 05/2020 ¶¶42-44; PKE Art. 400.
- **Reject on the first layer, in the same format as Accept.** Taskforce ¶8: a
  "vast majority" of authorities hold that having no refuse option on a layer
  with an accept button is an infringement. A few authorities dissent. CNIL
  reco ¶¶30-32 is stricter: same screen, same ease, same format. One click to
  accept against several to refuse biases the choice (¶31).
- **Withdrawal as easy as consent, reachable at all times.** GDPR Art. 7(3);
  EDPB 05/2020 ¶¶113-114; Taskforce ¶¶31-35; CNIL reco ¶¶40-41. A persistent
  icon or footer link is acceptable (Taskforce ¶32). CNIL reco ¶¶42-43 suggests
  a bottom-left cookie icon.
- **Records that demonstrate consent.** GDPR Art. 7(1); EDPB 05/2020
  ¶¶104-108. Keep proof while the processing lasts, then no longer than needed
  (¶107). CNIL reco ¶48 lists proof methods. Besidka: consent receipts via
  `/api/v1/consents`.

### MUST NOT

- **Pre-tick boxes.** Planet49 ¶¶52, 55 [paraphrase]; Taskforce ¶10; GDPR
  Recital 32; Orange Romania C-61/19 [paraphrase].
- **Treat scrolling, silence, continued browsing or X as consent.** EDPB 05/2020
  ¶86; CNIL ld ¶27. X may count as refusal only if the banner says so (CNIL reco
  ¶33). The Italian Garante uses X as "continue without consent" [secondary].
- **Make Reject a faint link or low-contrast.** Taskforce ¶¶11-14, ¶18. Colour
  asymmetry in general is judged case by case (Taskforce ¶¶17-19). Equal
  styling is the safe default.
- **Rely on legitimate interest to place cookies.** Taskforce ¶24.
- **Run a cookie wall**, meaning access conditional on consent. EDPB 05/2020
  ¶¶39-41. A blocking modal with an equal Reject is not a wall in itself (an
  engineering reading of ¶40). Authorities diverge:
  - CNIL ld ¶¶17-18 and FAQ Q32 judge walls case by case, after the Conseil
    d'État ruling of 19 June 2020.
  - CJEU C-252/21 ¶150 concerns a dominant platform.
  - Taskforce ¶13: the design must not imply that consent is needed for access
    or "clearly push" consent.
- **Re-nag on every page.** CNIL reco ¶35.
- **Degrade unrelated functionality on refusal.** EDPB 05/2020 ¶¶46-48.
- **Reuse an exempt cookie for non-exempt purposes.** WP194 §2.4.

### MAY: lawful ways to get a decision quickly

- Show the banner immediately on first visit and keep it until the user
  chooses.
- Use neutral, informative copy that explains what consent enables (WP194
  §2.6; CNIL reco ¶14). The line is "clearly pushes" (Taskforce ¶13).
- Ask for just-in-time consent at the moment the user uses a feature that needs
  the storage (CNIL reco ¶13). This fits per-purpose granularity.
- Withhold only the specific feature that cannot work without the storage.
- Re-ask after a refusal at an interval.
  - CNIL good practice is to keep both consent and refusal for 6 months (reco
    ¶¶37-39, FAQ Q21).
  - The EDPB only says "at appropriate intervals" (05/2020 ¶111). The GDPR sets
    no time limit (¶110).
  - Besidka's consent cookie lives 180 days.
- Watch the Commission's Digital Omnibus proposal (19 Nov 2025). It would add
  GDPR Art. 88a (one-click reject, 6-month bar on re-asking). Per [secondary]
  reports, the Council's June 2026 text dropped the cookie articles. It is not
  law.

### Enforcement reality

- CNIL fined Google €150M and Facebook €60M (6 Jan 2022) because refusing was
  harder than accepting [secondary summary]. It fined Google again €325M in
  Sept 2025, partly for asymmetric consent during account creation, and Shein
  €150M the same month.
- CNIL sent about 20 formal notices in May 2021 over refusal not being as
  simple as acceptance. noyb sent 500+ draft complaints in 2021 [secondary].
- The Spanish AEPD fined a small online retailer about €30k in 2021
  [secondary].
- For a small site, realistic exposure is complaint-driven or scan-driven. The
  practical rule: no non-exempt storage before consent, and an equal Reject.

### Where authorities diverge

- Persistent-login and UI-preference lifetime: WP29 is stricter than CNIL.
- First-party analytics exemption: CNIL yes, WP29 no.
- Cookie walls: EDPB flat, CNIL case by case.
- First-layer Reject: Taskforce majority, a few dissent, CNIL stricter.
- Re-prompt interval and "X means refusal": CNIL only.
- PKE Art. 399 ust. 2 browser settings: Polish-specific, in tension with
  Planet49.

### Sources

- [EUR-Lex 2002/58](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02002L0058-20091219)
- [PKE promulgated text](https://eli.gov.pl/api/acts/DU/2024/1221/text/O/D20241221.pdf)
- [CNIL, Google fined 325 million euros (2025)](https://www.cnil.fr/en/cookies-and-advertisements-inserted-between-emails-google-fined-325-million-euros-cnil)
- [CNIL cookies FAQ](https://www.cnil.fr/fr/cookies-et-autres-traceurs/regles/cookies/FAQ)
- [CNIL 2021 formal notices](https://www.cnil.fr/fr/refuser-les-cookies-doit-etre-aussi-simple-que-de-les-accepter-une-vingtaine-dorganismes-mis-en)
- [Cloudflare cookies documentation](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/)
- [prawo.pl on consent through browser settings](https://www.prawo.pl/biznes/zgoda-na-cookies-udzielona-przez-ustawienie-przegladarki,512328.html)
- EDPB Guidelines 05/2020 on consent.
- EDPB Guidelines 2/2023 on the technical scope of Art. 5(3) ePrivacy.
- EDPB Guidelines 03/2022 on deceptive design patterns in social-media
  interfaces (outside this scope; applies only by analogy).
- EDPB Cookie Banner Taskforce report (Jan 2023).
- WP29 Opinion 04/2012 on cookie consent exemption (WP194).

---

## First layer, states and just-in-time prompt

How the consent UI implements the MUST / MUST NOT lists above. Read this before
changing `app/components/Cookies/`, `useCookieConsentUi()` or any call site of
`requestPersistence()`.

### State model

Three states, derived from `isDecided` and the granted optional categories
(`hasOptionalGrant` in `Banner.client.vue`):

| State | `isDecided` | Optional grant | Meaning |
|-------|-------------|----------------|---------|
| Undecided | `false` | none | No cookie, a cookie from another `revision`, or the user closed the banner without choosing. Optional storage is purged. |
| Decided with a grant | `true` | at least one | The user accepted preferences. Optional storage is allowed. |
| Decided without | `true` | none | The user used Reject all. Same storage rules as undecided, but the first layer is not offered again until the cookie expires (180 days). |

Closing the banner (X or Esc) never changes state, so an undecided visitor stays
undecided and is asked again the next time the site is opened or reloaded, not
on every route change (MUST NOT "treat X as consent", MUST NOT "re-nag on every
page"). The just-in-time prompt's latch is a module-scope variable, so it
resets on reload and is not persisted anywhere; adding a storage key to
remember it would itself need a consent basis.

### Which buttons show in each state

| State | Popup (non-chat pages) | Modal (chat layout, or after Customize / footer opener) |
|-------|------------------------|--------------------------------------------------------|
| Undecided | Benefit text, policy link, **Reject all** and **Accept all** side by side, then **Customize** | First layer with the same content. **Customize** switches the modal to the per-category switches; there the footer offers **Reject all** and **Accept all** plus **Allow selected** |
| Decided with a grant | Per-category state, details toggle, **Withdraw consent** and **Change preferences** as equal buttons | Switches, footer **Withdraw consent** and **Accept all**, plus **Allow selected** |
| Decided without | Per-category state, details toggle, **Change preferences** only | Switches, footer **Reject all** and **Accept all**, plus **Allow selected** |

**Withdraw consent** replaces **Reject all** only when there is something to
withdraw, so the label always describes what the button does. Both call the same
`withdrawAll()`, which clears optional storage immediately (GDPR Art. 7(3)).

### Equal prominence rule

`app/components/Cookies/Choices.vue` renders the Reject and Accept pair, and
both buttons take the **same single class string** (`buttonClasses`: `btn btn-sm
btn-accent btn-block hitslop`) in a two-column grid. Do not give one of them its
own class, colour, size or order. This is the "same format as Accept" MUST and the
"no faint Reject" MUST NOT. The component takes labels and test ids as props so
the popup and the modal share it, and `Choices.spec.ts` asserts the classes are
identical. Customize is deliberately a quieter `btn-ghost`: it is a third
route, not a substitute for Reject.

The decided popup follows the same rule for GDPR Art. 7(3) (withdrawal as easy
as consent): **Withdraw consent** and **Change preferences** are rendered by
`Choices.vue` too (stacked in one column through its `stacked` prop, because the
labels are long for a 20rem popup), with the same class string and no `order`
trick. When there is nothing to withdraw, **Change preferences** shows alone
with that same class string.

After **Customize** in the compact modal the first layer is swapped out, which
would drop the focused button to `body`; `Banner.client.vue` moves focus to the
modal heading (`tabindex="-1"`) on the next tick.

### Just-in-time "Remember your preferences?" prompt

`requestPersistence()` (`app/composables/preference-storage.ts`) is called at
the moment a user changes a setting that would be persisted. It asks
`useCookieConsentUi().requestConsent('preferences')`, which shows
`Cookies/RememberPrompt.client.vue`: **Remember** grants `preferences`, **Not
now** and the close button dismiss. This is the MAY item "ask for just-in-time
consent at the moment the user uses a feature that needs the storage". Both
buttons carry identical classes.

The anti-nag rules and the legal items they satisfy:

| Rule | Where it lives | Legal item |
|------|----------------|------------|
| Undecided users only (`isAllowed` or `isDecided` returns `false`) | `requestConsent()` in `ui.ts` | MUST NOT re-nag; a decided user, including a refusal, is not asked again for 180 days (MAY re-ask at an interval) |
| Once per page load, through a module-level latch (`consentRequestShown`) that resets on reload and is never touched during SSR | `ui.ts` | MUST NOT re-nag on every page |
| Not while a consent view is open (`view !== 'hidden'`) or the auto-show timer is pending | `requestConsent()` | Never stack two consent surfaces; the full banner takes precedence |
| Not while the notification prompt is visible (`notification-prompt:is-visible` state) | `requestPersistence()` | Never stack two prompts; unrelated to consent but both are modal-like nags |
| The reverse: the notification prompt does not show while `cookie-consent:request` is set | `showUnlessConsentRequestOpen()` in `notification-prompt.ts` (proactive and missed-notification triggers); an explicit "enable notifications" click takes over and clears the request | The two prompts never stack in either order |
| `grantRequest(expectedId)` grants only when the open request is for `expectedId` (`'preferences'` from `RememberPrompt`), otherwise it clears the request and grants nothing | `ui.ts` | A grant must match the purpose the prompt's text describes |
| Dismiss on route change (the listener is removed on unmount) | `router.afterEach` in `RememberPrompt.client.vue` | The question belongs to the action that triggered it |
| **Never** from `usePreferenceStorage().setItem` | by design | A write is not a user act; background and restore paths write too |
| **Never** from `useUserSetting().syncForUser` | by design | Sync runs on sign-in and is not user-initiated |
| Neutral copy, Remember and Not now equally prominent, no pre-selection | `Cookies/RememberPrompt.client.vue`, locale files | "Clearly pushes" line (Taskforce ¶13); no pre-ticked choice |
| Closing or ignoring it stores nothing | `dismissRequest()` | MUST NOT treat silence as consent |

Hook sites (each calls `requestPersistence()` right after a user-initiated
change):

- `useThemeToggle` (`theme-toggle.ts`): theme change. On iOS standalone the
  toggle reloads the app 500 ms later so the status bar picks up the new
  `theme-color` meta (WebKit reads it only at load); that reload is skipped
  while `preferences` is not allowed, because the theme key was never
  persisted and the reload would revert the theme and drop the "Remember?"
  prompt. The consent check runs inside the toggle, not at composable setup.
- `ChatInput/ModelsTrigger.vue`: `selectModel` and `selectGatewayModel`.
- `ChatInput.client.vue`: `selectReasoningLevel` and `selectWebSearchProvider`.
- `useFileManager` (`file-manager.ts`): view-mode setter.
- `useUserSetting` (`user-setting.ts`): the signed-out branch of the reasoning
  expanded, reasoning auto-hide, sidebar pinned, favorite models and favorite
  gateway models setters. A signed-in user's settings live in the account, not
  in the browser, so nothing is asked.

When you add a new preference that a user can change directly, call
`requestPersistence()` from the handler of that change, not from the storage
layer.

### Pre-consent purge

Preference keys must not be on the device before a decision (MUST "no
non-exempt storage before a positive act"). Two mechanisms cover that:

- **The module plugin** (`modules/cookie-consent/src/runtime/plugins/
  consent.client.ts`) runs the cleanup for every category that is not granted on
  every client boot. It used to return early when the user was undecided; it no
  longer does, so an undecided visitor has all non-required entries from the
  manifest removed, including keys left by an earlier version or a stale
  revision.
- **The gate plugin** (`app/plugins/cookie-consent-gate.client.ts`) removes
  `nuxt-color-mode` (localStorage key and cookie) at startup while `preferences`
  is not granted, and again after every `colorMode.preference` change. The
  `@nuxtjs/color-mode` plugin runs first and writes the key synchronously, so
  the write-then-purge happens in the same startup pass and is never persisted
  across a reload. The theme keeps working in-session through the module's
  reactive state.

`usePreferenceStorage()` complements both: while `preferences` is not granted,
writes go to an in-memory map instead of `localStorage`, so the app keeps
working in-session.

### Storage the page must never create: the push handoff database

`besidka-push` (IndexedDB) carries the iOS cold-start push handoff. Only the
service worker creates it, when a notification is tapped
(`app/service-worker/push.ts`); a notification can only be shown, and so tapped,
after the user switched push on. The page side
(`app/plugins/push-navigation.client.ts`) therefore only ever reads it, and
never opens it in a way that can create it:

1. It does nothing unless `Notification.permission === 'granted'`. While
   permission is not granted it also calls `indexedDB.deleteDatabase()` for
   `besidka-push`, which removes the empty database that earlier versions of the
   plugin created for every visitor (deleting a database that does not exist is
   a no-op and never creates one). The e2e step "a push handoff IndexedDB left
   by an earlier version is removed" in `tests/e2e/cookies/consent.spec.ts`
   covers it.
2. Where `indexedDB.databases()` exists it returns early when no `besidka-push`
   database is listed.
3. Where it does not (older Firefox), the `open()` request aborts its upgrade
   transaction on `onupgradeneeded`, which cancels the creation of a database
   that did not exist.

A visitor who never enabled push has no `besidka-push` database, which the e2e
step "push handoff IndexedDB is not created for an undecided visitor" asserts in
Chromium. The handoff itself is unchanged: a user who tapped a notification
necessarily has permission `granted` and a database written by the worker.
Permission can in theory be revoked after a tap and before the next launch, in
which case the database is deleted on that launch and the pending target is
discarded with it.

Two robustness rules keep the handoff from being dropped. A `databases()` call
that throws or takes longer than 500 ms falls through to the guarded `open()`
(the upgrade-abort path above, which cannot create the database) instead of
being treated as "no database". And the legacy `deleteDatabase()` cleanup runs
at most once per page load, not on every visibility, focus or recheck event.
The e2e test in `tests/e2e/push/navigation-handoff.spec.ts` writes a pending
entry the way the service worker does and asserts the app navigates to it.
Headless Chromium reports `Notification.permission` as `denied` even after
`grantPermissions`, so that test also pins the property to `granted` with an
init script.

Navigation targets from the database, from `postMessage` and from the push
payload are resolved with `resolveInternalNavigationTarget()`
(`app/service-worker/internal-navigation.ts`), shared by the plugin and the
service worker. `startsWith('/') && !startsWith('//')` accepted `/\evil.com`,
which `clients.openWindow` parses as `https://evil.com/`. The helper rejects
backslashes, whitespace and control characters, resolves against the origin,
requires the same origin and returns path, search and hash only.

The manifest drives the purge. A key that is written but not declared is never
purged, which is a GDPR Art. 7(3) problem (this is how
`settings_favorite_models`, `settings_favorite_gateway_models` and
`settings_web_search_tool` went undeclared). `tests/unit/config/
cookie-consent.spec.ts` pins the manifest against the locale files.

### Never call consent composables during SSR

`useCookieConsent()` and `useCookieConsentUi()` read and write `useState` keys
(`cookie-consent:granted`, `cookie-consent:view`, ...). Anything written to
`useState` during SSR is serialized into the Nuxt payload. `/` is cached at the
edge with SWR, so a payload built for the first requester would be served to
other visitors, who would hydrate with that visitor's consent. That is a
cross-user consent leak and breaks the "never branch cacheable HTML on consent"
rule in [SSR and edge-cache constraints](#ssr-and-edge-cache-constraints).

The rule for anything that renders on the server: **call the consent
composables lazily, inside a client-side event handler, never in `<script
setup>`.** `LandingFooter.vue` is the example. Its "Cookie settings" button is
server-rendered, and its click handler calls `useCookieConsentUi().expand(...)`
itself:

```ts
function openCookieSettings(event: MouseEvent): void {
  useCookieConsentUi().expand({
    userInitiated: true,
    trigger: event.currentTarget as HTMLElement,
  })
}
```

Two tests guard this. `tests/unit/components/LandingFooter.spec.ts` asserts the
composable is not called while mounting. The two e2e tests in the "Cookie
consent SSR HTML" group, one step per route named "SSR HTML of <route> carries
no consent state", assert that the HTML contains no `cookie-consent:` key for
each public SSR route (`/`, `/privacy-policy`, `/terms-of-use`,
`/cookie-policy`, `/signin`, `/signup`), once without a consent cookie and once
with a valid `cookies_consent` cookie on the request.

### Why the consent revision was not bumped

This section records an earlier change, when `cookieConsent.revision` was `1`.
The revision has since been bumped to `2` for the analytics category, see
[Revision 2: the analytics category](#revision-2-the-analytics-category) below.

A cookie whose `v` differs from the revision is
ignored, so a bump makes every visitor undecided again. It was not bumped
because nothing a past decision covered had changed:

- The categories (`necessary`, `preferences`) and their purposes are unchanged.
- The newly declared keys (`settings_favorite_models`,
  `settings_favorite_gateway_models`, `settings_web_search_tool`) were already
  written under the `preferences` purpose; they were only missing from the
  manifest, so they were never purged. The manifest now matches what a user who
  consented to preferences already agreed to.
- The new `necessary` entries were already being set; they are now disclosed.
- A bump would reset existing refusals early, which is the re-nagging the legal
  section forbids, and would turn every existing decision into a new receipt.

Bump the revision when a category is added or removed, or when a purpose
changes so that a past "yes" would no longer cover it.

### Revision 2: the analytics category

`cookieConsent.revision` was bumped from `1` to `2` on 2026-10-24, when the
optional `analytics` category was added to enable Cloudflare Web Analytics
behind consent (see [Cloudflare Web Analytics](#cloudflare-web-analytics)). This
is exactly the case the rule above describes: a category was added, and no past
"yes" or "no" covered it. The bump makes every visitor undecided once, so
everyone is asked again and sees the new category. Only a revision bump
re-prompts; adding a category to `cookieConsent.categories` without one leaves
existing decisions untouched and the new category simply reads as not granted.

Consequences to expect after the deploy: a one-off wave of new consent
receipts, and a dip in the share of visitors who have preferences granted until
they choose again. Receipts carry the revision, so the two eras stay
distinguishable in `consent_receipts`.

Receipt `decision` semantics shift across this boundary. With two optional
categories, granting only `preferences` (the Remember prompt) is now `partial`,
not `all` (see `deriveConsentDecision` in `server/utils/consents.ts`: `all`
needs every optional category granted). Anyone counting `decision=all` across
the revision boundary must split by revision first.

---

## Follow-ups

Deliberately not part of the first-layer change. Each is a known gap, not an
oversight.

- **Better Auth cookies not declared.** `account_data` is not declared because
  it is only written when `account.storeAccountCookie` is enabled, and this app
  does not enable it; declare it if that option is ever turned on. `oauth_state`
  is not declared because it is only written under the `cookie` OAuth state
  strategy, and this app uses the `database` strategy (the plain `state` cookie
  is declared). The cookies are read from the installed `better-auth` 1.7.7
  source; re-verify names and lifetimes on a Better Auth upgrade, because the
  manifest and `content/legal/cookie-policy.md` repeat them.
  The names carry no `__Secure-` prefix, in production or locally. The prefix
  comes from `createCookieGetter`: with `advanced.useSecureCookies` unset and
  `baseURL` configured as the dynamic object (`protocol: 'auto'`), it falls
  through to `isProduction`, which is `process.env.NODE_ENV === 'production'`
  read once at module load. The Worker runtime has no `NODE_ENV`, so the check
  is false. `getCookies()` (session cookies) and `createAuthCookie()` (state,
  two-factor, trust-device, passkey challenge) share that one decision, and
  `resolveRequestContext` only rebuilds them per request when
  `crossSubDomainCookies` is enabled, which it is not. Verified on
  2026-10-09 against https://besidka.com: `POST /api/auth/sign-in/social`
  returns `better-auth.state` and `GET /api/auth/passkey/generate-authenticate-options`
  returns `better-auth.better-auth-passkey`, both `Max-Age=300`, `HttpOnly`,
  `SameSite=Lax`, with neither the prefix nor `Secure`. The other names follow
  from the shared source path; they were not each observed. `Secure` is now
  added without renaming anything: `advanced.defaultCookieAttributes` in
  `server/utils/auth.ts` sets `secure` from `isSecureBaseUrl(config.public.baseUrl)`,
  and `createCookieGetter` spreads it after its own `secure: !!secureCookiePrefix`.
  `advanced.useSecureCookies` stays unset because it would also add the
  `__Secure-` prefix, renaming every cookie and signing every user out. See
  [auth-security.md](auth-security.md#why-defaultcookieattributes-and-not-usesecurecookies).
- **The passkey challenge cookie is set on page load of `/signin`.** Passkey
  conditional UI (autofill) requests authentication options when the page opens,
  so `better-auth.better-auth-passkey` exists before any consent decision. It
  stays in `necessary`: it is a 5 minute, `HttpOnly` authentication-security
  challenge (CNIL ld ¶49 exempts authentication security).
- **Receipts do not record the source of a decision.** A decision made from the
  banner and one made from the "Remember your preferences?" prompt look
  identical in `consent_receipts`. Recording the source needs a migration of the
  consent database (`CONSENT_DB`), which is separate from the main schema.

---

## Reading consent state (client-side)

Use `useCookieConsent()` anywhere in client-side Vue code:

```ts
const { isAllowed, granted, isDecided } = useCookieConsent()

// Reactive check
if (isAllowed('analytics')) {
  // fire tracking event
}

// Reactive list of granted category ids
// granted.value → ['necessary', 'preferences']

// Has the user made a decision yet?
// isDecided.value → true / false
```

`isAllowed` is reactive: wrap it in a `computed` or `watchEffect` when you
need reactivity to re-run when consent changes.

---

## Subscribing to consent changes

> **Reference pattern.** The `analytics` category now exists and gates
> Cloudflare Web Analytics (see
> [Cloudflare Web Analytics](#cloudflare-web-analytics)); that beacon is loaded
> by a client plugin that subscribes to consent changes, not by the composable
> below. The server-side landing counter is still **not** consent-gated (it is
> cookieless and anonymous — see
> [Analytics consent — when it is (and isn't) required](#analytics-consent--when-it-is-and-isnt-required)).
> The `useLandingAnalytics` example below is a generic illustration of the
> queue-and-flush shape for **a consent-requiring tool that needs to queue
> events** (e.g. GA4). It is not code that exists in the repo.

Use `onConsentChange` for side effects that must run when the user commits or
revises their choice. Pass `immediate: true` to also fire right away when
consent is already decided — this is the correct pattern for late-init
analytics that need to recover queued events on page load:

```ts
// app/composables/useLandingAnalytics.ts
export function useLandingAnalytics() {
  const { onConsentChange } = useCookieConsent()

  const pendingEvents: AnalyticsEvent[] = []

  function track(event: AnalyticsEvent) {
    const { isAllowed } = useCookieConsent()

    if (isAllowed('analytics')) {
      send(event)
    } else {
      // Queue until consent is granted
      pendingEvents.push(event)
    }
  }

  onConsentChange(({ granted }) => {
    if (granted.includes('analytics')) {
      // Flush queued events now that analytics is allowed
      for (const event of pendingEvents.splice(0)) {
        send(event)
      }
    } else {
      // Analytics revoked — clear queue, do not send
      pendingEvents.length = 0
    }
  }, { immediate: true })

  return { track }
}
```

The `onConsentChange` callback also auto-cleans within component scope, so
no manual cleanup is needed when called inside `<script setup>` or a composable
used inside a component.

### Nuxt hook alternative

For module-level or plugin-level subscriptions outside Vue component scope,
listen to the `cookie-consent:changed` Nuxt hook:

```ts
// plugins/analytics.client.ts
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('cookie-consent:changed', ({ granted, denied, changed }) => {
    if (changed.includes('analytics')) {
      if (granted.includes('analytics')) {
        initAnalytics()
      } else {
        teardownAnalytics()
      }
    }
  })
})
```

The payload shape:

```ts
interface CookieConsentChangedPayload {
  granted: string[]  // all currently granted category ids
  denied: string[]   // all currently denied category ids
  changed: string[]  // ids whose state changed vs the previous commit
}
```

---

## Server-side gating

> **Reference pattern.** The events ingest endpoint (`/api/v1/events`) is
> **not** consent-gated — it records cookieless, anonymous data that
> does not require consent (see
> [Analytics consent — when it is (and isn't) required](#analytics-consent--when-it-is-and-isnt-required)).
> The check below is the recommended defense-in-depth pattern for a
> consent-requiring tool whose data is posted **to one of our own routes**.
> It does **not** apply to Cloudflare Web Analytics: that beacon posts to
> `cloudflareinsights.com`, never to our Worker, so there is no server route to
> gate (see [Cloudflare Web Analytics](#cloudflare-web-analytics)).

For a consent-requiring analytics or event ingestion endpoint, use
`getCookieConsent(event)` — auto-imported in Nitro — to guard the route as
defense-in-depth. This parses the `cookies_consent` cookie server-side and is
synchronous (no DB call):

```ts
// server/api/v1/events/index.post.ts
export default defineEventHandler(async (event) => {
  const consent = getCookieConsent(event)

  if (!consent.isAllowed('analytics')) {
    throw createError({ status: 403, message: 'Analytics consent not granted' })
  }

  // ... process event
})
```

The return type:

```ts
interface ServerConsent {
  isDecided: boolean
  granted: string[]
  isAllowed: (categoryId: string) => boolean
}
```

Note: server-side gating is defense-in-depth. The primary enforcement happens
client-side by not firing events in the first place. HttpOnly cookies set by
the server (e.g. `better_auth.session_token`) cannot be cleared by the client
cleanup routine — server-side logic must handle revocation of those entries.

### Server-written consent-gated cookies

A cookie that the server writes at a request the client cannot intercept cannot
be gated client-side, so the server must read `cookies_consent` itself before it
writes. The one case today is `better-auth.last_used_login_method`, gated by the
`lastLoginMethod` plugin's `beforeStoreCookie` callback in
`server/utils/auth.ts`, which uses `isConsentCategoryGranted()` from
`server/utils/consents.ts` (no H3 event needed inside Better Auth hooks, it
reads the raw cookie from the hook context). See
[Ongoing prevention — better-auth.last_used_login_method](#gating-preference-writes).
Any future server-set preference cookie needs the same check; the client-side
clear is only a fallback.

---

## Analytics consent — when it is (and isn't) required

Besidka has two different analytics mechanisms, with different consent
treatment:

- **Cloudflare Analytics Engine** — server-side `writeDataPoint` via
  `/api/v1/events`, recording event name, path, target, coarse country, and
  device class. No IP is stored, no user id, no cookie. **Not consent-gated**
  and not a banner category.
- **Cloudflare Web Analytics** — a client-side beacon
  (`static.cloudflareinsights.com/beacon.min.js`) that reports page views and
  page-load performance to `cloudflareinsights.com`. **Consent-gated** behind
  the optional `analytics` category, loaded by app code only after the visitor
  allows it. See [Cloudflare Web Analytics](#cloudflare-web-analytics).

### Why the server-side counter needs no consent

- **ePrivacy Directive Art. 5(3)** — the "cookie law" that mandates the consent
  banner — is triggered **only** by *storing or reading information on the
  user's device* (cookies, localStorage, fingerprinting). The Analytics Engine
  counter is written by the Worker and never touches the device, so Art. 5(3)
  is not triggered.
- **GDPR** governs *processing of personal data*. Truly anonymous, aggregate
  data (no IP retained, no identifier, cannot single out a person) falls
  outside GDPR's scope (Recital 26). No personal data → no consent needed.

### Why Web Analytics is gated anyway

Cloudflare states that Web Analytics sets no cookie, uses no localStorage and
does no fingerprinting. The beacon nevertheless runs in the visitor's browser
and reads its Navigation Timing data, which is access to information on the
terminal equipment under PKE Art. 399 (the Polish implementation of ePrivacy
Art. 5(3)), and the visitor's browser sends a request to a third party. The
conservative reading, and the one the Cookie Policy states, is that this needs
consent, with GDPR Art. 6(1)(a) as the basis for the processing. "No cookie"
does not by itself mean "no consent" for a script that measures the device.

### Decision rule

Analytics consent is required when the analytics tool either:

1. **Stores or reads data on the device** — cookies, localStorage,
   fingerprinting, or reading browser timing data from a script running in the
   page (→ ePrivacy Art. 5(3) / PKE Art. 399), **or**
2. **Processes personal data** — IP retained, persistent id, cross-site
   tracking (→ GDPR).

If a tool does neither, it runs without consent. Because the line for
client-side measurement scripts is not settled, treat any new client-side
script as consent-gated unless you have a reason not to.

| Tool | Device access | Personal data | Consent? |
|------|---------------|---------------|----------|
| Cloudflare Web Analytics (client beacon) | Reads Navigation Timing; sets no cookie or storage (per Cloudflare) | Cloudflare receives the request (IP, browser) as a processor | **Yes** — `analytics` category |
| Cloudflare Analytics Engine (our `/api/v1/events`) | None (cookieless) | None (aggregate, no IP/id) | **No** |
| Plausible / Fathom (self-hosted, cookieless, server-side) | None | None | **No** |
| Google Analytics 4 (GA4) | Sets `_ga` / `_gid` cookies | Yes (personal data) | **Required** |
| Meta Pixel / ad-tech | Cookies + cross-site tracking | Yes | **Required** + "Do Not Sell/Share" |

### Campaign attribution uses no device storage

UTM campaign attribution (`utm_source`, `utm_medium`, `utm_campaign`,
`utm_content`) is built on the same rule. The values are read from the URL,
held in in-memory client state (`useState`) and carried to sign-up through
the URL (the sign-up links and Better Auth's `callbackURL`). Nothing is
written to a cookie, `localStorage`, `sessionStorage` or IndexedDB, so
Art. 5(3) and PKE Art. 399 are not triggered. Attribution is independent of
the `analytics` category: it works whether or not the visitor allows it.

The server stores the first-touch campaign with the account
(`user_attribution`). That is GDPR processing under Art. 6(1)(f), disclosed
in the privacy policy, and it is not a consent matter.

If a future change adds a UTM cookie or any other device storage for
campaigns, it must go under the `analytics` category and be read only after
consent, with its entries declared in the manifest and listed in the Cookie
Policy table. The reasons the cookie was not built are in
[`docs/analytics-utm.md`](analytics-utm.md#decision-no-analytics-consent-cookie).

### Remaining obligation either way

Analytics still requires **transparency** under **GDPR Art. 13**: disclose it
in the privacy policy. For the consent-gated Web Analytics that is disclosure
on top of consent; for the Analytics Engine counter it is disclosure instead of
consent.

### Cloudflare Web Analytics

The beacon is enabled behind the `analytics` category, which was added together
with consent revision `2` (see
[Revision 2: the analytics category](#revision-2-the-analytics-category)).

**How it is loaded.** App code loads `beacon.min.js` only after the visitor
grants `analytics`, never before. The client plugin
`app/plugins/cloudflare-web-analytics.client.ts` subscribes to consent changes
and injects the script with the site token (`useScript` with
`trigger: 'manual'`). A visitor who is undecided or who denied the category
never triggers a request to `static.cloudflareinsights.com`. Do not add the
snippet to a template or to `app.head` script tags: that would load it before
consent.

**The reload rule.** A running beacon cannot be unloaded, so withdrawing
`analytics` after the script has already run needs a full page load. The plugin
waits for the `cookie-consent:receipt-sent` hook (see
[The receipt-sent hook](#the-receipt-sent-hook)) so the reload never races the
receipt POST, then:

- re-checks `isAllowed('analytics')`: if the category was granted again in the
  meantime, it does nothing;
- on any route except `/chats/*`, calls `window.location.reload()` immediately;
- on a `/chats/*` route, does not reload, because a reload would abort an
  in-flight generation (see
  [chats/stuck-generation-guard.md](chats/stuck-generation-guard.md)). It
  registers a one-shot `router.beforeEach` guard instead. The next client
  navigation is cancelled and replaced by `window.location.assign(to.fullPath)`,
  a full page load, and the guard removes itself. The guard re-checks consent
  when it fires, and it is removed as soon as `analytics` is granted again.

A visitor who withdrew before the beacon ever loaded, or whose beacon was
blocked, is never reloaded.

**The token.** The site token is `NUXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN`.
It is set only in `env.production.vars` in `wrangler.jsonc`. Previews
(`env.production.previews.vars`) and local development leave it empty, and an
empty token means the plugin loads nothing, so previews and development never
send measurements to the production site in Cloudflare's dashboard. See
[cloudflare-previews.md](cloudflare-previews.md#web-analytics-on-previews). The
token is public by design: `runtimeConfig.public` is serialized into every page
payload, so it is visible in the page source of every visitor whatever they
chose. On its own it loads nothing, and the beacon script is never requested
without consent.

**The `analytics` category has no manifest entries.** Cloudflare states the
beacon sets no cookie and uses no localStorage, so there is nothing for the
module's cleanup routine to purge on withdrawal. If a future Cloudflare change
makes the beacon write to the device, declare those keys as `entries` under
`analytics` (see [Adding new cookies to the manifest](#adding-new-cookies-to-the-manifest))
and list them in `content/legal/cookie-policy.md`.

**Why the server-side gate does not apply.** The
[Server-side gating](#server-side-gating) check protects a route that receives
the data. The beacon posts to `cloudflareinsights.com`, a Cloudflare host, and
never to our Worker, so there is no Besidka endpoint to check consent on. The
whole gate is client-side: the script is not requested until consent. This is
the opposite of `/api/v1/events`, which has a server route but needs no gate.

**The dashboard must be in manual mode.** Cloudflare can also inject the beacon
itself at the edge for a proxied site. That injection ignores our consent
decision, so it must stay off. In the Cloudflare dashboard, Web Analytics, the
`besidka.com` site must use "Enable with JS Snippet installation", not automatic
setup (see the runbook below). Before this change the site was in automatic mode
and Cloudflare injected the beacon into every page without consent, which
contradicted the Cookie Policy. With edge injection on, the consent gate is
meaningless whatever the app does.

**Owner runbook, after the code is deployed.**

1. Open the Cloudflare dashboard, Web Analytics, the `besidka.com` site, and
   choose Manage site.
2. Choose **Enable with JS Snippet installation**, not "Disable". Do this
   only **after** the code that loads the beacon behind consent is live, so
   there is no window with neither the edge injection nor the app script.
3. Confirm the token the dashboard shows matches the one in `wrangler.jsonc`
   (`env.production.vars`, `NUXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN`).
4. Verify that the edge no longer injects the beacon. Send a real browser User
   Agent and an HTML `Accept`, so the request looks like a browser's:

   ```bash
   curl -s -H 'User-Agent: <Chrome UA>' -H 'Accept: text/html' \
     https://besidka.com/ | grep -c cloudflareinsights
   ```

   It must print `0`. Any other number means the edge is still injecting and
   the consent gate is bypassed: go back to step 2.
5. In a real browser, with the category off, confirm there is no request to
   `static.cloudflareinsights.com` in the network panel; turn it on and confirm
   the request appears.

**Retention.** Cloudflare holds the data, not Besidka. Cloudflare's Web
Analytics FAQ states unsampled data is kept for the past 7 days and then
aggregated, and the dashboard shows the previous six months; no length is
stated for the aggregated data. The Privacy Policy points at that statement
rather than promising its own number. Re-read the FAQ
(<https://developers.cloudflare.com/web-analytics/faq/>) if the wording in the
policy is ever tightened.

### The receipt-sent hook

`cookie-consent:receipt-sent` is a runtime Nuxt hook fired by
`app/plugins/cookie-consent-gate.client.ts` once per consent change, after the
consent receipt POST to `/api/v1/consents` has settled. It settles on success,
on failure (errors are swallowed) and on the 5 s request timeout
(`RECEIPT_TIMEOUT_MS`), so a hung request cannot delay subscribers
indefinitely. The receipt itself is sent 150 ms after the decision
(`RECEIPT_DELAY_MS`) so the consent cookie is flushed first.

The payload is `{ granted, denied, changed }`, the same
`CookieConsentChangedPayload` the module's `onConsentChange` receives. The hook
is declared in `app/types/runtime-hooks.d.ts`. Use it for work that must not
overtake the receipt, such as reloading the page after a withdrawal; for plain
reactions to a decision, subscribe with `onConsentChange` instead.

### Re-enabling consent-gated analytics for another tool

For another consent-requiring analytics tool (e.g. GA4), the `analytics`
category already exists, so the steps are:

1. **Reuse the category.** Do not add a second analytics category unless the
   purpose differs. If you add or remove a category, or change what `analytics`
   covers, bump `cookieConsent.revision`: only a revision bump re-prompts
   visitors, a config change alone does not.
2. **Gate the client.** Load the tool only after `analytics` is granted, with
   the plugin pattern in [Subscribing to consent changes](#subscribing-to-consent-changes).
   If it posts to one of our own routes, also add the server
   `getCookieConsent(event).isAllowed('analytics')` check (see
   [Server-side gating](#server-side-gating)) as defense-in-depth.
3. **Declare the cookies.** Declare any cookies the tool sets as `entries`
   under the `analytics` category so the module's cleanup routine purges them
   on withdrawal (see [Adding new cookies to the manifest](#adding-new-cookies-to-the-manifest)),
   and update `content/legal/cookie-policy.md` and the Privacy Policy.

Two hardenings are worth applying at the same time:

- **Validate the consent cookie** in the server util — confirm the parsed
  `granted[]` contains only strings before trusting it.
- **Restrict the ingest endpoint** — limit `/api/v1/events` to requests whose
  `sec-fetch-site` is `same-origin`.

---

## SSR and edge-cache constraints

**Never branch cacheable SSR HTML on consent state.** Consent is a
per-user, client-side signal. Doing so would:

1. Cache one user's consent-branched HTML and serve it to another user.
2. Break ISR/CDN caching because the cache key would not include consent.

The cookie-consent UI is `client-only` (all three primitives use `.client.vue`
suffixes and are mode: 'client'). The styled banner is also `.client.vue`.
`LazyCookiesBanner` is wrapped in `<ClientOnly>` in `app.vue`, so it never
renders on the server.

For personalisation that depends on consent (e.g. showing/hiding a
preference-driven widget), gate it in client-side Vue
(`v-if="isAllowed('preferences')"`) not in server-rendered layouts.

The SWR cache on `/` is safe only because Nitro's cached handler does not vary
on cookies: every visitor gets the same cached HTML regardless of their consent
cookie, and that HTML carries no consent state. Never add `varies: ['cookie']`
(or any cookie-keyed variation) to that route rule.

---

## Adding new cookies to the manifest

1. **Declare the entry in `nuxt.config.ts`** under the appropriate category:

```ts
// nuxt.config.ts
cookieConsent: {
  categories: [
    {
      id: 'preferences',
      entries: [
        // ... existing entries
        {
          id: 'my-new-pref',      // unique id, used for i18n key
          name: 'my_new_pref',    // actual cookie / localStorage key
          type: 'localStorage',   // 'cookie' | 'localStorage' | 'sessionStorage'
        },
      ],
    },
  ],
},
```

2. **Add i18n descriptions** in the app locale files
   `i18n/locales/cookie-consent.en.ts` and `i18n/locales/cookie-consent.uk.ts`
   (registered through the `i18n:registerModule` hook in `nuxt.config.ts`). Each
   is a `defineI18nLocale(() => ({ ... }))` module; entries live under
   `cookieConsent.entries`, keyed by the manifest `id`:

```ts
// i18n/locales/cookie-consent.en.ts
export default defineI18nLocale(() => ({
  cookieConsent: {
    entries: {
      'my-new-pref': {
        description: 'What this cookie/key stores and who sets it.',
        duration: 'Until deleted',
      },
    },
  },
}))
```

```ts
// i18n/locales/cookie-consent.uk.ts
export default defineI18nLocale(() => ({
  cookieConsent: {
    entries: {
      'my-new-pref': {
        description: 'Що зберігає цей ключ та хто його встановлює.',
        duration: 'До видалення',
      },
    },
  },
}))
```

   `tests/unit/config/cookie-consent.spec.ts` fails if a manifest entry lacks a
   description or duration in either language, or if a locale has text for an id
   that is not in the manifest.

3. Update the tables in `content/legal/cookie-policy.md` and bump its
   `updatedAt`. The policy is the user-facing copy of the manifest.
4. That is all for the UI. The banner's modal auto-renders all declared entries
   from the manifest. No component changes required.

---

## Gating `useLandingAnalytics().track()`

> **Reference pattern.** The landing counter shipped cookieless and
> anonymous, so `track()` is **not** gated (see
> [Analytics consent — when it is (and isn't) required](#analytics-consent--when-it-is-and-isnt-required)).
> The optional `analytics` category gates Cloudflare Web Analytics only, not
> this counter. This is the recommended pattern for **if/when a
> consent-requiring tool must receive the `track` events** and you gate the
> `track` call.

If you introduce a consent-requiring analytics tool, gate the `track` call as
shown in the subscribing section above. The recommended pattern:

```ts
// Usage in a component or composable
const analytics = useLandingAnalytics()

// This is safe to call unconditionally — useLandingAnalytics queues
// events internally and flushes them once analytics consent is granted.
analytics.track({ type: 'page_view', path: route.path })
```

The queue-and-flush pattern ensures no events are lost when the user grants
consent after having loaded the page (the `onConsentChange({ immediate: true })`
fires immediately and drains the queue).

---

## Gating preference writes

All writes to localStorage keys declared under the `preferences` category must
go through `usePreferenceStorage()` instead of `useLocalStorage()` or
`window.localStorage` directly.

### usePreferenceStorage()

Auto-imported composable (lives in `app/composables/preference-storage.ts`).

```ts
const { setItem, getItem, removeItem, flushPending } = usePreferenceStorage()
```

| Method | Behavior |
|--------|----------|
| `setItem(key, value)` | If `preferences` is granted → writes to `localStorage`. Otherwise → stores in an in-memory pending `Map` and removes the real key. |
| `getItem(key)` | Returns the real `localStorage` value first; falls back to the pending map. Composables therefore keep working in-session even when denied. |
| `removeItem(key)` | Clears both the real key and the pending map entry. |
| `flushPending()` | Writes all pending entries to `localStorage` and clears the map. Called by the gate plugin when consent is granted. |

All methods are SSR-safe (guarded by `import.meta.client`).

### Gate plugin (app/plugins/cookie-consent-gate.client.ts)

Runs once per client boot and subscribes to consent changes.

**On grant of `preferences`:**
- Calls `flushPending()` to write all in-memory pending values to localStorage.
- Re-persists the current color mode preference (reads `useColorMode().preference`
  and writes `nuxt-color-mode` to localStorage) — no page reload required.

**On deny of `preferences`:**
- The module's built-in cleanup routine already removes declared entries.
- The pending map is left intact so in-session values remain accessible.

**Ongoing prevention — color mode:**
`@nuxtjs/color-mode` writes `nuxt-color-mode` to localStorage inside its own
plugin, which runs before this one, so the write itself cannot be intercepted.
Instead the gate plugin purges the key (and the cookie of the same name) in the
same synchronous startup pass whenever `preferences` is not granted, and again
after every `colorMode.preference` change (a `watch` with `{ flush: 'post' }`).
The head script only reads the key on the next load, by which time it is gone,
so the write-then-purge window is never persisted. The theme keeps working
in-session via the module's reactive state. See
[Pre-consent purge](#pre-consent-purge).

**Ongoing prevention — better-auth.last_used_login_method:**
The `lastLoginMethod` server plugin writes this cookie at sign-in, so the server
is where it is gated: `server/utils/auth.ts` passes the plugin a
`beforeStoreCookie` callback that reads the request's `cookies_consent` cookie
(through `isConsentCategoryGranted()` in `server/utils/consents.ts`, which
applies the same revision and category rules as `getCookieConsent()`) and
returns `false` unless `preferences` is granted at the current revision. With no
decision, a malformed cookie, a stale revision or a denied `preferences`, no
`Set-Cookie` is emitted at all, for both password and OAuth callback sign-ins.
The `users.lastLoginMethod` database column is unaffected: it is server-side
state, not terminal storage.

The manifest entry's `name` must still match the real cookie name — the
plugin's default is `better-auth.last_used_login_method` (hyphenated
`better-auth` prefix, and `last_used_login_method`, not `last_login_method`),
never a `__Secure-` prefixed variant, since the plugin sets it via a literal
`ctx.setCookie()` call rather than the framework's prefix-aware
`createCookie()` helper. The client-side clear stays as a fallback for a cookie
left by an earlier version or by a decision withdrawn later: the gate plugin
watches `useAuth().lastLoginMethod` and, while `preferences` is denied, clears
the cookie via the better-auth client's own `clearLastUsedLoginMethod()` action
rather than hand-writing the cookie name again. On a grant-flush this cookie is
**not** regenerated (it is only set at login time) — this is acceptable and
documented here.

Two limits of the server gate. A cross-host preview sign-in through
`oAuthProxy` finishes on the production host, which does not see the preview
host's consent cookie, so it fails closed (no cookie). And the consent cookie
is `SameSite=Lax`, so it is sent on the top-level OAuth callback navigation.

### Adding a new preference key

1. Declare it in `nuxt.config.ts` under the `preferences` category.
2. Use `usePreferenceStorage().setItem/getItem/removeItem` instead of
   `useLocalStorage` or raw `localStorage` in the composable that owns it.
3. Add an i18n description per the manifest guide above, and a row in the
   preferences table of `content/legal/cookie-policy.md`.
4. If a user can change it directly, call `requestPersistence()` from that
   change handler (see
   [Just-in-time prompt](#just-in-time-remember-your-preferences-prompt)).

### Video player preferences

`app/composables/video-player-preferences.ts` (`useVideoPlayerPreferences`,
used by `app/components/landing/VideoPlayer.client.vue`) persists the Video.js
player's volume, mute, speed, quality and captions choice as JSON under the
localStorage key `video-player`. The key is declared in the `preferences`
category manifest (`id: 'video-player'`). Video.js has no built-in persistence
(https://github.com/videojs/v10/issues/944), so the composable stores it
through `usePreferenceStorage()` like every other preference key:

```ts
const nuxtApp = useNuxtApp()
const preferenceStorage = usePreferenceStorage()

nuxtApp.runWithContext(() => {
  preferenceStorage.setItem('video-player', JSON.stringify(preferences))
})
```

`runWithContext` is needed because the writes happen in player-store
callbacks, outside the Nuxt context that `useCookieConsent()` (called inside
`setItem`) requires. While `preferences` is denied the values stay in the
in-memory pending map (the player remembers them in-session), a grant flushes
them through the gate plugin, and a deny removes the key through the module's
cleanup. The composable has no consent listener of its own. The lean
key-guide player does not persist anything. Player changes do not call
`requestPersistence()`.

The player used to be Plyr, which stored its settings under the `plyr` key
(also declared in the manifest). That manifest entry was replaced by
`video-player`, so the deny cleanup no longer covers `plyr`; the
`app/plugins/video-legacy-plyr-cleanup.client.ts` plugin removes it once per
app load through `removeLegacyPlyrPreferences()`, which clears values left by
earlier visits. Architecture of the player: `docs/video-player.md`.

---

## Category reference

| Category id | Required | Purpose |
|-------------|----------|---------|
| `necessary` | Yes | Auth cookies, the consent cookie, the unsent-message backup and push/PWA bookkeeping keys — always active |
| `preferences` | No | UI state persisted in cookies/localStorage |
| `analytics` | No | Cloudflare Web Analytics (page views and page-load performance). No cookies or storage, so no manifest entries. Added with consent revision `2` |

The `analytics` category gates only the Cloudflare Web Analytics beacon (see
[Cloudflare Web Analytics](#cloudflare-web-analytics)). The server-side landing
counter is cookieless and anonymous and runs without consent (see
[Analytics consent — when it is (and isn't) required](#analytics-consent--when-it-is-and-isnt-required)).
There is still **no `marketing` category**: it is commented out in
`nuxt.config.ts` and does not appear in the banner.

Check `nuxt.config.ts` → `cookieConsent.categories` for the full list of
declared entries per category.

---

## Consent receipt logging (Axiom)

### What is logged

When a visitor commits a consent decision (allow-all, allow-selected, or
withdraw), the client fires a fire-and-forget POST to `/api/v1/consents`.
The server logs a wide event to Axiom containing the following fields — all
**pseudonymous**, no personal data:

```
consent.id          — UUID v4 generated client-side at decision time (no user link)
consent.date        — ISO 8601 timestamp of the decision
consent.revision    — banner revision number from cookieConsent.revision
consent.granted     — array of granted category ids
consent.denied      — array of denied category ids
consent.changed     — array of ids whose state changed vs previous decision
consent.decision    — derived bucket: 'all' | 'partial' | 'none'
                      (computed over non-required categories)
consent.cookiePresent  — whether cookies_consent cookie was present server-side
consent.consistent  — whether cookie id + granted set matched the POST body
```

Country and colo fields are attached automatically by evlog wide-event
enrichers — these are aggregate/infrastructure metadata, not personal data.

### Validation and rate limiting

`POST /api/v1/consents` is unauthenticated, so it is validated and throttled
before anything is stored:

- **Rate limit.** `enforceConsentsRateLimit()`
  (`server/utils/consents-rate-limit.ts`) calls the Workers Rate Limiting
  binding `CONSENTS_RATE_LIMITER` (`ratelimits` in `wrangler.jsonc`, 60
  requests per 60 s) keyed by `cf-connecting-ip`, with an IPv6 address
  collapsed to its /64 prefix so one client cannot rotate addresses inside its
  own prefix. Beyond the limit it answers `429` (evlog `createError`, `Retry-After:
  60`). It runs before the body is read. The binding is declared in the
  top-level (preview) config and in `env.production`, with namespace ids
  `730101` and `730102`; namespaces are created implicitly, so nothing needs
  creating in Cloudflare, but ids must stay unique per account. The limit is
  per Cloudflare location and eventually consistent, so it is a flood guard,
  not exact accounting. A real person produces at most a receipt or two per
  minute, and a 429 only costs the audit receipt, never the user's choice (the
  client ignores the response).
- **Why not KV.** An earlier version used the KV-backed auth limiter. KV allows
  about one write per second to the same key and `consume` is a non-atomic
  read-then-write, so under a fast single-IP flood puts were rejected, the
  error was swallowed and requests went through: the limiter did not limit. It
  also stored the client IP in plaintext in KV for up to 15 minutes. The
  binding keeps no readable IP.
- **Fail open.** If `cf-connecting-ip` is absent (local dev), the binding is
  absent (unit and integration tests, non-Cloudflare self-hosts) or the binding
  throws, the request is let through and the logger gets
  `consentRateLimit.skipped` (`no-client-ip`, `binding-unavailable` or
  `limiter-error`; the error text goes under `attributes.consentRateLimit`).
- **`id` must be a UUID.** `crypto.randomUUID()` produces one; the module's
  fallback for browsers without it now builds a UUID v4 from
  `crypto.getRandomValues()` (and `Math.random()` only if there is no crypto at
  all) instead of the old base36 string, so every client produces ids the schema
  accepts.
- **`date` must be within 24 hours of server time**, in either direction. The
  client posts the receipt about 150 ms after the decision, so honest traffic
  is nearly exact; the window exists for devices with a wrong clock or time
  zone set by hand (up to about 14 hours off). A tighter bound would lose
  receipts for those users, a looser one would let an arbitrary backdated
  `createdAt` into the audit trail.

- **`granted`, `denied` and `changed` must be configured category ids.** They
  are checked against `cookieConsent.categories` from runtime config, the same
  source as the module, instead of any string up to 24 characters, so the
  receipt dataset stays bounded and cannot be filled with arbitrary text.
- **Bodies over 2 KB are rejected with a 413** from the `content-length` header
  before `readValidatedBody` runs. A chunked request without the header is not
  caught by this check; the schema still bounds what is stored.

The id and date rejections are evlog `createError` 400s with `why` and `fix`.

`consistent` in the logged event is a heuristic, not proof: it only says the
`cookies_consent` cookie on the request carried the same id and granted set as
the body. A client controls both, so it cannot authenticate a receipt.

On a storage failure the endpoint returns a generic `why` ("The consent
database rejected the insert."); the D1 message is logged under
`attributes.consentDb.error` (see `docs/axiom-map-fields.md`).

No raw IP address, no user-agent string, and no user account identifier are
logged. The consent `id` is a random UUID created at decision time and is
never linked to a Better Auth user record.

### Why it is lawful

- **Art. 7(1) GDPR (accountability)**: Controllers must be able to demonstrate
  that consent was given. A timestamped, pseudonymous receipt for every consent
  decision satisfies this burden.
- **Art. 6(1)(c) GDPR (legal obligation)**: Where applicable national law
  requires evidence of consent (e.g. ePrivacy, TTDSG §25), this logging
  fulfils that legal obligation.
- The data is pseudonymous (no IP, no account link) and therefore presents
  minimal risk to data subjects. The consent `id` stored in the cookie is
  already disclosed to the user via the banner's details section.

### Retention recommendation

Configure the Axiom **audit dataset** (`axiomAuditDataset`) and the dedicated
**consent dataset** (`axiomConsentDataset`) with a retention period of **3–5
years**. This covers standard supervisory authority inquiry windows (most EU
DPAs operate within 3 years; 5 years provides a margin for complex
investigations).

The main dataset (`axiomDataset`) can use shorter operational retention
(e.g. 90 days) as consent receipts flow to both the audit dataset (via evlog's
`auditOnly` drain filter) and the dedicated consent dataset (via the
`consentOnly` filter) independently.

To configure retention in Axiom: Settings → Datasets → select the audit
dataset → Retention.

### Drain routing

Each consent receipt wide event (identified by a non-empty `consent` field)
is delivered to **all three configured Axiom drains in parallel**:

| Drain | Dataset env key | Filter | Purpose |
|-------|----------------|--------|---------|
| `main` | `NUXT_AXIOM_DATASET` | none (all events) | Operational telemetry; short retention |
| `audit` | `NUXT_AXIOM_AUDIT_DATASET` | `auditOnly` (events with `audit` field) | Long-retention compliance copy |
| `consent` | `NUXT_AXIOM_CONSENT_DATASET` | `consentOnly` (events with `consent` field) | Dedicated consent analytics dataset |

The `consent` drain is a **second live copy** specifically for consent receipt
analytics, isolated from request-level app telemetry. The 30-day Axiom free-
plan window is intentional here — D1 is the legal system of record; Axiom is
the analytics layer where a rolling 30-day window is sufficient for monitoring
acceptance rates and consistency spikes.

### Setting up the consent dataset

1. Axiom → **Datasets → New dataset** → name it (e.g. `besidka-consent`).
2. **Settings → API tokens → New token** → ingest permission, scoped to that
   dataset only.
3. Set the secrets:

   ```bash
   npx wrangler secret put NUXT_AXIOM_CONSENT_DATASET
   npx wrangler secret put NUXT_AXIOM_CONSENT_TOKEN
   ```

   Locally: `.dev.vars` with the same keys.

   When either key is absent the drain is silently skipped — safe for local
   development without Axiom credentials.

### Org prerequisites

1. **Axiom DPA + SCCs**: Execute a Data Processing Agreement with Axiom and,
   if Axiom processes data in a third country (e.g. US), ensure Standard
   Contractual Clauses are in place before enabling the audit or consent drain.
2. **Privacy policy**: When the legal pages land, add a paragraph noting that
   consent decisions are logged pseudonymously for accountability purposes,
   are retained for up to 5 years in D1 (and 30 days in Axiom), and are
   accessible only to authorised engineering and legal staff.

### Example Axiom APL queries

Run these against the dedicated consent dataset (`besidka-consent`). The same
queries work against the audit dataset (`besidka-audit`) if you prefer a single
long-retention source.

**Decision distribution — counts by consent.decision:**

```apl
['besidka-consent']
| where ['consent.decision'] != ""
| summarize count() by ['consent.decision']
```

**Per-category acceptance rate — preferences as example:**

```apl
['besidka-consent']
| where isnotempty(['consent.granted'])
| extend grantedPreferences = array_contains(['consent.granted'], 'preferences')
| summarize
    total = count(),
    grantedCount = countif(grantedPreferences == true)
| extend acceptanceRate = round(todouble(grantedCount) / todouble(total) * 100, 1)
```

**Receipt lookup by consent id — support flow:**

```apl
['besidka-consent']
| where ['consent.id'] == "<paste-id-here>"
| project _time, ['consent.id'], ['consent.decision'],
    ['consent.granted'], ['consent.revision'], ['consent.consistent']
| sort by _time desc
```

## Storage strategy — D1 system of record

**Status: IMPLEMENTED.** `/api/v1/consents` persists every receipt to a
dedicated Cloudflare D1 database (`CONSENT_DB`) in addition to the Axiom
wide-event log. D1 is the legal system of record; Axiom is the analytics
layer.

### Table schema

```sql
CREATE TABLE IF NOT EXISTS consent_receipts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL,
  granted TEXT NOT NULL,       -- JSON array of granted category ids
  denied TEXT NOT NULL,        -- JSON array of denied category ids
  changed TEXT NOT NULL,       -- JSON array of changed category ids
  decision TEXT NOT NULL,      -- 'all' | 'partial' | 'none'
  consistent INTEGER NOT NULL DEFAULT 0,  -- 1 = cookie matched body
  country TEXT                 -- cf-ipcountry header, nullable
);
CREATE INDEX IF NOT EXISTS idx_consent_receipts_created_at
  ON consent_receipts (created_at);
```

Migration file: `.drizzle/migrations-consent/0000_deep_stardust.sql`
(generated by Drizzle Kit from `server/db/consent/schema.ts` via `pnpm run db:consents:generate`)

Bindings:
- Default env: `CONSENT_DB` → `besidka-consent-preview`
- Production env: `CONSENT_DB` → `besidka-consent`

No foreign keys — zero interaction with the cascade-sensitive app schema
(see the D1 migration safety rules in `CLAUDE.md`).

### Applying migrations

**Local (miniflare state — already applied):**

```bash
pnpm run db:consents:migrate
```

**Preview (run this before production):**

```bash
pnpm run db:consents:migrate:preview
```

**Production:**

```bash
pnpm run db:consents:migrate:prod
```

Always apply to preview first and verify a row lands before applying to
production.

### CI auto-apply

GitHub Actions applies `CONSENT_DB` migrations automatically alongside the
main `DB`, mirroring the existing migration pipeline:

- **PR (same-repo) build success** → `preview-deploy.yml` applies
  `CONSENT_DB --remote` from the uploaded `.drizzle` artifact (which includes
  `.drizzle/migrations-consent/`).
- **Merge / push to `main`** → `production.yml` (`deploy`) applies
  `CONSENT_DB --remote --env production` on every run (the apply is
  idempotent) from the committed migrations. CI never regenerates them; the
  `static` job fails a pull request whose consent schema changed without a
  committed migration.
- **Push to `main`** → `production.yml` (`deploy-preview`) applies
  `CONSENT_DB --remote` to the preview database, then deploys the long-lived
  Workers Preview (`wrangler preview --name preview`). See
  [`cloudflare-previews.md`](./cloudflare-previews.md).

`wrangler d1 migrations apply` is idempotent, so these steps only run
migrations not yet recorded in `CONSENT_DB`'s `d1_migrations` table. See
[`.github/workflows/README.md`](../.github/workflows/README.md#database-migrations)
for the full matrix. Manual `:preview` / `:prod` commands remain available for
out-of-band application.

### Support lookup

Point lookup by consent id:

```bash
pnpm exec wrangler d1 execute CONSENT_DB --remote \
  --command "SELECT * FROM consent_receipts WHERE id = '<paste-id>'"
```

Production:

```bash
pnpm exec wrangler d1 execute CONSENT_DB --env production --remote \
  --command "SELECT * FROM consent_receipts WHERE id = '<paste-id>'"
```

### Art. 17 GDPR — erasure and pseudonymization

Consent receipts contain no direct personal identifiers: `id` is a
random UUID with no link to a Better Auth user record, and IP addresses
are never stored. The `country` column is aggregate metadata (ISO 3166
two-letter code).

**Option A — Row deletion (erasure).** Delete by consent id when the
data subject cannot be linked to any stored identifier anyway and when
national law permits it (Art. 17(3)(b) allows retention for legal claims):

```sql
DELETE FROM consent_receipts WHERE id = ?;
```

**Option B — In-place pseudonymization.** Replace array fields with
empty arrays, preserving the audit trail structure (timestamp, decision
bucket, revision) while removing category-level detail:

```sql
UPDATE consent_receipts
SET granted = '[]', denied = '[]', changed = '[]', country = NULL
WHERE id = ?;
```

Choose Option B when you need to prove a decision was recorded (Art. 7(1)
accountability) but need to reduce the data footprint. Choose Option A
when no accountability interest survives.

Note: Art. 17(3)(b) allows continued processing for the establishment,
exercise, or defence of legal claims. A 3–5 year retention window is
appropriate for most EU supervisory authority inquiry windows.

### Retention cleanup

No automatic cleanup is implemented yet. To manually purge receipts older
than five years (run locally or in a cron Worker):

```sql
DELETE FROM consent_receipts
WHERE created_at < date('now', '-5 years');
```

A future scheduled Worker (Cloudflare Cron Trigger) can automate this
by running the DELETE on a monthly schedule.

### Decision matrix (why D1, not Axiom)

| Option | Retention | Erasure/pseudonymization | Verdict for receipts |
| --- | --- | --- | --- |
| Axiom (free) | 30 days, fixed | No event-level deletion | Dashboards/monitors only |
| Axiom (paid) | Custom per dataset | Still no surgical deletion | Long-term receipts violate Art. 17 handling |
| CF Analytics Engine | 92 days | None, sampled at volume | Disqualified — receipts must be lossless |
| CF D1 (SQLite) | Manual (yours) | `UPDATE`/`DELETE` per row | **System of record** ✓ |
| CF R2 (JSONL archive) | Lifecycle/locks | Immutable — conflicts with erasure | Cold WORM archive of exports only |

Axiom remains the analytics layer (acceptance rates, withdraw spikes,
consistency monitoring). Analytics Engine stays as the cookieless,
first-party page analytics layer and must not hold consent receipts
(sampling + 92-day limit).

## Axiom setup — datasets and dashboards

### Free plan constraints (verified)

- 30-day retention on every dataset, not configurable.
- **Maximum 3 datasets** — Besidka uses all three slots:
  - `axiomDataset` — main operational telemetry
  - `axiomAuditDataset` — long-retention compliance copy (receipts + audit events)
  - `axiomConsentDataset` — dedicated consent analytics (30-day rolling window)
- Monitors with email/Discord notifications are available.

### Creating a dataset + wiring it

**Audit dataset:**

1. Axiom → **Datasets → New dataset** → name it (e.g. `besidka-audit`).
2. **Settings → API tokens → New token** → ingest permission, scoped to that
   dataset only.
3. Set the secrets:

   ```bash
   npx wrangler secret put NUXT_AXIOM_AUDIT_DATASET
   npx wrangler secret put NUXT_AXIOM_AUDIT_TOKEN
   ```

**Consent dataset:**

1. Axiom → **Datasets → New dataset** → name it (e.g. `besidka-consent`).
2. **Settings → API tokens → New token** → ingest permission, scoped to that
   dataset only.
3. Set the secrets:

   ```bash
   npx wrangler secret put NUXT_AXIOM_CONSENT_DATASET
   npx wrangler secret put NUXT_AXIOM_CONSENT_TOKEN
   ```

   Locally: `.dev.vars` with the same keys for both datasets.

### Dashboards worth building (consent dataset)

Create via **Dashboards → New dashboard**, one APL query per panel,
using the `besidka-consent` dataset (30-day rolling window):

1. **Decision split** (donut / statistic): the all/partial/none counts —
   query in "Example Axiom APL queries" above.
2. **Acceptance trend** (time series):

   ```apl
   ['besidka-consent']
   | where ['consent.decision'] != ""
   | summarize count() by ['consent.decision'], bin(_time, 1d)
   ```

3. **Per-category acceptance** (table): the acceptance-rate query above,
   repeated per category id, or extended with one `countif` per category.
4. **Withdrawals** (time series + monitor): decisions turning `none` —
   alert on spikes (often means a scary banner change or a bug):

   ```apl
   ['besidka-consent']
   | where ['consent.decision'] == "none"
   | summarize count() by bin(_time, 1h)
   ```

5. **Consistency monitor** (monitor → threshold): `consent.consistent ==
   false` should stay near zero; a spike means the client/cookie race
   regressed:

   ```apl
   ['besidka-consent']
   | where ['consent.consistent'] == false
   | summarize count() by bin(_time, 1h)
   ```

6. **Geography** (bar): `summarize count() by ['country']` — consent
   behavior per market.

### Why a dedicated consent dataset instead of reusing audit?

The 30-day Axiom free-plan window is intentional for the `besidka-consent`
dataset. Consent analytics (acceptance rates, withdrawal spikes, consistency
monitoring) are operational dashboards with a short horizon — the rolling
30-day window is sufficient. The `besidka-audit` dataset retains receipts for
the full 3–5 year compliance window. The separation also keeps token scoping
clean: a read-only token for the consent dataset can be shared with a
front-end dashboard tool without exposing request-level audit events.

**Access scope** — audit data should be queryable without exposing
request-level app logs (token scoping is per dataset). The three-dataset
split gives the right shape: receipts land in all configured drains in
parallel, D1 is the system of record, and each Axiom dataset has a
distinct governance purpose.

---

## Regulatory status of server-side logging (EU + US)

Research date: 2026-06-12. Sources: EDPB Guidelines 2/2023 (technical scope
of ePrivacy Art. 5(3), final Oct 2024), EDPB Guidelines 1/2024 (legitimate
interest), EDPB Guidelines 05/2020 (consent), WP29 Opinion 04/2012, GDPR
Recital 49, CCPA/CPRA + 2026 state privacy laws, CIPA litigation trends,
FTC Act §5 guidance.

### Verdict: logging is NOT subject to cookie consent

Cookie consent (ePrivacy Art. 5(3)) regulates **storing or reading
information on the user's terminal equipment**. All Besidka observability
(evlog wide events for API requests, Vercel AI SDK usage, Better Auth
context, custom fields → Axiom; Cloudflare Workers observability) is
**server-side observation** of data the browser sends anyway — outside
Art. 5(3) per EDPB Guidelines 2/2023. In the US, no state requires opt-in
consent for first-party operational logging; it falls under the CCPA
"business purpose" exception (security, debugging, auditing).

Consequences:

- Do **not** add a "logging" category to the banner.
- Do **not** gate evlog on consent — the legal basis is GDPR
  Art. 6(1)(f) **legitimate interest** (Recital 49 explicitly endorses
  network/information-security logging), which cannot be "withdrawn" the
  way consent can. Users instead have an Art. 21 right to object,
  handled case by case.
- Reading the `better_auth.session_token` cookie server-side IS terminal
  access, but is covered by the strictly-necessary exemption. The
  `cookies_consent` cookie itself is likewise exempt (it implements the
  consent mechanism).
- The line not to cross: combining server-observable signals (IP + UA
  hashing) into a persistent cross-session identifier is fingerprinting
  and WOULD fall back under Art. 5(3) consent (cf. the Criteo
  enforcement). Nothing in the codebase does this; keep it that way.

### Verified data-flow facts (audited 2026-06-12)

What actually ships to Axiom — verified against `evlog` internals and the
drain pipeline, not just our call sites:

- **No raw IP address ever reaches Axiom.** `attachCloudflareMeta()`
  (`server/utils/cloudflare-meta.ts`) attaches only `cfColo`, `cfCountry`,
  `cfRegion`, `cfRegionCode`, `cfContinent`, `cfAsn`, `cfTimezone` —
  country/region-level aggregate metadata, no `cf-connecting-ip`, no
  city/latitude/longitude.
- **Request headers are never serialized into the Axiom payload.** evlog
  drains receive headers only as side context (`ctx.headers`, already
  passed through `filterSafeHeaders` which strips `authorization`,
  `cookie`, `x-api-key`); `defineDrain` ships **only `ctx.event`** (the
  wide event) to the ingest endpoint. The only header-derived value in
  the event is `requestMeta.cfRay` (infrastructure request id).
- **evlog's optional `userAgent`/`geo` enrichers are NOT enabled** — the
  geo enricher would add city/lat/long; it is not wired anywhere. Do not
  enable it without revisiting this section.
- `redact: true` masks request/response bodies; fields passed explicitly
  to `logger.set()` bypass redaction — minimization happens at the call
  site (see below).
- Auth routes (`/api/auth/**`) are excluded from the identity middleware;
  `maskEmail: true` hashes the email field
  (`server/middleware/evlog-auth.ts`).
- Chat message content, prompts, completions, and reasoning output are
  **never** logged.
- Raw IP + user-agent exist in exactly two places, neither of which is
  Axiom: the `sessions` table (Better Auth session security / rate
  limiting — D1 only) and Cloudflare Workers Logs
  (`wrangler.jsonc` → `observability.enabled`, Cloudflare-side short
  retention). Both rest on legitimate interest and must be disclosed in
  the privacy policy.

### Per-sink legal basis

| Sink | Personal data | Legal basis | Notes |
| --- | --- | --- | --- |
| Axiom main | `userId`, `userName`, country-level geo | Art. 6(1)(f) legitimate interest | Ops/security/cost telemetry; 30-day retention is fine |
| Axiom audit | same + `audit` actions | Art. 6(1)(f) + Art. 7(1) accountability | Long retention justified by consent-proof duty |
| Axiom consent | pseudonymous receipt only | Art. 7(1) (legally required) | No user link, no IP, no UA |
| D1 `CONSENT_DB` | pseudonymous receipt + country | Art. 7(1) | System of record |
| CF Workers Logs | raw IP, UA in headers | Art. 6(1)(f) (Recital 49) | Cloudflare-side retention is short; disclose |
| `sessions` table | raw IP, UA | Art. 6(1)(f) session security | Deleted with session lifecycle |
| AI SDK telemetry | tokens, estimated cost, tool-call shape | Art. 6(1)(f) / Art. 6(1)(b) billing | Tool input **content** is not captured (see below) |

US view: none of the above is a CCPA "sale" or "share" — Axiom and
Cloudflare act as service providers under their standard DPAs. A
"Do Not Sell or Share" link and GPC handling become relevant only when
analytics/marketing categories activate with third-party ad-tech.

### Data-minimization rules at logging call sites

`logger.set()` bypasses `redact: true`, so user-generated **content**
must never be passed to it — log shape, not substance:

- Chat rename logs `titleLength`, not the title
  (`server/api/v1/chats/[slug]/rename.patch.ts`).
- Project create/rename log `nameLength`, not the name
  (`server/api/v1/projects/index.put.ts`,
  `server/api/v1/projects/[id]/name.patch.ts`).
- Project instructions/memory endpoints log `hasInstructions` /
  `enabled` booleans only.
- AI tool inputs (e.g. `web_search` queries — conversation-derived
  content) are transformed to `{ length }` before capture
  (`createAILogger` `toolInputs.transform` in
  `server/api/v1/chats/[slug]/index.post.ts`). Tool **names** and
  counts remain logged.
- Known justified exception: `fileName` appears in file-persistence
  **error paths** (`server/utils/files/persist-file.ts`) — needed to
  debug failed uploads; covered by legitimate interest, disclosed here.

When adding a new `logger.set()` call, apply the same test: if the value
was typed by a user, log its length/hash/presence — not the value. This
also keeps CIPA (California wiretapping) exposure at zero: the 2022–2026
litigation wave targets sites sharing communication content with
third-party vendors; Besidka ships none to Axiom.

### Compliance checklist (org-side, before/with feat/244 legal pages)

1. **Privacy policy** must disclose: purposes (security, debugging, cost
   monitoring, consent accountability); legal bases (legitimate
   interest; Art. 7(1) for receipts); categories (user id, country,
   usage/cost, request metadata; IP/UA in CF logs and session records);
   **named processors: Axiom, Inc. and Cloudflare, Inc.**; retention
   per sink; transfer mechanism (EU-US Data Privacy Framework); user
   rights incl. Art. 21 objection to legitimate-interest processing.
2. **Processor paperwork**: verify Axiom on
   <https://www.dataprivacyframework.gov/participant-search> and keep
   their DPA on file; Cloudflare Customer DPA (v6.3+, DPF-certified).
   If DPF reliance fails, fall back to SCCs.
3. **Document a short LIA** (legitimate-interest assessment) + retention
   table — converts "probably fine" into demonstrable Art. 5(2)
   accountability. The three-part test (purpose/necessity/balancing)
   passes for this setup given the minimization above.
4. **When a marketing category or an ad-tech analytics vendor activates**
   (the `analytics` category with Cloudflare Web Analytics, a processor with no
   cross-site tracking, does not trigger this): add a
   "Do Not Sell or Share My Personal Information" mechanism
   (California), detect and honor the `Sec-GPC` header server-side
   (12 states mandate GPC as of 2026), propagate opt-outs to any
   analytics vendor, and consider adding a `gpc` boolean to consent
   receipts.
5. **Do not** enable evlog's geo enricher (city/lat/long), log raw IPs
   to Axiom, or build identifiers from IP+UA — each would change the
   legal analysis above.
