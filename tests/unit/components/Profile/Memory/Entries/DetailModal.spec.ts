import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  MemoryCategory,
  MemoryEntry,
} from '../../../../../../shared/types/memory.d'
import type { MemoryEntryLimits } from '../../../../../../shared/types/memory-api.d'
import DetailModal from '../../../../../../app/components/Profile/Memory/Entries/DetailModal.client.vue'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  confirm: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useInfoMessage', () => mocks.info)
mockNuxtImport('useErrorMessage', () => mocks.error)

enableAutoUnmount(afterEach)

const limits: MemoryEntryLimits = {
  maxAccountEntries: 30,
  maxProjectEntries: 15,
  maxBodyBytes: 40,
  maxAlwaysInjectedBodyBytes: 20,
  maxDescriptionChars: 30,
  maxTitleChars: 20,
}

function createEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'entry-1',
    projectId: null,
    category: 'topics',
    slug: 'espresso',
    title: 'Espresso setup',
    description: 'Prefers a double shot',
    body: 'Line one\nLine two <b>bold</b>',
    sensitivity: 'none',
    sensitiveCategory: null,
    origin: 'extraction',
    sourceChatIds: [],
    sourceMessageId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: new Date().toISOString(),
    lastUsedAt: null,
    ...overrides,
  }
}

function createRejection() {
  return Object.assign(new Error('Request failed'), {
    data: {
      statusCode: 422,
      message: 'Memory rejected',
      data: {
        why: 'It looks like a payment card number.',
        fix: 'Remove the number and try again.',
      },
    },
  })
}

interface InitialValues {
  title: string
  description: string
  body: string
  category: MemoryCategory
}

interface ModalOverrides {
  initialValues?: InitialValues | null
  projectId?: string | null
  takenSingletonCategories?: MemoryCategory[]
  backLabel?: string
  limits?: MemoryEntryLimits
}

const MarkdownStub = {
  name: 'MDCCached',
  props: ['value', 'unwrap', 'components', 'cacheKey', 'parserOptions'],
  template: '<div class="markdown-stub">{{ value }}</div>',
}

