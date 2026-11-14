import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CreateDialog from '../../../../../app/components/Profile/Skills/CreateDialog.client.vue'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)

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

function mountDialog(kind: 'blank' | 'command' | 'template') {
  return mountSuspended(CreateDialog, {
    props: { kind },
    attachTo: document.body,
    global: { stubs: { teleport: false } },
  })
}

describe('Profile/Skills/CreateDialog', () => {
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
    mocks.fetch.mockReset()
    mocks.fetch.mockResolvedValue({ id: 'NewId', name: 'meeting-recap' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('titles the dialog by what is being created', async () => {
    await mountDialog('blank')
    expect(get('skills-dialog-title').textContent).toContain('New skill')

    document.body.innerHTML = ''
    await mountDialog('command')
    expect(get('skills-dialog-title').textContent).toContain('New command')

    document.body.innerHTML = ''
    await mountDialog('template')
    expect(get('skills-dialog-title').textContent)
      .toContain('New skill from a template')
  })

  it('keeps Create disabled until a name is typed', async () => {
    await mountDialog('blank')

    expect((get('skill-create-submit') as HTMLButtonElement).disabled)
      .toBe(true)

    await setValue('skill-create-name', 'meeting-recap')

    expect((get('skill-create-submit') as HTMLButtonElement).disabled)
      .toBe(false)
  })

  it('posts a blank skill with its trimmed name and description', async () => {
    const wrapper = await mountDialog('blank')

    await setValue('skill-create-name', ' meeting-recap ')
    await setValue('skill-create-description', ' Turn notes into a recap ')
    await submit()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills', {
      method: 'POST',
      body: {
        kind: 'blank',
        name: 'meeting-recap',
        description: 'Turn notes into a recap',
      },
    })
    expect(wrapper.emitted('created')?.[0]).toEqual([{
      id: 'NewId',
      name: 'meeting-recap',
    }])
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('omits an empty description', async () => {
    await mountDialog('blank')
    await setValue('skill-create-name', 'meeting-recap')
    await submit()

    expect(mocks.fetch.mock.calls[0]![1].body).toEqual({
      kind: 'blank',
      name: 'meeting-recap',
    })
  })

  it('posts a command with an argument hint', async () => {
    await mountDialog('command')
    await setValue('skill-create-name', 'summarise')
    await setValue('skill-create-hint', 'What to summarise')
    await submit()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills', {
      method: 'POST',
      body: {
        kind: 'command',
        name: 'summarise',
        argumentHint: 'What to summarise',
      },
    })
  })

  it('posts a template with its id and an optional name', async () => {
    await mountDialog('template')
    await submit()

    expect(mocks.fetch.mock.calls[0]![1].body).toEqual({
      kind: 'template',
      template: 'writing-style',
    })

    mocks.fetch.mockClear()
    await setValue('skill-create-name', 'my-voice')
    await submit()

    expect(mocks.fetch.mock.calls[0]![1].body).toEqual({
      kind: 'template',
      template: 'writing-style',
      name: 'my-voice',
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
    await mountDialog('blank')
    await setValue('skill-create-name', 'My Skill!')

    expect(get('skill-create-name-help').textContent).toContain(
      'Use lowercase letters, numbers and single hyphens (max 64)',
    )
    expect(get('skill-create-name-help').getAttribute('role')).toBe('alert')
    expect((get('skill-create-submit') as HTMLButtonElement).disabled)
      .toBe(true)
  })

  it('refuses a reserved name for a command', async () => {
    await mountDialog('command')
    await setValue('skill-create-name', 'memory')

    expect(get('skill-create-name-help').textContent)
      .toContain('/memory is reserved by Besidka')
    expect((get('skill-create-submit') as HTMLButtonElement).disabled)
      .toBe(true)
  })

  it('allows a reserved name for a plain skill', async () => {
    await mountDialog('blank')
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

    const wrapper = await mountDialog('blank')

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

  it('closes without creating on Cancel', async () => {
    const wrapper = await mountDialog('blank')

    get('skill-create-cancel').click()
    await flushPromises()

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
