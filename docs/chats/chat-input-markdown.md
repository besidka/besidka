# Chat input: Markdown-aware textarea

The chat input stays a plain `<textarea>` (`useTextareaAutosize`). Messages
are sent as Markdown and rendered with MDC (remark-gfm plus remark-breaks, so
a single newline is already a line break). `useMarkdownTextarea`
(`app/composables/markdown-textarea.ts`) makes that textarea Markdown-aware.
It is bound in `app/components/ChatInput.client.vue` (`/chats/new` and
`/chats/[slug]`) and, without the long-paste attachment, in
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
composable's `insertText(text, snapshot)` for the fallback. With a snapshot,
`insertText` does not call `focus()`, so a user who moved to another field
does not lose it.

## Long paste becomes an attachment

After conversion and normalisation, a text longer than
`LONG_PASTE_MIN_CHARACTERS` (4000) or with more than `LONG_PASTE_MIN_LINES`
(80) lines is not inserted, unless the caret is inside an open code fence:
there the text is inserted verbatim, because attaching it would pull code out
of the fence the user is writing. Otherwise the composable calls
`options.onLongPaste(text, snapshot)` and `ChatInput.client.vue` wraps it in
`new File([text], 'pasted-text-YYYYMMDD-HHmmss-SSS.txt', { type: 'text/plain' })`
(milliseconds avoid same-second name collisions)
and passes it to `uploadFiles([file])`, the same path as any attachment (the
chip shows the file name and the `lucide:file-text` icon, no image preview).
Without an `onLongPaste` option (the project instructions card) the text is
inserted normally.

`text/plain` is safe for every provider:

- it is in `allowedFileFormats` (`nuxt.config.ts`) and `AllowedFileFormat`
  (`shared/types/files.d.ts`), so the upload endpoints accept it;
- `isMediaTypeRejectedByModel` only gates `image/*` and `application/pdf`,
  and `createInputMediaTypePredicate` always allows `text/*`, so no model
  rejects it;
- `server/utils/files/convert-files-for-ai.ts` reads `text/*` files from R2 and
  inlines them as text parts, so no provider needs native file support.

`uploadFiles` (`app/composables/chat-files.ts`) resolves `true` only when the
files were accepted and queued, and `false` on every early return (unsupported
type, consent declined, file count or size caps). `attachLongPaste` awaits it
and, on `false` (or a thrown error), inserts the pasted text at the paste-time
snapshot through the composable's `insertText`, so a long paste is never lost.

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
- `tests/unit/components/ChatInput.spec.ts` (`markdown-aware textarea`) and
  `tests/unit/components/Projects/InstructionsCard.spec.ts`.

Not covered by the jsdom-style environment (happy-dom): the real
`execCommand` path and native undo. Verify once in a browser: paste an Apple
Mail list, press Cmd+Z, expect the whole paste to undo in one step.