async function mountModal(
  entry: MemoryEntry | null = createEntry(),
  overrides: ModalOverrides = {},
) {
  const wrapper = await mountSuspended(DetailModal, {
    props: {
      entry,
      limits,
      open: false,
      ...overrides,
    },
    global: {
      stubs: {
        Teleport: true,
        MDCCached: MarkdownStub,
      },
    },
  })

  await wrapper.setProps({ open: true })
  await flushPromises()

  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountModal>>

function byTestId<T extends Element = Element>(
  wrapper: Wrapper,
  testId: string,
) {
  return wrapper.get<T>(`[data-testid="${testId}"]`)
}

function isDisabled(wrapper: Wrapper, testId: string): boolean {
  return byTestId(wrapper, testId).classes().includes('btn-disabled')
}

async function startEditing(wrapper: Wrapper) {
  await byTestId(wrapper, 'memory-entry-edit').trigger('click')
  await flushPromises()
}

describe('Profile/Memory/Entries/DetailModal', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.confirm.mockReset()
    mocks.info.mockReset()
    mocks.error.mockReset()
    mocks.fetch.mockResolvedValue({ chats: [] })
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

  describe('view mode', () => {
    it('opens the dialog and lays out the entry in labelled sections',
      async () => {
        const wrapper = await mountModal()
        const view = byTestId(wrapper, 'memory-entry-view')
        const labels = view.findAll('h4').map(heading => heading.text())

        expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
        expect(byTestId(wrapper, 'memory-entry-title').element.tagName)
          .toBe('H3')
        expect(byTestId(wrapper, 'memory-entry-title').text())
          .toBe('Espresso setup')
        expect(wrapper.get('dialog').attributes('aria-labelledby'))
          .toBe(byTestId(wrapper, 'memory-entry-title').attributes('id'))
        expect(labels).toEqual([
          'Last updated',
          'Summary',
          'Details',
          'Sources',
        ])
        expect(view.findAll('h4').every((heading) => {
          return heading.classes().includes('font-semibold')
            && !heading.classes().includes('uppercase')
        })).toBe(true)
        expect(byTestId(wrapper, 'memory-entry-description').text())
          .toBe('Prefers a double shot')
        expect(byTestId(wrapper, 'memory-entry-category').text())
          .toBe('Topics')
        expect(byTestId(wrapper, 'memory-entry-origin').text())
          .toBe('Extracted from chats')
      })

    it('shows the local update date with a muted age', async () => {
      const updatedAt = '2026-10-25T12:00:00.000Z'
      const wrapper = await mountModal(createEntry({ updatedAt }))
      const expectedDate = new Date(updatedAt).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
      const meta = byTestId(wrapper, 'memory-entry-meta')

      expect(meta.text()).toContain(expectedDate)
      expect(meta.get('span').text()).toMatch(/^· .+/)
      expect(meta.get('span').classes()).toContain('text-base-content/70')
    })

    it('renders the details as markdown without unwrapping or raw HTML',
      async () => {
        const { messageComponents } = useChatFormat()
        const body = '- one\n- two <b>bold</b>'
        const wrapper = await mountModal(createEntry({ body }))
        const markdown = wrapper.getComponent({ name: 'MDCCached' })

        expect(markdown.props('value')).toBe(body)
        expect(markdown.props('unwrap')).toBeUndefined()
        expect(markdown.props('components')).toBe(messageComponents)
        expect(markdown.props('components')).toHaveProperty('a')
        expect(markdown.props('cacheKey')).toBe(
          `memory-entry:entry-1:${wrapper.props('entry')!.updatedAt}:${body.length}`,
        )
        expect(markdown.classes()).toEqual(
          expect.arrayContaining(['chat-markdown', 'text-sm']),
        )
        expect(byTestId(wrapper, 'memory-entry-body').find('b').exists())
          .toBe(false)
        expect(wrapper.html()).not.toContain('v-html')
      })

    it('changes the markdown cache key when the entry changes', async () => {
      const wrapper = await mountModal()
      const firstKey = wrapper.getComponent({ name: 'MDCCached' })
        .props('cacheKey')

      await wrapper.setProps({
        entry: createEntry({
          body: 'A longer body',
          updatedAt: '2026-10-26T00:00:00.000Z',
        }),
      })

      expect(wrapper.getComponent({ name: 'MDCCached' }).props('cacheKey'))
        .not.toBe(firstKey)
    })

    it('closes from the back button labelled Memory by default', async () => {
      const wrapper = await mountModal()
      const back = byTestId(wrapper, 'memory-entry-back')

      expect(back.text()).toBe('Memory')

      await back.trigger('click')
      await flushPromises()

      expect(wrapper.emitted('update:open')).toEqual([[false]])
      expect(HTMLDialogElement.prototype.close).toHaveBeenCalled()
    })

    it('accepts a custom back label', async () => {
      const wrapper = await mountModal(createEntry(), {
        backLabel: 'Projects',
      })

      expect(byTestId(wrapper, 'memory-entry-back').text()).toBe('Projects')
    })

    it('places Delete in the header and keeps no close X', async () => {
      const wrapper = await mountModal()
      const title = byTestId(wrapper, 'memory-entry-title')
      const header = title.element.parentElement!.parentElement!
      const deleteButton = byTestId(wrapper, 'memory-entry-delete')

      expect(header.contains(deleteButton.element)).toBe(true)
      expect(deleteButton.attributes('aria-label')).toBe('Delete')
      expect(wrapper.find('[data-testid="memory-entry-modal-close"]').exists())
        .toBe(false)
    })

    it('never renders a sensitive badge, even for special entries',
      async () => {
        const wrapper = await mountModal(createEntry({
          sensitivity: 'special',
          sensitiveCategory: 'health',
        }))

        expect(wrapper.find('[data-testid="memory-entry-sensitive"]').exists())
          .toBe(false)
        expect(byTestId(wrapper, 'memory-entry-view').text())
          .not.toContain('Sensitive')
      })

    it('offers Edit in the footer', async () => {
      const wrapper = await mountModal()
      const footer = wrapper.get('.modal-box > div:last-child')

      expect(footer.find('[data-testid="memory-entry-edit"]').exists())
        .toBe(true)
      expect(footer.find('[data-testid="memory-entry-delete"]').exists())
        .toBe(false)
      expect(byTestId(wrapper, 'memory-entry-edit').text()).toContain('Edit')
    })

    it('renders no view without an entry', async () => {
      const wrapper = await mountModal(null)

      expect(wrapper.find('[data-testid="memory-entry-view"]').exists())
        .toBe(false)
      expect(mocks.fetch).not.toHaveBeenCalled()
    })
  })

  describe('create mode', () => {
    function categoryOption(wrapper: Wrapper, category: MemoryCategory) {
      return wrapper.get<HTMLOptionElement>(
        `[data-testid="memory-entry-category-select"] option[value="${category}"]`,
      )
    }

    async function fillValid(wrapper: Wrapper) {
      await byTestId(wrapper, 'memory-entry-title-input').setValue('About me')
      await byTestId(wrapper, 'memory-entry-description-input')
        .setValue('Backend developer')
      await byTestId(wrapper, 'memory-entry-body-input')
        .setValue('Builds APIs')
    }

    it('shows an empty form headed Add memory without view actions',
      async () => {
        const wrapper = await mountModal(null)

        expect(byTestId(wrapper, 'memory-entry-title').text())
          .toBe('Add memory')
        expect(byTestId(wrapper, 'memory-entry-form').exists()).toBe(true)
        expect(byTestId<HTMLInputElement>(
          wrapper,
          'memory-entry-title-input',
        ).element.value).toBe('')
        expect(wrapper.find('[data-testid="memory-entry-edit"]').exists())
          .toBe(false)
        expect(wrapper.find('[data-testid="memory-entry-delete"]').exists())
          .toBe(false)
        expect(wrapper.find('[data-testid="memory-entry-view"]').exists())
          .toBe(false)
        expect(byTestId(wrapper, 'memory-entry-save').text()).toContain('Save')
        expect(isDisabled(wrapper, 'memory-entry-save')).toBe(true)
      })

    it('defaults the category to Profile when no profile entry exists',
      async () => {
        const wrapper = await mountModal(null)

        expect(byTestId<HTMLSelectElement>(
          wrapper,
          'memory-entry-category-select',
        ).element.value).toBe('profile')
        expect(wrapper.find('[data-testid="memory-entry-category-hint"]')
          .exists()).toBe(false)
      })

    it('defaults to Topics and blocks a taken profile entry', async () => {
      const wrapper = await mountModal(null, {
        takenSingletonCategories: ['profile'],
      })

      expect(byTestId<HTMLSelectElement>(
        wrapper,
        'memory-entry-category-select',
      ).element.value).toBe('topics')
      expect(categoryOption(wrapper, 'profile').element.disabled).toBe(true)
      expect(categoryOption(wrapper, 'preferences').element.disabled)
        .toBe(false)
      expect(byTestId(wrapper, 'memory-entry-category-hint').text())
        .toBe('Edit your existing Profile entry instead.')
    })

    it('blocks every taken singleton category with a hint each', async () => {
      const wrapper = await mountModal(null, {
        takenSingletonCategories: ['profile', 'preferences'],
      })

      expect(categoryOption(wrapper, 'profile').element.disabled).toBe(true)
      expect(categoryOption(wrapper, 'preferences').element.disabled)
        .toBe(true)
      expect(categoryOption(wrapper, 'areas').element.disabled).toBe(false)
      expect(wrapper.findAll('[data-testid="memory-entry-category-hint"]')
        .map(hint => hint.text())).toEqual([
        'Edit your existing Profile entry instead.',
        'Edit your existing Preferences entry instead.',
      ])
    })

    it('posts the account payload and reports a created entry', async () => {
      mocks.fetch.mockResolvedValue({ entry: createEntry() })

      const wrapper = await mountModal(null)

      await fillValid(wrapper)
      await byTestId(wrapper, 'memory-entry-save').trigger('click')
      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledOnce()
      expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/memory/entries', {
        method: 'POST',
        body: {
          category: 'profile',
          title: 'About me',
          description: 'Backend developer',
          body: 'Builds APIs',
        },
      })
      expect(mocks.info).toHaveBeenCalledWith('Saved', 'Memory entry added.')
      expect(wrapper.emitted('changed')).toEqual([[{
        reason: 'created',
        categoryChanged: false,
      }]])
      expect(wrapper.emitted('update:open')).toEqual([[false]])
      expect(HTMLDialogElement.prototype.close).toHaveBeenCalled()
    })

    it('adds the project id and the chosen category in a project',
      async () => {
        mocks.fetch.mockResolvedValue({ entry: createEntry() })

        const wrapper = await mountModal(null, { projectId: 'project-1' })

        await fillValid(wrapper)
        await byTestId(wrapper, 'memory-entry-category-select')
          .setValue('areas')
        await byTestId(wrapper, 'memory-entry-description-input')
          .setValue('  First line ')
        await byTestId(wrapper, 'memory-entry-save').trigger('click')
        await flushPromises()

        expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/memory/entries', {
          method: 'POST',
          body: {
            projectId: 'project-1',
            category: 'areas',
            title: 'About me',
            description: 'First line',
            body: 'Builds APIs',
          },
        })
      })

    it('shows a rejection inline without a toast and stays open', async () => {
      mocks.fetch.mockRejectedValue(createRejection())

      const wrapper = await mountModal(null)

      await fillValid(wrapper)
      await byTestId(wrapper, 'memory-entry-save').trigger('click')
      await flushPromises()

      const alert = byTestId(wrapper, 'memory-entry-error')

      expect(alert.attributes('role')).toBe('alert')
      expect(alert.get('p.font-bold').text()).toBe('Memory rejected')
      expect(alert.text()).toContain('It looks like a payment card number.')
      expect(alert.text()).toContain('Remove the number and try again.')
      expect(mocks.error).not.toHaveBeenCalled()
      expect(mocks.info).not.toHaveBeenCalled()
      expect(wrapper.emitted('changed')).toBeUndefined()
      expect(wrapper.emitted('update:open')).toBeUndefined()

      await byTestId(wrapper, 'memory-entry-title-input').setValue('Other')

      expect(wrapper.find('[data-testid="memory-entry-error"]').exists())
        .toBe(false)
    })

    it('counts bytes against the always-injected limit for Profile',
      async () => {
        const wrapper = await mountModal(null)

        await byTestId(wrapper, 'memory-entry-body-input')
          .setValue('x'.repeat(21))

        expect(byTestId(wrapper, 'memory-entry-body-counter').text())
          .toContain('21 / 20')
        expect(byTestId(wrapper, 'memory-entry-body-counter').classes())
          .toContain('text-error')

        await byTestId(wrapper, 'memory-entry-category-select')
          .setValue('topics')

        expect(byTestId(wrapper, 'memory-entry-body-counter').text())
          .toContain('21 / 40')
      })

    it('keeps Save disabled while any field is empty or over a limit',
      async () => {
        const wrapper = await mountModal(null)

        await fillValid(wrapper)

        expect(isDisabled(wrapper, 'memory-entry-save')).toBe(false)

        await byTestId(wrapper, 'memory-entry-title-input')
          .setValue('t'.repeat(21))

        expect(isDisabled(wrapper, 'memory-entry-save')).toBe(true)
        expect(byTestId(wrapper, 'memory-entry-title-counter').text())
          .toBe('21 / 20')

        await byTestId(wrapper, 'memory-entry-title-input').setValue('Short')
        await byTestId(wrapper, 'memory-entry-description-input')
          .setValue('d'.repeat(31))

        expect(isDisabled(wrapper, 'memory-entry-save')).toBe(true)
        expect(byTestId(wrapper, 'memory-entry-description-counter').text())
          .toBe('31 / 30')
      })

    it('closes without saving on Cancel', async () => {
      const wrapper = await mountModal(null)

      await fillValid(wrapper)
      await byTestId(wrapper, 'memory-entry-cancel').trigger('click')
      await flushPromises()

      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(wrapper.emitted('update:open')).toEqual([[false]])
    })

    it('starts from a clean form every time it opens', async () => {
      const wrapper = await mountModal(null)

      await fillValid(wrapper)
      await wrapper.setProps({ open: false })
      await flushPromises()
      await wrapper.setProps({ open: true })
      await flushPromises()

      expect(byTestId<HTMLInputElement>(
        wrapper,
        'memory-entry-title-input',
      ).element.value).toBe('')
      expect(byTestId<HTMLTextAreaElement>(
        wrapper,
        'memory-entry-body-input',
      ).element.value).toBe('')
    })

    it('disables taken singleton categories when editing another entry',
      async () => {
        const wrapper = await mountModal(createEntry(), {
          takenSingletonCategories: ['profile'],
        })

        await startEditing(wrapper)

        expect(categoryOption(wrapper, 'profile').element.disabled).toBe(true)
        expect(wrapper.find('[data-testid="memory-entry-category-hint"]')
          .exists()).toBe(false)
      })

    it('keeps the entry\'s own singleton category selectable when editing',
      async () => {
        const wrapper = await mountModal(createEntry({ category: 'profile' }), {
          takenSingletonCategories: ['profile'],
        })

        await startEditing(wrapper)

        expect(categoryOption(wrapper, 'profile').element.disabled).toBe(false)
      })
  })

  describe('prefilled create mode', () => {
    const initialValues: InitialValues = {
      title: 'About me',
      description: 'Backend developer',
      body: 'Builds APIs',
      category: 'topics',
    }

    function value(wrapper: Wrapper, testId: string): string {
      return byTestId<HTMLInputElement | HTMLTextAreaElement>(
        wrapper,
        testId,
      ).element.value
    }

    it('fills every field from the initial values', async () => {
      const wrapper = await mountModal(null, { initialValues })

      expect(byTestId(wrapper, 'memory-entry-title').text())
        .toBe('Add memory')
      expect(value(wrapper, 'memory-entry-title-input')).toBe('About me')
      expect(value(wrapper, 'memory-entry-description-input'))
        .toBe('Backend developer')
      expect(value(wrapper, 'memory-entry-body-input')).toBe('Builds APIs')
      expect(value(wrapper, 'memory-entry-category-select')).toBe('topics')
      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(false)
    })

    it('keeps the prefilled Profile category when it is free', async () => {
      const wrapper = await mountModal(null, {
        initialValues: { ...initialValues, category: 'profile' },
      })

      expect(value(wrapper, 'memory-entry-category-select')).toBe('profile')
    })

    it('posts the prefilled values and leaves the toast to the caller',
      async () => {
        mocks.fetch.mockResolvedValue({ entry: createEntry() })

        const wrapper = await mountModal(null, { initialValues })

        await byTestId(wrapper, 'memory-entry-save').trigger('click')
        await flushPromises()

        expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(
          '/api/v1/memory/entries',
          {
            method: 'POST',
            body: {
              category: 'topics',
              title: 'About me',
              description: 'Backend developer',
              body: 'Builds APIs',
            },
          },
        )
        expect(mocks.info).not.toHaveBeenCalled()
        expect(wrapper.emitted('changed')).toEqual([[{
          reason: 'created',
          categoryChanged: false,
        }]])
        expect(wrapper.emitted('update:open')).toEqual([[false]])
      })

    it('lets the user edit before saving', async () => {
      mocks.fetch.mockResolvedValue({ entry: createEntry() })

      const wrapper = await mountModal(null, { initialValues })

      await byTestId(wrapper, 'memory-entry-body-input').setValue('Shorter')
      await byTestId(wrapper, 'memory-entry-category-select')
        .setValue('areas')
      await byTestId(wrapper, 'memory-entry-save').trigger('click')
      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/memory/entries', {
        method: 'POST',
        body: {
          category: 'areas',
          title: 'About me',
          description: 'Backend developer',
          body: 'Shorter',
        },
      })
    })

    it('shows the byte counter over the limit and blocks Save', async () => {
      const wrapper = await mountModal(null, {
        initialValues: { ...initialValues, body: 'a'.repeat(41) },
      })

      expect(byTestId(wrapper, 'memory-entry-body-counter').text())
        .toBe('41 / 40 bytes')
      expect(byTestId(wrapper, 'memory-entry-body-counter').classes())
        .toContain('text-error')
      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(true)
    })

    it('keeps a refusal inline with the prefill intact and no toast',
      async () => {
        mocks.fetch.mockRejectedValue(createRejection())

        const wrapper = await mountModal(null, { initialValues })

        await byTestId(wrapper, 'memory-entry-save').trigger('click')
        await flushPromises()

        const alert = byTestId(wrapper, 'memory-entry-error')

        expect(alert.text()).toContain('Memory rejected')
        expect(alert.text()).toContain('It looks like a payment card number.')
        expect(mocks.info).not.toHaveBeenCalled()
        expect(wrapper.emitted('changed')).toBeUndefined()
        expect(wrapper.emitted('update:open')).toBeUndefined()
        expect(value(wrapper, 'memory-entry-body-input')).toBe('Builds APIs')
      })

    it('applies the initial values again on every open', async () => {
      const wrapper = await mountModal(null, { initialValues })

      await byTestId(wrapper, 'memory-entry-title-input').setValue('Changed')
      await wrapper.setProps({ open: false })
      await flushPromises()
      await wrapper.setProps({ open: true })
      await flushPromises()

      expect(value(wrapper, 'memory-entry-title-input')).toBe('About me')
    })

    it('falls back to an empty form when the initial values are dropped',
      async () => {
        const wrapper = await mountModal(null, { initialValues })

        await wrapper.setProps({ open: false, initialValues: null })
        await flushPromises()
        await wrapper.setProps({ open: true })
        await flushPromises()

        expect(value(wrapper, 'memory-entry-title-input')).toBe('')
        expect(value(wrapper, 'memory-entry-body-input')).toBe('')
        expect(value(wrapper, 'memory-entry-category-select'))
          .toBe('profile')
      })

    it('ignores the initial values when an entry is set', async () => {
      const wrapper = await mountModal(createEntry(), { initialValues })

      expect(byTestId(wrapper, 'memory-entry-title').text())
        .toBe('Espresso setup')
      expect(wrapper.find('[data-testid="memory-entry-form"]').exists())
        .toBe(false)

      await startEditing(wrapper)

      expect(value(wrapper, 'memory-entry-title-input'))
        .toBe('Espresso setup')
      expect(value(wrapper, 'memory-entry-description-input'))
        .toBe('Prefers a double shot')
      expect(value(wrapper, 'memory-entry-body-input'))
        .toBe('Line one\nLine two <b>bold</b>')
      expect(value(wrapper, 'memory-entry-category-select')).toBe('topics')
    })

    it('still toasts when saving an existing entry with initial values set',
      async () => {
        mocks.fetch.mockImplementation(async (url: string) => {
          if (url.endsWith('/sources')) {
            return { chats: [] }
          }

          return { entry: createEntry({ title: 'New title' }) }
        })

        const wrapper = await mountModal(createEntry(), { initialValues })

        await startEditing(wrapper)
        await byTestId(wrapper, 'memory-entry-title-input')
          .setValue('New title')
        await byTestId(wrapper, 'memory-entry-save').trigger('click')
        await flushPromises()

        expect(mocks.info).toHaveBeenCalledWith(
          'Saved',
          'Memory entry updated.',
        )
      })
  })

  describe('sources', () => {
    it('says so when the entry has no source chats', async () => {
      const wrapper = await mountModal()

      expect(byTestId(wrapper, 'memory-entry-sources-empty').text())
        .toBe('Not tied to a specific chat.')
      expect(mocks.fetch).not.toHaveBeenCalled()
    })

    it('fetches sources once per opened entry and links the chats',
      async () => {
        mocks.fetch.mockResolvedValue({
          chats: [
            { id: 'chat-1', slug: 'first-chat', title: 'First chat' },
            { id: 'chat-2', slug: 'second-chat', title: '' },
          ],
        })

        const wrapper = await mountModal(createEntry({
          sourceChatIds: ['chat-1', 'chat-2', 'chat-3'],
        }))

        expect(mocks.fetch).toHaveBeenCalledOnce()
        expect(mocks.fetch).toHaveBeenCalledWith(
          '/api/v1/memory/entries/entry-1/sources',
        )

        const links = wrapper.findAll(
          '[data-testid="memory-entry-source-link"]',
        )

        expect(links).toHaveLength(2)
        expect(links[0]!.attributes('to')).toBe('/chats/first-chat')
        expect(links[0]!.text()).toBe('First chat')
        expect(links[1]!.attributes('to')).toBe('/chats/second-chat')
        expect(links[1]!.text()).toBe('Untitled chat')
        expect(byTestId(wrapper, 'memory-entry-sources-missing').text())
          .toBe('1 source chat no longer exists.')

        await startEditing(wrapper)
        await byTestId(wrapper, 'memory-entry-cancel').trigger('click')
        await flushPromises()

        expect(mocks.fetch).toHaveBeenCalledOnce()
      })

    it('pluralizes the missing sources note', async () => {
      mocks.fetch.mockResolvedValue({ chats: [] })

      const wrapper = await mountModal(createEntry({
        sourceChatIds: ['chat-1', 'chat-2'],
      }))

      expect(byTestId(wrapper, 'memory-entry-sources-missing').text())
        .toBe('2 source chats no longer exist.')
    })

    it('shows a skeleton while the sources load', async () => {
      mocks.fetch.mockReturnValue(new Promise(() => {}))

      const wrapper = await mountModal(createEntry({
        sourceChatIds: ['chat-1'],
      }))

      expect(wrapper.find('[data-testid="memory-entry-sources-skeleton"]')
        .exists()).toBe(true)
    })

    it('shows a sources failure inline', async () => {
      mocks.fetch.mockRejectedValue(createRejection())

      const wrapper = await mountModal(createEntry({
        sourceChatIds: ['chat-1'],
      }))

      const alert = byTestId(wrapper, 'memory-entry-sources-error')

      expect(alert.text()).toContain('Memory rejected')
      expect(alert.text()).toContain('It looks like a payment card number.')
      expect(mocks.error).not.toHaveBeenCalled()
    })

    it('ignores a stale sources response for a previous entry', async () => {
      let resolveFirst: (value: unknown) => void = () => {}

      mocks.fetch
        .mockReturnValueOnce(new Promise((resolve) => {
          resolveFirst = resolve
        }))
        .mockResolvedValueOnce({
          chats: [{ id: 'chat-b', slug: 'chat-b-slug', title: 'Chat B' }],
        })

      const wrapper = await mountModal(createEntry({
        id: 'entry-a',
        sourceChatIds: ['chat-a'],
      }))

      await wrapper.setProps({
        entry: createEntry({ id: 'entry-b', sourceChatIds: ['chat-b'] }),
      })
      await flushPromises()

      resolveFirst({
        chats: [{ id: 'chat-a', slug: 'chat-a-slug', title: 'Chat A' }],
      })
      await flushPromises()

      const links = wrapper.findAll(
        '[data-testid="memory-entry-source-link"]',
      )

      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      expect(links).toHaveLength(1)
      expect(links[0]!.text()).toBe('Chat B')
    })
  })

  describe('edit mode', () => {
    it('shows Title, Summary, Details and Category fields', async () => {
      const wrapper = await mountModal()

      await startEditing(wrapper)

      const form = byTestId(wrapper, 'memory-entry-form')

      expect(form.findAll('label').map(label => label.text())).toEqual([
        'Title',
        'Summary',
        'Details',
        'Category',
      ])
      expect(wrapper.find('[data-testid="memory-entry-view"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="memory-entry-delete"]').exists())
        .toBe(false)
    })

    it('renders a markdown textarea that is not pill shaped', async () => {
      const wrapper = await mountModal()

      await startEditing(wrapper)

      const textarea = byTestId<HTMLTextAreaElement>(
        wrapper,
        'memory-entry-body-input',
      )

      expect(textarea.classes()).toEqual(expect.arrayContaining([
        'textarea',
        'textarea-bordered',
        'rounded-box',
        'w-full',
        'resize-none',
        'overflow-y-auto',
        'min-h-36',
        'max-h-[50dvh]',
      ]))
      expect(textarea.attributes('placeholder')).toContain('- One fact')
      expect(textarea.element.value).toBe('Line one\nLine two <b>bold</b>')
      expect(textarea.element.style.height).not.toBe('')
    })

    it('reads both byte caps from the limits prop', async () => {
      const wrapper = await mountModal(createEntry(), {
        limits: {
          ...limits,
          maxBodyBytes: 4096,
          maxAlwaysInjectedBodyBytes: 1024,
        },
      })

      await startEditing(wrapper)

      expect(byTestId(wrapper, 'memory-entry-body-counter').text())
        .toContain('/ 4096')

      await byTestId(wrapper, 'memory-entry-category-select')
        .setValue('profile')

      expect(byTestId(wrapper, 'memory-entry-body-counter').text())
        .toContain('/ 1024')

      await byTestId(wrapper, 'memory-entry-category-select')
        .setValue('topics')
      await byTestId(wrapper, 'memory-entry-body-input')
        .setValue('x'.repeat(4096))

      expect(byTestId(wrapper, 'memory-entry-body-counter').classes())
        .not.toContain('text-error')
      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(false)
    })

    it('keeps Save disabled until a field changes', async () => {
      const wrapper = await mountModal()

      await startEditing(wrapper)

      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(true)

      await byTestId(wrapper, 'memory-entry-title-input')
        .setValue('Espresso routine')

      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(false)
    })

    it('sends only the changed fields and shows the saved entry',
      async () => {
        mocks.fetch.mockResolvedValue({
          entry: createEntry({ title: 'Espresso routine' }),
        })

        const wrapper = await mountModal()

        await startEditing(wrapper)
        await byTestId(wrapper, 'memory-entry-title-input')
          .setValue('  Espresso routine ')
        await byTestId(wrapper, 'memory-entry-save').trigger('click')
        await flushPromises()

        expect(mocks.fetch).toHaveBeenCalledOnce()
        expect(mocks.fetch).toHaveBeenCalledWith(
          '/api/v1/memory/entries/entry-1',
          { method: 'PATCH', body: { title: 'Espresso routine' } },
        )
        expect(mocks.info).toHaveBeenCalledWith(
          'Saved',
          'Memory entry updated.',
        )
        expect(wrapper.emitted('changed')).toEqual([[
          { reason: 'saved', categoryChanged: false },
        ]])
        expect(wrapper.find('[data-testid="memory-entry-form"]').exists())
          .toBe(false)
        expect(byTestId(wrapper, 'memory-entry-title').text())
          .toBe('Espresso routine')
      })

    it('sends the category and body when they change', async () => {
      mocks.fetch.mockResolvedValue({ entry: createEntry() })

      const wrapper = await mountModal()

      await startEditing(wrapper)
      await byTestId(wrapper, 'memory-entry-body-input').setValue('New body')
      await byTestId(wrapper, 'memory-entry-category-select')
        .setValue('people')
      await byTestId(wrapper, 'memory-entry-save').trigger('click')
      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/memory/entries/entry-1',
        { method: 'PATCH', body: { body: 'New body', category: 'people' } },
      )
    })

    it('reports a category change when the saved entry moves', async () => {
      mocks.fetch.mockResolvedValue({
        entry: createEntry({ category: 'people' }),
      })

      const wrapper = await mountModal()

      await startEditing(wrapper)
      await byTestId(wrapper, 'memory-entry-category-select')
        .setValue('people')
      await byTestId(wrapper, 'memory-entry-save').trigger('click')
      await flushPromises()

      expect(wrapper.emitted('changed')).toEqual([[
        { reason: 'saved', categoryChanged: true },
      ]])
    })

    it('strips newlines from the description', async () => {
      mocks.fetch.mockResolvedValue({ entry: createEntry() })

      const wrapper = await mountModal(createEntry({
        description: 'Likes\ndouble shots',
      }))

      await startEditing(wrapper)

      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(false)

      await byTestId(wrapper, 'memory-entry-save').trigger('click')
      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/memory/entries/entry-1',
        { method: 'PATCH', body: { description: 'Likes double shots' } },
      )
    })

    it('shows counters and disables Save over the title limit', async () => {
      const wrapper = await mountModal()

      await startEditing(wrapper)

      expect(byTestId(wrapper, 'memory-entry-title-counter').text())
        .toBe('14 / 20')

      await byTestId(wrapper, 'memory-entry-title-input')
        .setValue('x'.repeat(21))

      const counter = byTestId(wrapper, 'memory-entry-title-counter')

      expect(counter.text()).toBe('21 / 20')
      expect(counter.classes()).toContain('text-error')
      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(true)
    })

    it('disables Save over the description limit', async () => {
      const wrapper = await mountModal()

      await startEditing(wrapper)
      await byTestId(wrapper, 'memory-entry-description-input')
        .setValue('x'.repeat(31))

      expect(byTestId(wrapper, 'memory-entry-description-counter').classes())
        .toContain('text-error')
      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(true)
    })

    it('counts body bytes against the general limit', async () => {
      const wrapper = await mountModal()

      await startEditing(wrapper)
      await byTestId(wrapper, 'memory-entry-body-input')
        .setValue('é'.repeat(20))

      const counter = byTestId(wrapper, 'memory-entry-body-counter')

      expect(counter.text()).toContain('40 / 40')
      expect(counter.classes()).not.toContain('text-error')
      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(false)

      await byTestId(wrapper, 'memory-entry-body-input')
        .setValue('é'.repeat(21))

      expect(byTestId(wrapper, 'memory-entry-body-counter').classes())
        .toContain('text-error')
      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(true)
    })

    it('uses the lower body limit for always-injected categories',
      async () => {
        const wrapper = await mountModal(createEntry({ category: 'profile' }))

        await startEditing(wrapper)
        await byTestId(wrapper, 'memory-entry-body-input')
          .setValue('x'.repeat(21))

        expect(byTestId(wrapper, 'memory-entry-body-counter').text())
          .toContain('21 / 20')
        expect(isDisabled(wrapper, 'memory-entry-save')).toBe(true)

        await byTestId(wrapper, 'memory-entry-category-select')
          .setValue('topics')

        expect(byTestId(wrapper, 'memory-entry-body-counter').text())
          .toContain('21 / 40')
        expect(isDisabled(wrapper, 'memory-entry-save')).toBe(false)
      })

    it('disables Save when a field is empty', async () => {
      const wrapper = await mountModal()

      await startEditing(wrapper)
      await byTestId(wrapper, 'memory-entry-description-input')
        .setValue('   ')

      expect(isDisabled(wrapper, 'memory-entry-save')).toBe(true)
    })

    it('shows a rejection inline without a toast and clears it on input',
      async () => {
        mocks.fetch.mockRejectedValue(createRejection())

        const wrapper = await mountModal()

        await startEditing(wrapper)
        await byTestId(wrapper, 'memory-entry-body-input').setValue('Card 1')
        await byTestId(wrapper, 'memory-entry-save').trigger('click')
        await flushPromises()

        const alert = byTestId(wrapper, 'memory-entry-error')

        expect(alert.attributes('role')).toBe('alert')
        expect(alert.text()).toContain('Memory rejected')
        expect(alert.text()).toContain('It looks like a payment card number.')
        expect(alert.text()).toContain('Remove the number and try again.')
        expect(mocks.error).not.toHaveBeenCalled()
        expect(mocks.info).not.toHaveBeenCalled()
        expect(wrapper.emitted('changed')).toBeUndefined()
        expect(wrapper.find('[data-testid="memory-entry-form"]').exists())
          .toBe(true)

        await byTestId(wrapper, 'memory-entry-body-input').setValue('Card 2')

        expect(wrapper.find('[data-testid="memory-entry-error"]').exists())
          .toBe(false)
      })

    it('renders a 422 rejection as message, why and fix without a toast',
      async () => {
        mocks.fetch.mockRejectedValue(Object.assign(new Error('Failed'), {
          data: {
            statusCode: 422,
            message: 'This looks like sensitive information',
            data: {
              why: 'Health details are not stored in memory.',
              fix: 'Remove that detail and save again.',
            },
          },
        }))

        const wrapper = await mountModal()

        await startEditing(wrapper)
        await byTestId(wrapper, 'memory-entry-body-input')
          .setValue('I manage a chronic condition')
        await byTestId(wrapper, 'memory-entry-save').trigger('click')
        await flushPromises()

        const alert = byTestId(wrapper, 'memory-entry-error')
        const lines = alert.findAll('p')

        expect(lines.map(line => line.text())).toEqual([
          'This looks like sensitive information',
          'Health details are not stored in memory.',
          'Remove that detail and save again.',
        ])
        expect(lines[0]!.classes()).toContain('font-bold')
        expect(lines.every(line => line.classes().includes('break-words')))
          .toBe(true)
        expect(alert.text()).not.toContain('422')
        expect(mocks.error).not.toHaveBeenCalled()
        expect(mocks.info).not.toHaveBeenCalled()
      })

    it('discards the draft on Cancel', async () => {
      const wrapper = await mountModal()

      await startEditing(wrapper)
      await byTestId(wrapper, 'memory-entry-title-input').setValue('Changed')
      await byTestId(wrapper, 'memory-entry-cancel').trigger('click')

      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(byTestId(wrapper, 'memory-entry-title').text())
        .toBe('Espresso setup')

      await startEditing(wrapper)

      expect(
        (byTestId(wrapper, 'memory-entry-title-input')
          .element as HTMLInputElement).value,
      ).toBe('Espresso setup')
    })

    it('returns to view mode when the modal closes', async () => {
      const wrapper = await mountModal()

      await startEditing(wrapper)
      await wrapper.setProps({ open: false })
      await flushPromises()
      await wrapper.setProps({ open: true })
      await flushPromises()

      expect(wrapper.find('[data-testid="memory-entry-view"]').exists())
        .toBe(true)
    })
  })

  it('shows the age without the activity prefix', async () => {
    const wrapper = await mountModal(createEntry({
      updatedAt: new Date(Date.now() - (3 * 24 * 60 * 60 * 1000)).toISOString(),
    }))

    expect(byTestId(wrapper, 'memory-entry-meta').text())
      .toContain('· 3 days ago')
    expect(byTestId(wrapper, 'memory-entry-meta').text())
      .not.toContain('Last activity')
  })

  describe('delete', () => {
    it('deletes after confirmation, closes and emits changed', async () => {
      mocks.confirm.mockResolvedValue({ label: 'Delete', index: 0 })
      mocks.fetch.mockResolvedValue({ success: true })

      const wrapper = await mountModal()

      await byTestId(wrapper, 'memory-entry-delete').trigger('click')
      await flushPromises()

      expect(mocks.confirm).toHaveBeenCalledWith({
        text: 'Delete this memory?',
        subtitle: 'Besidka stops using it in chats. This cannot be undone.',
        alert: true,
        actions: ['Delete'],
        labelDecline: 'Cancel',
      })
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/memory/entries/entry-1',
        { method: 'DELETE' },
      )
      expect(mocks.info).toHaveBeenCalledWith(
        'Deleted',
        'Memory entry removed.',
      )
      expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
      expect(wrapper.emitted('changed')).toEqual([[
        { reason: 'deleted', categoryChanged: false },
      ]])
    })

    it('does nothing when the confirmation is declined', async () => {
      mocks.confirm.mockResolvedValue(null)

      const wrapper = await mountModal()

      await byTestId(wrapper, 'memory-entry-delete').trigger('click')
      await flushPromises()

      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(wrapper.emitted('changed')).toBeUndefined()
      expect(wrapper.emitted('update:open')).toBeUndefined()
    })

    it('toasts a failed delete and keeps the modal open', async () => {
      mocks.confirm.mockResolvedValue({ label: 'Delete', index: 0 })
      mocks.fetch.mockRejectedValue(createRejection())

      const wrapper = await mountModal()

      await byTestId(wrapper, 'memory-entry-delete').trigger('click')
      await flushPromises()

      expect(mocks.error).toHaveBeenCalledWith(
        'Memory rejected',
        'It looks like a payment card number.',
      )
      expect(mocks.info).not.toHaveBeenCalled()
      expect(wrapper.emitted('changed')).toBeUndefined()
      expect(wrapper.emitted('update:open')).toBeUndefined()
      expect(wrapper.find('[data-testid="memory-entry-view"]').exists())
        .toBe(true)
    })
  })
})
