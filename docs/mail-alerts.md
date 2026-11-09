# Mail alerts: a phone push for the legal and security mailboxes

Mail to `privacy@`, `abuse@`, `security@` and `contact@besidka.com` can start a
legal clock: a TCO removal order must be acted on within one hour
(`docs/legal/content-incidents.md`, section 3), and a personal-data breach must
be reported within 72 hours (`docs/legal/breach-runbook.md`). Until this
change, each address was a Cloudflare Email Routing rule that forwarded to one
Gmail inbox, and nothing told the controller that mail had arrived.

The `besidka-mail-alerts` Email Worker keeps that forward and adds a Web Push
to every admin's phone, normally within seconds.

**Status (2026-11-09):** code ready, not deployed. The owner deploys the
Worker and switches the four rules by hand with the runbook below. Nothing in
CI changes Email Routing rules.

## How it works

```
sender ──SMTP──> Cloudflare Email Routing (rule: privacy@ → Worker)
                   │
                   ▼
          besidka-mail-alerts  email()
            1. await message.forward(FORWARD_TO)   ← same as the old rule
            2. ctx.waitUntil(alert)                ← only after 1 succeeded
                   │  service binding APP → Worker "besidka"
                   ▼
          POST /api/v1/internal/mail-alert   (HMAC-signed, 404 otherwise)
                   │
                   ▼
          Web Push to every admin's subscribed devices
```

| File | Role |
|---|---|
| `workers/mail-alerts/src/main.ts` | `email()` handler: forward, then the signed alert call |
| `workers/mail-alerts/src/classify.ts` | RFC 2047 subject decoding, urgency rules, mailbox mapping |
| `workers/mail-alerts/wrangler.jsonc` | Worker `besidka-mail-alerts`, service binding `APP` → `besidka`, no `workers.dev`, no previews, observability off |
| `shared/utils/mail-alert-protocol.ts` | The contract both sides import: mailboxes, route, header names, HMAC sign and verify, subject sanitiser |
| `server/api/v1/internal/mail-alert/index.post.ts` | The internal route: secret check, bounded body, HMAC, schema, push |
| `server/utils/mail-alerts/notify.ts` | Admin push: title, collapse window, urgency |
| `server/utils/features/admin-recipients.ts` | Who is an admin (shared with scheduled feature changes) |
| `server/utils/push.ts` | `sendPushNotificationToUser` gained an optional `{ ttl, urgency }` |

### Forwarding comes first, and a failed forward is never silent

The handler awaits `message.forward(FORWARD_TO)` before anything else. If
`FORWARD_TO` is unset or the forward throws (for example an unverified
destination), the handler throws too, so Email Routing records the message as
failed in its activity log instead of the Worker swallowing it. What the
sending server sees then (a temporary or a permanent SMTP error) is not
documented by Cloudflare and has not been tested; treat a failed forward as
lost mail and restore the plain forward rule (runbook step 7).

The alert runs in `ctx.waitUntil` after the forward returned, inside its own
`try/catch`. A failing alert (app down, binding missing, secret unset, push
service error) never changes what happens to the mail. Gmail stays the source
of truth; the push is only a wake-up call.

### The internal route

`POST /api/v1/internal/mail-alert` lives on the public Worker, so it is also
reachable from the internet, and the service binding call bypasses the WAF and
rate limits. Its only guard is the shared secret:

- `NUXT_MAIL_ALERT_SECRET` unset → 404 for every call.
- Missing `x-mail-alert-timestamp` or `x-mail-alert-signature` → 404.
- Body over 2 KB (read as a bounded stream, before any parsing) → 404.
- HMAC-SHA256 over `<timestamp>.<body>` checked with `crypto.subtle.verify`
  (constant time), timestamp within ±5 minutes → otherwise 404. A captured
  request cannot be replayed after five minutes.
- Signed but not matching the schema (`mailbox` from the fixed list,
  `subject` at most 400 characters, `urgent` boolean) → 400.
- Valid → 202 with `{ outcome }`.

The Worker classifies urgency itself and sends only `{ mailbox, subject,
urgent }`. The sender address, the recipient address and the body never leave
the Worker.

### What the push says

| | Normal mail | Urgent mail |
|---|---|---|
| Title | `New mail to privacy@` | `Urgent: new mail to privacy@` |
| Body | The subject, decoded, control, bidi and zero-width characters removed, one line, at most 80 characters | Same |
| Web Push `urgency`, `TTL` | `normal`, 300 s | `high`, 600 s |
| Notification `tag` | `besidka-mail-<mailbox>` (a newer one replaces it) | unique per message (never replaced) |
| Collapse | One push per mailbox per 2 minutes (KV key `mail-alert:collapse:<mailbox>`, `expirationTtl: 120`) | Always sent |
| Tap opens | `/admin` | `/admin` |

The collapse window uses KV, which is eventually consistent: two mails a few
seconds apart that land in different Cloudflare locations can both push. That
is acceptable for a wake-up call.

