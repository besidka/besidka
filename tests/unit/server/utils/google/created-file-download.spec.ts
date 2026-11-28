import { describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_FILE_DOWNLOAD_FAILURES,
  downloadCreatedGoogleFile,
} from '~~/server/utils/google/created-file-download'

const FILE = {
  toolCallId: 'call_1',
  kind: 'document' as const,
  title: 'Quarterly plan',
  content: 'body',
  id: 'document-id-0123456789',
  openLink: 'https://docs.google.com/document/d/document-id-0123456789/edit',
}

describe('downloadCreatedGoogleFile', () => {
  it('refuses a format the kind does not allow before any request', async () => {
    const fetchImpl = vi.fn()

    await expect(downloadCreatedGoogleFile({
      file: FILE,
      format: 'xlsx',
      accessToken: 'token',
      fetchImpl,
    })).rejects.toMatchObject({ status: 400 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('stops at the metadata when Drive cannot be reached', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    })

    await expect(downloadCreatedGoogleFile({
      file: FILE,
      format: 'docx',
      accessToken: 'token',
      fetchImpl,
    })).rejects.toMatchObject({ status: 502 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('GOOGLE_FILE_DOWNLOAD_FAILURES', () => {
  it('words every refusal in plain sentences without a Drive message', () => {
    for (const failure of Object.values(GOOGLE_FILE_DOWNLOAD_FAILURES)) {
      expect(failure.message.length).toBeGreaterThan(0)
      expect(failure.status).toBeGreaterThanOrEqual(400)
      expect(failure.message).not.toMatch(/Pick it again|Nothing changed/)
    }
  })

  it('states the real export limit', () => {
    expect(GOOGLE_FILE_DOWNLOAD_FAILURES.export_too_large.why)
      .toContain('10 MB')
  })
})
