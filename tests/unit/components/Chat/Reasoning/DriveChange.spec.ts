import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import DriveChange from '../../../../../app/components/Chat/Reasoning/DriveChange.vue'
import type { DriveWriteApprovalView } from '#shared/utils/google-drive-write'

const FOLDER_ID = 'folder-id-0123456789'

function view(
  overrides: Partial<DriveWriteApprovalView> = {},
): DriveWriteApprovalView {
  return {
    kind: 'create-folder',
    name: 'Reports',
    parent: { isRoot: true, name: null, id: null },
    ...overrides,
  }
}

function testId(name: string): string {
  return `[data-testid="reasoning-approval-step-drive-change-${name}"]`
}

describe('Chat/Reasoning/DriveChange', () => {
  it('shows the new folder name and the top level of My Drive', async () => {
    const wrapper = await mountSuspended(DriveChange, {
      props: { view: view() },
    })

    expect(wrapper.get(testId('name')).text()).toBe('Reports')
    expect(wrapper.get(testId('parent')).text()).toBe('My Drive (top level)')
    expect(wrapper.find(testId('parent-id')).exists()).toBe(false)
  })

  it('shows the parent folder name quoted with the exact id under it',
    async () => {
      const wrapper = await mountSuspended(DriveChange, {
        props: {
          view: view({
            parent: { isRoot: false, name: 'My Drive', id: FOLDER_ID },
          }),
        },
      })

      expect(wrapper.get(testId('parent')).text()).toContain('“My Drive”')
      expect(wrapper.get(testId('parent-id')).text()).toBe(FOLDER_ID)
    })

  it('names a parent without a stored name by the id only', async () => {
    const wrapper = await mountSuspended(DriveChange, {
      props: {
        view: view({
          parent: { isRoot: false, name: null, id: FOLDER_ID },
        }),
      },
    })

    expect(wrapper.get(testId('parent')).text())
      .toContain('A folder from this chat')
    expect(wrapper.get(testId('parent-id')).text()).toBe(FOLDER_ID)
  })

  it('shows names as text, never as markup', async () => {
    const wrapper = await mountSuspended(DriveChange, {
      props: {
        view: view({
          name: '<img src=x onerror=alert(1)> [x](https://evil.example)',
        }),
      },
    })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.get(testId('name')).text())
      .toContain('<img src=x onerror=alert(1)>')
  })

  it('shows a parent folder name from Drive as text, never as markup',
    async () => {
      const hostileName = '<script>alert(1)</script><b>bold</b> '
        + '[x](https://evil.example) <a href="https://evil.example">y</a>'
      const wrapper = await mountSuspended(DriveChange, {
        props: {
          view: view({
            name: '<i>new</i>',
            parent: { isRoot: false, name: hostileName, id: FOLDER_ID },
          }),
        },
      })

      expect(wrapper.find('script').exists()).toBe(false)
      expect(wrapper.find('b').exists()).toBe(false)
      expect(wrapper.find('i').exists()).toBe(false)
      expect(wrapper.find('a').exists()).toBe(false)
      expect(wrapper.get(testId('parent')).text()).toContain(hostileName)
      expect(wrapper.get(testId('name')).text()).toBe('<i>new</i>')
    })

  it('says Besidka cannot delete files or change who can see them',
    async () => {
      const wrapper = await mountSuspended(DriveChange, {
        props: { view: view() },
      })

      expect(wrapper.get(testId('note')).text()).toBe(
        'Besidka cannot delete files or change who can see them.',
      )
    })
})
