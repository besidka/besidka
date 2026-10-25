import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  MemoryCategory,
  MemoryEntry,
} from '../../../../../../shared/types/memory.d'
import Project from '../../../../../../app/components/Profile/Memory/Entries/Project.vue'

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

const nuxtLinkStub = {
  props: ['to'],
  template: '<a :data-to="JSON.stringify(to)"><slot /></a>',
}

const RESET_URL = '/api/v1/memory/entries/reset'

function createEntry(id: string, category: MemoryCategory): MemoryEntry {
  return {
    id,
    projectId: 'project-1',
    category,
    slug: id,
    title: `Title ${id}`,
    description: `Description ${id}`,
    body: 'Body',
    sensitivity: 'none',
    sensitiveCategory: null,
    origin: 'tool',
    sourceChatIds: [],
    sourceMessageId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: new Date().toISOString(),
    lastUsedAt: null,
  }
}

interface ProjectProps {
  id: string
  name: string
  entries: MemoryEntry[]
  limit: number
  isMemoryOff: boolean
  focusRequested: boolean
}

async function mountProject(overrides: Partial<ProjectProps> = {}) {
  const wrapper = await mountSuspended(Project, {
    attachTo: document.body,
    global: { stubs: { NuxtLink: nuxtLinkStub } },
    props: {
      id: 'project-1',
      name: 'Home lab',
      entries: [createEntry('p1', 'profile'), createEntry('t1', 'topics')],
      limit: 15,
      isMemoryOff: false,
      focusRequested: false,
      ...overrides,
    },
  })

  await flushPromises()

  return wrapper
}

function createRejection(message: string, why: string) {
  return Object.assign(new Error('Request failed'), {
    data: { statusCode: 500, message, data: { why } },
  })
}

