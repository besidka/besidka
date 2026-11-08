import type { ArtifactPayload } from '@besidka/artifacts-protocol'

const PREVIEW_LINE_COUNT = 40

const KIND_LABELS: Record<ArtifactPayload['kind'], string> = {
  html: 'HTML page',
  react: 'React component',
  svg: 'SVG image',
  mermaid: 'diagram',
  markdown: 'document',
}

export function tailLines(content: string, lineCount: number): string {
  const lines = content.split('\n')

  return lines.slice(Math.max(0, lines.length - lineCount)).join('\n')
}

/**
 * Streaming preview for kinds whose partial source cannot be executed
 * safely or meaningfully: it shows progress and the latest lines as text,
 * never running partial code.
 */
export function renderSourcePreview(
  payload: ArtifactPayload,
  root: HTMLElement,
) {
  const wrapper = document.createElement('section')
  const status = document.createElement('p')
  const source = document.createElement('pre')

  wrapper.className = 'besidka-partial'
  wrapper.setAttribute('aria-busy', 'true')
  status.textContent = `Writing ${KIND_LABELS[payload.kind]}… ${payload.content.length} characters`
  source.textContent = tailLines(payload.content, PREVIEW_LINE_COUNT)
  wrapper.append(status, source)
  root.replaceChildren(wrapper)
}
