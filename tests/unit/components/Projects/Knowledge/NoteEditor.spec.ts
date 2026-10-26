import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeItem } from '../../../../../shared/types/project-knowledge.d'
import { KNOWLEDGE_LIMITS } from '../../../../../shared/utils/project-knowledge-policy'
import NoteEditor from '../../../../../app/components/Projects/Knowledge/NoteEditor.client.vue'
import { createKnowledgeItem } from '../../../../setup/helpers/knowledge-ui-fixtures'

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  getItemText: vi.fn(),
}))

mockNuxtImport('useInfoMessage', () => mocks.info)

enableAutoUnmount(afterEach)

const MarkdownStub = {
  name: 'MDCCached',
  props: ['value', 'unwrap', 'components', 'cacheKey', 'parserOptions'],
  template: '<div class="markdown-stub">{{ value }}</div>',
}

const note = createKnowledgeItem({
  id: 'note-1',
  kind: 'note',
  title: 'Meeting notes',
  extractor: 'note',
  mediaType: 'text/markdown',
})

async function mountEditor(item: KnowledgeItem | null = null) {
  const wrapper = await mountSuspended(NoteEditor, {
    props: {
      item,
      createNote: mocks.createNote,
      updateNote: mocks.updateNote,
      getItemText: mocks.getItemText,
      open: false,
    },
    global: {
      stubs: { Teleport: true, MDCCached: MarkdownStub },
    },
  })

  await wrapper.setProps({ open: true })
  await flushPromises()

  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountEditor>>

function byTestId(wrapper: Wrapper, id: string) {
  return wrapper.get(`[data-testid="${id}"]`)
}

async function fill(wrapper: Wrapper, title: string, body: string) {
  await byTestId(wrapper, 'knowledge-note-title').setValue(title)
  await byTestId(wrapper, 'knowledge-note-body').setValue(body)
}

function isSaveDisabled(wrapper: Wrapper): boolean {
  return byTestId(wrapper, 'knowledge-note-save').classes()
    .includes('btn-disabled')
}

describe('Projects/Knowledge/NoteEditor', () => {
  beforeEach(() => {
    mocks.info.mockReset()
    mocks.createNote.mockReset()
    mocks.updateNote.mockReset()
    mocks.getItemText.mockReset()
    mocks.createNote.mockResolvedValue({ ok: true, result: {} })
    mocks.updateNote.mockResolvedValue({ ok: true, result: {} })
    mocks.getItemText.mockResolvedValue({
      ok: true,
      result: { text: '# Existing\n\nbody' },
    })
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function () {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function () {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('structure and accessibility', () => {
    it('opens a dialog named by its heading', async () => {
      const wrapper = await mountEditor()
      const heading = byTestId(wrapper, 'knowledge-note-heading')

      expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
      expect(heading.element.tagName).toBe('H3')
      expect(heading.text()).toBe('New note')
      expect(wrapper.get('dialog').attributes('aria-labelledby'))
        .toBe(heading.attributes('id'))
    })

    it('labels the title and note fields', async () => {
      const wrapper = await mountEditor()
      const title = byTestId(wrapper, 'knowledge-note-title')
      const body = byTestId(wrapper, 'knowledge-note-body')

      expect(wrapper.get(`label[for="${title.attributes('id')}"]`).text())
        .toBe('Title')
      expect(wrapper.get(`label[for="${body.attributes('id')}"]`).text())
        .toBe('Note (Markdown)')
      expect(body.attributes('aria-describedby')).toBe(
        byTestId(wrapper, 'knowledge-note-body-counter').attributes('id'),
      )
    })

    it('uses a rounded-box textarea that grows up to 60dvh', async () => {
      const wrapper = await mountEditor()
      const classes = byTestId(wrapper, 'knowledge-note-body').classes()

      expect(classes).toEqual(expect.arrayContaining([
        'textarea',
        'textarea-bordered',
        'rounded-box',
        'w-full',
        'resize-none',
        'overflow-y-auto',
        'min-h-48',
        'max-h-[60dvh]',
      ]))
    })

    it('exposes Write and Preview as tabs with a selected state', async () => {
      const wrapper = await mountEditor()

      expect(wrapper.get('[role="tablist"]').attributes('aria-label'))
        .toBe('Note view')
      expect(byTestId(wrapper, 'knowledge-note-tab-write')
        .attributes('role')).toBe('tab')
      expect(byTestId(wrapper, 'knowledge-note-tab-write')
        .attributes('aria-selected')).toBe('true')
      expect(byTestId(wrapper, 'knowledge-note-tab-preview')
        .attributes('aria-selected')).toBe('false')

      await byTestId(wrapper, 'knowledge-note-tab-preview').trigger('click')

      expect(byTestId(wrapper, 'knowledge-note-tab-preview')
        .attributes('aria-selected')).toBe('true')
      expect(byTestId(wrapper, 'knowledge-note-tab-write')
        .attributes('aria-selected')).toBe('false')
      expect(byTestId(wrapper, 'knowledge-note-preview').attributes(
        'aria-labelledby',
      )).toBe(byTestId(wrapper, 'knowledge-note-tab-preview')
        .attributes('id'))
    })

    it('switches tabs with the arrow keys', async () => {
      const wrapper = await mountEditor()

      await wrapper.get('[role="tablist"]').trigger('keydown', {
        key: 'ArrowRight',
      })

      expect(byTestId(wrapper, 'knowledge-note-tab-preview')
        .attributes('aria-selected')).toBe('true')

      await wrapper.get('[role="tablist"]').trigger('keydown', {
        key: 'ArrowLeft',
      })

      expect(byTestId(wrapper, 'knowledge-note-tab-write')
        .attributes('aria-selected')).toBe('true')
    })
  })

  describe('preview', () => {
    it('renders through MDCCached with the safe chat components', async () => {
      const { messageComponents } = useChatFormat()
      const wrapper = await mountEditor()

      await fill(wrapper, 'Title', '# Hi\n\n![x](https://example.com/a.png)')
      await byTestId(wrapper, 'knowledge-note-tab-preview').trigger('click')

      const markdown = wrapper.getComponent({ name: 'MDCCached' })

      expect(markdown.props('value'))
        .toBe('# Hi\n\n![x](https://example.com/a.png)')
      expect(markdown.props('components')).toBe(messageComponents)
      expect(markdown.props('components')).toHaveProperty('img')
      expect(markdown.props('components')).toHaveProperty('a')
      expect(markdown.props('unwrap')).toBeUndefined()
      expect(markdown.props('parserOptions')).toEqual({ highlight: false })
      expect(markdown.props('cacheKey')).toMatch(/^knowledge-note-preview:new:/)
      expect(markdown.classes()).toEqual(
        expect.arrayContaining(['chat-markdown', 'text-sm']),
      )
      expect(wrapper.html()).not.toContain('v-html')
    })

    it('keeps raw HTML out of the preview', async () => {
      const wrapper = await mountEditor()

      await fill(wrapper, 'Title', '<script>alert(1)</script>')
      await byTestId(wrapper, 'knowledge-note-tab-preview').trigger('click')

      expect(byTestId(wrapper, 'knowledge-note-preview').find('script')
        .exists()).toBe(false)
    })

    it('shows an empty hint when there is nothing to preview', async () => {
      const wrapper = await mountEditor()

      await byTestId(wrapper, 'knowledge-note-tab-preview').trigger('click')

      expect(byTestId(wrapper, 'knowledge-note-preview-empty').text())
        .toBe('Nothing to preview yet.')
    })
  })

  describe('limits', () => {
    it('counts the title and the note against their limits', async () => {
      const wrapper = await mountEditor()

      await fill(wrapper, 'Hello', 'a'.repeat(1500))

      expect(byTestId(wrapper, 'knowledge-note-title-counter').text())
        .toBe(`5 / ${KNOWLEDGE_LIMITS.maxTitleChars}`)
      expect(byTestId(wrapper, 'knowledge-note-body-counter').text())
        .toBe('1,500 / 100,000 characters')
    })

    it('blocks saving a note over the character limit', async () => {
      const wrapper = await mountEditor()

      await fill(
        wrapper,
        'Long',
        'a'.repeat(KNOWLEDGE_LIMITS.maxNoteChars + 1),
      )

      expect(byTestId(wrapper, 'knowledge-note-body-counter').classes())
        .toContain('text-error')
      expect(byTestId(wrapper, 'knowledge-note-body')
        .attributes('aria-invalid')).toBe('true')
      expect(isSaveDisabled(wrapper)).toBe(true)
    })

    it('blocks saving a title over the limit', async () => {
      const wrapper = await mountEditor()

      await fill(
        wrapper,
        'a'.repeat(KNOWLEDGE_LIMITS.maxTitleChars + 1),
        'body',
      )

      expect(isSaveDisabled(wrapper)).toBe(true)
    })
  })

  describe('creating', () => {
    it('needs a title and a note before it can save', async () => {
      const wrapper = await mountEditor()

      expect(isSaveDisabled(wrapper)).toBe(true)

      await byTestId(wrapper, 'knowledge-note-title').setValue('Only title')

      expect(isSaveDisabled(wrapper)).toBe(true)

      await byTestId(wrapper, 'knowledge-note-body').setValue('And a body')

      expect(isSaveDisabled(wrapper)).toBe(false)
    })

    it('sends a normalised title and never an extractor for new notes', async () => {
      const wrapper = await mountEditor()

      await fill(wrapper, 'Cafe\u0301\t  plan', 'Body')
      await byTestId(wrapper, 'knowledge-note-save').trigger('click')
      await flushPromises()

      const payload = mocks.createNote.mock.calls[0]?.[0]

      expect(payload).toEqual({ title: 'Caf\u00E9 plan', body: 'Body' })
      expect(payload).not.toHaveProperty('extractor')
    })

    it('creates the note, toasts and closes', async () => {
      const wrapper = await mountEditor()

      await fill(wrapper, '  Release plan  ', '- one\n- two')
      await byTestId(wrapper, 'knowledge-note-save').trigger('click')
      await flushPromises()

      expect(mocks.createNote).toHaveBeenCalledWith({
        title: 'Release plan',
        body: '- one\n- two',
      })
      expect(mocks.info).toHaveBeenCalledWith('Saved', 'Note added.')
      expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
    })

    it('shows a failure inline with message, why and fix', async () => {
      mocks.createNote.mockResolvedValue({
        ok: false,
        parsed: {
          message: 'Project is full',
          why: 'It holds 500 items',
          fix: 'Remove an item first',
        },
      })

      const wrapper = await mountEditor()

      await fill(wrapper, 'Title', 'Body')
      await byTestId(wrapper, 'knowledge-note-save').trigger('click')
      await flushPromises()

      const alert = byTestId(wrapper, 'knowledge-note-error')

      expect(alert.attributes('role')).toBe('alert')
      expect(alert.text()).toContain('Project is full')
      expect(alert.text()).toContain('It holds 500 items')
      expect(alert.text()).toContain('Remove an item first')
      expect(mocks.info).not.toHaveBeenCalled()
    })
  })

  describe('editing', () => {
    it('loads the note text and fills the form', async () => {
      const wrapper = await mountEditor(note)

      expect(mocks.getItemText).toHaveBeenCalledWith('note-1')
      expect(byTestId(wrapper, 'knowledge-note-heading').text())
        .toBe('Edit note')
      expect(byTestId(wrapper, 'knowledge-note-title')
        .element).toHaveProperty('value', 'Meeting notes')
      expect(byTestId(wrapper, 'knowledge-note-body')
        .element).toHaveProperty('value', '# Existing\n\nbody')
      expect(isSaveDisabled(wrapper)).toBe(true)
    })

    it('shows a skeleton while the text loads', async () => {
      let resolveText: (value: unknown) => void = () => undefined

      mocks.getItemText.mockReturnValue(new Promise((resolve) => {
        resolveText = resolve
      }))

      const wrapper = await mountEditor(note)

      expect(byTestId(wrapper, 'knowledge-note-loading').exists()).toBe(true)

      resolveText({ ok: true, result: { text: 'loaded' } })
      await flushPromises()

      expect(wrapper.find('[data-testid="knowledge-note-loading"]').exists())
        .toBe(false)
      expect(byTestId(wrapper, 'knowledge-note-body')
        .element).toHaveProperty('value', 'loaded')
    })

    it('sends only the changed fields', async () => {
      const wrapper = await mountEditor(note)

      await byTestId(wrapper, 'knowledge-note-body').setValue('New body')
      await byTestId(wrapper, 'knowledge-note-save').trigger('click')
      await flushPromises()

      expect(mocks.updateNote).toHaveBeenCalledWith('note-1', {
        body: 'New body',
      })
      expect(mocks.info).toHaveBeenCalledWith('Saved', 'Note updated.')
    })

    it('sends a renamed title alone', async () => {
      const wrapper = await mountEditor(note)

      await byTestId(wrapper, 'knowledge-note-title').setValue('Renamed')
      await byTestId(wrapper, 'knowledge-note-save').trigger('click')
      await flushPromises()

      expect(mocks.updateNote).toHaveBeenCalledWith('note-1', {
        title: 'Renamed',
      })
    })

    it('shows a load failure instead of an empty form', async () => {
      mocks.getItemText.mockResolvedValue({
        ok: false,
        parsed: { message: 'Could not load the note', why: 'Offline' },
      })

      const wrapper = await mountEditor(note)

      expect(byTestId(wrapper, 'knowledge-note-load-error').text())
        .toContain('Could not load the note')
      expect(wrapper.find('[data-testid="knowledge-note-body"]').exists())
        .toBe(false)
      expect(isSaveDisabled(wrapper)).toBe(true)
    })
  })

  it('closes from Cancel', async () => {
    const wrapper = await mountEditor()

    await byTestId(wrapper, 'knowledge-note-cancel').trigger('click')

    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })
})