describe('Profile/Memory/Entries/Project', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.confirm.mockReset()
    mocks.confirm.mockResolvedValue({ label: 'Delete entries', index: 0 })
    mocks.info.mockReset()
    mocks.error.mockReset()
  })

  describe('toggle', () => {
    it('shows the name and its own count against the project limit',
      async () => {
        const wrapper = await mountProject()

        expect(wrapper.get('[data-testid="memory-project-name"]').text())
          .toBe('Home lab')
        expect(wrapper.get('[data-testid="memory-project-count"]').text())
          .toBe('2 of 15')
      })

    it('is a collapsed button wired to its panel', async () => {
      const wrapper = await mountProject()
      const toggle = wrapper.get('[data-testid="memory-project-toggle"]')

      expect(toggle.element.tagName).toBe('BUTTON')
      expect(toggle.attributes('type')).toBe('button')
      expect(toggle.attributes('aria-expanded')).toBe('false')
      expect(toggle.attributes('aria-controls')).toBeTruthy()
      expect(toggle.classes()).toContain('js-memory-project-toggle')
      expect(wrapper.find('[data-testid="memory-project-panel"]').exists())
        .toBe(false)
    })

    it('expands and collapses, rotating the chevron', async () => {
      const wrapper = await mountProject()
      const toggle = wrapper.get('[data-testid="memory-project-toggle"]')
      const chevron = toggle.get('.iconify')

      await toggle.trigger('click')

      const panel = wrapper.get('[data-testid="memory-project-panel"]')

      expect(toggle.attributes('aria-expanded')).toBe('true')
      expect(panel.attributes('id'))
        .toBe(toggle.attributes('aria-controls'))
      expect(chevron.classes()).toContain('rotate-90')
      expect(chevron.classes()).toContain('motion-reduce:transition-none')

      await toggle.trigger('click')

      expect(toggle.attributes('aria-expanded')).toBe('false')
      expect(chevron.classes()).not.toContain('rotate-90')
      expect(wrapper.find('[data-testid="memory-project-panel"]').exists())
        .toBe(false)
    })

    it('shows the Memory off badge only when memory is off', async () => {
      const off = await mountProject({ isMemoryOff: true })
      const on = await mountProject({ isMemoryOff: false })

      expect(off.get('[data-testid="memory-project-off"]').text())
        .toBe('Memory off')
      expect(on.find('[data-testid="memory-project-off"]').exists())
        .toBe(false)
    })

    it('uses the reusable ring instead of the browser default', async () => {
      const wrapper = await mountProject()
      const toggle = wrapper.get('[data-testid="memory-project-toggle"]')

      expect(toggle.classes()).toEqual(expect.arrayContaining([
        'rounded-box',
        'focus-visible:outline-none',
        'focus-visible:ring-2',
        'focus-visible:ring-accent',
      ]))
      expect(toggle.classes()).not.toContain('rounded-full')
    })
  })

  describe('panel', () => {
    async function mountExpanded(overrides: Partial<ProjectProps> = {}) {
      const wrapper = await mountProject(overrides)

      await wrapper.get('[data-testid="memory-project-toggle"]')
        .trigger('click')

      return wrapper
    }

    it('lists the entries as rows labelled with their category', async () => {
      const wrapper = await mountExpanded()
      const rows = wrapper.findAll('[data-testid="memory-entry-row"]')

      expect(rows.map(row => row.get('[data-testid="memory-entry-label"]')
        .text())).toEqual(['Profile', 'Topics'])
      expect(rows[0]!.text()).toContain('Title p1')
      expect(rows[0]!.text()).toContain('Description p1')
      expect(rows[0]!.get('[data-testid="memory-entry-meta"]').text())
        .toBe('Updated just now')
    })

    it('emits select with the clicked entry', async () => {
      const wrapper = await mountExpanded()

      await wrapper.findAll('[data-testid="memory-entry-row"]')[1]!
        .trigger('click')

      expect(wrapper.emitted('select')![0]).toEqual([
        expect.objectContaining({ id: 't1' }),
      ])
    })

    it('links to the project page', async () => {
      const wrapper = await mountExpanded()
      const link = wrapper.get('[data-testid="memory-project-open"]')

      expect(JSON.parse(link.attributes('data-to')!))
        .toBe('/chats/projects/project-1')
      expect(link.text()).toContain('Open project')
    })

    it('emits add with the project id', async () => {
      const wrapper = await mountExpanded()

      await wrapper.get('[data-testid="memory-project-add"]')
        .trigger('click')

      expect(wrapper.emitted('add')).toEqual([['project-1']])
    })
  })

  describe('reset', () => {
    async function clickReset(overrides: Partial<ProjectProps> = {}) {
      const wrapper = await mountProject(overrides)

      await wrapper.get('[data-testid="memory-project-toggle"]')
        .trigger('click')
      await wrapper.get('[data-testid="memory-project-reset"]')
        .trigger('click')
      await flushPromises()

      return wrapper
    }

    it('names the project in the confirmation', async () => {
      await clickReset()

      expect(mocks.confirm).toHaveBeenCalledWith({
        text: 'Reset memory for "Home lab"?',
        subtitle: 'This deletes every memory entry in this project. '
          + 'This cannot be undone.',
        alert: true,
        actions: ['Delete entries'],
        labelDecline: 'Cancel',
      })
    })

    it('does nothing when the confirmation is cancelled', async () => {
      mocks.confirm.mockResolvedValue(null)

      const wrapper = await clickReset()

      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(wrapper.emitted('changed')).toBeUndefined()
    })

    it('resets the project and reports the deleted count', async () => {
      mocks.fetch.mockResolvedValue({ deleted: 2 })

      const wrapper = await clickReset()

      expect(mocks.fetch).toHaveBeenCalledWith(RESET_URL, {
        method: 'POST',
        body: { scope: 'project', projectId: 'project-1' },
      })
      expect(mocks.info).toHaveBeenCalledWith(
        'Memory reset',
        'Deleted 2 entries.',
      )
      expect(wrapper.emitted('changed')).toHaveLength(1)
    })

    it('uses the singular for one entry', async () => {
      mocks.fetch.mockResolvedValue({ deleted: 1 })

      await clickReset()

      expect(mocks.info).toHaveBeenCalledWith('Memory reset', 'Deleted 1 entry.')
    })

    it('says when there was nothing to delete', async () => {
      mocks.fetch.mockResolvedValue({ deleted: 0 })

      await clickReset()

      expect(mocks.info).toHaveBeenCalledWith(
        'Memory reset',
        'Nothing to delete.',
      )
    })

    it('shows an error toast and keeps the list when it fails', async () => {
      mocks.fetch.mockRejectedValue(
        createRejection('Could not reset memory', 'Database unavailable'),
      )

      const wrapper = await clickReset()

      expect(mocks.error).toHaveBeenCalledWith(
        'Could not reset memory',
        'Database unavailable',
      )
      expect(mocks.info).not.toHaveBeenCalled()
      expect(wrapper.emitted('changed')).toBeUndefined()
    })
  })

  describe('focus request', () => {
    it('expands, focuses the toggle and reports it once', async () => {
      const wrapper = await mountProject({ focusRequested: true })
      const toggle = wrapper.get('[data-testid="memory-project-toggle"]')

      expect(toggle.attributes('aria-expanded')).toBe('true')
      expect(document.activeElement).toBe(toggle.element)
      expect(wrapper.emitted('focused')).toHaveLength(1)
    })

    it('expands when the request arrives after mounting', async () => {
      const wrapper = await mountProject()

      await wrapper.setProps({ focusRequested: true })
      await flushPromises()

      expect(wrapper.get('[data-testid="memory-project-toggle"]')
        .attributes('aria-expanded')).toBe('true')
      expect(wrapper.emitted('focused')).toHaveLength(1)
    })

    it('stays collapsed without a request', async () => {
      const wrapper = await mountProject()

      expect(wrapper.get('[data-testid="memory-project-toggle"]')
        .attributes('aria-expanded')).toBe('false')
      expect(wrapper.emitted('focused')).toBeUndefined()
    })
  })
})
