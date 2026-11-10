#!/usr/bin/env node

/**
 * Proves that the lazy, client-only highlighter in
 * app/utils/code-highlight.ts produces byte-identical `codeToTokens` output
 * to the eager `shiki/bundle/web` highlighter it replaced, for every language
 * of that bundle, in both themes, cold and after other languages loaded in
 * two orders (so the result does not depend on which code block a reader
 * opened first). It also checks that CODE_LANGUAGE_INJECTORS matches the
 * injections the eager highlighter collects. The same
 * functions back tests/unit/scripts/shiki-token-parity.spec.ts. See
 * docs/code-highlighting.md.
 *
 * Usage:
 *   node scripts/shiki-token-parity.mjs
 */

/* eslint-disable no-console */

import { fileURLToPath } from 'node:url'
import {
  createHighlighter,
  bundledLanguages as webLanguages,
  bundledLanguagesInfo as webLanguagesInfo,
} from 'shiki/bundle/web'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { bundledLanguages as allLanguages } from 'shiki/langs'
import {
  CODE_LANGUAGE_INJECTORS,
  CODE_THEME_DARK,
  CODE_THEME_LIGHT,
  createCodeHighlighterPool,
} from '../app/utils/code-highlight.ts'

export const PARITY_THEMES = [CODE_THEME_DARK, CODE_THEME_LIGHT]

const TYPESCRIPT_SAMPLE = `import { css, html } from 'lit'
import type { Ref } from 'vue'

/** Docs with a {@link Ref} tag. */
export interface Account<TMeta = unknown> {
  readonly id: number
  email?: string
  meta: TMeta
}

enum Role { Admin = 'admin', Reader = 'reader' }

@Component({ selector: 'app-root' })
export class AccountStore<T extends Account> implements Iterable<T> {
  #items = new Map<number, T>()
  private static readonly LIMIT = 0x1f

  constructor(private readonly prefix: string = \`acc-\${Role.Admin}\`) {}

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    for await (const item of this.#items.values()) {
      yield item satisfies T
    }
  }

  find(pattern = /^[a-z]+\\d{2,}$/giu): T | undefined {
    return [...this.#items.values()].find(item => pattern.test(item.email ?? ''))
  }
}

const styles = css\`
  :host { display: block; color: var(--accent, #0af); }
\`
const view = html\`<p class="greeting">Hello, \${name}!</p>\`
const query = sql\`SELECT id, email FROM users WHERE id = \${id} LIMIT 1\`
const markup = /* html */ \`<span>\${1 + 2}</span>\`
const shader = glsl\`void main() { gl_FragColor = vec4(1.0); }\`
const doc = xml\`<note><to>Tove</to></note>\`
`

const TSX_SAMPLE = `import { useMemo, useState } from 'react'

type Props = { items: string[]; onPick?: (value: string) => void }

export function Picker({ items, onPick }: Props) {
  const [query, setQuery] = useState<string>('')
  const visible = useMemo(() => items.filter(item => item.includes(query)), [items, query])

  return (
    <div className="picker" data-count={visible.length}>
      <input value={query} onChange={event => setQuery(event.target.value)} />
      {visible.length > 0 ? (
        <ul>{visible.map(item => <li key={item} onClick={() => onPick?.(item)}>{item}</li>)}</ul>
      ) : <p>Nothing &amp; nobody</p>}
    </div>
  )
}
`

const PYTHON_SAMPLE = `from __future__ import annotations
import asyncio
from dataclasses import dataclass, field

@dataclass(frozen=True)
class Point:
    x: float = 0.0
    tags: list[str] = field(default_factory=list)

    def __add__(self, other: "Point") -> "Point":
        return Point(self.x + other.x)

async def main(limit: int = 3) -> None:
    """Docstring with 'quotes'."""
    values = [n ** 2 for n in range(limit) if n % 2 == 0]
    print(f"{values=} {len(values):>4}", r"\\d+", b"bytes")
    await asyncio.sleep(0.1)

if __name__ == "__main__":
    asyncio.run(main())
`

const HTML_SAMPLE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Sample &amp; test</title>
  <style>
    body { margin: 0; font: 16px/1.5 system-ui; }
    .card:hover > a::after { content: "→"; }
  </style>
