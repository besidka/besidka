import { describe, expect, it } from 'vitest'
import { checkContainerDocument } from '~~/server/utils/code-execution/document-validation'

describe('checkContainerDocument', () => {
  it('rejects bytes that are not the claimed format', async () => {
    const result = await checkContainerDocument({
      format: 'pdf',
      bytes: new TextEncoder().encode('not a pdf at all'),
      model: 'claude-haiku-5-5',
    })

    expect(result.ok).toBe(false)
  })

  it('rejects an empty file and a ZIP that is not an Office document', async () => {
    expect((await checkContainerDocument({
      format: 'docx',
      bytes: new Uint8Array(0),
      model: 'm',
    })).ok).toBe(false)
    expect((await checkContainerDocument({
      format: 'xlsx',
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]),
      model: 'm',
    })).ok).toBe(false)
  })
})
