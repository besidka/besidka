interface HastNode {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

function toLiteralNode(rawNode: HastNode, parent: HastNode): HastNode {
  const textNode: HastNode = {
    type: 'text',
    value: rawNode.value ?? '',
  }

  if (parent.type !== 'root') {
    return textNode
  }

  return {
    type: 'element',
    tagName: 'p',
    properties: {},
    children: [textNode],
  }
}

function replaceRawNodes(parent: HastNode) {
  if (!parent.children) {
    return
  }

  parent.children = parent.children.map((child) => {
    if (child.type === 'raw') {
      return toLiteralNode(child, parent)
    }

    replaceRawNodes(child)

    return child
  })
}

export function rehypeRawHtmlAsText() {
  return replaceRawNodes
}
