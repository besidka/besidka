import type { DefineComponent } from 'vue'
import type { UIMessage } from 'ai'
import ProseStreamPre from '~/components/prose/PreStream.vue'
import Table from '~/components/prose/Table.vue'

const components = {
  pre: ProseStreamPre as unknown as DefineComponent,
  table: Table as unknown as DefineComponent,
}

function getUnwrap(role: UIMessage['role']) {
  const tags = ['strong', 'details']

  if (role === 'user') {
    tags.push('pre')
  } else {
    tags.push('table')
  }

  return tags.join(',')
}

export function useChatFormat() {
  return {
    components,
    getUnwrap,
  }
}