</head>
<body>
  <!-- comment -->
  <div id="app" class="card" v-if="visible" :title="label" @click="toggle">
    {{ message | capitalize }}
    <li *ngFor="let item of items; trackBy: id">{{ item.name }}</li>
    @if (user.isLoggedIn) { <p>Welcome</p> } @else { <p>Sign in</p> }
    @let total = price * quantity;
  </div>
  <script type="module">
    const state = { count: 0 }
    document.querySelector('#app').addEventListener('click', () => state.count++)
    const template = html\`<b>\${state.count}</b>\`
  </script>
</body>
</html>
`

const CSS_SAMPLE = `@use 'sass:math';
$gap: 4px !default;
@media (min-width: 768px) and (prefers-color-scheme: dark) {
  :root { --accent: oklch(70% 0.1 200); }
  .grid > *:nth-child(2n + 1) {
    margin: math.div($gap, 2) auto;
    background: url("data:image/png;base64,AAAA") no-repeat;
    &:hover { transform: translate(-50%, 10px) rotate(45deg); }
  }
}
@keyframes spin { from { rotate: 0turn } to { rotate: 1turn } }
`

const DATA_SAMPLE = `{
  "name": "besidka",
  "version": "1.0.0",
  "private": true,
  "nested": { "list": [1, 2.5e3, -3, null, false], "empty": {} }
}
# yaml-ish
key: value
list:
  - item: "quoted"
    anchor: &ref { a: 1 }
  - *ref
multiline: |
  text block
`

const MARKDOWN_SAMPLE = `---
title: Notes
tags: [a, b]
---

import { Chart } from './chart'
export const meta = { draft: true }

# Title with \`code\`

<Chart data={[1, 2, 3]} />
{props.year > 2020 ? 'new' : 'old'}

Some *emphasis*, **strong** and a [link](https://example.com "title").
Inline {{ interpolation }} and <span v-if="ok" :class="cls">html</span>.

> Quote with a list:
> - one
> - two

1. First
2. Second

\`\`\`ts
const answer: number = 42
const tagged = css\`color: red;\`
\`\`\`

\`\`\`python
def greet(name: str) -> str:
    return f"hi {name}"
\`\`\`

\`\`\`json
{ "ok": true }
\`\`\`

\`\`\`bash
pnpm install && echo "$HOME"
\`\`\`

\`\`\`vue
<template><p>{{ msg }}</p></template>
\`\`\`

| Column | Value |
| ------ | ----- |
| a      | 1     |
`

const VUE_SAMPLE = `<template>
  <section :class="{ active }" @keydown.enter="submit">
    <MyInput v-model.trim="name" #default="{ item }">{{ item.label }}</MyInput>
    <p v-for="(row, index) in rows" :key="row.id">{{ index }}: {{ row.text }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, shallowRef } from 'vue'

const name = shallowRef<string>('')
const active = computed<boolean>(() => name.value.length > 2)
const query = sql\`SELECT 1\`
</script>

<style scoped lang="scss">
section { color: v-bind(color); .nested { margin: 0 } }
</style>

<i18n lang="yaml">
en:
  hello: Hello
</i18n>
`

const SQL_SHELL_SAMPLE = `-- create a table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
SELECT u.id, COUNT(*) AS total FROM users u LEFT JOIN orders o ON o.user_id = u.id
WHERE u.email LIKE '%@example.com' GROUP BY u.id HAVING total > 2 ORDER BY 2 DESC;

#!/usr/bin/env bash
set -euo pipefail
for file in "$@"; do
  if [[ -f "$file" ]]; then echo "\${file##*/}: $(wc -l < "$file")"; fi
done
export PATH="$HOME/bin:$PATH"
`

const C_FAMILY_SAMPLE = `#include <stdio.h>
#define MAX(a, b) ((a) > (b) ? (a) : (b))

template <typename T>
struct Box { T value; };

public class Main {
    @Override
    public static void main(String[] args) throws Exception {
        int[] values = {1, 2, 3};
        System.out.printf("%d%n", MAX(values[0], values[1]));
    }
}

int main(void) {
    char *text = "hello\\n";
    return printf("%s", text) > 0 ? 0 : 1;
}
`

const PHP_TEMPLATE_SAMPLE = `<?php
declare(strict_types=1);

namespace App\\Http;

final class Controller {
    public function __invoke(array $items): string {
        return implode(', ', array_map(fn ($item) => "<li>{$item}</li>", $items));
    }
}
?>
<ul>
  <?= $controller(['a', 'b']) ?>
  {% for item in items %}<li>{{ item|upper }}</li>{% endfor %}
  {{#each people}}<li>{{this}}</li>{{/each}}
  @foreach ($users as $user) <p>{{ $user->name }}</p> @endforeach
</ul>
`