Recipients are every admin, resolved exactly like scheduled feature changes
(`listAdminRecipients`): env admins (`NUXT_ADMIN_EMAILS` with a verified email)
and holders of the `admin` role. Each gets the push on every device that
subscribed. One failing admin never blocks the others.

### Urgency rules (`classify.ts`)

Mail is urgent when any of these holds (after RFC 2047 decoding, lowercasing
and removing Polish diacritics, so `nakaz usunięcia` and `nakaz usuniecia`
both match):

- The subject contains a TCO or authority phrase: `removal order`,
  `nakaz usuniecia`, `terrorist content`, `terrorystyczn…`, `2021/784`,
  `policj…`, `prokurat…`, or the words `abw`, `tco`, `uodo`, `europol`.
- The subject looks like a breach or security report: `breach`, `security
  incident`, `security report`, `security issue`, `vulnerability`, `cve`,
  `csirt`, `naruszenie/naruszenia/naruszeniu ochrony danych`,
  `naruszenie bezpieczenstwa`, `incydent bezpieczenstwa`, `wyciek`,
  `podatnosc`.
- The From display name names an authority (`policj…`, `prokurat…`, `abw`,
  `uodo`, `europol`). The address part is ignored here.
- The From address is in `gov.pl` or `europa.eu` (or a subdomain), **and**
  the first `Authentication-Results` header, the one Cloudflare prepends with
  authserv-id `mx.cloudflare.net`, says `dmarc=pass`. A header the sender
  added is never trusted.

Subjects and display names cannot be authenticated. Anyone can send mail with
"removal order" in the subject and get an urgent push; urgent pushes are never
collapsed, so a flood of such mail would ring the phone each time. That is the
accepted trade-off: a missed removal order costs far more than a noisy hour.
If it happens, switch the affected rule back to forward (step 7) and tighten
the rules.

Mail to an address outside the five mailboxes in
`MAIL_ALERT_MAILBOXES` (`privacy`, `abuse`, `security`, `contact`,
`mail-alerts-test`; plus addressing like `privacy+x@` maps to `privacy`) is
forwarded and gets no alert.

### Logging and storage

- Axiom: the route's wide event carries `attributes.mailAlert` with
  `mailbox` (local part only), `urgent`, `outcome` (`sent`, `collapsed`,
  `no-recipients`, `push-not-configured`, `push-failed`, `rejected`,
  `invalid`), `recipients` and `sent`. No addresses, no subject, no body.
- The push send loop logs its usual counts (`push.*`, with the admin's user
  id, as for every push).
- KV holds only `mail-alert:collapse:<mailbox>` = `1` for two minutes.
- D1 stores nothing about mail.
- The Worker logs nothing. `observability` is off in its `wrangler.jsonc`,
  because Workers Logs would record the envelope sender and recipient of every
  mail. To debug, use `pnpm --dir workers/mail-alerts exec wrangler tail
  besidka-mail-alerts` while sending a test mail (live only, not stored).

### Legal note

