# Chat input: Markdown-aware textarea

The chat input stays a plain `<textarea>` (`useTextareaAutosize`). Messages
are sent as Markdown and rendered with MDC (remark-gfm plus remark-breaks, so
a single newline is already a line break). `useMarkdownTextarea`
(`app/composables/markdown-textarea.ts`) makes that textarea Markdown-aware.
It is bound in `app/components/ChatInput.client.vue` (`/chats/new` and
`/chats/[slug]`) and, without the long-paste chip, in
`app/components/Projects/InstructionsCard.vue`.

## Why

A browser puts only `text/plain` into a textarea. Pasting from Apple Mail,
Gmail or a web page lost bullets, blank lines and bold. Apple Mail's plain
text is `\t•\tItem`, which Markdown renders as an indented code block. Typing
had no list continuation, and Enter inside an open code fence sent the
message half-written.

## Paste

The handler reads `text/html` and `text/plain` from the clipboard.

1. Image files on the clipboard: do nothing. The document-level image paste
   listener in `ChatInput.client.vue` handles them (desktop only).
2. The caret is inside an unclosed code fence: paste verbatim, no conversion.
3. The HTML gate (`shouldConvertHtml`) decides whether the HTML is converted:
   - converted when it has `ul|ol|li|strong|b|em|h1-h6|pre|code|blockquote|table`;
   - or when it has more than one `<p>` or `<div>` block, unless it carries
     `white-space: pre`;
   - otherwise `text/plain` is used unchanged. VS Code and terminals put span
     soup in `text/html` (one `<div>` per line, `white-space: pre`), and the
     plain text is the right input for them.
4. Conversion is `htmlToChatMarkdown` in
   `app/utils/knowledge-html-to-markdown.ts`. It reuses the Turndown setup of
   the project knowledge importer (GFM tables, strikethrough, task lists, link
   scheme hardening, image alt hardening) and adds: removal of `head`, `meta`,
   `style`, `script`, `link`, `title` and Word's `<o:p>`; Google Docs'
   `<b style="font-weight:normal">` wrapper unwrapped instead of bolding the
   whole paste; `&nbsp;` to a space; list markers `-   x` / `1.  x` to
   `- x` / `1. x` (outside code fences); trailing whitespace removed; three or
   more newlines collapsed to two. `htmlToKnowledgeMarkdown` is unchanged
   (its existing spec still expects the wide markers).
5. The module is imported dynamically on the first HTML paste, so Turndown is
   not in the chat page chunk. `preventDefault()` is called synchronously
   before the import; if the import or conversion fails or yields an empty
   string, the `text/plain` text is inserted instead.
6. Plain text pastes also get bullet normalisation: a line that starts with
   optional whitespace, one of `•◦▪‣` and whitespace becomes `- Item`
   (`·` is not a bullet: it is a common middle dot in prose). Nesting is
   kept: the level is the larger of the glyph level (`•`/`‣` 0, `◦` 1, `▪` 2)
   and the rank of the line's leading whitespace among the distinct indents in
   the paste (tab = 4 columns), so Apple Mail's uniform leading tab does not
   add a level. Each level is two spaces. Lines inside code fences are left
   alone. When nothing changes, the native paste is kept (no `preventDefault`).

All insertion goes through one helper: `document.execCommand('insertText')`
so native undo keeps working, with a fallback to `setRangeText(..., 'end')`
plus a bubbling `input` event so `v-model` and autosize update. Removals use
`execCommand('delete')` with the same fallback. The editing command is used
only while the textarea is the active element; otherwise the `setRangeText`
path runs so an insertion never moves focus.

### Where an async paste lands

HTML conversion awaits a dynamic import, so the caret can move before the text
is ready. `onPaste` snapshots `selectionStart`, `selectionEnd` and the value
synchronously, before any await, and the insertion uses that range. If the
value changed in the meantime (the user typed, or sent the message), the text
is appended at the end of the current value instead of the stale range. The
same snapshot is passed to `onLongPaste(text, snapshot)` and back to the
composable's `insertText(text, snapshot)` when the chip limit is reached.
With a snapshot, `insertText` does not call `focus()`, so a user who moved to
another field does not lose it.

