# Round 4 live-testing feedback (2026-08-09)

Captured verbatim from the user's live-testing pass on PR #362's preview
after Round 3 shipped, so nothing is lost across a session-limit reset or
context compaction. Status field per item is filled in as work happens —
do not assume anything below is fixed just because it is listed.

Process instruction from the user: prioritize the web-search/tools-mapping
bug bucket first. A Fable-model planning agent was dispatched to investigate
and produce an implementation plan before any code changes were made; that
plan has since been executed and retired, and its durable findings live in
`docs/providers.md`. Everything else in this file was explicitly deferred
until the user reviews it and asks to proceed, at which point it should be
run as a full cycle (debugger subagent, browser verification, worker, tests).

## Status (2026-08-10, updated)

- **Tools/web-search bucket — the direct-provider half shipped.** The
  multi-step tool loop (`server/utils/ai/tool-loop.ts`) and Moonshot AI
  web search via the Formula API both landed; Qwen's `qwen3.7-max`
  exclusion and DeepSeek's total absence of a search API were each
  re-verified as real vendor-side gaps and accepted as verified non-fixes.
  All of that is now recorded permanently in `docs/providers.md`. The
  entries under "Per-provider web search / tools mapping" below are that
  shipped bucket, kept verbatim as the original report — read
  `docs/providers.md` for how each was resolved, and do not re-open them.
- **The rest of that bucket is moot.** The plan's remaining scope, and
  several bugs originally logged below, were scoped to the third-party
  model-routing/proxy integrations that have since been removed from the
  product entirely. Those items have been stripped from this file because
  the surface they described no longer exists — not because they were
  fixed.
- **Everything under "Model picker" and "Change requests" below is open
  and unstarted.** They will be picked up as their own cycle.
- **Home page / legal pages update** (separate, older deferred ask):
  still held pending the product owner's sign-off on its own plan — not
  part of this file's scope.

---

## Bugs

### Per-provider web search / tools mapping

- **Qwen**: `qwen3.7-plus` and `qwen3.6-flash` show the web-search globe
  badge; `qwen3.7-max` does not. User considers this implausible/wrong and
  suspects a mapping bug rather than a real per-model capability
  difference — wants this re-verified, not assumed correct from Round 3.
- **Kimi / Moonshot AI**: neither `Kimi K2.6` nor `Kimi K3` show a
  web-search badge at all. User believes these models should be able to
  search and wants a real fix, not just a documented gap.
- **DeepSeek**: neither `DeepSeek Chat` nor `DeepSeek Reasoner` show a
  web-search badge. Same ask — user wants this actually resolved, is
  skeptical of "no API surface" as a final answer.
- User's own framing: "I guess it's still issue of tools mapping from
  providers (all) to my app's architecture" — asked explicitly for this to
  be reviewed with the Fable advisor and fixed, having asked twice before.

### Model picker

- When text is typed into the model search box, the left provider icon
  rail disappears completely. Expected behavior: filter the model
  list by the search term, and filter the rail icons to only show
  providers that still have matching models — only hide the rail
  entirely when literally nothing matches. Same behavior expected when
  filtering by favorites (hide only providers with zero favorited models,
  not the whole rail).

---

## Change requests

- Remove the model-count badges on the sidebar rail icons completely.
- Remove the word "Free" from the free-model cost badge — keep only the
  icon, with "Free" as a hover tooltip and in the info popup instead.
- In the user-message context menu's Provider row, for **direct**
  providers: show the provider's real logo instead of the API-key icon,
  and remove the "(direct)" suffix entirely.
- Add a per-provider enable/disable toggle in `/profile/keys`. Default:
  everything enabled. Persisted as a user setting in the DB, synced across
  devices. When a provider is disabled: hide its logo from the sidebar
  rail, hide its models from the list (including previously-favorited
  ones).

---

## Explicit process notes from the user

- Session was at ~21% of a 5-hour window (~1.5h) when this feedback was
  given — instructed to spend that time on the Fable plan only, not code.
- The web-search/tools bucket is the highest priority and must be solved
  first, in isolation, with a Fable-authored plan reviewed by the user
  before implementation starts.
- Everything else in this file (picker UX bugs, change requests) is
  explicitly deferred to a later full implementation cycle once the tools
  plan is approved.
