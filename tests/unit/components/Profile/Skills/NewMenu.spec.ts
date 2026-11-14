import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NewMenu from '../../../../../app/components/Profile/Skills/NewMenu.vue'

enableAutoUnmount(afterEach)

function testId(id: string) {
  return `[data-testid="${id}"]`
}

describe('Profile/Skills/NewMenu', () => {
  beforeEach(() => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.removeAttribute('open')
      })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists the four local actions in the dropdown', async () => {
    const wrapper = await mountSuspended(NewMenu)
    const labels = wrapper.findAll(`${testId('skills-new-menu')} button`)
      .map(button => button.text())

    expect(labels).toEqual([
      'New skill',
      'From a template',
      'Upload .zip or .skill',
      'Paste SKILL.md',
    ])
  })

  it('adds From GitHub only when the import flag is on', async () => {
    const wrapper = await mountSuspended(NewMenu, {
      props: { canImportFromUrl: true },
    })

    expect(wrapper.get(testId('skills-new-github')).text()).toBe('From GitHub')
  })

  it('emits the chosen action from the dropdown', async () => {
    const wrapper = await mountSuspended(NewMenu)

    await wrapper.get(testId('skills-new-skill')).trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual(['skill'])
  })

  it('has no blank skill or blank command action', async () => {
    const wrapper = await mountSuspended(NewMenu)

    expect(wrapper.find(testId('skills-new-blank')).exists()).toBe(false)
    expect(wrapper.find(testId('skills-new-command')).exists()).toBe(false)
    expect(wrapper.find(testId('skills-new-sheet-blank')).exists()).toBe(false)
    expect(wrapper.find(testId('skills-new-sheet-command')).exists())
      .toBe(false)
  })

  it('offers New skill in the bottom sheet too', async () => {
    const wrapper = await mountSuspended(NewMenu)

    expect(wrapper.get(testId('skills-new-sheet-skill')).text())
      .toBe('New skill')
  })

  it('opens a bottom sheet for small screens and emits from it', async () => {
    const wrapper = await mountSuspended(NewMenu)
    const sheet = wrapper.get(testId('skills-new-sheet'))

    expect(sheet.classes()).toContain('modal-bottom')

    await wrapper.get(testId('skills-new-sheet-trigger')).trigger('click')

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled()

    await wrapper.get(testId('skills-new-sheet-paste')).trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual(['paste'])
  })
})
