import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import type { OmittedContextFilesData } from '#shared/types/model-context.d'
import OmittedContextFiles from '../../../../app/components/Chat/OmittedContextFiles.vue'

function createMessage(parts: unknown[]): UIMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    parts,
  } as UIMessage
}

function mountWithData(data: OmittedContextFilesData) {
  return mountSuspended(OmittedContextFiles, {
    props: {
      message: createMessage([
        { type: 'data-omitted-context-files', data },
        { type: 'text', text: 'An answer.' },
      ]),
    },
  })
}

describe('Chat/OmittedContextFiles', () => {
  it('renders nothing without the omitted files part', async () => {
    const wrapper = await mountSuspended(OmittedContextFiles, {
      props: {
        message: createMessage([{ type: 'text', text: 'An answer.' }]),
      },
    })

    expect(wrapper.find('[data-testid="omitted-context-files"]').exists())
      .toBe(false)
  })

  it('renders nothing for an empty files list', async () => {
    const wrapper = await mountWithData({ files: [] })

    expect(wrapper.find('[data-testid="omitted-context-files"]').exists())
      .toBe(false)
  })

  it('shows a singular summary for one file', async () => {
    const wrapper = await mountWithData({
      files: [{
        filename: 'a.pdf',
        mediaType: 'application/pdf',
        reason: 'outside-window',
      }],
    })

    expect(wrapper.find('summary').text())
      .toContain('1 earlier file wasn\'t sent to the model')
  })

  it('shows a plural summary for several files', async () => {
    const wrapper = await mountWithData({
      files: [
        { filename: 'a.pdf', mediaType: 'application/pdf', reason: 'over-limit' },
        { filename: 'b.pdf', mediaType: 'application/pdf', reason: 'over-limit' },
      ],
    })

    expect(wrapper.find('summary').text())
      .toContain('2 earlier files weren\'t sent to the model')
    expect(wrapper.findAll('[data-testid="omitted-context-file"]'))
      .toHaveLength(2)
  })

  it('is collapsed by default', async () => {
    const wrapper = await mountWithData({
      files: [{
        filename: 'a.pdf',
        mediaType: 'application/pdf',
        reason: 'over-limit',
      }],
    })

    expect(wrapper.find('details').attributes('open')).toBeUndefined()
  })

  it.each([
    ['outside-window', 'Attached too many messages ago'],
    ['over-limit', 'Over the size or count limit for earlier files'],
    [
      'gateway-no-carry',
      'Gateway models only see files from the latest message',
    ],
    ['unsupported-by-model', 'Gemma can\'t read this file type'],
  ] as const)('shows the label for %s', async (reason, label) => {
    const wrapper = await mountWithData({
      modelName: 'Gemma',
      files: [{ filename: 'a.pdf', mediaType: 'application/pdf', reason }],
    })

    expect(wrapper.find('[data-testid="omitted-context-file"]').text())
      .toContain(label)
  })

  it('uses a generic model name when none is provided', async () => {
    const wrapper = await mountWithData({
      files: [{
        filename: 'a.pdf',
        mediaType: 'application/pdf',
        reason: 'unsupported-by-model',
      }],
    })

    expect(wrapper.text())
      .toContain('The selected model can\'t read this file type')
  })

  it('falls back to an unnamed file label and shows the hint', async () => {
    const wrapper = await mountWithData({
      files: [{ mediaType: 'application/pdf', reason: 'over-limit' }],
    })

    expect(wrapper.find('[data-testid="omitted-context-file"]').text())
      .toContain('Unnamed file')
    expect(wrapper.text()).toContain('Attach a file again to include it.')
  })
})