## Long paste becomes a pasted text chip

After conversion and normalisation, a text longer than
`LONG_PASTE_MIN_CHARACTERS` (1200) or with more than `LONG_PASTE_MIN_LINES`
(40) lines is not inserted into the textarea. The owner's calibration
(2026-11-05): one 15-line, 330-character email stays text; three of them
pasted at once (about 1000 characters, 47 lines) become a chip. Inside an open
code fence the text is always inserted verbatim, because a chip would pull
code out of the fence the user is writing. Without an `onLongPaste` option
(the project instructions card) the text is inserted normally.

The chip is **visual only**. `ChatInput.client.vue` keeps the pending pastes
in the global client-only `usePastedTexts()` state (`app/composables/pasted-texts.ts`,
`PastedText` from `app/utils/pasted-text.ts`)
and shows them in the attachments row (`Files/Attached/Preview.client.vue`,
before the files) as `Files/Attached/TextCard.vue`: the first three non-empty
lines, "Pasted text", and "N lines, size". On send,
`joinMessageWithPastedTexts` appends every block to the end of the typed text,
separated by a blank line (`typed\n\nblock 1\n\nblock 2`); with nothing
typed the message is just the blocks, and with no blocks the typed text is
sent byte for byte as before. `sendMessage` writes the joined text into the
`message` model before `emit('submit')`, because both parents read their own
model synchronously in the submit handler (`new.vue` `onSubmit`,
`useChat().submit`). The request, D1, the model, search, memory, titles, MCP
and shared pages therefore all see one ordinary text part.

- **Edit**: clicking a chip opens `Chat/TextFileModal.client.vue` (mounted
  per open, `v-if` plus `key`, because it loads its content on mount) with an
  editable textarea, a character and line counter, Save (enabled only for a
  changed, non-blank draft), Cancel and "Insert as text". Insert moves the
  content into the textarea at the caret and removes the chip. It focuses the
  textarea first (the modal's own focus restore runs while it unmounts, before
  the insert), so the `execCommand('insertText')` path runs: native undo
  removes the insertion in one step and the caret ends after the inserted text.
- **Editor on iOS**: below `sm` (40rem, where the modal is a bottom sheet) the
  textarea is never focused on open, so the on-screen keyboard does not cover
  the editor, the counter and the actions before the user has seen them.
  Desktop devices at `sm` and wider keep focusing the textarea for an editable
  paste. `autofocus` alone does not work: iOS WebKit's `showModal()` ignores it
  and focuses the first text field (or link, for a read-only file) in the
  dialog. The modal therefore reuses the model picker's mechanism
  (`docs/chats/model-picker.md`): the body and the action row sit in one
  `display: contents` wrapper that is `inert` for the render before
  `showModal()`, the close button is focused explicitly right after it, and the
  wrapper is released in the same call, so iOS has no field to pull focus into
  (Chromium and happy-dom ignore the quirk, so only a real iPhone or the iOS
  Simulator shows the bug; reproduced in the iOS 26 Simulator on 2026-11-05). When the user taps into the textarea and the
  keyboard opens (`useVisualViewportInset`, at least 120 px covered, no
  pinch zoom), the sheet is lifted exactly like the picker's: `marginBottom`
  equals the covered height, `height` and `maxHeight` are 85% of the visible
  viewport, the textarea drops `min-h-64` for `min-h-24` and is the only part
  that shrinks (header, counter and actions stay visible), and the new
  `--text-file-sheet-bottom-padding` variable (the iOS safe area under the
  actions below `sm`) falls to `0.375rem` while lifted. The centered modal is
  never lifted. Not yet verified on a real iPhone.
- **Unsaved edits**: Cancel, Escape (the dialog's `cancel` event), the X button
  and the backdrop (both `method="dialog"` forms) all go through
  `requestClose`. With a changed draft it asks "Discard your unsaved changes?"
  through `useConfirm` (a second `showModal` dialog, so it stacks above the
  editor; "Keep editing" returns to it). With no changes, and for read-only
  files, it closes without asking. A second close request while the question is
  open is ignored.
- **Remove**: the chip's x button removes it without a confirmation (the text
  is still on the clipboard).
