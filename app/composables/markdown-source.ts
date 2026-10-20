import type { InjectionKey } from 'vue'

export interface MarkdownSourceContext {
  source: string
  streaming: boolean
}

const COMPLETE_CONTEXT: MarkdownSourceContext = {
  source: '',
  streaming: false,
}

export const markdownSourceKey: InjectionKey<() => MarkdownSourceContext>
  = Symbol('markdown-source')

export function provideMarkdownSource(
  getContext: () => MarkdownSourceContext,
) {
  provide(markdownSourceKey, getContext)
}

export function useMarkdownSource(): ComputedRef<MarkdownSourceContext> {
  const getContext = inject(markdownSourceKey, () => COMPLETE_CONTEXT)

  return computed<MarkdownSourceContext>(getContext)
}