const PUG_SAMPLE = `doctype html
html(lang="en")
  head
    title= pageTitle
  body
    div.card(v-if="visible" :title="label" @click="toggle")
      p {{ message }}
    script.
      const answer = 42
    :markdown
      # Heading inside pug
    style(lang="stylus").
      body
        color red
`

export const PARITY_SAMPLES = {
  'typescript': TYPESCRIPT_SAMPLE,
  'tsx': TSX_SAMPLE,
  'python': PYTHON_SAMPLE,
  'html': HTML_SAMPLE,
  'css': CSS_SAMPLE,
  'data': DATA_SAMPLE,
  'markdown': MARKDOWN_SAMPLE,
  'vue': VUE_SAMPLE,
  'sql-shell': SQL_SHELL_SAMPLE,
  'c-family': C_FAMILY_SAMPLE,
  'php-template': PHP_TEMPLATE_SAMPLE,
  'pug': PUG_SAMPLE,
}

export const WEB_LANGUAGE_IDS = webLanguagesInfo.map((info) => {
  return info.id
})

/**
 * Markdown that fences a language outside the old web bundle. The eager
 * highlighter left the Go fence plain; the lazy one loads Go and colours it.
 */
export const IMPROVEMENT_SAMPLE = `Run it:

\`\`\`go
package main

func main() { println("hi") }
\`\`\`
`

const themeImports = [
  import('shiki/themes/github-dark-high-contrast.mjs'),
  import('shiki/themes/github-light-high-contrast.mjs'),
]

const engine = createJavaScriptRegexEngine()

/**
 * Shiki stops tokenizing a line after 500 ms by default, and the first line a
 * large grammar such as C++ sees can take that long while its regular
 * expressions compile, so a timed comparison is not repeatable.
 */
const NO_TIME_LIMIT = 0

export function createEagerWebHighlighter() {
  return createHighlighter({
    engine: createJavaScriptRegexEngine(),
    themes: PARITY_THEMES,
    langs: Object.keys(webLanguages),
  })
}

export function createLazyPool() {
  return createCodeHighlighterPool({
    createHighlighter: () => {
      return createHighlighterCore({
        engine,
        themes: themeImports,
        langs: [],
        warnings: false,
      })
    },
    languageImports: allLanguages,
  })
}

function serializeTokens(highlighter, code, lang, theme) {
  return JSON.stringify(highlighter.codeToTokens(code, {
    lang,
    theme,
    tokenizeTimeLimit: NO_TIME_LIMIT,
  }).tokens)
}

/**
 * Reads, from the eager highlighter, which injection grammars each web
 * language collects for its root scope, and maps them to the web language
 * module that ships them. Uses shiki's private registry fields: if a shiki
 * upgrade moves them, this throws and the spec fails loudly.
 */
export async function deriveLanguageInjectors() {
  const eager = await createEagerWebHighlighter()
  const injectionModules = new Map()

  for (const info of webLanguagesInfo) {
    const registrations = (await info.import()).default

    for (const registration of registrations) {
      if (!registration.injectTo?.length) {
        continue
      }

      const current = injectionModules.get(registration.scopeName)

      if (!current || registrations.length < current.size) {
        injectionModules.set(registration.scopeName, {
          id: info.id,
          size: registrations.length,
        })
      }
    }
  }

  const derived = {}

  for (const id of WEB_LANGUAGE_IDS) {
    const grammar = eager.getLanguage(id)
    const scopes = grammar._grammarRepository._injectionGrammars
      .get(grammar._rootScopeName) ?? []
    const ownNames = new Set((await webLanguages[id]()).default.map((item) => {
      return item.name
    }))
    const injectors = new Set()

    for (const scope of scopes) {
      const injectionModule = injectionModules.get(scope)

      if (!injectionModule) {
        throw new Error(`No web language ships the injection ${scope}`)
      }

      if (injectionModule.id !== id && !ownNames.has(injectionModule.id)) {
        injectors.add(injectionModule.id)
      }
    }

    if (injectors.size) {
      derived[id] = [...injectors].sort()
    }
  }

  return derived
}

async function compareLanguage(eager, pool, id, samples, mismatches, label) {
  let comparisons = 0

  for (const [sampleName, code] of Object.entries(samples)) {
    const { highlighter, language } = await pool.load(id, code)

    for (const theme of PARITY_THEMES) {
      comparisons++

      const expected = serializeTokens(eager, code, id, theme)
      const actual = serializeTokens(highlighter, code, language, theme)

      if (expected !== actual) {
        mismatches.push({ label, id, sampleName, theme })
      }
    }
  }

  return comparisons
}

