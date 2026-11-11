# Attaching an existing artifact to a chat

Owner request of 2026-11-10 (Linear BES-350, GitHub #817): work on one
artifact across several chats. Before this, `update_artifact` reached only
artifacts created in the chat it was called from, so an artifact could not be
continued anywhere else, and not at all once its origin chat was deleted. The
**Add artifact** row in the composer's "+" menu attaches up to three of the
user's own artifacts to a message. Owner chats only: shared chats, `/artifacts/<token>`
pages and MCP (it has no chat send) are unchanged.

## What the user sees

- "+" menu, Add section: **Add artifact** after "Generated images"
  (`docs/chats/chat-input-tools-menu.md`, "Add artifact").
- The picker is History → Artifacts in a dialog: the same rows, search, kind
  filter, lazy paging and states (`docs/artifacts/library.md`).
- Each attached artifact is a tile in the composer's attachments row (kind
  icon, kind, title, remove ×), also a chip in the phone sheet.
- A sent message shows the attached artifacts as chips above its text
  (`Chat/ArtifactAttachments.vue`; click opens the artifact in the side
  panel), and the context panel lists them under **Inputs**
  (`docs/chats/context-panel.md`, "Attached artifacts").
- **Ask to fix** for an artifact whose origin chat was deleted (BES-349): the
  panel's "Start a new chat with this artifact" opens `/chats/new` with the
  artifact attached and the fix prompt prefilled. Nothing is sent
  (`docs/artifacts/panel.md`).

## Message data: the `data-artifact-attachment` part

An attachment is a part of the **user** message, persisted in
`messages.parts`; no table and no migration:

```ts
{
  type: 'data-artifact-attachment',
  data: { artifactId, version, kind, title },
}
```

It is deliberately not `data-artifact`. That type means "this chat produced
or edited the artifact" and drives the chat's cards, the Outputs section, the
shared-chat artifact routes (`findSharedChatArtifact`) and the model-context
reference list. A separate type keeps all of that unchanged and gives the
attachment its own rules:

- `shared/utils/artifacts.ts`: `ARTIFACT_ATTACHMENT_PART_TYPE`,
  `ARTIFACT_ATTACHMENTS_MAX` (3, the same number as the context budget
  `ARTIFACT_CONTEXT_MAX_ARTIFACTS`), `isDataArtifactAttachmentPart`,
  `toArtifactAttachmentPart`, `collectArtifactAttachments` (user messages
  only, newest first, once per artifact).
- `userMessagePartSchema` accepts the part (strict, `kind` from
  `ARTIFACT_KINDS`, `version >= 1`); `userMessagePartsSchema` allows at most
  three different artifacts per message and still needs a text part.
- The model-facing copy of a message drops it (`sanitizeMessageParts` keeps
  only text and files), so the attachment reaches the model only as the
  context block below.
- **Never public.** `filterPublicParts` removes it, so the shared chat view,
  the share personal-data check and the public context route never see it.
  Sharing a chat therefore does not publish an artifact the owner attached,
  and `findSharedChatArtifact` (which reads `data-artifact` only) cannot
  resolve it. This is the reading of "nothing new becomes public" in the
  ticket: an artifact becomes visible in a shared chat only when the chat
  itself produced it, exactly as before.

## Access gate (owner requirement)

The `artifacts` flag decides everything, evaluated on the server through the
feature layer (`docs/feature-flags.md`): rollout, grants, roles,
`NUXT_FEATURES_DISABLED` and the kill switch all apply. The client only hides
UI.

| Surface | Without access |
| --- | --- |
| "+" menu, tiles, picker | Not rendered; the picker component is not even mounted, so no request (`docs/chats/chat-input-tools-menu.md`) |
| `GET /api/v1/artifacts` (picker list) | 404 `feature_unavailable` (`requireFeature(event, 'artifacts', { active: false })`, unchanged) |
| `PUT /api/v1/chats/new` and `POST /api/v1/chats/<slug>` with an attachment | 404 `feature_unavailable` before anything is stored or any model is called |
| `update_artifact` | The artifact tools are only registered when `artifacts` is active for the send; the tool still requires ownership |
| Replays of a stored message that has attachments (resend, Regenerate) | The attachments are dropped from the request and the send goes on (`onUnavailable: 'drop'`) |

`resolveArtifactAttachmentParts` (`server/utils/artifacts/attachments.ts`) is
the one validation point, called by both chat routes right after the body is
parsed. A message with no attachment costs nothing (no flag evaluation). With
attachments it:

1. requires the `artifacts` feature (`requireFeature(event, 'artifacts')`,
   Labs toggle included);
2. loads the rows in one query scoped to `user_id` and rejects, with one and
   the same `400 artifact_attachment_unavailable`, an id that does not decode,
   does not exist, belongs to someone else, is not live
   (`current_version = 0`) or whose `version` is above `current_version`, so
   ids cannot be probed;
3. rejects a taken-down artifact with `451 artifact_taken_down`;
4. rewrites every part from the row (`kind`, `title`), so a client cannot
   persist a forged title; the attached `version` is the client's, validated.

