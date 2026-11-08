import { marked } from 'marked'
import type { Renderer } from './types.ts'

export function markdownToHtml(content: string): string {
  return marked.parse(content, { async: false, gfm: true })
}

export const renderMarkdown: Renderer = (payload, context) => {
  const article = document.createElement('article')

  article.className = 'besidka-markdown'
  article.innerHTML = markdownToHtml(payload.content)
  context.root.replaceChildren(article)
}
