import { reportError } from '../report.ts'
import type { KitController } from './chrome.ts'

export const CODE_ELEMENT_NAME = 'besidka-code'

export const MERMAID_ELEMENT_NAME = 'besidka-mermaid'

export const KIT_READY_ATTRIBUTE = 'data-besidka-ready'

type ControllerFactory = (element: HTMLElement) => Promise<KitController>

/**
 * The element classes are tiny and defined at boot, so markup parsed later
 * (HTML artifacts, Markdown, React) upgrades on insertion. Shiki, its
 * grammars and Mermaid load only when the first element connects.
 */
function createKitElement(createController: ControllerFactory) {
  return class extends HTMLElement {
    static observedAttributes = ['lang']

    controller: KitController | null = null

    connecting = false

    markReady: () => void = () => {}

    ready: Promise<void> = new Promise((resolve) => {
      this.markReady = resolve
    })

    reveal() {
      this.style.removeProperty('visibility')
      this.setAttribute(KIT_READY_ATTRIBUTE, '')
      this.markReady()
    }

    async connectedCallback() {
      if (this.controller) {
        this.controller.connect()

        return
      }

      if (this.connecting) {
        return
      }

      this.connecting = true
      this.style.visibility = 'hidden'

      try {
        const controller = await createController(this)

        this.controller = controller

        if (this.isConnected) {
          controller.connect()
          await controller.ready
        }
      } catch (exception) {
        reportError(exception, { level: 'warning', showPanel: false })
      } finally {
        this.connecting = false
        this.reveal()
      }
    }

    disconnectedCallback() {
      this.controller?.disconnect()
    }

    attributeChangedCallback() {
      this.controller?.refresh()
    }
  }
}

export function defineKitElements() {
  if (!customElements.get(CODE_ELEMENT_NAME)) {
    customElements.define(
      CODE_ELEMENT_NAME,
      createKitElement(async (element) => {
        const module = await import('./code-view.ts')

        return module.createCodeController(element)
      }),
    )
  }

  if (!customElements.get(MERMAID_ELEMENT_NAME)) {
    customElements.define(
      MERMAID_ELEMENT_NAME,
      createKitElement(async (element) => {
        const module = await import('./mermaid-view.ts')

        return module.createMermaidController(element)
      }),
    )
  }
}

/**
 * Resolves once every `<besidka-code>` and `<besidka-mermaid>` in the
 * document has drawn its first render (or failed to), so the runtime does
 * not reveal a block that still shows its raw source.
 */
export async function whenKitBlocksReady(): Promise<void> {
  const blocks = document.querySelectorAll<HTMLElement & {
    ready?: Promise<void>
  }>(`${CODE_ELEMENT_NAME}, ${MERMAID_ELEMENT_NAME}`)

  await Promise.all([...blocks].map((block) => {
    return block.ready ?? Promise.resolve()
  }))
}
