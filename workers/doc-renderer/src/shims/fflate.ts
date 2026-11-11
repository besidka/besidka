import { zipSync } from '../../node_modules/fflate/esm/browser.js'
import type {
  AsyncZippable,
  AsyncZipOptions,
  FlateError,
} from '../../node_modules/fflate/esm/browser.js'

export * from '../../node_modules/fflate/esm/browser.js'

type ZipCallback = (error: FlateError | null, data: Uint8Array) => void

/**
 * Synchronous stand-in for the asynchronous `zip` of `fflate`, which starts a
 * `Worker` for large entries. Workers has no `Worker` global.
 */
export function zip(
  data: AsyncZippable,
  options: AsyncZipOptions,
  callback: ZipCallback,
): () => void
export function zip(data: AsyncZippable, callback: ZipCallback): () => void
export function zip(
  data: AsyncZippable,
  optionsOrCallback: AsyncZipOptions | ZipCallback,
  maybeCallback?: ZipCallback,
): () => void {
  const callback = typeof optionsOrCallback === 'function'
    ? optionsOrCallback
    : maybeCallback
  const options = typeof optionsOrCallback === 'function'
    ? {}
    : optionsOrCallback

  try {
    callback?.(null, zipSync(data as Parameters<typeof zipSync>[0], options))
  } catch (exception) {
    callback?.(exception as FlateError, new Uint8Array(0))
  }

  return () => {}
}
