interface HastNode {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
  content?: HastNode
}

const BINDING_PREFIX = /^:?[.^]?/
const DIRECTIVE_PROPERTY = /^(?:v-|@|on)/i
const HTML_INJECTION_PROPERTY = /^(?:inner|outer)-?html$/i
const UNSAFE_ATTRIBUTE_PROPERTY = /^(?:srcdoc|formaction)$/i
const SLOT_DIRECTIVE_PROPERTY = /^v-slot(?::|$)/i
const SLOT_TEMPLATE_TAG_NAMES = new Set(['template', 'component-slot'])

function isForbiddenProperty(name: string, node: HastNode): boolean {
  if (
    node.tagName
    && SLOT_TEMPLATE_TAG_NAMES.has(node.tagName)
    && SLOT_DIRECTIVE_PROPERTY.test(name)
  ) {
    return false
  }

  const bindingName = name.replace(BINDING_PREFIX, '')

  return DIRECTIVE_PROPERTY.test(bindingName)
    || HTML_INJECTION_PROPERTY.test(bindingName)
    || UNSAFE_ATTRIBUTE_PROPERTY.test(bindingName)
}

function stripForbiddenProperties(node: HastNode) {
  if (!node.properties) {
    return
  }

  for (const name of Object.keys(node.properties)) {
    if (isForbiddenProperty(name, node)) {
      Reflect.deleteProperty(node.properties, name)
    }
  }
}

function collectChildNodes(node: HastNode): HastNode[] {
  const childNodes = node.children ?? []

  if (!node.content) {
    return childNodes
  }

  return [...childNodes, node.content]
}

/**
 * Removes Vue directive style and HTML-injection properties from every hast
 * element, including the `content` fragment hast keeps for `<template>`
 * elements (which @nuxtjs/mdc compiles and renders like regular children).
 * MDCRenderer merges `v-bind` / `v-model:*` values onto vnode props without
 * re-running its attribute validation, so these keys must never reach the
 * compiler. A single leading `:` (and an optional `.` / `^` Vue prop-modifier
 * after it) is removed before matching: plain `:prop` bindings, which
 * remark-mdc emits for YAML block props holding objects, arrays, numbers and
 * booleans, survive because MDCRenderer binds them to that one prop name
 * only and validateProp already rejects unsafe ones. `:v-bind`, `:onclick`,
 * `:innerHTML` and the like are still stripped. `v-slot` / `v-slot:<name>`
 * is kept on `template` elements only (MDC named slots `#title` arrive as
 * `component-slot` elements that the MDC compiler renames to `template`)
 * because MDCRenderer reads only the slot name from that key. Must be
 * registered after `rehype-raw`.
 */
export default function rehypeStripDirectiveProps() {
  return (tree: HastNode) => {
    const pendingNodes: HastNode[] = [tree]

    while (pendingNodes.length > 0) {
      const node = pendingNodes.pop() as HastNode

      stripForbiddenProperties(node)
      pendingNodes.push(...collectChildNodes(node))
    }
  }
}
