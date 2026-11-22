export type XlsConvertFailureReason
  = | 'not-cfb'
    | 'too-large'
    | 'empty-workbook'
    | 'convert-failed'
    | 'worker-error'
    | 'worker-unavailable'
    | 'timeout'

export interface XlsWorkerRequest {
  id: number
  bytes: ArrayBuffer
}

export interface XlsWorkerSuccess {
  id: number
  ok: true
  bytes: ArrayBuffer
}

export interface XlsWorkerFailure {
  id: number
  ok: false
  reason: XlsConvertFailureReason
}

export type XlsWorkerResponse = XlsWorkerSuccess | XlsWorkerFailure

export type XlsConversionResult
  = | { status: 'converted', file: File }
    | { status: 'failed', reason: XlsConvertFailureReason }
