import { describe, expect, it } from 'vitest'
import { userMessagePartsSchema } from '../../../../server/utils/chats/request-schema'

const FILE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz'

function drivePart(overrides: Record<string, unknown> = {}) {
  return {
    type: 'data-drive-file',
    data: {
      driveFileId: FILE_ID,
      name: 'Plan',
      mimeType: 'text/markdown',
      link: `https://drive.google.com/open?id=${FILE_ID}`,
      ...overrides,
    },
  }
}

describe('userMessagePartsSchema Google Drive references', () => {
  it('accepts a reference beside the text and the file', () => {
    const result = userMessagePartsSchema.safeParse([
      { type: 'text', text: 'Summarize' },
      {
        type: 'file',
        mediaType: 'text/markdown',
        filename: 'Plan.md',
        url: '/files/a.md',
      },
      drivePart(),
    ])

    expect(result.success).toBe(true)
  })

  it.each([
    ['a path in the id', { driveFileId: '../../etc' }],
    ['a short id', { driveFileId: 'abc' }],
    ['an overlong name', { name: 'n'.repeat(256) }],
    ['an unknown field', { content: 'secret body' }],
  ])('refuses %s', (_name, overrides) => {
    const result = userMessagePartsSchema.safeParse([
      { type: 'text', text: 'Summarize' },
      drivePart(overrides),
    ])

    expect(result.success).toBe(false)
  })

  it('does not count as the text a message needs', () => {
    expect(userMessagePartsSchema.safeParse([drivePart()]).success)
      .toBe(false)
  })
})
