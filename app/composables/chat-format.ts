import type { DefineComponent } from 'vue'
import type { Message } from '@ai-sdk/vue'
import ProseStreamPre from '~/components/prose/PreStream.vue'

const components = {
  pre: ProseStreamPre as unknown as DefineComponent,
}

function getUnwrap(role: Message['role']) {
  const tags = ['strong']

  if (role === 'user') {
    tags.push('pre')
  }

  return tags.join(',')
}

export function useChatFormat() {
  return {
    components,
    getUnwrap,
  }
}
