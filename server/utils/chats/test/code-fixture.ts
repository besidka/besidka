export const TEST_CODE_SHORT_LINES: number = 50

export const TEST_CODE_LONG_LINES: number = 300

export const TEST_CODE_STREAM_LINES: number = 1047

export const TEST_CODE_UNKNOWN_LANGUAGE: string = 'besidkascript'

const TYPESCRIPT_SECTION: readonly string[] = [
  '/** Loads item {index} with a "quoted" and `ticked` note. */',
  'export interface Item{index}<TMeta = Record<string, unknown>> {',
  '  readonly id: number',
  '  label?: string',
  '  meta: TMeta',
  '}',
  '',
  'export async function loadItem{index}(id: number): Promise<Item{index}> {',
  '  const pattern = /^item-{index}-\\d{2,}$/u',
  '  const query = sql`SELECT * FROM items WHERE id = ${id} LIMIT 1`',
  '  const response = await fetch(`/api/items/${id}?v={index}`)',
  '',
  '  if (!response.ok || !pattern.test(String(id))) {',
  '    throw new Error(`Item ${id} failed: ${response.status}`)',
  '  }',
  '',
  '  return { id, label: query.text, meta: await response.json() }',
  '}',
  '',
]

const GO_BLOCK: string = [
  'package main',
  '',
  'import (',
  '\t"fmt"',
  '\t"strings"',
  ')',
  '',
  'type Greeter struct {',
  '\tName string `json:"name"`',
  '}',
  '',
  'func (g *Greeter) Greet(times int) string {',
  '\tparts := make([]string, 0, times)',
  '\tfor i := 0; i < times; i++ {',
  '\t\tparts = append(parts, fmt.Sprintf("hi %s #%d", g.Name, i))',
  '\t}',
  '\treturn strings.Join(parts, ", ")',
  '}',
].join('\n')

const RUST_BLOCK: string = [
  'use std::collections::HashMap;',
  '',
  '#[derive(Debug, Clone)]',
  'pub struct Counter<\'a> {',
  '    words: HashMap<&\'a str, usize>,',
  '}',
  '',
  'impl<\'a> Counter<\'a> {',
  '    pub fn add(&mut self, text: &\'a str) -> usize {',
  '        for word in text.split_whitespace() {',
  '            *self.words.entry(word).or_insert(0) += 1;',
  '        }',
  '        self.words.len()',
  '    }',
  '}',
].join('\n')

const DIFF_BLOCK: string = [
  'diff --git a/app/config.ts b/app/config.ts',
  'index 3b18e51..a9c1f02 100644',
  '--- a/app/config.ts',
  '+++ b/app/config.ts',
  '@@ -1,5 +1,6 @@',
  ' export const config = {',
  '-  retries: 1,',
  '+  retries: 3,',
  '+  timeoutMs: 5000,',
  '   region: \'eu\',',
  ' }',
].join('\n')

const UNKNOWN_BLOCK: string = [
  'define greeting as "hello"',
  'repeat 3 times: say greeting',
].join('\n')

export function buildTestTypeScript(lineCount: number): string {
  const lines: string[] = []

  for (let index = 0; lines.length < lineCount; index++) {
    for (const line of TYPESCRIPT_SECTION) {
      lines.push(line.replaceAll('{index}', String(index)))
    }
  }

  return lines.slice(0, lineCount).join('\n').trimEnd()
}

function fence(language: string, code: string): string {
  return `\`\`\`${language}\n${code}\n\`\`\``
}

export const TEST_CODE_MESSAGE: string = [
  `A ${TEST_CODE_SHORT_LINES}-line TypeScript block:`,
  '',
  fence('ts', buildTestTypeScript(TEST_CODE_SHORT_LINES)),
  '',
  'Go:',
  '',
  fence('go', GO_BLOCK),
  '',
  'Rust:',
  '',
  fence('rust', RUST_BLOCK),
  '',
  'A diff:',
  '',
  fence('diff', DIFF_BLOCK),
  '',
  'A language the highlighter does not know:',
  '',
  fence(TEST_CODE_UNKNOWN_LANGUAGE, UNKNOWN_BLOCK),
  '',
  `And a ${TEST_CODE_LONG_LINES}-line TypeScript block:`,
  '',
  fence('ts', buildTestTypeScript(TEST_CODE_LONG_LINES)),
].join('\n')

export const TEST_CODE_STREAM_MESSAGE: string = [
  `Here is a ${TEST_CODE_STREAM_LINES}-line module:`,
  '',
  fence('ts', buildTestTypeScript(TEST_CODE_STREAM_LINES)),
  '',
  'That is the whole module.',
].join('\n')
