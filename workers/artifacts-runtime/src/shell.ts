import type { Theme } from '@besidka/artifacts-protocol'
import { paletteDeclarations } from './palette.ts'

export const ROOT_ELEMENT_ID = 'root'

export const SHELL_STYLE = `
:root {
  color-scheme: light;
  ${paletteDeclarations('light')}
}
:root[data-theme='dark'] {
  color-scheme: dark;
  ${paletteDeclarations('dark')}
}
html {
  background: var(--besidka-bg);
  color: var(--besidka-fg);
}
body {
  margin: 0;
  font: 16px/1.6 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  overflow-wrap: anywhere;
}
#root {
  padding: 16px;
}
a {
  color: var(--besidka-accent);
}
.besidka-markdown > :first-child {
  margin-top: 0;
}
.besidka-markdown > :last-child {
  margin-bottom: 0;
}
.besidka-markdown pre,
.besidka-markdown code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.875em;
  background: var(--besidka-surface);
  border-radius: 6px;
}
.besidka-markdown code {
  padding: 0.15em 0.35em;
}
.besidka-markdown pre {
  padding: 12px 16px;
  overflow-x: auto;
}
.besidka-markdown pre code {
  padding: 0;
  background: none;
}
.besidka-markdown blockquote {
  margin: 0;
  padding: 0 1em;
  color: var(--besidka-muted);
  border-left: 4px solid var(--besidka-border);
}
.besidka-markdown table {
  border-collapse: collapse;
}
.besidka-markdown th,
.besidka-markdown td {
  padding: 6px 12px;
  border: 1px solid var(--besidka-border);
}
.besidka-markdown img,
.besidka-svg svg,
.besidka-mermaid svg {
  max-width: 100%;
  height: auto;
}
.besidka-svg,
.besidka-mermaid {
  display: flex;
  justify-content: center;
}
.besidka-mermaid > besidka-mermaid {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
}
.besidka-partial {
  color: var(--besidka-muted);
  font-size: 14px;
}
.besidka-partial pre {
  margin: 8px 0 0;
  padding: 12px;
  max-height: 60vh;
  overflow: hidden;
  white-space: pre-wrap;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: var(--besidka-surface);
  border-radius: 6px;
}
.besidka-standalone {
  max-width: 32rem;
  margin: 15vh auto;
  color: var(--besidka-muted);
  text-align: center;
}
`.trim()

export const SHELL_HEAD = [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<meta name="robots" content="noindex, nofollow">',
  '<meta name="ai-generated" content="true">',
  '<title>Besidka artifact</title>',
  `<style>${SHELL_STYLE}</style>`,
].join('')

export function createShellDocument(theme: Theme, extraHead = ''): string {
  return [
    '<!doctype html>',
    `<html lang="en" data-theme="${theme}">`,
    `<head>${SHELL_HEAD}${extraHead}</head>`,
    `<body><div id="${ROOT_ELEMENT_ID}"></div></body>`,
    '</html>',
  ].join('')
}
