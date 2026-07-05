# Email

## Overview

This document is the source of truth for transactional email:

- how the app sends email today (Cloudflare Email Sending Workers binding);
- configuration reference (wrangler binding, vars, runtime config, DNS);
- testing notes for the `cloudflare:workers` binding under Vitest;
- migration history (Resend → Cloudflare, PR #284);
- a detailed runbook for **reverting to Resend** if that decision changes.

The app sends only two kinds of transactional email — password reset and
email verification — both triggered by Better Auth. There is no marketing or
bulk email. Keep it that way: Cloudflare Email Sending is for transactional
mail only.

## Current architecture (Cloudflare Email Sending)

Email is sent through the native Cloudflare Email Sending **Workers binding**
`EMAIL`. There is **no API key** — the binding authenticates via the platform,
exactly like the `DB`, `KV`, and `DATA_BUCKET` bindings.

### Files

| File | Role |
|------|------|
| `server/utils/email.ts` | `useEmail().send()` — the single send path |
| `server/utils/auth.ts` | Better Auth `sendResetPassword` / `sendVerificationEmail` callers |
| `wrangler.jsonc` | `send_email` binding + `NUXT_EMAIL_SENDER_*` vars (preview + production) |
| `nuxt.config.ts` / `index.d.ts` | `emailNoopEnabled`, `emailSenderNoreply`, `emailSenderPersonalized` runtime config |
| `.dev.vars.example` | documents `NUXT_EMAIL_NOOP_ENABLED` |
| `tests/integration/server/email.spec.ts` | unit coverage (injects a fake binding) |
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

### Plain-text fallback

Callers should pass an explicit `text` part. When they don't, `send()` derives
one from the HTML via `htmlToText()`, which is link-aware (it rewrites
`<a href="URL">label</a>` to `label (URL)` so plaintext MUAs keep the link)
and decodes common HTML entities. Both current callers pass `text` explicitly,
so the fallback is a safety net for future HTML templates.

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