- **Privacy Policy: no change.** The mail was already received and read by
  the controller through Cloudflare (a processor the policy names). The alert
  adds no purpose (it serves handling those messages on time), no recipient
  who can read anything (the push services see only RFC 8291 ciphertext, as
  for every push, and the only reader is the controller's own device), and no
  retention (nothing is stored beyond a two-minute KV marker without content).
- **Art. 30: no new row.** Rows 14 and 14a (requests, reports, notices,
  removal orders) already cover the mail; the record gets a history line for
  this change (`docs/legal/art30-record.md`, section 7, review log). The transient
  processing of the sender header and the subject inside the Worker is part of
  receiving the mail.
- **Lock screen.** The subject can show on the phone's lock screen. If that
  is a concern (for example a data subject's name in a subject), set the
  Besidka notification previews to "When unlocked" on the phone.

## Owner runbook

Do the steps in order. Never paste the destination address into a file in the
repo or into a chat; keep it in a shell variable only.

### 1. Phone and cover

1. On the phone, open the installed Besidka PWA (Add to Home Screen on iOS),
   sign in with the admin account, and turn push on (bell in the sidebar
   dropdown, or Profile). Allow notifications when the system asks. On iOS,
   allow Besidka in any Focus mode you use, otherwise the alert is silenced.
2. Name a person who covers absences (holidays, travel, nights you cannot be
   woken). They need a Besidka account with the `admin` role (Admin → Users)
   or in `NUXT_ADMIN_EMAILS`, the PWA installed and push on, access to the
   Gmail inbox or a forward of it, and the admin takedown steps in
   `docs/legal/content-incidents.md`. Record their name and how to reach them
   in your private incident record, not in this public repo.

### 2. Merge and deploy the app

Merge this PR and let `production.yml` deploy `besidka`. Then check that the
route is closed:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://besidka.com/api/v1/internal/mail-alert
# expect 404
```

### 3. Deploy the Worker (inert until a rule points at it)

```bash
pnpm --filter mail-alerts run deploy
```

It has no route, no `workers.dev` URL and no `addresses` field, so deploying
it changes no Email Routing rule and receives no mail yet. Do not add the
`addresses` field to `wrangler.jsonc`: Wrangler would then take the rules
over on every deploy.

### 4. Secrets (both Workers, same HMAC secret)

```bash
read -rs FORWARD_TO        # paste the verified Gmail destination, Enter
MAIL_ALERT_SECRET="$(openssl rand -hex 32)"

printf '%s' "$FORWARD_TO" \
  | pnpm --dir workers/mail-alerts exec wrangler secret put FORWARD_TO
printf '%s' "$MAIL_ALERT_SECRET" \
  | pnpm --dir workers/mail-alerts exec wrangler secret put MAIL_ALERT_SECRET
printf '%s' "$MAIL_ALERT_SECRET" \
  | pnpm exec wrangler secret put NUXT_MAIL_ALERT_SECRET --env production
unset MAIL_ALERT_SECRET
```

Keep `FORWARD_TO` set in this shell for steps 6 and 7. `FORWARD_TO` must be an
already verified destination address (it is the one the four rules use
today). Setting a secret on `besidka` deploys a new version of it; the route
answers 404 to unsigned calls either way.

### 5. Test with a temporary rule first

```bash
cf email-routing rules create -z besidka.com \
  --name "mail alerts test" \
  --matchers '[{"type":"literal","field":"to","value":"mail-alerts-test@besidka.com"}]' \
  --actions '[{"type":"worker","value":["besidka-mail-alerts"]}]' \
  --dry-run
# then the same command without --dry-run
```

From another mailbox (not the Gmail destination itself), send:

1. `Hello` to `mail-alerts-test@besidka.com`: the mail arrives in Gmail and
   the phone shows "New mail to mail-alerts-test@ / Hello".
2. A second mail within two minutes: it arrives in Gmail, no second push
   (collapsed).
3. `Test removal order`: an "Urgent: new mail to mail-alerts-test@" push even
   inside the window.

Check:

- Cloudflare dashboard → Compute → Email Service → Email Routing → Activity
  log: each message shows as delivered to the Worker, none as failed.
- Axiom `besidka-prod`: `['attributes.mailAlert.outcome']` is `sent`,
  `collapsed`, `sent`.

If nothing arrives in Gmail, stop and delete the test rule; the four real
rules are untouched.

### 6. Switch the four rules, one at a time

List the rules and note each one's id, name and priority:

```bash
cf email-routing rules list-account -z besidka.com
```

Save each rule outside the repo before changing it (the file contains the
destination address):

```bash
cf email-routing rules get <privacy-rule-id> -z besidka.com > ~/mail-rule-privacy.backup.json
```

Update it to the Worker action. The API replaces the whole rule (`PUT`), so
restate the matcher, the name and the priority from the listing, and run it
with `--dry-run` first:

```bash
cf email-routing rules update <privacy-rule-id> -z besidka.com \
  --name "<existing name>" --priority <existing priority> --enabled \
  --matchers '[{"type":"literal","field":"to","value":"privacy@besidka.com"}]' \
  --actions '[{"type":"worker","value":["besidka-mail-alerts"]}]'
```

Send a test mail to `privacy@` and confirm the Gmail copy and the push. Then
repeat for `abuse@`, `security@` and `contact@`, one at a time, each with its
own backup file and test mail. Finally delete the test rule:

```bash
cf email-routing rules delete <test-rule-id> -z besidka.com
```

### 7. Restore a rule to the plain forward

If anything goes wrong (Gmail copy missing, failures in the activity log,
too many pushes), put the rule back as it was:

```bash
read -rs FORWARD_TO        # if this is a new shell
cf email-routing rules update <privacy-rule-id> -z besidka.com \
  --name "<existing name>" --priority <existing priority> --enabled \
  --matchers '[{"type":"literal","field":"to","value":"privacy@besidka.com"}]' \
  --actions "[{\"type\":\"forward\",\"value\":[\"$FORWARD_TO\"]}]"
```

Same for `abuse@`, `security@`, `contact@` with their ids. Compare the result
with the backup file. The Worker can stay deployed; without a rule it receives
nothing.

### 8. Let CI keep the Worker up to date

```bash
gh variable set MAIL_ALERTS_DEPLOY_ENABLED --body true --repo besidka/besidka
```

From then on, `production.yml`'s `deploy-mail-alerts` job redeploys the
Worker after a successful app deploy whenever `workers/mail-alerts/`,
`shared/utils/mail-alert-protocol.ts`, `pnpm-lock.yaml` or
`pnpm-workspace.yaml` changed. Until the variable is `true` the job is
skipped. It never touches Email Routing rules or secrets.

### Rotating the secret

Generate a new value and set it on both Workers (step 4, the two
`MAIL_ALERT_SECRET` lines). Alerts sent between the two `secret put` calls get
a 404 and are lost; the mail itself is still forwarded.
