import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import * as XLSX from 'xlsx'
import type {
  XlsConvertFailureReason,
  XlsWorkerRequest,
  XlsWorkerResponse,
} from '~/types/xls-convert.d'
import {
  CFB_SIGNATURE,
  XLS_CONVERT_MAX_INPUT_BYTES,
  XLS_CONVERT_MAX_ROWS,
  hasCfbSignature,
} from '~/utils/xls-convert'

interface XlsWorkerScope {
  onmessage: ((event: MessageEvent<XlsWorkerRequest>) => void) | null
  postMessage: (
    response: XlsWorkerResponse,
    transfer: Transferable[],
  ) => void
}

const CONTENT_TYPES_PART = '[Content_Types].xml'
const MACRO_CONTENT_TYPE_ELEMENT = new RegExp(
  '<(?:Default|Override)\\b[^>]*ContentType="[^"]*'
  + '(?:macroEnabled|vbaProject)[^"]*"[^>]*/>',
  'gi',
)

export class XlsConvertException extends Error {
  readonly reason: XlsConvertFailureReason

  constructor(reason: XlsConvertFailureReason) {
    super(reason)
    this.reason = reason
  }
}

/**
 * SheetJS writes a fixed content-type table that maps the `.bin` extension to
 * the macro-enabled binary workbook type, whether or not a `.bin` part exists.
 * The server's Office reader treats that type as a macro marker and refuses
 * the file, so the entry is dropped from the freshly written package.
 */
function removeMacroContentTypes(xlsx: Uint8Array): Uint8Array {
  const entries = unzipSync(xlsx)
  const contentTypes = entries[CONTENT_TYPES_PART]

  if (!contentTypes) {
    throw new XlsConvertException('convert-failed')
  }

  entries[CONTENT_TYPES_PART] = strToU8(
    strFromU8(contentTypes).replace(MACRO_CONTENT_TYPE_ELEMENT, ''),
  )

  return zipSync(entries)
}

/**
 * Converts BIFF8 `.xls` bytes to `.xlsx` bytes with SheetJS. Cells keep their
 * values and number formats; formulas keep their cached values. Styles,
 * charts, VBA and embedded files are not read. Throws an
 * `XlsConvertException` for input that is not a compound file, is over the
 * size cap, or has no sheets.
 */
export function convertXlsBytes(bytes: ArrayBuffer): ArrayBuffer {
  if (bytes.byteLength > XLS_CONVERT_MAX_INPUT_BYTES) {
    throw new XlsConvertException('too-large')
  }

  const head = new Uint8Array(
    bytes,
    0,
    Math.min(CFB_SIGNATURE.length, bytes.byteLength),
  )

  if (!hasCfbSignature(head)) {
    throw new XlsConvertException('not-cfb')
  }

  const workbook = XLSX.read(bytes, {
    type: 'array',
    sheetRows: XLS_CONVERT_MAX_ROWS,
    cellNF: true,
    cellStyles: false,
    bookVBA: false,
    bookFiles: false,
  })

  if (workbook.SheetNames.length === 0) {
    throw new XlsConvertException('empty-workbook')
  }

  const written: ArrayBuffer = XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'array',
    compression: true,
  })
  const cleaned = removeMacroContentTypes(new Uint8Array(written))

  return cleaned.buffer.slice(
    cleaned.byteOffset,
    cleaned.byteOffset + cleaned.byteLength,
  ) as ArrayBuffer
}

function toFailureReason(exception: unknown): XlsConvertFailureReason {
  if (exception instanceof XlsConvertException) {
    return exception.reason
  }

  return 'convert-failed'
}

export function handleXlsWorkerRequest(
  request: XlsWorkerRequest,
): { response: XlsWorkerResponse, transfer: Transferable[] } {
  try {
    const bytes = convertXlsBytes(request.bytes)

    return {
      response: { id: request.id, ok: true, bytes },
      transfer: [bytes],
    }
  } catch (exception) {
    return {
      response: {
        id: request.id,
        ok: false,
        reason: toFailureReason(exception),
      },
      transfer: [],
    }
  }
}

function isDedicatedWorkerScope(scope: object): boolean {
  const workerScopeConstructor = (globalThis as {
    WorkerGlobalScope?: new () => object
  }).WorkerGlobalScope

  return typeof workerScopeConstructor !== 'undefined'
    && scope instanceof workerScopeConstructor
}

const workerScope = globalThis as unknown as XlsWorkerScope

if (isDedicatedWorkerScope(workerScope)) {
  workerScope.onmessage = (event) => {
    const { response, transfer } = handleXlsWorkerRequest(event.data)

    workerScope.postMessage(response, transfer)
  }
}
