# @besidka/nuxt-cookie-consent

Headless, project-agnostic cookie consent module for Nuxt 4. Published as
an npm-compatible pnpm workspace package — add it to the `modules` array
in `nuxt.config.ts`.

## Installation

```bash
pnpm add @besidka/nuxt-cookie-consent
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@besidka/nuxt-cookie-consent'],
})
```

> In the Besidka monorepo, this package lives in `modules/cookie-consent/`
> and is consumed via a pnpm workspace reference — no separate install
> needed.  The package is no longer auto-discovered via the Nuxt
> `modules/` scan; it must be listed explicitly.

The module ships **logic, state, persistence, events, i18n texts and
accessibility behavior**. It ships **no styling**: no Tailwind, no DaisyUI,
no CSS at all. Markup is fully controlled by the consuming app through
scoped slots; sensible unstyled semantic markup is rendered when slots are
omitted, so the module works out of the box.

## Design principles

- **Headless first.** Primitives expose behavior + state via scoped slots
  (Headless-UI style). The app owns every pixel.
- **Declarative cookie registry.** Categories and cookie entries are declared
  in `nuxt.config.ts`. No runtime `document.cookie` scanning — HttpOnly
  cookies are invisible to JS, so scanning is unreliable by design; a
  declared manifest is the industry standard (what Cookiebot's crawler
  produces for you, declared by hand here).
- **Structure in config, texts in i18n.** Declarations carry only ids and
  technical metadata. Every human-readable string (category titles,
  descriptions, per-cookie purposes, durations, button labels) is an i18n
  message, so the banner is localizable even in single-language apps.
- **Opt-in by default.** All non-required categories are denied until the
  user explicitly commits a choice (GDPR).
- **The consent cookie is itself "necessary".** Storing the user's decision
  is exempt from consent under ePrivacy — a decision is always persisted,
  whether it is "allow all" or "withdraw".

## Module options (`cookieConsent` key in `nuxt.config.ts`)

```ts
interface CookieEntryDeclaration {
  id: string
  // i18n slug: cookieConsent.entries.<id>.{description,duration}
  name: string
  // actual cookie / storage key; '*' suffix allowed (prefix match)
  type?: 'cookie' | 'localStorage' | 'sessionStorage' // default 'cookie'
}

interface CookieCategoryDeclaration {
  id: string // i18n slug: cookieConsent.categories.<id>.{title,description}
  required?: boolean // locked on; default false
  entries?: CookieEntryDeclaration[]
}

interface ModuleOptions {
  enabled: boolean // kill switch, default true
  cookieName: string // default 'cookies_consent'
  cookieMaxAge: number // seconds, default 180 days (EDPB/CNIL re-prompt norm)
  revision: number // default 1; bump to force re-consent for all users
  showDelay: number // ms before auto-opening the popup, default 1200
  categories: CookieCategoryDeclaration[]
  // default: necessary (required) + preferences + analytics + marketing
}
```

Options are exposed at `runtimeConfig.public.cookieConsent` so runtime code
and the consuming app can read them.

## Persistence

A single first-party cookie (default `cookies_consent`, SameSite Lax,
`maxAge` 180 days) holding JSON:

```json
{
  "v": 1,
  "granted": ["necessary", "analytics"],
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "date": "2026-06-11T12:00:00.000Z"
}
```

- The cookie's presence with `v === revision` means "the user has decided".
- `v !== revision` is treated as undecided → the popup auto-shows again.
- `id` and `date` are regenerated on every commit — each commit is a new
  consent receipt. Legacy cookies without `id`/`date` are still recognised
  as decided; the receipt fields appear after the next commit.
- Required categories are always part of `granted` — including before any
  decision, so `isAllowed()` is always `true` for required categories.
- SSR-safe read via `useCookie`; canonical reactive state lives in
  `useState`, hydrated once from the cookie.

## Composables

### `useCookieConsent()`

