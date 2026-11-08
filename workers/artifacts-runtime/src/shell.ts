import type { Theme } from '@besidka/artifacts-protocol'

export const ROOT_ELEMENT_ID = 'root'

export const SHELL_STYLE = `
:root {
  color-scheme: light;
  --besidka-bg: #ffffff;
  --besidka-fg: #1f2328;
  --besidka-muted: #59636e;
  --besidka-border: #d1d9e0;
  --besidka-accent: #0969da;
  --besidka-surface: #f6f8fa;
  --besidka-danger: #cf222e;
  --besidka-danger-bg: #ffebe9;
}
:root[data-theme='dark'] {
  color-scheme: dark;
  --besidka-bg: #0d1117;
  --besidka-fg: #e6edf3;
  --besidka-muted: #9198a1;
  --besidka-border: #3d444d;
  --besidka-accent: #4493f8;
  --besidka-surface: #151b23;
  --besidka-danger: #ff7b72;
  --besidka-danger-bg: #2d1214;
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
