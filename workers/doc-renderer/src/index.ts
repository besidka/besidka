import { WorkerEntrypoint } from 'cloudflare:workers'
import { documentFonts } from './fonts'
import { getCapabilities, renderDocument, validateDocument } from './renderer'
import type {
  RendererCapabilities,
  RenderRequest,
  RenderResult,
  ValidateRequest,
  ValidateResult,
} from './contract'

export type * from './contract'

export class DocRenderer extends WorkerEntrypoint<Record<string, never>> {
  async capabilities(): Promise<RendererCapabilities> {
    return getCapabilities()
  }

  async render(request: RenderRequest): Promise<RenderResult> {
    return renderDocument(request, documentFonts)
  }

  async validate(request: ValidateRequest): Promise<ValidateResult> {
    return validateDocument(request)
  }
}

export default {
  fetch(): Response {
    return new Response('Not found', { status: 404 })
  },
}