- **Send**: a message with only chips is sendable (`hasMessage` counts chips
  that have non-blank content). A whitespace-only long paste is dropped
  silently in `attachLongPaste`: no chip and no insertion, so it can never
  produce an empty message (a 400 on `/chats/new`, an empty user message on
  `/chats/[slug]`).
- **Limit**: at most `MAX_PASTED_TEXTS` (10) chips, counted separately from
  the file cap (`maxFilesPerMessage`). A further long paste is inserted into
  the textarea at the paste-time snapshot with a warning toast.
- **Length cap**: the client enforces the server limit,
  `MAX_USER_MESSAGE_TEXT_LENGTH` (200 000 characters,
  `shared/utils/chat-message-limits.ts`, imported by
  `server/utils/chats/request-schema.ts`; it lives in `shared/` so both sides
  cannot drift). The length that counts is the joined text
  (`getMessageTextOverflow(message, pastedTexts)`, typed text plus chips plus
  the blank-line separators). Three places check it, each reporting how far
  over the limit the message would be: a long paste that would pass the limit
  is refused with a warning toast and its text is kept out entirely (neither a
  chip nor inserted, also when the chip limit is reached); saving a chip edit
  that would pass it keeps the modal open with a warning toast; and
  `sendMessage` refuses an over-limit message with an error toast, before the
  consent prompt, leaving the textarea and the chips untouched. Typing has no
  cap, so only the send check can catch a message that grew by typing.
- **Drafts and navigation**: pending chips live in `useState`
  (`chat-input-pasted-texts`), not in the component. Each chat page mounts its
  own `ChatInput`, and the typed draft already survives navigation through the
  global `chat_input` preference, so the chips follow the draft the same way:
  they stay while the user moves between `/chats/new` and `/chats/[slug]`, and
  `sendMessage` clears them exactly where it clears the textarea. Sign-out and
  account deletion clear them with the draft (shared-device leak). Chips are
  **not** persisted to storage: a reload before sending loses them. That is
  deliberate: a paste can be 200 000 characters, which does not belong in
  `localStorage` (quota, and a synchronous write on every edit). A failed send on
  `/chats/new` restores the joined text into the textarea and the
  `chat_input_backup` draft backup, so nothing is lost, but it comes back as
  text, not as chips.
- **Auto web search**: the `https://` auto-enable watcher reads the textarea,
  so a URL that is only inside a chip does not turn web search on.

Uploaded text files (`text/plain`, `text/markdown`) in the same row also use
`TextCard` (preview fetched lazily up to `TEXT_FILE_PREVIEW_MAX_BYTES`) and
open the modal read-only with Copy, Open raw and Download (not loaded above
`TEXT_FILE_VIEW_MAX_BYTES`). The file picker in `Files/Modal/Upload.client.vue`
adds `.md,.markdown,.txt` to its `accept` list next to the MIME types, because
some systems have no MIME mapping for `.md` and would grey those files out;
the extensions are listed only while a text format is accepted.

### Why not a file, and why not a message part

The first version of this feature uploaded a long paste as
`pasted-text-*.txt`. The owner dropped that on 2026-11-05: every paste became a file in the file manager and counted
against the storage quota, while a paste is a one-off that belongs to one
message. A dedicated message part (a marker in `providerMetadata`, or a
`data-pasted-text` part) was also considered and rejected: the send schema
(`userMessagePartsSchema`) is strict, and every consumer of user text (the
history sanitizer, FTS search, memory extraction, chat titles, MCP
`get_chat`, shared pages, copy) would need to learn the new shape. Appending
plain text needs none of that. The trade-off: a sent message shows the pasted
text inline as Markdown, not as a chip.

## Keyboard

All rules are skipped during IME composition (`event.isComposing` or
`event.keyCode === 229`, which is what Safari reports for the Enter that ends
a composition; `isImeEvent` is exported and `ChatInput.client.vue` uses it
too) and when Ctrl, Meta or Alt is held. A keydown without `event.key`
(autofill and some IME events) is ignored. `onKeydown` returns `true` when it
handled the event.

