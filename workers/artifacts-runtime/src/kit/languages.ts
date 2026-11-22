import type { LanguageRegistration } from 'shiki/core'

export type LanguageLoader = () => Promise<{
  default: LanguageRegistration[]
}>

export const PLAIN_LANGUAGE = 'text'

export const LANGUAGE_LOADERS: Record<string, LanguageLoader> = {
  'angular-html': () => {
    return import('shiki/langs/angular-html.mjs')
  },
  'angular-ts': () => {
    return import('shiki/langs/angular-ts.mjs')
  },
  'astro': () => {
    return import('shiki/langs/astro.mjs')
  },
  'blade': () => {
    return import('shiki/langs/blade.mjs')
  },
  'c': () => {
    return import('shiki/langs/c.mjs')
  },
  'coffee': () => {
    return import('shiki/langs/coffee.mjs')
  },
  'cpp': () => {
    return import('shiki/langs/cpp.mjs')
  },
  'css': () => {
    return import('shiki/langs/css.mjs')
  },
  'csv': () => {
    return import('shiki/langs/csv.mjs')
  },
  'glsl': () => {
    return import('shiki/langs/glsl.mjs')
  },
  'graphql': () => {
    return import('shiki/langs/graphql.mjs')
  },
  'haml': () => {
    return import('shiki/langs/haml.mjs')
  },
  'handlebars': () => {
    return import('shiki/langs/handlebars.mjs')
  },
  'html': () => {
    return import('shiki/langs/html.mjs')
  },
  'html-derivative': () => {
    return import('shiki/langs/html-derivative.mjs')
  },
  'http': () => {
    return import('shiki/langs/http.mjs')
  },
  'hurl': () => {
    return import('shiki/langs/hurl.mjs')
  },
  'imba': () => {
    return import('shiki/langs/imba.mjs')
  },
  'java': () => {
    return import('shiki/langs/java.mjs')
  },
  'javascript': () => {
    return import('shiki/langs/javascript.mjs')
  },
  'jinja': () => {
    return import('shiki/langs/jinja.mjs')
  },
  'jison': () => {
    return import('shiki/langs/jison.mjs')
  },
  'json': () => {
    return import('shiki/langs/json.mjs')
  },
  'json5': () => {
    return import('shiki/langs/json5.mjs')
  },
  'jsonc': () => {
    return import('shiki/langs/jsonc.mjs')
  },
  'jsonl': () => {
    return import('shiki/langs/jsonl.mjs')
  },
  'jsx': () => {
    return import('shiki/langs/jsx.mjs')
  },
  'julia': () => {
    return import('shiki/langs/julia.mjs')
  },
  'less': () => {
    return import('shiki/langs/less.mjs')
  },
  'markdown': () => {
    return import('shiki/langs/markdown.mjs')
  },
  'marko': () => {
    return import('shiki/langs/marko.mjs')
  },
  'mdc': () => {
    return import('shiki/langs/mdc.mjs')
  },
  'mdx': () => {
    return import('shiki/langs/mdx.mjs')
  },
  'php': () => {
    return import('shiki/langs/php.mjs')
  },
  'postcss': () => {
    return import('shiki/langs/postcss.mjs')
  },
  'pug': () => {
    return import('shiki/langs/pug.mjs')
  },
  'python': () => {
    return import('shiki/langs/python.mjs')
  },
  'r': () => {
    return import('shiki/langs/r.mjs')
  },
  'regexp': () => {
    return import('shiki/langs/regexp.mjs')
  },
  'sass': () => {
    return import('shiki/langs/sass.mjs')
  },
  'scss': () => {
    return import('shiki/langs/scss.mjs')
  },
  'shellscript': () => {
    return import('shiki/langs/shellscript.mjs')
  },
  'smithy': () => {
    return import('shiki/langs/smithy.mjs')
  },
  'sql': () => {
    return import('shiki/langs/sql.mjs')
  },
  'stylus': () => {
    return import('shiki/langs/stylus.mjs')
  },
  'svelte': () => {
    return import('shiki/langs/svelte.mjs')
  },
  'ts-tags': () => {
    return import('shiki/langs/ts-tags.mjs')
  },
  'tsx': () => {
    return import('shiki/langs/tsx.mjs')
  },
  'typescript': () => {
    return import('shiki/langs/typescript.mjs')
  },
  'vue': () => {
    return import('shiki/langs/vue.mjs')
  },
  'vue-html': () => {
    return import('shiki/langs/vue-html.mjs')
  },
  'vue-vine': () => {
    return import('shiki/langs/vue-vine.mjs')
  },
  'wasm': () => {
    return import('shiki/langs/wasm.mjs')
  },
  'wgsl': () => {
    return import('shiki/langs/wgsl.mjs')
  },
  'wit': () => {
    return import('shiki/langs/wit.mjs')
  },
  'xml': () => {
    return import('shiki/langs/xml.mjs')
  },
  'yaml': () => {
    return import('shiki/langs/yaml.mjs')
  },
}

export const LANGUAGE_ALIASES: Record<string, string> = {
  'coffeescript': 'coffee',
  'c++': 'cpp',
  'gql': 'graphql',
  'hbs': 'handlebars',
  'js': 'javascript',
  'cjs': 'javascript',
  'mjs': 'javascript',
  'jl': 'julia',
  'md': 'markdown',
  'jade': 'pug',
  'py': 'python',
  'regex': 'regexp',
  'bash': 'shellscript',
  'sh': 'shellscript',
  'shell': 'shellscript',
  'zsh': 'shellscript',
  'styl': 'stylus',
  'lit': 'ts-tags',
  'ts': 'typescript',
  'cts': 'typescript',
  'mts': 'typescript',
  'yml': 'yaml',
}

export function resolveLanguage(name: string | null | undefined): string {
  const normalized = (name ?? '').trim().toLowerCase()
  const id = LANGUAGE_ALIASES[normalized] ?? normalized

  return Object.hasOwn(LANGUAGE_LOADERS, id) ? id : PLAIN_LANGUAGE
}
