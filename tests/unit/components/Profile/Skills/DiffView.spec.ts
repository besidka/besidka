import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import DiffView from '../../../../../app/components/Profile/Skills/DiffView.vue'
import type { SkillFileDiff } from '../../../../../shared/utils/skills/diff'

enableAutoUnmount(afterEach)

function testId(id: string) {
  return `[data-testid="${id}"]`
}

const files: SkillFileDiff[] = [{
  path: 'SKILL.md',
  status: 'modified',
  added: 1,
  removed: 1,
  truncated: false,
  lines: [
    { kind: 'gap', text: '4 unchanged lines' },
    { kind: 'remove', text: 'old line' },
    { kind: 'add', text: 'new line' },
    { kind: 'context', text: 'same' },
  ],
}]

describe('Profile/Skills/DiffView', () => {
  it('shows + and - markers with text labels, not colour alone', async () => {
    const wrapper = await mountSuspended(DiffView, {
      props: { files, added: 1, removed: 1 },
    })
    const added = wrapper.get(testId('skill-diff-line-add'))
    const removed = wrapper.get(testId('skill-diff-line-remove'))

    expect(added.text()).toContain('+')
    expect(added.text()).toContain('Added:')
    expect(removed.text()).toContain('-')
    expect(removed.text()).toContain('Removed:')
  })

  it('summarises the change and shows the file status', async () => {
    const wrapper = await mountSuspended(DiffView, {
      props: { files, added: 1, removed: 1 },
    })

    expect(wrapper.get(testId('skill-diff-summary')).text())
      .toBe('1 file changes: 1 line added, 1 line removed.')
    expect(wrapper.get(testId('skill-diff-file')).text()).toContain('Changed')
    expect(wrapper.get(testId('skill-diff-file')).text()).toContain('+1 -1')
  })

  it('says so when nothing changed', async () => {
    const wrapper = await mountSuspended(DiffView, {
      props: { files: [], added: 0, removed: 0 },
    })

    expect(wrapper.get(testId('skill-diff-summary')).text())
      .toBe('No file changes.')
  })

  it('tells the user when the diff was capped and lists what was skipped', async () => {
    const wrapper = await mountSuspended(DiffView, {
      props: {
        files,
        added: 1,
        removed: 1,
        truncated: true,
        skipped: [{ path: 'references/big.md', status: 'modified' }],
      },
    })

    expect(wrapper.get(testId('skill-diff-truncated')).text())
      .toContain('references/big.md')
    expect(wrapper.get(testId('skill-diff-truncated')).text())
      .toContain('2000 lines')
  })

  it('shows hidden characters in a diff line as code points', async () => {
    const wrapper = await mountSuspended(DiffView, {
      props: {
        files: [{
          ...files[0]!,
          lines: [{ kind: 'add', text: 'a‮b' }],
        }],
        added: 1,
        removed: 0,
      },
    })

    expect(wrapper.get(testId('skill-diff-line-add')).text())
      .toContain('a⟨U+202E⟩b')
  })
})