- Enter (no Shift) inside an unclosed fence (` ``` ` or `~~~`, tracked per
  CommonMark: same character, closing length at least the opening length):
  inserts `\n` and returns `true`. `ChatInput.client.vue` does not send in that
  case. After the fence is closed, Enter sends again. A just typed opening
  fence counts as open.
- Shift+Enter on a list line (`-`, `*`, `+`, `1.`, `1)` with one to three
  digits, task `- [ ]`/`- [x]`, any indent): inserts a newline, the same indent
  and the next marker (ordered numbers increment, a task resets to `[ ]`).
  `2024. was a year` is not a list. A `>` quote line continues only when the
  `>` is followed by a space (`>=5` and `>_<` are text). Not applied inside a
  fence, with a selection, or with the caret before the marker (native newline
  then).
- On an empty item the line is removed, which ends the list, only for a
  top-level item (and a bare quote line). An empty nested item (`  - `)
  outdents one level instead, to the indent of the nearest shallower list item
  above it (or two columns less), so Enter, Enter, Enter walks out of a nested
  list one level at a time.
- Tab on a list line nests it under the previous line, but only when the
  previous line is also a list item and the line is not already as deep as that
  item's content: the indent is the parent's content width (`- ` is 2,
  `1. ` is 3, `10. ` is 4), so the nesting is real Markdown. In every other
  case (first item, a plain line above, already nested) Tab keeps its default,
  so keyboard users can leave the textarea.
- Shift+Tab on an indented list line moves it to the indent of the nearest
  shallower item above (a leading tab is removed whole). On an unindented line
  it keeps its default.
- The `continueListsOnEnter` option lets plain Enter continue or end lists
  and quotes exactly like Shift+Enter (an open fence still gets a bare
  newline). `ChatInput.client.vue` sets it to `() => !isDesktop`, because
  on mobile Enter never sends; the project instructions card sets it
  unconditionally, because Enter never sends there either.
- `ChatInput.client.vue` also ignores Enter during composition when deciding
  to send (before, an Enter that confirmed an IME candidate could send).

### Mobile list continuation (`beforeinput`)

Android IMEs often keep the last word composing, so the Enter keydown carries
`keyCode` 229 and the keydown path correctly stays out of the way. The
composable therefore also exposes `onBeforeInput`, bound to the textarea's
`beforeinput` event in `ChatInput.client.vue` and `InstructionsCard.vue`. When
`continueListsOnEnter()` is true and the event is `insertLineBreak` or
`insertParagraph` (and not itself composing), it runs the same continue or end
logic as the keydown path and calls `preventDefault()`.

The two paths cannot both act for one Enter: when the keydown handler handles
an Enter it calls `preventDefault()`, and the browser then never dispatches
`beforeinput`. A second guard covers our own edits: `execCommand('insertText')`
with a newline can dispatch `insertLineBreak` or `insertParagraph` itself, so
the composable sets an `isApplyingEdit` flag around every replacement and
`onBeforeInput` returns early while it is set.

## Rendering user messages

User messages are Markdown, not HTML and not MDC. `getParserOptions('user')` in
`app/composables/chat-format.ts` turns off everything that could make user text into live elements:

1. `remark-mdc` is disabled (`'remark-mdc': false`). MDC directive syntax in a
   user message used to produce live elements, and the public
   `/shared/<publicId>` page renders them for anonymous visitors:
   `::iframe{src="https://evil.example" style="position:fixed;inset:0"}`
   (a full-page frame), `::form{action=...}` with `:input{type=password}` (a
   phishing form), `:style[body{display:none}]`, `:span{style=...}` and
   `:span{class="fixed inset-0 z-50"}` (an overlay), `:meta{http-equiv="refresh"
   ...}`, `:link{rel=stylesheet ...}`, and `:binding{value="$doc.updateRuntimeData"}`
   or `{{ $doc.updateRuntimeData }}`, which makes `MDCRenderer` throw and the
   page crash. Without `remark-mdc` all of these are literal text. Plain text
   like `10:30`, `{a}` and `C:\dir` is unchanged, and `:smile:` still resolves
   to an emoji (`remark-emoji` is separate and is unchanged for every role).
2. `remark-disable-html` (`app/utils/remark-disable-html.ts`) pushes
   `{ disable: { null: ['htmlFlow', 'htmlText'] } }` onto the processor's
   `micromarkExtensions`, so micromark never tokenizes HTML at all. This is the
   fix for what stripping HTML later cannot undo: a block-level tag such as
   `<div>` or `<script>` opens an HTML block that swallows every line up to the
   next blank line (so a fence after `<div>x</div>` was eaten and
   `<script>\nfoo\n\n**after**` lost its bold), and the html handler
   lower-cases and kebab-cases tag names (`Vec<String>` became `Vec<string>`).
   Now `Vec<String>`, `<MyComponent>`, `Option<T>` and `<img src=x onerror=...>`
   are plain text. Autolinks `<https://example.com>`, fences, bold, GFM tables,
   task lists and strikethrough keep working, `[x](javascript:...)` is still
   stripped, and `remark-breaks` from `nuxt.config.ts` still turns single
   newlines into `br`.
