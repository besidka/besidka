import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import CreateDialog from '../../../../../app/components/Profile/Skills/CreateDialog.client.vue'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

const commandsActive = ref<boolean>(false)

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useFeature', () => {
  return (key: string) => computed(() => {
    const active = key === 'skills.commands' && commandsActive.value

    return { enabled: active, active, variant: null }
  })
})

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

async function setValue(id: string, value: string) {
  const input = get(id) as HTMLInputElement | HTMLTextAreaElement

  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function submit() {
  get('skill-create-submit').click()
  await flushPromises()
}

function mountDialog(kind: 'skill' | 'template') {
  return mountSuspended(CreateDialog, {
    props: { kind },
    attachTo: document.body,
    global: { stubs: { teleport: false } },
  })
}

describe('Profile/Skills/CreateDialog', () => {
  beforeEach(() => {
    commandsActive.value = false
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
    mocks.fetch.mockReset()
    mocks.fetch.mockResolvedValue({ id: 'NewId', name: 'meeting-recap' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('titles the dialog by what is being created', async () => {
    await mountDialog('skill')
    expect(get('skills-dialog-title').textContent).toContain('New skill')
    expect(get('skills-dialog-title').textContent).not.toContain('command')

    document.body.innerHTML = ''
    await mountDialog('template')
    expect(get('skills-dialog-title').textContent)
      .toContain('New skill from a template')
  })

  it('keeps Create disabled until a name is typed', async () => {
    await mountDialog('skill')

    expect((get('skill-create-submit') as HTMLButtonElement).disabled)
      .toBe(true)

    await setValue('skill-create-name', 'meeting-recap')

    expect((get('skill-create-submit') as HTMLButtonElement).disabled)
      .toBe(false)
  })

  it('posts a blank skill with its trimmed name and description', async () => {
    const wrapper = await mountDialog('skill')

    await setValue('skill-create-name', ' meeting-recap ')
    await setValue('skill-create-description', ' Turn notes into a recap ')
    await submit()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills', {
      method: 'POST',
      body: {
        kind: 'blank',
        name: 'meeting-recap',
        description: 'Turn notes into a recap',
        mode: 'auto',
      },
    })
    expect(wrapper.emitted('created')?.[0]).toEqual([{
      id: 'NewId',
      name: 'meeting-recap',
    }])
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('omits an empty description', async () => {
    await mountDialog('skill')
    await setValue('skill-create-name', 'meeting-recap')
    await submit()

    expect(mocks.fetch.mock.calls[0]![1].body).toEqual({
      kind: 'blank',
      name: 'meeting-recap',
      mode: 'auto',
    })
  })

  it('posts the chosen mode', async () => {
    await mountDialog('skill')

    expect((get('skill-create-mode') as HTMLSelectElement).value).toBe('auto')

    await setValue('skill-create-name', 'meeting-recap')

    const select = get('skill-create-mode') as HTMLSelectElement

    select.value = 'ask'
    select.dispatchEvent(new Event('change'))
    await flushPromises()
    await submit()

    expect(mocks.fetch.mock.calls[0]![1].body).toEqual({
      kind: 'blank',
      name: 'meeting-recap',
      mode: 'ask',
    })
  })

  it('shows no command field and sends no command while the feature is off', async () => {
    await mountDialog('skill')

    expect(find('skill-create-command')).toBeNull()
    expect(find('skill-create-hint')).toBeNull()

    await setValue('skill-create-name', 'summarise')
    await submit()

    expect(mocks.fetch.mock.calls[0]![1].body).not.toHaveProperty('command')
  })

  it('shows the command field and the hint only once a command is typed', async () => {
    commandsActive.value = true
    await mountDialog('skill')

    expect(find('skill-create-command')).not.toBeNull()
    expect(find('skill-create-hint')).toBeNull()

    await setValue('skill-create-command', '/summarise')

    expect(find('skill-create-hint')).not.toBeNull()

    await setValue('skill-create-command', '')

    expect(find('skill-create-hint')).toBeNull()
  })

  it('posts a skill with a command and an argument hint', async () => {
    commandsActive.value = true
    await mountDialog('skill')
    await setValue('skill-create-name', 'summarise')
    await setValue('skill-create-command', ' /summarise ')
    await setValue('skill-create-hint', 'What to summarise')
    await submit()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills', {
      method: 'POST',
      body: {
        kind: 'blank',
        name: 'summarise',
        mode: 'auto',
        command: 'summarise',
        argumentHint: 'What to summarise',
      },
    })
  })

  it('leaves the hint out when the command is cleared again', async () => {
    commandsActive.value = true
    await mountDialog('skill')
    await setValue('skill-create-name', 'summarise')
    await setValue('skill-create-command', 'summarise')
    await setValue('skill-create-hint', 'What to summarise')
    await setValue('skill-create-command', '')
    await submit()

    expect(mocks.fetch.mock.calls[0]![1].body).toEqual({
      kind: 'blank',
      name: 'summarise',
      mode: 'auto',
    })
  })

  it('posts a template with its id and an optional name', async () => {
    await mountDialog('template')
    await submit()

    expect(mocks.fetch.mock.calls[0]![1].body).toEqual({
      kind: 'template',
      template: 'writing-style',
      mode: 'auto',
    })

    mocks.fetch.mockClear()
    await setValue('skill-create-name', 'my-voice')
    await submit()

    expect(mocks.fetch.mock.calls[0]![1].body).toEqual({
      kind: 'template',
      template: 'writing-style',
      name: 'my-voice',
      mode: 'auto',
    })
  })

  it('takes the mode from the template and leaves the command out while the feature is off', async () => {
    await mountDialog('template')

    const radio = get('skill-template-meeting-notes') as HTMLInputElement

    radio.checked = true
    radio.dispatchEvent(new Event('change'))
    await flushPromises()

    expect((get('skill-create-mode') as HTMLSelectElement).value).toBe('ask')
    expect(find('skill-create-command')).toBeNull()

    await submit()

    expect(mocks.fetch.mock.calls[0]![1].body).toEqual({
      kind: 'template',
      template: 'meeting-notes',
      mode: 'ask',
    })
  })

  it('prefills the command of a template when the feature is on', async () => {
    commandsActive.value = true
    await mountDialog('template')

    expect((get('skill-create-command') as HTMLInputElement).value).toBe('')

    const radio = get('skill-template-meeting-notes') as HTMLInputElement

    radio.checked = true
    radio.dispatchEvent(new Event('change'))
    await flushPromises()

    expect((get('skill-create-command') as HTMLInputElement).value)
      .toBe('meeting-notes')

    await submit()

    expect(mocks.fetch.mock.calls[0]![1].body).toEqual({
      kind: 'template',
      template: 'meeting-notes',
      mode: 'ask',
      command: 'meeting-notes',
    })
  })

  it('lets the user pick another template', async () => {
    await mountDialog('template')

    const radio = get('skill-template-meeting-notes') as HTMLInputElement

    radio.checked = true
    radio.dispatchEvent(new Event('change'))
    await flushPromises()
    await submit()

    expect(mocks.fetch.mock.calls[0]![1].body)
      .toMatchObject({ template: 'meeting-notes' })
  })

  it('refuses an invalid name before calling the server', async () => {
    await mountDialog('skill')
    await setValue('skill-create-name', 'My Skill!')

    expect(get('skill-create-name-help').textContent).toContain(
      'Use lowercase letters, numbers and single hyphens (max 64)',
    )
    expect(get('skill-create-name-help').getAttribute('role')).toBe('alert')
    expect((get('skill-create-submit') as HTMLButtonElement).disabled)
      .toBe(true)
  })

  it('refuses a reserved command under the command field', async () => {
    commandsActive.value = true
    await mountDialog('skill')
    await setValue('skill-create-name', 'my-skill')
    await setValue('skill-create-command', '/memory')

    expect(get('skill-create-command-help').textContent)
      .toContain('/memory is reserved by Besidka')
    expect(get('skill-create-command-help').getAttribute('role'))
      .toBe('alert')
    expect((get('skill-create-submit') as HTMLButtonElement).disabled)
      .toBe(true)

    await setValue('skill-create-command', '/my-command')

    expect((get('skill-create-submit') as HTMLButtonElement).disabled)
      .toBe(false)
  })

  it('refuses a command with an invalid pattern', async () => {
    commandsActive.value = true
    await mountDialog('skill')
    await setValue('skill-create-name', 'my-skill')
    await setValue('skill-create-command', 'Not Valid')

    expect(get('skill-create-command-help').textContent)
      .toContain('Use lowercase letters, digits and single hyphens (max 64)')
    expect((get('skill-create-submit') as HTMLButtonElement).disabled)
      .toBe(true)
  })

  it('allows a reserved skill name', async () => {
    await mountDialog('skill')
    await setValue('skill-create-name', 'memory')

    expect((get('skill-create-submit') as HTMLButtonElement).disabled)
      .toBe(false)
  })

  it('shows the server message and keeps the dialog open on failure', async () => {
    mocks.fetch.mockRejectedValue({
      data: {
        message: 'A skill named meeting-recap exists',
        why: 'Skill names are unique',
      },
    })

    const wrapper = await mountDialog('skill')

    await setValue('skill-create-name', 'meeting-recap')
    await submit()

    expect(get('skill-create-name-help').textContent)
      .toContain('A skill named meeting-recap exists')
    expect(wrapper.emitted('created')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()

    await setValue('skill-create-name', 'meeting-recaps')

    expect(get('skill-create-name-help').textContent)
      .not.toContain('A skill named meeting-recap exists')
  })

  it('shows a taken command under the command field, not under the name', async () => {
    commandsActive.value = true
    mocks.fetch.mockRejectedValue({
      data: {
        message: '/summarise is already a command',
        code: 'command-taken',
      },
    })

    const wrapper = await mountDialog('skill')

    await setValue('skill-create-name', 'summarise')
    await setValue('skill-create-command', 'summarise')
    await submit()

    expect(get('skill-create-command-help').textContent)
      .toContain('/summarise is already a command')
    expect(get('skill-create-command-help').getAttribute('role'))
      .toBe('alert')
    expect(get('skill-create-name-help').textContent)
      .not.toContain('already a command')
    expect(wrapper.emitted('close')).toBeUndefined()

    await setValue('skill-create-command', 'summarise-2')

    expect(get('skill-create-command-help').textContent)
      .not.toContain('already a command')
  })

  it('shows a server reserved-name refusal under the command field', async () => {
    commandsActive.value = true
    mocks.fetch.mockRejectedValue({
      data: { message: '/search is reserved by Besidka', code: 'reserved-name' },
    })
    await mountDialog('skill')
    await setValue('skill-create-name', 'my-skill')
    await setValue('skill-create-command', 'my-cmd')
    await submit()

    expect(get('skill-create-command-help').textContent)
      .toContain('/search is reserved by Besidka')
    expect(get('skill-create-name-help').textContent)
      .not.toContain('reserved')
  })

  it('closes without creating on Cancel', async () => {
    const wrapper = await mountDialog('skill')

    get('skill-create-cancel').click()
    await flushPromises()

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
