import type { DefineComponent } from 'vue'
import type { UIMessage } from 'ai'
import type { MDCParseOptions } from '@nuxtjs/mdc'
import ProseStreamPre from '~/components/prose/PreStream.vue'
import Table from '~/components/prose/Table.vue'
import A from '~/components/prose/A.vue'
import Img from '~/components/prose/Img.vue'
import { rehypeRawHtmlAsText } from '~/utils/rehype-raw-html-as-text'
import { remarkDisableHtml } from '~/utils/remark-disable-html'

const imageComponents = {
  img: Img as unknown as DefineComponent,
}

const components = {
  pre: ProseStreamPre as unknown as DefineComponent,
  table: Table as unknown as DefineComponent,
  ...imageComponents,
}

const messageComponents = {
  ...components,
  a: A as unknown as DefineComponent,
}

const userParserOptions: MDCParseOptions = {
  highlight: false,
  remark: {
    plugins: {
      'remark-mdc': false,
      'remark-disable-html': { instance: remarkDisableHtml },
    },
  },
  rehype: {
    plugins: {
      'rehype-raw': false,
      'rehype-raw-html-as-text': { instance: rehypeRawHtmlAsText },
    },
  },
}

const defaultParserOptions: MDCParseOptions = {
  highlight: false,
  remark: {
    plugins: {
      'remark-mdc': false,
    },
  },
}

function getParserOptions(role: UIMessage['role']) {
  return role === 'user' ? userParserOptions : defaultParserOptions
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
    imageComponents,
    messageComponents,
    getUnwrap,
    getParserOptions,
  }
}
