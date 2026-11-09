# Code highlighting in chat

Decision of 2026-11-09 (owner): keep shiki, but load it only in the browser,
load grammars on first use, and stream code blocks line by line. This
replaced `shiki/bundle/web` plus `shiki-stream`'s `ShikiCachedRenderer`.
rangi was evaluated and rejected (see below).

## The rule

**Never import shiki (`shiki`, `shiki/*`, `@shikijs/*`) statically from code
the server can reach.** That includes components such as `PreStream.vue`
that render inside `<ClientOnly>`: the component module is still part of the
SSR bundle, so a static import ships every grammar and theme in the Worker,
where they never run. All shiki imports live in `importShiki()` in
`app/composables/md-syntax-highlighter.ts`, behind
`if (import.meta.client)`, so the server build drops them. Type-only imports
are fine.

Check after `pnpm run build`:

```bash
grep -rlE 'scopeName\\?":\\?"(source|text)\.|scopeName:"(source|text)\.' .output/server
grep -rl tokenColors .output/server
```

Both must print nothing. A bare `grep -rl scopeName .output/server` always
matches `.output/server/chunks/nitro/nitro.mjs`: that is ajv's code
generator (`scopeName("validate")`), not a grammar, and it was there before.

## How it works

| Piece | File | Job |
| --- | --- | --- |
| Client entry | `app/composables/md-syntax-highlighter.ts` | Dynamic imports of `shiki/core`, the JavaScript regex engine, `shiki/langs` (the lazy import map of ~240 languages), the two themes and `@shikijs/stream`. Exposes `loadCodeHighlighter()`, `createCodeTokenizer()` and `highlightCode()`. |
| Highlighter pool | `app/utils/code-highlight.ts` | Hands out one shiki core highlighter per root language, loads grammars on demand, resolves aliases, falls back to `text`. |
| Streaming renderer | `app/composables/code-stream.ts`, `app/components/prose/CodeStream.vue` | Plain lines first, then `ShikiStreamTokenizer` line by line. |
| Code block chrome | `app/components/prose/PreStream.vue` | Unchanged props (`code`, `language`, `class`, `meta`); renders `ProseCodeStream` for non-diagram blocks. |

### Engine and themes

`createJavaScriptRegexEngine()` (no WASM), themes
`github-dark-high-contrast` and `github-light-high-contrast`, picked from the
colour mode. Switching the colour mode re-tokenizes the block once.

### Languages load on first use

A block's language is normalised (trimmed, lower case) and looked up in
`shiki/langs`, which knows every bundled language and alias. An unknown
language renders as plain `text`. Today's chat therefore colours Go, Rust,
C#, Ruby, Kotlin, Swift, diff, TOML, Dockerfile, PowerShell and the other
languages that were not in the web bundle.

### One highlighter per root language

Shiki's registry has two behaviours that make one shared, incrementally
grown highlighter colour the same block differently depending on which
blocks the reader opened first:

1. A grammar captures its list of injections (for example ts-tags' `css\``
   and `sql\`` templates inside TypeScript) the first time *any* loaded
   grammar references it, and never again. Markdown and Vue reference
   TypeScript and JSX lazily, so after a Markdown block a later TypeScript
   block lost its tagged-template colours.
2. A grammar compiled before a lazily embedded language arrives (a Python
   fence in Markdown) never picks that language up.

So `createCodeHighlighterPool()` builds a separate highlighter for each root
language, in one `loadLanguage` call, from:

- the root's grammars;
- `CODE_LANGUAGE_INJECTORS`: the modules whose grammars inject into the root
  in the old eager bundle (`ts-tags` for JavaScript, JSX, TypeScript and
  Angular TS; Angular and Vue for HTML derivatives);
- `CODE_LANGUAGE_IMPLICIT_EMBEDS`: lazily embedded languages a root uses
  without naming them (inline HTML in Markdown and MDC, ESM and JSX in MDX);
- the embedded languages the code names: fence info strings, `lang="…"`
  attributes, Pug/Haml `:filters`, YAML/TOML front matter.

When a later block of the same root names a new embedded language, that
root's highlighter is rebuilt with it. Registrations are passed in catalogue
order, as the eager bundle did, because the order decides the order of a
scope's injections.

The price: TypeScript, JavaScript and JSX blocks load the ts-tags closure
(about 86 KB gzip: TypeScript, JavaScript, CSS, HTML, SQL, XML, GLSL and
their tags) instead of TypeScript alone (16 KB gzip), and a chat that mixes
roots compiles shared grammars once per root. Go is about 5 KB gzip, Rust 3
KB, Python 9 KB, TSX 16 KB.

### Streaming renderer

`useCodeStream()` renders each line as its own `<span>` inside
`pre.shiki.shiki-stream > code`, with token `<span style="color:…">`
children and a `\n` text node at the end of every finished line, so the
block's `textContent` is exactly the source (copy-as-HTML in
`app/utils/clipboard-html.ts` and the Copy button read the source, not the
spans).

- Before the language has loaded, the lines render as plain text. Colouring
  replaces the spans inside each line without changing the text, so nothing
  moves.
- While a block streams, only the appended text is fed to
  `ShikiStreamTokenizer.enqueue()`. Finished lines are tokenized once and keep
  the same object; `v-memo` keeps their DOM nodes untouched. Only the
  incomplete last line is re-tokenized and re-rendered per chunk. Work per
  chunk is the number of new lines plus one `codeToTokens` call.
