import { describe, expect, it } from 'vitest'
import { buildChatContext } from '~~/server/utils/chats/context/build-chat-context'
import type { ChatContextMessage } from '~~/server/utils/chats/context/sections'
import { filterPublicParts } from '~~/server/utils/chats/share-public-parts'

const FILE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz'
const DRIVE_LINK = `https://drive.google.com/open?id=${FILE_ID}`

function userMessage(parts: unknown[]): ChatContextMessage {
  return { id: 'm1', role: 'user', parts }
}

const driveParts = [
  { type: 'text', text: 'Summarize this' },
  {
    type: 'file',
    mediaType: 'text/markdown',
    filename: 'Plan.md',
    url: '/files/plan.md',
  },
  {
    type: 'data-drive-file',
    data: {
      driveFileId: FILE_ID,
      name: 'Plan',
      mimeType: 'text/markdown',
      link: DRIVE_LINK,
    },
  },
]

describe('Google Drive files in the chat context', () => {
  it('lists a Drive file once, with its link and the Drive kind', () => {
    const context = buildChatContext([userMessage(driveParts)], {
      visibility: 'private',
    })

    expect(context.inputs).toEqual([{
      id: `drive-file:${FILE_ID}:m1`,
      sectionId: 'drive-files',
      kind: 'drive-file',
      title: 'Plan',
      messageId: 'm1',
      href: DRIVE_LINK,
      meta: { url: '/files/plan.md', mediaType: 'text/markdown' },
    }])
    expect(context.counts.inputs).toBe(1)
  })

  it('keeps an ordinary file listed as before', () => {
    const context = buildChatContext([userMessage([
      driveParts[1],
    ])], { visibility: 'private' })

    expect(context.inputs.map(item => item.kind)).toEqual(['file'])
  })

  it('lists the name only in a public build', () => {
    const publicMessages = filterPublicParts([{
      id: 'm1',
      role: 'user',
      parts: driveParts,
    }] as never) as unknown as ChatContextMessage[]
    const context = buildChatContext(publicMessages, {
      visibility: 'public',
    })
    const serialized = JSON.stringify(context)

    expect(context.inputs).toEqual([
      expect.objectContaining({
        kind: 'drive-file',
        title: 'Plan',
      }),
    ])
    expect(context.inputs[0]!.href).toBeUndefined()
    expect(serialized).not.toContain('drive.google.com')
    expect(serialized).not.toContain(FILE_ID)
  })

  it('ignores a Drive reference on an assistant message', () => {
    const context = buildChatContext([{
      id: 'm1',
      role: 'assistant',
      parts: [driveParts[2]],
    }], { visibility: 'private' })

    expect(context.inputs).toEqual([])
  })
})
