# Email

## Overview

This document is the source of truth for transactional email:

- how the app sends email today (Cloudflare Email Sending Workers binding);
- configuration reference (wrangler binding, vars, runtime config, DNS);
- testing notes for the `cloudflare:workers` binding under Vitest;
- migration history (Resend → Cloudflare, PR #284);
- a detailed runbook for **reverting to Resend** if that decision changes.

The app sends transactional email only — there is no marketing or bulk
email. Keep it that way: Cloudflare Email Sending is for transactional mail
only.

As of the styled-emails work, that transactional mail spans 13 flows built
from 2 Vue SFC template shapes rendered by `nuxt-email-renderer`
(see [Templates](#templates) below):

- **4 action-link emails** (`ActionEmail.vue`): reset password, verify
  email, confirm a new email address, confirm account deletion. All
  triggered by Better Auth callbacks in `server/utils/auth.ts`.
- **9 security notices** (`NoticeEmail.vue`), sent via
  `server/utils/account/security-emails.ts`: password changed, sign-in
  method connected/disconnected, two-factor turned on/off, two-factor
  backup codes regenerated, account email changed, passkey added/removed.

Both shapes are sent through a single helper, `sendTemplateEmail()`, which
wraps `nuxt-email-renderer`'s `renderEmailComponent()` and `useEmail().send()`
(see [Templates](#templates)).

## Current architecture (Cloudflare Email Sending)

Email is sent through the native Cloudflare Email Sending **Workers binding**
`EMAIL`. There is **no API key** — the binding authenticates via the platform,
exactly like the `DB`, `KV`, and `DATA_BUCKET` bindings.

### Files

| File | Role |
|------|------|
| `server/utils/email.ts` | `useEmail().send()` — the single low-level send path |
| `server/utils/email-template.ts` | `sendTemplateEmail()` — renders an `ActionEmail`/`NoticeEmail` template (html + plain text) and hands both to `useEmail().send()` |
| `app/emails/**` | The two Vue SFC templates (`ActionEmail.vue`, `NoticeEmail.vue`) plus shared layout pieces (`components/EmailLayout.vue`, `EmailHeader.vue`, `EmailFooter.vue`, `theme.ts`) |
| `server/utils/auth.ts` | Better Auth `sendResetPassword` / `sendVerificationEmail` / `sendChangeEmailConfirmation` / `sendDeleteAccountVerification` callers, all via `sendTemplateEmail()` with `ActionEmail` |
| `server/utils/account/security-emails.ts` | The 9 security-notice senders, all via `sendTemplateEmail()` with `NoticeEmail` |
| `wrangler.jsonc` | `send_email` binding + `NUXT_EMAIL_SENDER_*` vars (preview + production) |
| `nuxt.config.ts` / `index.d.ts` | `emailNoopEnabled`, `emailSenderNoreply`, `emailSenderPersonalized` runtime config; the `nuxtEmailRenderer` module options block and the `forceInlineVueI18nForEmailRenderer` local module (see [Templates](#templates)) |
| `.dev.vars.example` | documents `NUXT_EMAIL_NOOP_ENABLED` |
| `tests/integration/server/email.spec.ts` | unit coverage for `useEmail()` (injects a fake binding) |
| `tests/integration/server/email-templates.spec.ts` | real Vue SSR render coverage for `ActionEmail`/`NoticeEmail` (see [Templates](#templates)) |
| `tests/unit/utils/email-template.spec.ts` | unit coverage for `sendTemplateEmail()`'s union-narrowing and argument passthrough (mocks `renderEmailComponent`) |
| `vitest.config.mts` + `tests/setup/mocks/cloudflare-workers.ts` | resolves `cloudflare:workers` under Vitest |

### Send path

`useEmail()` reads sender addresses and the noop flag from runtime config and
takes the `EMAIL` binding (injectable for tests). `send()` short-circuits in
noop mode, guards against a missing binding, resolves the `from` address by
role, and calls the binding's object-form `send()`:

```ts
return await emailBinding.send({
  from: {
    name: 'Besidka',
    email: resultFrom,
  },
  to,
  subject,
  html,
  text: text ?? htmlToText(html),
})
```

Key contract facts (verified against `@cloudflare/workers-types` and the
Cloudflare docs):

- The object form is a first-class, documented `send()` overload — not
  REST-only. It resolves to `{ messageId: string }`.
- `from` as an object requires **both** `name` and `email` (`EmailAddress`);
  a bare `{ email }` is a type error. A plain `string` also works.
- `SendEmail`, `EmailAddress`, and `EmailSendResult` are ambient **global**
  types from `@cloudflare/workers-types` — no import. `pnpm run cf-typegen`
  (`wrangler types`) adds `EMAIL: SendEmail` to the generated `Env` once the
  `send_email` binding exists in `wrangler.jsonc`.
- The object form needs **no** `nodejs_compat` and **no** `mimetext` (those are
  only for the legacy `EmailMessage` raw-MIME path).

### Templates

Both template shapes live under `app/emails/`:

- `ActionEmail.vue` — heading, intro text, a CTA button/link, a raw-URL
  fallback line, and a footnote. Used for every flow that needs the
  recipient to click through (password reset, email verification, email
  change confirmation, account deletion confirmation).
- `NoticeEmail.vue` — heading and a body paragraph, no CTA. Used for
  after-the-fact security notices that only inform, never require action.

Both wrap `components/EmailLayout.vue`, which renders the shared
`nuxt-email-renderer` chrome (`EHtml`, `EHead`, `EBody`, `EContainer`) plus
`EmailHeader.vue` (the "Besidka" wordmark) and `EmailFooter.vue` (besidka.com
/ Privacy policy / Terms of use / GitHub links). `components/theme.ts` is the
single source of color/typography constants — a light value and a matching
`*Dark` value per token (`accent`, `surface`, `page`, `text`, `body`, `muted`,
`subtle`, `border`) plus a shared `fontFamily`.

Dark mode is CSS-only (`prefers-color-scheme: dark`), since email clients
can't run JS: `EmailLayout.vue` builds a `darkModeCss` string in
`<script setup>` by interpolating the `*Dark` constants into a
`@media (prefers-color-scheme: dark) { ... }` template literal, then renders
it with `{{ darkModeCss }}` inside `<EStyle>`. `<EStyle>` resolves a single
text child with mixed static text and `{{ }}` interpolations into one
already-interpolated string at render time, so this is a plain, non-reactive
string substitution, not a runtime binding — verified against
`node_modules/nuxt-email-renderer/dist/runtime/components/style/EStyle.vue`.
Light-mode colors are applied directly as inline `:style` bindings on each
element (email clients strip `<style>` classes unpredictably, so light mode
can't rely on the class-based override the dark-mode block uses). The
`color-scheme: light dark;` `:root` rule and the `<meta name=
"supported-color-schemes" content="light dark">` tag in `<EHead>` are what
actually opt email clients into dark mode — `supported-color-schemes` is
*not* a real CSS property, so it must be the `<meta>` tag only, never
duplicated inside the `:root {}` block.

`server/utils/email-template.ts` exports `sendTemplateEmail({ to, subject,
template, props, from })`, which calls `renderEmailComponent(template,
props)` for the HTML body and `renderEmailComponent(template, props,
{ plainText: true })` for the plain-text body, then passes both to
`useEmail().send()`.

The dev-only render endpoint (`nuxt-email-renderer`'s own
`POST /api/emails/render`) is useful for manually inspecting a template
without sending a real email:

```bash
curl -s http://localhost:3000/api/emails/render \
  -H 'Content-Type: application/json' \
  -d '{"name":"ActionEmail","props":{"preview":"p","heading":"h","intro":"i","ctaLabel":"Go","url":"https://besidka.com","footnote":"f"}}'
```

Pass `"plainText": true` in the body to get the plain-text render instead.

### Plain-text fallback

`sendTemplateEmail()` — the path every current template uses — gets its
plain-text body from `nuxt-email-renderer`'s own renderer
(`renderEmailComponent(template, props, { plainText: true })`), which is
itself backed by `html-to-text`. It does **not** go through `email.ts`'s
`htmlToText()`.

`email.ts`'s `htmlToText()` fallback only fires for a caller that calls
`useEmail().send()` directly without passing `text` — today, no caller does
that (every caller goes through `sendTemplateEmail()`, which always passes an
explicit `text`). It remains in place as a safety net for any future direct
`useEmail().send()` caller that skips the template renderer, and is
link-aware (it rewrites `<a href="URL">label</a>` to `label (URL)` so
plaintext MUAs keep the link) and decodes common HTML entities.

## Configuration

### Binding (`wrangler.jsonc`)

Present in **both** the top-level (preview) env and `env.production`, restricted
to the two known senders:

```jsonc
"send_email": [
  {
    "name": "EMAIL",
    "allowed_sender_addresses": [
      "noreply@besidka.com",
      "serhii@besidka.com"
    ]
  }
]
```

- `allowed_sender_addresses` restricts **senders only** — it has no effect on
  recipients. Recipients are unrestricted (arbitrary) because `besidka.com` is
  onboarded to Email *Sending* (not merely Email *Routing*, which limits the
  binding to verified destinations).
- Do **not** add `destination_address` / `allowed_destination_addresses` — those
  would pin or allowlist recipients, breaking sends to arbitrary users.
- Do **not** commit `"remote": true`. That flag is **local-dev-only**: with it,
  `wrangler dev` / `pnpm run preview` sends **real** email. Add it ad hoc only
  when you specifically want to test a live send locally.

### Vars and runtime config

`wrangler.jsonc` vars (both envs):

```jsonc
"NUXT_EMAIL_SENDER_NOREPLY": "noreply@besidka.com",
"NUXT_EMAIL_SENDER_PERSONALIZED": "serhii@besidka.com"
```

`nuxt.config.ts` `runtimeConfig`:

```ts
emailNoopEnabled: false,
emailSenderNoreply: '',
emailSenderPersonalized: '',
```

`NUXT_EMAIL_NOOP_ENABLED=true` (set in CI E2E) makes `send()` return
`{ messageId: 'email-noop' }` without touching the binding.

### DNS (already provisioned by Cloudflare on domain onboarding)

- `cf-bounce.besidka.com` — MX (bounce routing) + SPF
  (`v=spf1 include:_spf.mx.cloudflare.net ~all`)
- `cf-bounce._domainkey.besidka.com` — DKIM
- `_dmarc.besidka.com` — DMARC (`p=reject`)

Verify with `dig`:

```bash
dig +short TXT cf-bounce.besidka.com
dig +short TXT cf-bounce._domainkey.besidka.com
dig +short TXT _dmarc.besidka.com
```

### Requirements

- Email Sending requires the **Workers Paid** plan.
- Domain must be onboarded to Email Sending: `npx wrangler email sending enable besidka.com`
  (or via the dashboard). Check with `npx wrangler email sending list`.

## Testing

A server util that does `import { env } from 'cloudflare:workers'` cannot be
imported directly in a spec under the `nuxt` Vitest environment out of the box —
that specifier only resolves inside workerd / Nitro's `cloudflare_module`
rollup, so Vite throws `Failed to resolve import "cloudflare:workers"`. (Other
specs avoid this by stubbing the auto-imported global, e.g.
`vi.stubGlobal('useDb', ...)`, rather than importing the module.)

To test `email.ts` directly:

1. `vitest.config.mts` aliases the specifier to a stub so Vite can resolve it:

   ```ts
   resolve: {
     alias: {
       'cloudflare:workers': fileURLToPath(
         new URL('./tests/setup/mocks/cloudflare-workers.ts', import.meta.url),
       ),
     },
   },
   ```

   The stub is `export const env = {}`. This alias is **suite-wide**: any module
   importing `cloudflare:workers` resolves to an empty `env`, so tests must
   inject bindings explicitly rather than read from `env`.

2. The spec mocks the specifier and injects a fake binding:

   ```ts
   vi.mock('cloudflare:workers', () => ({ env: {} }))
   // ...
   const fakeBinding = { send: vi.fn().mockResolvedValue({ messageId: 'm1' }) }
   const email = useEmail(runtimeConfig, fakeBinding)
   ```

3. `createError` is not auto-injected in this pipeline either — stub it via
   `vi.stubGlobal('createError', ...)` (mirror `chats-new.spec.ts`).

The spec is registered in `scripts/test-affected-check.mjs` under `emailTests`,
mapped to `server/utils/(email|auth).ts`.

## Migration history

PR #284 (2026-07-05) replaced Resend with Cloudflare Email Sending:

- Removed the `resend` npm dependency and the `NUXT_RESEND_API_KEY` secret.
- Added the `send_email` binding; renamed `NUXT_RESEND_SENDER_*` →
  `NUXT_EMAIL_SENDER_*`.
- Added a plain-text part to both emails and the `htmlToText` fallback.

Rationale: the app already runs entirely on Cloudflare Workers, so the native
binding removes an external dependency and an outbound secret, and keeps email
inside the same platform (billing, observability, deliverability) as the rest
of the stack.

## Reverting to Resend

Reverting is safe and mechanical. Two paths — pick by how much control you want.

Prerequisites for either path (Resend-side, outside this repo):

- A valid Resend API key.
- `besidka.com` verified in the Resend dashboard with Resend's own SPF/DKIM DNS
  records in place. (The Cloudflare `cf-bounce.*` records can stay — they are
  harmless when Resend is the sender.)

### Option A — revert the migration commit (fastest)

The migration is a single commit. Revert it, then run the follow-up steps.

```bash
# On the feat branch (or on main, using the squash-merge SHA if it was merged):
git revert 8df48ff        # the migration commit
```

This reverses all 13 committed files at once: restores the Resend SDK in
`email.ts`, re-adds `resend` to `package.json` and the old lockfile, removes the
`send_email` binding, restores the `NUXT_RESEND_SENDER_*` var names, and
restores the old test.

Then:

```bash
pnpm install                 # restore resend into node_modules from the lockfile
pnpm run cf-typegen          # regenerate types (EMAIL binding drops out of Env)
pnpm run typecheck && pnpm vitest run tests/integration/server/email.spec.ts
```

Re-add the secret to both Worker environments:

```bash
npx wrangler secret put NUXT_RESEND_API_KEY                 # preview (default env)
npx wrangler secret put NUXT_RESEND_API_KEY --env production
```

Set `NUXT_RESEND_API_KEY` in `.dev.vars` for local dev if you send email locally.

> If the PR was squash-merged, run `git revert <squash-commit-sha>` on `main`
> instead of the branch commit SHA.

### Option B — manual, file-by-file

Use this when you want partial control (for example, keeping the `htmlToText`
fallback or the expanded tests). Below is the target state of each file.

**`package.json`** — re-add the dependency (the version at migration time):

```jsonc
"resend": "6.17.0",
```

Then `pnpm install`.

**`server/utils/email.ts`** — restore the Resend implementation:

```ts
import { Resend } from 'resend'

type From = 'noreply' | 'personalized'

interface EmailRuntimeConfig {
  emailNoopEnabled: boolean | string
  resendApiKey: string
  resendSenderNoreply: string
  resendSenderPersonalized: string
}

function getSenderEmail(
  from: From,
  resendSenderNoreply: string,
  resendSenderPersonalized: string,
): string {
  switch (from) {
    case 'noreply':
      if (resendSenderNoreply) {
        return resendSenderNoreply
      }

      throw createError('Sender email is required for noreply emails')
    case 'personalized':
      if (resendSenderPersonalized) {
        return resendSenderPersonalized
      }

      throw createError('Sender email is required for personalized emails')
    default:
      throw createError('Invalid sender type')
  }
}

export const useEmail = (
  runtimeConfig: EmailRuntimeConfig = useRuntimeConfig(),
) => {
  const {
    emailNoopEnabled,
    resendApiKey,
    resendSenderNoreply,
    resendSenderPersonalized,
  } = runtimeConfig

  async function send({
    to,
    subject,
    html,
    from = 'noreply' as From,
  }: {
    to: string
    subject: string
    html: string
    from?: From
  }) {
    if (!to || !subject || !html) {
      throw createError('Missing required parameters: to, subject, or html')
    }

    if (String(emailNoopEnabled) === 'true') {
      return { id: 'email-noop' }
    }

    if (!resendApiKey) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Resend API key is not set in the runtime configuration.',
      })
    }

    const resultFrom = getSenderEmail(
      from,
      resendSenderNoreply,
      resendSenderPersonalized,
    )
    const resend = new Resend(resendApiKey)

    try {
      return await resend.emails.send({
        from: resultFrom,
        to,
        subject,
        html,
      })
    } catch (exception: any) {
      throw createError(exception)
    }
  }

  return {
    send,
  }
}
```

> Resend accepts a plain-string `from` (`'noreply@besidka.com'` or
> `'Besidka <noreply@besidka.com>'`) and does not require a `text` part, so the
> callers can drop `text` — but keeping `text` is harmless and better for
> deliverability. If you keep `htmlToText`, keep passing `text: text ?? htmlToText(html)`.

**`server/utils/auth.ts`** — the `text` field is optional for Resend; you may
leave it or remove it from both `sendResetPassword` and `sendVerificationEmail`.

**`nuxt.config.ts`** — restore the Resend runtime config keys:

```ts
emailNoopEnabled: false,
resendApiKey: '',
resendSenderNoreply: '',
resendSenderPersonalized: '',
```

**`index.d.ts`** — restore the `RuntimeConfig` keys:

```ts
resendApiKey: string
resendSenderNoreply: string
resendSenderPersonalized: string
```

(Drop `emailNoopEnabled` again only if you want to match the pre-migration
interface exactly — it was missing there. Leaving it typed is fine.)

**`wrangler.jsonc`** — remove **both** `send_email` blocks and rename the vars
back in **both** envs:

```jsonc
"NUXT_RESEND_SENDER_NOREPLY": "noreply@besidka.com",
"NUXT_RESEND_SENDER_PERSONALIZED": "serhii@besidka.com"
```

**`.dev.vars.example`** — restore the Resend block:

```
# Resend
# https://resend.com/api-keys
NUXT_RESEND_API_KEY=
# Set true in CI E2E to skip real email sending
NUXT_EMAIL_NOOP_ENABLED=false
```

**`tests/integration/server/email.spec.ts`** — restore the Resend mock
(`vi.mock('resend', ...)`) and assert `{ id: 'email-noop' }` for the noop case.
The `cloudflare:workers` alias in `vitest.config.mts` and the stub file become
unused; they are harmless to keep and can be left in place for future binding
tests, or removed.

**`README.md`** — change the tech-stack link back to Resend.

Then run the operational steps from Option A (`pnpm install`,
`pnpm run cf-typegen`, secrets, verify).

### Option C — make it switchable (recommended for real flexibility)

If you want to flip providers without a code revert, add a provider strategy to
`useEmail()` keyed off runtime config. This is **not implemented today** — it is
a sketch to make the future decision a config change rather than a diff:

```ts
// runtimeConfig: emailProvider: 'cloudflare' | 'resend'
export const useEmail = (
  runtimeConfig = useRuntimeConfig(),
  emailBinding = env.EMAIL,
) => {
  async function send(input: SendInput) {
    // shared: noop guard, sender resolution, htmlToText fallback ...

    if (runtimeConfig.emailProvider === 'resend') {
      const resend = new Resend(runtimeConfig.resendApiKey)

      return await resend.emails.send({ from, to, subject, html, text })
    }

    return await emailBinding.send({ from: { name, email: from }, to, subject, html, text })
  }

  return { send }
}
```

Trade-off: this keeps the `resend` dependency and the `NUXT_RESEND_API_KEY`
secret around permanently. Only add it if provider flexibility is a real,
recurring requirement — otherwise the plain revert above is cleaner.
