import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SkillPreview from '../../../../app/components/Chat/SkillPreview.client.vue'
import { createSkillDetail } from '../../../setup/helpers/skills-ui'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  navigateTo: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('navigateTo', () => mocks.navigateTo)

enableAutoUnmount(afterEach)

const SKILL_MD = [
  '---',
  'name: writing-style',
  'description: Write in my voice',
  '---',
  '# Voice',
  '',
  '<img src=x onerror=alert(1)> **not bold**',
  '',
].join('\n')

function find(id: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${id}"]`)
}

function get(id: string): HTMLElement {
  const element = find(id)

  if (!element) {
    throw new Error(`Missing ${id}`)
  }

  return element
}

async function mountPreview() {
  const wrapper = await mountSuspended(SkillPreview, {
    props: { skillId: 'S1' },
    attachTo: document.body,
    global: { stubs: { teleport: false } },
  })

  await vi.waitFor(() => {
    expect(find('skill-preview-loading')).toBeNull()
  })

  return wrapper
}

describe('Chat/SkillPreview', () => {
  beforeEach(() => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
    document.body.innerHTML = ''
    mocks.fetch.mockReset()
    mocks.navigateTo.mockReset()
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === '/api/v1/skills/S1') {
        return createSkillDetail({
          id: 'S1',
          name: 'writing-style',
          description: 'Write in my voice',
          enabled: true,
          modelInvocable: true,
          slashCommand: true,
        })
      }

      return { version: 1, path: 'SKILL.md', text: SKILL_MD }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the name, the description, the mode and SKILL.md as plain text', async () => {
    await mountPreview()

    expect(get('skill-preview-name').textContent?.trim()).toBe('writing-style')
    expect(get('skill-preview-description').textContent)
      .toContain('Write in my voice')
    expect(get('skill-preview-mode').textContent?.trim()).toBe('Auto')
    expect(get('skill-preview-text').textContent).toContain('# Voice')
    expect(get('skill-preview-text').textContent)
      .toContain('<img src=x onerror=alert(1)> **not bold**')
    expect(get('skill-preview-text').querySelector('img')).toBeNull()
    expect(get('skill-preview-text').tagName).toBe('PRE')
    expect(get('skill-preview-text').className).toContain('font-mono')
  })

  it('asks for SKILL.md of the skill, nothing else', async () => {
    await mountPreview()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills/S1')
    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills/S1/files', {
      query: { path: 'SKILL.md' },
    })
  })

  it('opens the skill in the editor from Edit', async () => {
    const wrapper = await mountPreview()

    get('skill-preview-edit').click()
    await flushPromises()

    expect(mocks.navigateTo).toHaveBeenCalledWith({
      path: '/chats/skills',
      query: { skill: 'S1', edit: '1' },
    })
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('links to all skills and closes', async () => {
    const wrapper = await mountPreview()

    expect(get('skill-preview-all').outerHTML).toContain('/chats/skills')

    get('skill-preview-dismiss').click()
    await flushPromises()

    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('says the skill is not available when it cannot be loaded', async () => {
    mocks.fetch.mockRejectedValue({ data: { message: 'Skill not found' } })
    await mountPreview()

    expect(get('skill-preview-error').textContent).toContain('Skill not found')
    expect((get('skill-preview-edit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('cuts a very long file and says so', async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      return url === '/api/v1/skills/S1'
        ? createSkillDetail({ id: 'S1' })
        : { version: 1, path: 'SKILL.md', text: 'x'.repeat(70_000) }
    })
    await mountPreview()

    expect(get('skill-preview-text').textContent!.length).toBeLessThan(61_000)
    expect(find('skill-preview-truncated')).not.toBeNull()
  })
})
