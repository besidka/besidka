import { parseDocumentSpec } from '../src/spec/index.ts'
import { render } from '../src/render/index.ts'
import { validate } from '../src/validate/index.ts'

self.onmessage = async (event) => {
  const { spec, images, fonts, name } = event.data

  try {
    const parsed = parseDocumentSpec(spec)

    if (!parsed.ok) {
      self.postMessage({ name, error: JSON.stringify(parsed.issues) })

      return
    }

    const assets = new Map(
      Object.entries(images).map(([fileId, bytes]) => {
        return [fileId, { bytes: new Uint8Array(bytes), mediaType: 'image/png' }]
      }),
    )
    const started = performance.now()
    const rendered = await render(parsed.spec, assets, {
      fonts: {
        regular: new Uint8Array(fonts.regular),
        bold: new Uint8Array(fonts.bold),
        italic: new Uint8Array(fonts.italic),
      },
    })
    const elapsed = performance.now() - started
    const validation = validate(
      rendered.extension,
      rendered.bytes,
      parsed.spec.format === 'xlsx' ? { spec: parsed.spec } : {},
    )

    self.postMessage(
      {
        name,
        bytes: rendered.bytes.buffer,
        extension: rendered.extension,
        stats: rendered.stats,
        validation,
        elapsed,
      },
      [rendered.bytes.buffer],
    )
  } catch (exception) {
    self.postMessage({
      name,
      error: exception instanceof Error ? exception.message : String(exception),
    })
  }
}
