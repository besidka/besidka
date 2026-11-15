import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SKILL_SCRIPTS_DISCLOSURE_POINTS } from '../../../../../shared/utils/skills/scripts'
import ScriptsDialog from '../../../../../app/components/Profile/Skills/ScriptsDialog.client.vue'

enableAutoUnmount(afterEach)

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

async function mountDialog(scriptsProviderName: string | null = null) {
  const wrapper = await mountSuspended(ScriptsDialog, {
    props: {
      skill: { name: 'claude-api', scriptsProviderName },
    },
    attachTo: document.body,
    global: { stubs: { teleport: false } },
  })

  await flushPromises()

  return wrapper
}

describe('Profile/Skills/ScriptsDialog', () => {
  beforeEach(() => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.removeAttribute('open')
      })
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is closed until it is opened', async () => {
    const wrapper = await mountDialog()

    expect(get('skill-scripts-dialog').hasAttribute('open')).toBe(false)

    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()

    expect(get('skill-scripts-dialog').hasAttribute('open')).toBe(true)
  })

  it('states every disclosure point before the first upload', async () => {
    await mountDialog()

    const text = get('skill-scripts-dialog-points').textContent ?? ''

    for (const point of SKILL_SCRIPTS_DISCLOSURE_POINTS) {
      expect(text).toContain(point)
    }

    expect(text).toContain('workspace')
    expect(text).toContain('zero data retention')
    expect(text).toContain('30 days')
    expect(text).toContain('1,550 container-hours')
    expect(text).toContain('trust')
    expect(find('skill-scripts-dialog-rename')).toBeNull()
  })

  it('names the upload name when the skill has to be renamed', async () => {
    await mountDialog('bsk-c-api')

    expect(get('skill-scripts-dialog-rename').textContent)
      .toContain('bsk-c-api')
    expect(get('skill-scripts-dialog-confirm').textContent)
      .toContain('Allow and rename')
  })

  it('emits confirm and closes on Allow scripts', async () => {
    const wrapper = await mountDialog()

    get('skill-scripts-dialog-confirm').click()
    await flushPromises()

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(get('skill-scripts-dialog').hasAttribute('open')).toBe(false)
  })

  it('emits decline and no confirm on Keep scripts off', async () => {
    const wrapper = await mountDialog()

    get('skill-scripts-dialog-cancel').click()
    await flushPromises()

    expect(wrapper.emitted('decline')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })
})
