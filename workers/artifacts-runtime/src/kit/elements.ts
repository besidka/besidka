import { reportError } from '../report.ts'
import type { KitController } from './chrome.ts'

export const CODE_ELEMENT_NAME = 'besidka-code'

export const MERMAID_ELEMENT_NAME = 'besidka-mermaid'

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

    async connectedCallback() {
      if (this.controller) {
        this.controller.connect()

        return
      }

      if (this.connecting) {
        return
      }

      this.connecting = true

      try {
        const controller = await createController(this)

        this.controller = controller

        if (this.isConnected) {
          controller.connect()
        }
      } catch (exception) {
        reportError(exception, { level: 'warning', showPanel: false })
      } finally {
        this.connecting = false
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