3. `rehype-raw` stays `false` and `rehype-raw-html-as-text`
   (`app/utils/rehype-raw-html-as-text.ts`) stays in the chain as defense in
   depth: if a future parser change lets a `raw` node through, it becomes
   literal text instead of being parsed.
4. The project's `rehype-strip-directive-props` (module-level, all roles) still
   runs and strips `v-*`, `@*`, `on*`, `innerHTML` and `srcdoc` props.

The layers are independent on purpose: the first two stop the dangerous syntax
from being parsed, the last two catch what a parser or module upgrade lets
through. Do not re-enable `remark-mdc` or `rehype-raw` for user messages.

### Assistant messages

`getParserOptions` for every other role (assistant, system) is
`{ highlight: false, remark: { plugins: { 'remark-mdc': false } } }`. Only
`remark-mdc` is off, for two reasons verified with the real parser:

- **Binding swallow.** With `remark-mdc` on, assistant text such as
  `Use {{ message }} in the template` renders `{{ message }}` as an MDC
  `binding` element, so Vue and Jinja answers lose their braces, and
  `{{ $doc.updateRuntimeData }}` crashes rendering.
- **Directive injection by echo.** A model asked to echo
  `::iframe{src="https://evil.example"}\n::` rendered a live iframe, and the
  public `/shared/<publicId>` page shows assistant messages to anonymous
  visitors, so the injection reaches them.

