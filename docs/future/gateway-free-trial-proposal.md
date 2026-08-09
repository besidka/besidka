# Proposal: limited free trial via an app-owned Cloudflare AI Gateway key (NOT built)

> **Status: proposed only, not implemented, not scheduled.** This is a record
> of an idea the product owner raised during the providers/gateways
> initiative (see `docs/gateways.md`), explicitly decided against for that
> initiative's scope, and preserved here for future reconsideration.

## The idea

New accounts with zero saved API keys could get a small number of free
messages (e.g. 3–10) on the cheapest available model, routed through an
**app-owner-funded** Cloudflare AI Gateway credential, before the normal BYOK
key-required gating (`docs/gateways.md`'s "No-key UX gating" section) applies.

## Why it was not built

Besidka's entire cost model is BYOK: users bring their own provider/gateway
keys and pay providers directly. The app owner has never held or spent on an
inference credential. This proposal inverts that invariant — the maintainer
would pay for inference for the first time, with real, unbounded-by-default
cost exposure.

Building it safely requires infrastructure this initiative did not build and
was explicitly out of scope for:

- **Abuse prevention**: a per-user message counter alone doesn't stop
  multi-account abuse (an unauthenticated visitor can create unlimited free
  accounts). Real protection needs bot/fraud detection, rate limiting beyond
  simple counters, and likely some friction (email verification, CAPTCHA
  already exists via Turnstile per `docs/auth-security.md` but wasn't
  evaluated against this specific threat model).
- **A hard cost ceiling and kill switch**: the app owner needs a way to cap
  total spend and instantly disable the free tier if abused, independent of
  the per-user counter working correctly.
- **Billing visibility**: the owner needs cost tracking on the app-owned
  Cloudflare credential specifically, separate from the Axiom
  provider/gateway usage telemetry this initiative added (which tracks
  *which* provider/model users choose, not *who's spending the owner's own
  money*).

The owner's own stated position, verbatim in intent: explicit budget anxiety
about ever paying for users' inference, and a stated preference for the
safe default (fully key-gated, no free tier) if a fast decision was needed.
Given that, and given the scope of infrastructure a safe implementation
requires, the recommendation — confirmed and not built — was: ship the fully
key-gated experience now, leave this as a proposal for the owner to
greenlight later with its own dedicated design pass (abuse model, cost caps,
kill switch, and a decision on whether Cloudflare's Unified Billing feature,
new as of this initiative's development, changes the cost/complexity
tradeoff).

## If revisited later

Cloudflare's AI Gateway Unified Billing feature (referenced in
`docs/gateways.md`) may be worth evaluating first — it could simplify the
"one app-owned credential, capped spend" mechanic considerably compared to
building custom quota tracking from scratch. Any future implementation
should treat abuse prevention as the first design question, not an
afterthought bolted onto a working free-tier flow.