`onUnavailable: 'drop'` (used when the message id is already stored) leaves
out what no longer resolves, or every attachment once access is gone, instead
of failing a replay of an old message. `/chats/new` also drops attachments
from a deep research start (the composer never sends them there).

## What the model sees

`buildArtifactContextBlock` (`server/utils/artifacts/context.ts`) is the same
function that adds the chat's own artifacts. It now takes
`attachedArtifactIds` (every user attachment in the loaded history plus the
new message, newest first):

- attached artifacts come first, then the chat's own artifacts by last
  update, and the **whole block is still capped at 3 artifacts** and 30,000
  characters each (`ARTIFACT_CONTEXT_MAX_CHARS`, with the existing truncation
  marker), so the existing budget logic decides; there is no read tool;
- an attached `<artifact>` carries `attached="true"` and the block notice
  gains one sentence: they were attached by the user from their library,
  possibly made in other chats, and the user wants the model to work with
  them;
- only the sender's own, live, not taken-down artifacts are read, as before,
  so a copied or branched message cannot pull in someone else's content;
- the block still goes to the latest user turn, never the system prompt, so
  the cached prefix is untouched. Attaching spends no tokens by itself and
  needs no new consent: same data, same purpose.

The artifact instructions say that `update_artifact` also applies to an
artifact the user attached (`attached="true"`).

Consequences to know:

- Attachments persist in the history, so an artifact attached in turn 1 keeps
  its place (ahead of the chat's own artifacts) on every later turn and is
  re-sent on the user's key each time. With three attached, an artifact
  created in the chat after that is not in the block until an attachment
  falls out of the chat or the user removes it by starting a new chat.
- The artifact came from another chat and may hold untrusted text (web
  results, files). It is wrapped as data and its delimiters are neutralised,
  but a model that obeys it could call `update_artifact` on an attached
  artifact in later turns. The editable set stays owner-only, at most the
  chat's attachments, and each write is a new immutable version.
- Id lists in these queries are capped below D1's bound-parameter limit
  (`CHAT_ATTACHED_IDS_LIMIT` 80, `ARTIFACT_CONTEXT_REFERENCE_LIMIT` 80).
- A new message whose attachment is deleted or taken down in the seconds
  between picking and sending is refused with the clear error above; on an
  existing chat the optimistic message then stays in the list (Regenerate
  repeats the refusal), a known rough edge. `/chats/new` restores the
  composer.

## Editing an attached artifact

`listChatArtifactIds` (`server/utils/artifacts/chat-artifacts.ts`) is the set
`update_artifact` may touch: artifacts created in the chat, plus those whose
public id is in an attachment part of **this chat's own user messages**
(`attachedArtifactIds`, passed through `CapabilityToolContext`). The owner
filter in that query means a branched or copied chat that carries someone
else's attachment part matches nothing, and ids are Hashids, so a part cannot
be forged for a victim's artifact. The new version is written normally
(`appendArtifactVersion`, immutable, optimistic version check); its
`data-artifact` card appears in the **current** chat, and the origin chat
keeps its own history. The History list sorts by `updated_at`, so the edit
moves the artifact to the top.

## Tests

- Unit: `tests/unit/utils/artifact-attachments.spec.ts`,
  `tests/unit/utils/chats/request-schema.spec.ts`,
  `tests/unit/server/utils/artifacts/attachments.spec.ts` (real SQLite),
  `chat-artifacts.spec.ts`, `context.spec.ts` (attached first, cap, notice,
  truncation, foreign and taken-down),
  `tests/unit/server/utils/chats/share-public-parts.spec.ts`,
  `tests/unit/server/utils/chats/context/build-chat-context.spec.ts`,
  `tests/unit/components/ChatInput/ToolsMenu/Content.spec.ts` and
  `ToolsMenu.spec.ts` (row present with access, absent without, popover and
  sheet), `ArtifactPicker.client.spec.ts`, `tests/unit/components/Chat/ArtifactAttachments.spec.ts`,
  `tests/unit/components/ChatInput.spec.ts` ("artifact attachments").
- Integration: `tests/integration/api/chats-new-artifacts.spec.ts` (404 and
  nothing stored without access, canonical rewrite, foreign, taken down, four
  attachments, research) and `tests/integration/api/chats-artifacts.spec.ts`
  ("attached artifacts": ids reach the context builder, `update_artifact`
  edits an attached artifact from another chat and still refuses one that is
  neither from the chat nor attached, drop mode on a stored message, 404
  before any model call).
- E2E: `tests/e2e/chat/artifact-attach.spec.ts` (attach, tile, remove,
  send, message chip, context panel Inputs; search, kind filter and lazy
  load; a user without the flag sees the unchanged menu and no picker
  request) and the Ask to fix cases in
  `tests/e2e/chat/artifact-actions.spec.ts`.

## Decisions and limits

- No migration. A column or table would only duplicate what the part holds.
- Attachments are not shown on shared chats (above). If the owner wants the
  chips public, the part has to join `findSharedChatArtifact` and
  `loadChatContextArtifacts` public mode first.
- Deleting an attached artifact leaves the chip in old messages (the panel
  then answers "unavailable"), and a replay of that message drops it.
- MCP is unchanged: it has no chat send, so it cannot attach.