Nothing in the app injects MDC directive syntax into assistant text. The only
special syntax is the ```` ```mermaid ```` fence, which is an ordinary code
fence handled by the `pre` component (`prose/PreStream.vue`), so diagrams still
render.

`rehype-raw` stays **on** for assistant messages: models emit `<br>`, `<sup>`
and `<details>` inside tables and prose, and they must keep rendering. A full
allowlist of assistant HTML (sanitizing what `rehype-raw` lets through, as the
user path does by not parsing it at all) is a separate follow-up and is not
done here.

## Copying messages

The message context menu "Copy" and a native selection copy (select text in a
message, press Cmd+C) both put clean, Mail-style HTML on the clipboard, so a paste
into Apple Mail, Gmail or Docs uses the target app's own fonts, real lists and
bold, and no bubble tint.

Why not `navigator.clipboard.write`: Chromium sanitizes the `text/html` of an
async `ClipboardItem` by re-serializing it in the page's style context. Every
element gets its computed style inlined: `font-family: Nunito`, an `oklch()`
colour, the bubble's `background-color`, `margin: 0; padding: 0` and Tailwind
preflight's `list-style: none`. A copy of one short message put about 9.7 KB of
that on the pasteboard, and Mail showed a pink background, Nunito, no bullets
and no paragraph spacing.

The fix is a synchronous `copy` event. `copyRich` in
`app/composables/message-copy.ts` registers a one-shot capture listener on
`document`, calls `document.execCommand('copy')` inside the click handler, and
the listener calls `clipboardData.setData('text/html', ...)` and
`setData('text/plain', ...)` then `preventDefault()`. That data reaches the
pasteboard unchanged (about 1 KB). The listener always comes off again, and the
path counts only when `execCommand` returned `true` and the listener actually
ran. Everything before `execCommand` is synchronous, because WebKit's transient
activation dies across an `await`. The fallbacks, in order: the async
`ClipboardItem` write (still sanitized), `writeText`, and the old
contenteditable `execCommand` path.

`app/utils/clipboard-html.ts` cleans the HTML first (parsed in an inert
document, so nothing loads or runs): comments (Vue's `<!--[-->`), `class`,
`style`, `id` and `data-*` are dropped; buttons, svg and `aria-hidden` or
`.js-clipboard-skip` chrome are removed; non-semantic wrappers (the table
scroller `div`, `span`) are unwrapped; a code block becomes
`<pre><code>text</code></pre>`; a mermaid diagram in diagram view becomes its
source in the same block, read from the `data-code-source` attribute that
`prose/PreStream.vue` sets only while the diagram is shown; links keep only a
resolved `href` (http, https, mailto, tel); images keep `src` (made absolute)
and `alt`; tables get `border`, `cellpadding` and `cellspacing` attributes so
they have lines without any style.

A second pass then lays the cleaned tree out the way Apple Mail writes its own
clipboard markup. This is the format (owner decision 2026-11-05, verified in
Apple Mail and Google Docs):

```html
<meta charset="utf-8"><div style="font-size: 12px"><div>Dobry wieczór,</div><div><br></div><div>Przesyłam stan liczników za październik:</div><ul style="margin: 0"><li>Prąd: 3597 kWh (+155)</li><li>Woda zimna: 48.3 m³ (+2.8)</li></ul><div><br></div><div>Razem: <b>5458 zł</b></div></div>
```

The rules:

- Everything sits in one `<div style="font-size: 12px">`: no font family and no
  colour, so the target keeps its own face.
- A paragraph is a `<div>`. Consecutive top-level blocks get a `<div><br></div>`
  spacer between them, except between a paragraph and a list directly after it
  (the list hangs under its intro line). After a list the spacer is present.
- `ul` and `ol`, nested ones too, get `style="margin: 0"`; `ol` keeps `start`.
  Paragraphs inside `li` (loose lists) are unwrapped so items gain no margins,
  and several paragraphs in one item are separated by `<br>`.
- `strong` becomes `b` and `em` becomes `i`, as in Mail.
- A heading is `<div><b>…</b></div>`, with no heading sizes, and follows the
  normal spacer rules (only a paragraph hangs a list under it).
- `blockquote` is `<blockquote style="margin: 0 0 0 1em">` with the same inner
  rules, `pre` is `<pre style="margin: 0"><code>`, `hr` and tables are as before.
- A selection with no block element (plain text, or inline markup such as one
  `<code>`) gets no wrapper, so it pastes inline in the middle of a sentence.
- `text/plain` (`domToPlainText`) is computed from the cleaned tree before the
  layout pass and is unchanged.

Why 12 px: Apple Mail's factory default is Helvetica 12. WebKit pastes HTML
with no font size at its "medium" size, 16 px, so an unstyled paste into Mail
looked noticeably larger than the text around it. Plain `<p>` margins also put
a blank line between an intro line and its list, which a Mail-written email
does not have. Measured trade-off: Google Docs shows the same markup as 9 pt
(it converts 12 px to points), Gmail comes out about equal, and Slack and Notion
ignore the size. Mail is the target that matters most, so 12 px stays.

Paste-lab evidence (same message, variants pasted into each app): B (no size)
pasted at 16 px in Mail; D and E (12 px) pasted at 12 px in Mail and 9 pt in
Docs. D kept `<p>` margins; E, the Mail-style `div` and spacer layout above,
matched a Mail-written email, so E was chosen.

Native selection copy is intercepted by `@copy` on the root element of
`Chat/Message.vue`, which both `/chats/[slug]` and `/shared/[slug]` use. It
acts only when every range of the selection lies inside one `.js-message-text`;
a selection that touches the avatar, reasoning, tools or two messages keeps
the browser's behaviour. Each range is `cloneContents()`-ed, wrapped back in
its list or table when the selection started inside one (an ordered list keeps
its numbers through `start`), cleaned, and rendered to plain text by
`domToPlainText`: `- ` for bullets, `1. ` numbering, indented nested lists,
blank lines between paragraphs, code verbatim, tables as `a | b` rows. A link
keeps its label and gets the address after it (`docs (https://example.com/d)`);
only a link whose label is the address itself (ignoring the scheme, `www.` and
a trailing slash) prints the address once. A
selection inside a code block becomes a `<pre><code>` block, or an inline
`<code>` when it is one line. A selection that is only text still goes through
the same path, because the native copy has the Nunito problem too.

Not verified outside Chromium: whether Safari and Firefox fire the `copy` event
for `execCommand('copy')` with no selection. If not, `copyRich` falls through
to the async write and the paste is styled again, not broken.

## Rejected for now: a WYSIWYG editor

TipTap or ProseMirror was considered and deferred. The textarea is kept
because:

- bundle size: an editor core plus the Markdown serializer is far more than
  the one lazy Turndown chunk used here;
- the iOS keyboard and safe-area handling of the chat input (visual-viewport
  lift, `onKeyboardFocus`) is built around a textarea, and a
  `contenteditable` behaves differently there (caret, scroll into view,
  autocorrect, IME);
- `useTextareaAutosize` and the `message` string model would have to be
  replaced by a document model;
- e2e and unit tests select the `textarea` element and use its `value`.

Revisit if users need inline rendering while typing (bold, tables) rather
than structure-preserving paste.

## Tests

- `tests/unit/composables/markdown-textarea.spec.ts`: every paste and keydown
  rule, the Apple Mail and Gmail fixtures, the VS Code span-soup fall-through,
  the IME guard, fences, list continuation and ending, Tab indent, long paste.
- `tests/unit/utils/knowledge-html-to-markdown.spec.ts` (`htmlToChatMarkdown`).
- `tests/unit/utils/remark-disable-html.spec.ts` (the real `parseMarkdown`
  with `getParserOptions('user')`: literal generics and tags, every directive
  payload, `remark-breaks`, GFM, emoji; and the assistant role: literal
  `{{ message }}`, every directive payload inert, `br`/`sup` in tables, the
  mermaid fence), `tests/unit/utils/rehype-raw-html-as-text.spec.ts`
  and `tests/unit/composables/chat-format.spec.ts` (hostile user and assistant
  payloads mounted through `MDCRenderer`).
- `tests/e2e/chat/chat-input-markdown.spec.ts` (the `markdown` test scenario in
  `server/utils/chats/test/markdown-fixture.ts`, including an iframe directive
  and `Vec<String>`).
- `tests/unit/utils/clipboard-html.spec.ts`,
  `tests/unit/composables/message-copy.spec.ts` and the `onCopy` block of
  `tests/unit/components/Chat/Message.spec.ts` (copying messages).
- `tests/unit/components/ChatInput.spec.ts` (`markdown-aware textarea`) and
  `tests/unit/components/Projects/InstructionsCard.spec.ts`.
- Pasted text chips: `tests/unit/utils/pasted-text.spec.ts`,
  `tests/unit/components/ChatInput/Files/Attached/TextCard.spec.ts`,
  `tests/unit/components/ChatInput/Files/Attached/Preview.client.spec.ts`,
  `tests/unit/components/Chat/TextFileModal.client.spec.ts` (including the iOS
  `showModal` stub and the keyboard lift), the text file
  helpers in `tests/unit/utils/files.spec.ts`, and two e2e tests in
  `tests/e2e/chat/chat-input-markdown.spec.ts` (chip, no `/api/v1/files`
  request, edit, joined send payload; Insert as text).

Not covered by the jsdom-style environment (happy-dom): the real
`execCommand` path and native undo. Verify once in a browser: paste an Apple
Mail list, press Cmd+Z, expect the whole paste to undo in one step.
