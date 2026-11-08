export type JobState
  = | 'queued'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'cancelled'

export interface JobStatus {
  jobId: string
  kind: string
  state: JobState
  error?: string
}

export interface JobEnqueueOptions {
  userId?: number
  idempotencyKey?: string
}

/**
 * `retries` has no default on purpose: a step that spends the user's money
 * must say `retries: 0`, so no adapter can retry it silently.
 */
export interface JobStepOptions {
  retries: number
  timeoutMs?: number
}

/**
 * Host-agnostic background job runner. The Cloudflare adapter will start an
 * orchestrator Workflow instance and receive HMAC callbacks (R-1, R-5); other
 * hosts get their own adapter.
 */
export interface JobRunner {
  enqueue(
    kind: string,
    payload: unknown,
    options?: JobEnqueueOptions,
  ): Promise<{ jobId: string }>
  get(jobId: string): Promise<JobStatus>
  cancel(jobId: string): Promise<void>
  step<T>(
    name: string,
    options: JobStepOptions,
    run: () => Promise<T>,
  ): Promise<T>
}

export type BlobBody
  = | ReadableStream
    | ArrayBuffer
    | ArrayBufferView
    | string
    | Blob

export interface BlobMetadata {
  contentType?: string
  customMetadata?: Record<string, string>
}

export interface StoredBlob {
  key: string
  size: number
  contentType: string | null
  customMetadata: Record<string, string>
  body: ReadableStream
}

/**
 * Host-agnostic object storage. `delete` takes a list so adapters can use
 * one batch call (R2 does), which keeps a Worker under its six simultaneous
 * connections.
 */
export interface BlobStore {
  put(key: string, body: BlobBody, metadata?: BlobMetadata): Promise<void>
  get(key: string): Promise<StoredBlob | null>
  delete(keys: string[]): Promise<void>
  signedUrl(key: string, ttlSeconds: number): Promise<string>
}
