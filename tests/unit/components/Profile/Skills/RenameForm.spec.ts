import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import RenameForm from '../../../../../app/components/Profile/Skills/RenameForm.vue'

enableAutoUnmount(afterEach)

function testId(id: string) {
  return `[data-testid="${id}"]`
}

describe('Profile/Skills/RenameForm', () => {
  it('submits the trimmed name when it is valid', async () => {
    const wrapper = await mountSuspended(RenameForm, {
      props: { modelValue: 'review-pr-copy' },
    })

    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toEqual([['review-pr-copy']])
  })

  it('disables Import for an invalid name or while busy', async () => {
    const invalid = await mountSuspended(RenameForm, {
      props: { modelValue: 'Not Valid' },
    })
    const busy = await mountSuspended(RenameForm, {
      props: { modelValue: 'fine-name', isDisabled: true },
    })

    expect(invalid.get(testId('skill-import-rename-submit')).attributes('disabled'))
      .toBeDefined()
    expect(busy.get(testId('skill-import-rename-submit')).attributes('disabled'))
      .toBeDefined()
  })

  it('shows the label it is given', async () => {
    const wrapper = await mountSuspended(RenameForm, {
      props: { modelValue: 'x-y', label: 'Name of the copy' },
    })

    expect(wrapper.get('label').text()).toBe('Name of the copy')
  })
})