- An edit that is not an append (mermaid Edit/Reset, regenerate), a theme
  switch or a rebuilt highlighter starts the tokenizer over; every line whose
  colours did not change keeps its object and DOM node.

## Parity with the old highlighter

`pnpm run shiki:parity` (`scripts/shiki-token-parity.mjs`, also run by
`tests/unit/scripts/shiki-token-parity.spec.ts`) tokenizes 12 samples in
every one of the 57 languages of `shiki/bundle/web`, in both themes, with
the old eager highlighter and with the pool, in three states: a fresh pool
per language, and one pool fed every language forward and in reverse. It
compares the `codeToTokens` JSON byte for byte, with shiki's 500 ms per-line
time limit off (the first line a big grammar such as C++ sees can hit it
while its regular expressions compile, which made the old highlighter's own
output vary between runs). Result on 2026-11-09: 4,104 comparisons, 0
differences. It also checks that TypeScript after Vue and Markdown keeps its
tagged-template colours, that `CODE_LANGUAGE_INJECTORS` matches the
injections the eager highlighter collects (read from shiki's private
registry fields, so a shiki upgrade that moves them fails the spec loudly),
and that a Go fence in Markdown, plain before, is now coloured.

Re-run it on every shiki upgrade.

## Measurements

Production builds of `origin/main` and this change, both with the
`/chats/test?scenario=code` fixture (`server/utils/chats/test/code-fixture.ts`),
served by `wrangler dev`, measured in headless Chromium at 1440 x 900,
median of three runs.

### Worker

| | Before | After |
| --- | --- | --- |
| `wrangler deploy --dry-run` upload | 18,584 KiB, 3,718 KiB gzip | 13,283 KiB, 2,873 KiB gzip |
| `.output/server` | 19.6 MB | 13.7 MB |
| Grammar modules in the server output | 57 | 0 |

### First highlight of a persisted chat

TypeScript 50 and 300 lines, Go, Rust, diff and an unknown language in one
message. Times are from the block appearing to its first coloured span.
Cold is a fresh browser context; warm is a reload with the HTTP cache.

| | Before | After |
| --- | --- | --- |
| TypeScript 50 lines, cold / warm | 4,198 / 3,936 ms | 643 / 286 ms |
| TypeScript 300 lines, cold / warm | 4,198 / 3,936 ms | 643 / 286 ms |
| Go, Rust, diff, cold / warm | never coloured | 392 / 157 ms |
| Long tasks while loading | 1, 3.9 s | 1, 205 ms (cold), 112 ms (warm) |
| Shiki JavaScript loaded | 59 files, 3.48 MB, 489 KB gzip | 19 files, 877 KB, 150 KB gzip |
| All JavaScript transferred (cold) | 1.32 MB | 1.00 MB |

The 50 and 300 line blocks colour in the same frame: both wait for the same
load, and tokenizing 300 lines is a few milliseconds.

### Streaming a 1,047-line TypeScript block

918 chunks of 20 to 50 characters, 10 ms apart (about 11 s of stream).

| | Before | After |
| --- | --- | --- |
| Wall time until the stream finished rendering | 43.0 s | 11.2 s |
| Long tasks during the stream | 18, 41.8 s in total, longest 25 s | 2, 182 ms in total, longest 125 ms |
| Last line coloured after the stream ended | 25 ms | 4 ms |

Before, `ShikiCachedRenderer` re-rendered every token on every chunk, so the
page fell four times behind the stream and froze for seconds. The remaining
long tasks after the change are the first grammar compile and Markdown
parsing, which both versions share.

## Why not rangi

[rangi](https://www.npmjs.com/package/rangi) 2.2.0 was evaluated on
2026-11-09 against shiki core in a prototype: about 30 KB for the whole
library, against about 389 KB (80 KB gzip) for shiki core, both themes and
the TSX grammar. It was rejected because:

- **It recolours finished lines while streaming.** rangi has no resumable
  tokenizer state, so every chunk re-tokenizes the whole block, and a later
  chunk can change an earlier line: in the evaluation's 300-line TSX sample
  line 235 changed colour after it was complete, at every chunk size tried
  (1, 5 to 15 and 20 to 50 characters).
- Weaker JSX and TSX: coarser token types than the TextMate grammars.
- No themes that match the GitHub high-contrast pair this app uses, so every
  colour would change.
- 46 languages against about 240.
- About three months old at the time.

### When to revisit

Look again if rangi (or another small highlighter) gains resumable state or
otherwise never recolours finished lines while streaming, covers the
languages people paste into chat (at least the old web bundle's 57 plus Go,
Rust, C#, Ruby, Kotlin, Swift, diff, TOML, Dockerfile, PowerShell), can
reproduce the GitHub high-contrast colours, and has a release history of a
year or more. Also revisit the ts-tags companion if tagged-template colours
are judged not worth about 70 KB gzip on TypeScript and JavaScript blocks:
drop `ts-tags` from `CODE_LANGUAGE_INJECTORS` and accept the parity
difference for tagged templates.

## Related

- Open stack PR #778 (instant code tab in the artifact panel) builds a
  static, non-streaming path on the old `useHighlighter()`; after this change
  it should call `highlightCode(code, language, theme)` instead.
- `docs/nuxt-icon-collections.md` and `docs/vite-css-minify.md` record other
  bundle-size decisions.