/**
 * Tokenizes every sample in every web-bundle language and both themes with
 * the eager and the lazy highlighters, in three states: a fresh pool per
 * language (cold), one pool fed every language in order (warm forward) and
 * in reverse (warm reverse). Returns the unexpected mismatches.
 */
export async function compareTokenParity(options = {}) {
  const languageIds = options.languageIds ?? WEB_LANGUAGE_IDS
  const samples = options.samples ?? PARITY_SAMPLES
  const eager = await createEagerWebHighlighter()
  const mismatches = []
  let comparisons = 0

  for (const id of languageIds) {
    comparisons += await compareLanguage(
      eager,
      createLazyPool(),
      id,
      samples,
      mismatches,
      'cold',
    )
  }

  for (const order of ['forward', 'reverse']) {
    const pool = createLazyPool()
    const orderedIds = order === 'forward'
      ? languageIds
      : [...languageIds].reverse()

    for (const id of orderedIds) {
      comparisons += await compareLanguage(
        eager,
        pool,
        id,
        samples,
        mismatches,
        `warm ${order}`,
      )
    }
  }

  return { comparisons, mismatches }
}

/**
 * The case per-root highlighters exist for: Markdown and Vue reference
 * TypeScript lazily, which in one shared registry would freeze TypeScript
 * without its tagged-template injections.
 */
export async function compareAfterContamination() {
  const eager = await createEagerWebHighlighter()
  const pool = createLazyPool()

  await pool.load('vue', VUE_SAMPLE)
  await pool.load('markdown', MARKDOWN_SAMPLE)

  const { highlighter, language } = await pool.load(
    'typescript',
    TYPESCRIPT_SAMPLE,
  )

  return PARITY_THEMES.every((theme) => {
    return serializeTokens(eager, TYPESCRIPT_SAMPLE, 'typescript', theme)
      === serializeTokens(highlighter, TYPESCRIPT_SAMPLE, language, theme)
  })
}

export async function compareImprovement() {
  const eager = await createEagerWebHighlighter()
  const { highlighter, language } = await createLazyPool()
    .load('markdown', IMPROVEMENT_SAMPLE)
  const goLine = IMPROVEMENT_SAMPLE.split('\n').indexOf('package main')
  const eagerLine = eager.codeToTokens(IMPROVEMENT_SAMPLE, {
    lang: 'markdown',
    theme: CODE_THEME_DARK,
  }).tokens[goLine]
  const lazyLine = highlighter.codeToTokens(IMPROVEMENT_SAMPLE, {
    lang: language,
    theme: CODE_THEME_DARK,
  }).tokens[goLine]

  return { eagerTokens: eagerLine.length, lazyTokens: lazyLine.length }
}

async function main() {
  const startedAt = performance.now()
  const derived = await deriveLanguageInjectors()
  const isMapCurrent = JSON.stringify(derived)
    === JSON.stringify(CODE_LANGUAGE_INJECTORS)

  console.log(isMapCurrent
    ? 'CODE_LANGUAGE_INJECTORS matches the eager highlighter.'
    : `CODE_LANGUAGE_INJECTORS is stale. Derived:\n${JSON.stringify(derived, null, 2)}`)

  const { comparisons, mismatches } = await compareTokenParity()
  const isContaminationSafe = await compareAfterContamination()
  const improvement = await compareImprovement()
  const seconds = ((performance.now() - startedAt) / 1000).toFixed(1)

  console.log(`${comparisons} comparisons (${WEB_LANGUAGE_IDS.length} languages × `
    + `${Object.keys(PARITY_SAMPLES).length} samples × ${PARITY_THEMES.length} `
    + `themes × cold, warm forward, warm reverse): ${mismatches.length} `
    + `mismatches, ${seconds}s`)

  for (const mismatch of mismatches) {
    console.log(`  ${mismatch.label} ${mismatch.id} ${mismatch.sampleName} ${mismatch.theme}`)
  }

  console.log(`TypeScript after Vue and Markdown: ${isContaminationSafe ? 'identical' : 'DIFFERENT'}`)
  console.log(`Go fence in Markdown: eager ${improvement.eagerTokens} token(s), lazy ${improvement.lazyTokens}`)

  if (!isMapCurrent || mismatches.length || !isContaminationSafe) {
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