```ts
const {
  categories,     // CookieCategoryDeclaration[] (resolved, with required flags)
  granted,        // DeepReadonly<Ref<string[]>> — committed category ids (read-only)
  isDecided,      // ComputedRef<boolean> — backed by shared useState, stays in sync across instances
  consentId,      // Readonly<Ref<string | null>> — receipt id; null until first commit or for legacy cookies
  consentDate,    // Readonly<Ref<string | null>> — ISO date string; null until first commit or for legacy cookies
  isAllowed,      // (categoryId: string) => boolean — reactive when used in effects
  allow,          // (categoryIds: string[]) => void — commits exactly these + required
  allowAll,       // () => void — for programmatic use; UI should call ui.allowAll()
  withdrawAll,    // () => void — only required categories remain; UI should call ui.withdrawAll()
  onConsentChange, // (cb, options?) => stop
} = useCookieConsent()
```

`onConsentChange(cb, { immediate?: boolean })` subscribes to consent commits.
With `immediate: true` the callback also fires right away when a decision
already exists (late analytics init). Returns an unsubscribe function and
auto-cleans within component scope.

Commits (and only commits — not draft toggling) also call the Nuxt hook
`cookie-consent:changed` with payload:

```ts
interface CookieConsentChangedPayload {
  granted: string[]
  denied: string[]
  changed: string[] // ids whose state differs from the previous commit
}
```

On commit the module deletes browser-visible cookies / storage entries
declared in categories that are not granted (best effort; HttpOnly cookies
must be handled by the server).

### `useCookieConsentUi()`

```ts
const {
  view,           // Readonly<Ref<'hidden' | 'popup' | 'modal'>>
  draft,          // Ref<Record<string, boolean>> — uncommitted switches state (shared across instances)
  toggleDraft,    // (categoryId: string) => void (no-op for required)
  commitDraft,    // () => void — "Allow selected"; closes immediately
  allowAll,       // () => void — commits all + closes immediately
  withdrawAll,    // () => void — withdraws to required only + closes immediately
  openPopup,      // (trigger?: HTMLElement) => void
  expand,         // () => void — popup → modal, carries draft as-is
  close,          // () => void — discards draft, restores focus
  isTriggerNode,  // (node: Node | null) => boolean — true when node is/contains the stored trigger
  scheduleAutoShow, // () => void — see auto-show policy
  switchProps,    // (categoryId: string) => { role, aria-checked, disabled }
} = useCookieConsentUi()
```

The draft is shared across all composable instances via `useState`. It is
(re)initialized from committed consent when the UI opens from `'hidden'`.
Transitioning from popup → modal (`expand()`) carries the draft as-is so
toggles made in the popup are preserved. Closing without a CTA discards the
draft — consent never changes without an explicit commit.

`allowAll()` and `withdrawAll()` in `useCookieConsentUi()` are the UI-layer
wrappers: they commit the decision and close the UI immediately (synchronously).
The same-named functions on `useCookieConsent()` are raw commit primitives for
programmatic use (no UI interaction).

`isTriggerNode(node)` returns `true` when `node` is, or is contained by, the
element that opened the current UI session. Returns `false` when no trigger is
stored, when the trigger is `document.body` / `document.documentElement`
(guards against spurious full-document matches), or when `node` is `null`.
Used by `CookieConsentPopup`'s outside-click handler to prevent
close-then-reopen on the same trigger click.

## Components (headless primitives, client-only)

All primitives accept attrs/classes pass-through and expose the full action
surface as slot props (`categories`, `draft`, `toggleDraft`, `commitDraft`,
`allowAll`, `withdrawAll`, `expand`, `close`, `isDecided`, `granted`,
`isAllowed`, `consentId`, `consentDate`). The `allowAll` and `withdrawAll`
slot props are the UI-layer wrappers that commit and then close the dialog
immediately; they are not the raw `useCookieConsent()` primitives. `consentId`
and `consentDate` reflect the current consent receipt — `null` while undecided
or for legacy cookies without receipt fields.

