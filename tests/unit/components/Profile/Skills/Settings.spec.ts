import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import Settings from '../../../../../app/components/Profile/Skills/Settings.vue'
import { createSkillDetail } from '../../../../setup/helpers/skills-ui'

const mocks = vi.hoisted(() => ({
  setScripts: vi.fn(),
}))

const scriptsEnabled = ref<boolean>(true)
const scriptsActive = ref<boolean>(true)
const commandsActive = ref<boolean>(false)

mockNuxtImport('useFeature', () => {
  return (key: string) => computed(() => {
    if (key === 'skills.scripts') {
      return {
        enabled: scriptsEnabled.value,
        active: scriptsActive.value,
        variant: null,
      }
    }

    if (key === 'skills.commands') {
      return {
        enabled: commandsActive.value,
        active: commandsActive.value,
        variant: null,
      }
    }

    return { enabled: false, active: false, variant: null }
  })
})
mockNuxtImport('useSkillActions', () => {
  return () => ({
    isBusy: () => false,
    setMode: vi.fn(),
    saveCommand: vi.fn(),
    setScripts: mocks.setScripts,
  })
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

function testId(id: string) {
  return `[data-testid="${id}"]`
}

function mountSettings(overrides: Record<string, unknown> = {}) {
  return mountSuspended(Settings, {
    props: {
      skill: createSkillDetail({ hasScripts: true, ...overrides }),
    },
    attachTo: document.body,
  })
}

describe('Profile/Skills/Settings scripts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.removeAttribute('open')
      })
    document.body.innerHTML = ''
    scriptsEnabled.value = true
    scriptsActive.value = true
  })

  it('shows nothing about scripts for a skill without a script', async () => {
    const wrapper = await mountSettings({ hasScripts: false })

    expect(wrapper.find(testId('skill-setting-scripts')).exists()).toBe(false)
  })

  it('shows nothing while the flag is off for the user', async () => {
    scriptsEnabled.value = false
    scriptsActive.value = false

    const wrapper = await mountSettings()

    expect(wrapper.find(testId('skill-setting-scripts')).exists()).toBe(false)
  })

  it('points to Labs and locks the toggle without the opt-in', async () => {
    scriptsActive.value = false

    const wrapper = await mountSettings()
    const toggle = wrapper.get(testId('skill-setting-scripts-toggle'))

    expect(wrapper.get(testId('skill-setting-scripts-optin')).text())
      .toContain('Labs')
    expect((toggle.element as HTMLInputElement).disabled).toBe(true)
  })

  it('keeps a skill that already allows scripts switchable off without the opt-in', async () => {
    scriptsActive.value = false

    const wrapper = await mountSettings({ allowScripts: true })
    const toggle = wrapper.get(testId('skill-setting-scripts-toggle'))

    expect((toggle.element as HTMLInputElement).disabled).toBe(false)
  })

  it('opens the disclosure instead of turning scripts on at once', async () => {
    const wrapper = await mountSettings()
    const toggle = wrapper.get(testId('skill-setting-scripts-toggle'))

    await toggle.setValue(true)
    await flushPromises()

    expect(
      document.body.querySelector('[data-testid="skill-scripts-dialog"]')
        ?.hasAttribute('open'),
    ).toBe(true)
    expect(mocks.setScripts).not.toHaveBeenCalled()
    expect((toggle.element as HTMLInputElement).checked).toBe(false)
  })

  it('turns scripts off through the action', async () => {
    const wrapper = await mountSettings({ allowScripts: true })

    await wrapper.get(testId('skill-setting-scripts-toggle')).setValue(false)
    await flushPromises()

    expect(mocks.setScripts).toHaveBeenCalledWith(
      expect.objectContaining({ allowScripts: true }),
      false,
    )
  })

  it('says whether the copy is uploaded yet', async () => {
    const uploaded = await mountSettings({
      allowScripts: true,
      scriptsUploaded: true,
      scriptsProviderName: 'bsk-c-api',
    })

    expect(uploaded.get(testId('skill-setting-scripts-uploaded')).text())
      .toContain('as bsk-c-api')

    const pending = await mountSettings({
      allowScripts: true,
      scriptsUploaded: false,
    })

    expect(pending.find(testId('skill-setting-scripts-uploaded')).exists())
      .toBe(false)
    expect(pending.text()).toContain('Not uploaded yet')
  })
})

describe('Profile/Skills/Settings command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    commandsActive.value = true
  })

  afterEach(() => {
    commandsActive.value = false
    delete useNuxtApp().payload.data['skills-library']
  })

  it('names the other skill that uses the command and blocks Save', async () => {
    const skill = createSkillDetail({ command: null })

    useNuxtApp().payload.data['skills-library'] = {
      skills: [
        { id: skill.id, name: skill.name, command: null },
        { id: 'other-id', name: 'code-review', command: 'review' },
      ],
      counts: { sources: { all: 2, created: 2, imported: 0, apps: 0 } },
    }

    const wrapper = await mountSuspended(Settings, {
      props: { skill },
      attachTo: document.body,
    })
    const input = wrapper.get(testId('skill-setting-command'))

    await input.setValue('/review')
    await flushPromises()

    expect(wrapper.get(testId('skill-setting-command-help')).text())
      .toBe('The command /review is already used by the skill code-review')
    expect((wrapper.get(testId('skill-setting-command-save'))
      .element as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not count the skill\'s own command as taken', async () => {
    const skill = createSkillDetail({ command: 'mine' })

    useNuxtApp().payload.data['skills-library'] = {
      skills: [{ id: skill.id, name: skill.name, command: 'mine' }],
      counts: { sources: { all: 1, created: 1, imported: 0, apps: 0 } },
    }

    const wrapper = await mountSuspended(Settings, {
      props: { skill },
      attachTo: document.body,
    })

    await wrapper.get(testId('skill-setting-command')).setValue('/Mine')
    await flushPromises()

    expect(wrapper.get(testId('skill-setting-command-help')).text())
      .not.toContain('already used')
  })
})
