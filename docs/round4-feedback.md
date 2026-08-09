# Round 4 live-testing feedback (2026-08-09)

Captured verbatim from the user's live-testing pass on PR #362's preview
after Round 3 shipped, so nothing is lost across a session-limit reset or
context compaction. Status field per item is filled in as work happens —
do not assume anything below is fixed just because it is listed.

Process instruction from the user: prioritize the web-search/tools-mapping
bug bucket first. A Fable-model planning agent was dispatched to investigate
and produce an implementation plan before any code changes are made — see
`docs/round4-web-search-tools-plan.md`. Everything else in this file is
explicitly deferred until the user reviews that plan and asks to proceed,
at which point it should be run as a full cycle (debugger subagent, browser
verification, worker, tests).

## Status (2026-08-09, updated)

- **Tools/web-search bucket**: plan approved by the product owner, full
  scope (see `docs/round4-web-search-tools-plan.md` section 6) — QW1–QW4
  + LW1 (multi-step tool loop) + LW2 (Moonshot search) + LW4 (functional
  gateway reasoning) + LW5 (gateway image generation), excluding LW3
  (DeepSeek app-owned search, explicitly declined). Implementation is
  starting now in dependency-ordered waves (Wave A → Wave B → Wave C, see
  the plan doc's section 6).
- **Everything else in this file** (gateway UX bugs, all 4 change
  requests): still queued, not started. Will be picked up as its own
  cycle once the tools bucket is implemented, reviewed, tested, and
  merged.
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

### Gateways

- **Sidebar tooltips**: the direct-provider left rail shows a tooltip with
  provider name + model count on hover (e.g. "OpenAI — 15 models"). The
  gateway vendor rail (inside Cloudflare/OpenRouter/Vercel) has no
  equivalent tooltip.
- **Cloudflare AI Gateway**: zero models show a web-search badge, across
  the entire catalog. User wants to know what's wrong / what's possible.
- **OpenRouter**: web search is inconsistent — some models show the globe
  (e.g. GPT-4o family), but models that should have it 100% (GPT-5+ family
  and others) do not. Suspected tools-mapping bug, not a real capability
  gap.
- **Vercel AI Gateway**: same class of inconsistency as OpenRouter.
- User's expectation: "each gateway should be solved differently but at
  the end I expect fixed web search tool, reasoning, and image generation
  for gateways correctly as 'per provider' direct functionality."
- **Focus outline clipped**: keyboard focus ring on gateway rail icons is
  cut off because the scrollable rail container has no padding. Proposed
  fix: add padding (e.g. `p-1`) to the scrollable block.
- **"Image input" badge is wrong for OpenRouter / Vercel**: currently
  copied from the "per provider" image-generation icon/style. Two
  acceptable fixes, user's choice left open in the plan:
  1. Only show the icon if the model can genuinely generate images, or
  2. Replace it with an "eye" icon labeled "Vision" that represents
     image/video/PDF *input* only, fully separate from image
     *generation*. If this path is chosen, apply the same separation to
     the "per provider" list too, and to all gateways consistently.
- **Gateway filters**: currently only "Free" + a clear button exist for
  all 3 gateways. Once web-search/image-generation mapping is fixed,
  add real filters (e.g. "Chat" / "Image generation") matching what
  "per provider" already has.

### All (both direct providers and gateways)

- When text is typed into the model search box, the left provider/gateway
  icon rail disappears completely. Expected behavior: filter the model
  list by the search term, and filter the rail icons to only show
  providers/gateways that still have matching models — only hide the rail
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
- Add a per-provider / per-gateway enable/disable toggle in
  `/profile/keys`. Default: everything enabled. Persisted as a user
  setting in the DB, synced across devices. When a provider is disabled:
  hide its logo from the sidebar rail, hide its models from the list
  (including previously-favorited ones). When a gateway is disabled: hide
  it from the gateway row at the bottom of the picker. If all 3 gateways
  are disabled, hide that entire bottom row/div.

---

## Explicit process notes from the user

- Session was at ~21% of a 5-hour window (~1.5h) when this feedback was
  given — instructed to spend that time on the Fable plan only, not code.
- The web-search/tools bucket is the highest priority and must be solved
  first, in isolation, with a Fable-authored plan reviewed by the user
  before implementation starts.
- Everything else in this file (gateway UX bugs, change requests) is
  explicitly deferred to a later full implementation cycle once the tools
  plan is approved.