- `<CookieConsentTrigger>` — renders a `<button aria-haspopup="dialog">`
  that **toggles** the consent UI: clicking when the UI is hidden opens the
  popup; clicking when the popup or modal is open closes it. Exposes
  `{ isOpen: boolean }` as a slot prop (true when `view !== 'hidden'`) so
  the app can swap icons. The button also sets `:aria-expanded` accordingly.
  A race-condition guard prevents the outside-click handler in
  `CookieConsentPopup` from re-opening when the same trigger click closes the
  popup.
- `<CookieConsentPopup>` — small non-modal `role="dialog"` panel. Accepts an
  optional `transition` prop (Vue `<Transition>` name); when provided, the
  panel is wrapped in `<Transition :name="transition">` for enter/leave
  animations. Auto-show: calls `scheduleAutoShow()` on mount unless
  `:auto-show="false"`.
- `<CookieConsentModal>` — full `role="dialog" aria-modal="true"` dialog with
  overlay. Accepts an optional `transition` prop; when provided, the entire
  overlay+dialog is wrapped in `<Transition :name="transition">`.

## Accessibility behavior (owned by the module)

- **Popup**: `role="dialog"`, labelled by its title; initial focus moves to
  the dialog container (`tabindex="-1"`); Esc closes; click outside closes;
  Tab cycles within the popup (inner loop across switches and CTA buttons).
- **Modal**: `role="dialog" aria-modal="true"`; focus trap with Tab /
  Shift+Tab wrap; Esc closes (discards draft); overlay click closes.
- **Focus restore**: on close, focus returns to the element that opened the
  UI (trigger button for mouse and keyboard users alike). When the popup
  auto-opened without an explicit trigger, focus returns to whichever element
  was active at the time `openPopup()` was called (`document.activeElement`),
  falling back to blurring the active element and focusing `<body>` when the
  saved target is no longer in the document.
- **Switches**: the slot props include per-category
  `switchProps(categoryId)` → `{ role: 'switch', 'aria-checked', disabled }`
  so app markup stays accessible regardless of the element used.

## Auto-show / re-display policy

- Undecided visitor: the **popup** (small, non-blocking — not the modal)
  auto-opens `showDelay` ms after hydration, once per app boot.
- Dismissing without a decision (Esc, outside click, close button) keeps the
  visitor undecided: nothing is persisted and the popup auto-opens again on
  the **next page load** — not again in the same SPA session (no dark
  patterns, no nagging).
- After a decision: no auto-show. The floating trigger remains the only
  entry point. Bumping `revision` re-triggers the flow.

## i18n

`@nuxtjs/i18n` is a declared `moduleDependencies` peer — the module
framework ensures it is loaded and configured before this module's `setup`
runs. If the app already registers `@nuxtjs/i18n` with its own settings,
those take precedence; if not, sensible defaults are applied
(`strategy: 'no_prefix'`, no browser detection, default locale `en`) so
app routing is unaffected. The module then registers its message files via
the `i18n:registerModule` hook regardless.

Shipped locales: `en`, `uk`. All keys live under `cookieConsent.*`:

```
cookieConsent.title / description / close
cookieConsent.currentState
cookieConsent.details.{show,hide,date,id}
cookieConsent.actions.{allowAll,allowSelected,withdraw,customize,change}
cookieConsent.categories.<id>.{title,description}
cookieConsent.entries.<id>.{description,duration}
```

Apps override or extend texts through their own i18n messages; unknown
category/entry ids fall back to the raw id, so missing texts never break
rendering.

## Server util

`getCookieConsent(event)` (auto-imported in Nitro) parses the consent cookie
from an `H3Event` and returns `{ isDecided, granted, isAllowed(id) }` for
server-side gating (defense in depth for analytics endpoints).

## Usage example (styled layer lives in the app, not here)

```vue
<CookieConsentPopup v-slot="{ categories, draft, toggleDraft, switchProps,
  commitDraft, allowAll, withdrawAll, expand, close }"
>
  <!-- app-owned markup, e.g. DaisyUI card + toggles -->
</CookieConsentPopup>
```

The Besidka app styles the banner in `app/components/Cookies/` with
Tailwind + DaisyUI and mounts `<LazyCookiesBanner />` once in `app.vue`.
