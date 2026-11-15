import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import CodeExecution from '../../../../app/components/Chat/CodeExecution.vue'
import { useSidePanel } from '../../../../app/composables/side-panel'

enableAutoUnmount(afterEach)

const LONG_CODE = [
  'import math',
  'values = [1, 2, 3]',
  'total = sum(values)',
  'print(total)',
  'print(math.pi)',
  'print("done")',
].join('\n')

function donePart(
  output: Record<string, unknown> = {},
  input: Record<string, unknown> = {},
) {
  return {
    type: 'tool-code_execution',
    toolCallId: 'call_1',
    state: 'output-available',
    input: { language: 'python', code: 'print(1)', ...input },
    output: {
      stdout: '1\n',
      stderr: '',
      returnCode: 0,
      ...output,
    },
  }
}

async function mountCard(
  part: unknown,
  skippedFiles: { filename: string, reason: string }[] = [],
) {
  return mountSuspended(CodeExecution, {
    props: {
      part,
      skippedFiles: skippedFiles as never,
      fallbackKey: 'm1-0',
    },
  })
}

beforeEach(() => {
  useSidePanel().close()
})

afterEach(() => {
  useSidePanel().close()
})

describe('ChatCodeExecution', () => {
  it('shows the language badge, a success return code and the code preview',
    async () => {
      const wrapper = await mountCard(donePart())

      expect(wrapper.get('[data-testid="code-execution-language"]').text())
        .toBe('Python')
      expect(wrapper.get('[data-testid="code-execution-language"]').classes())
        .toEqual(expect.arrayContaining(['badge', 'badge-soft']))

      const returnCode = wrapper.get('[data-testid="code-execution-return-code"]')

      expect(returnCode.text()).toBe('Exit 0')
      expect(returnCode.classes()).toContain('badge-success')
      expect(returnCode.attributes('aria-label')).toBe('Exit code 0')
      expect(wrapper.get('[data-testid="code-execution-preview"]').text())
        .toBe('print(1)')
      expect(wrapper.find('[data-testid="code-execution-details"]').exists())
        .toBe(false)
    })

  it('shows an error tone for a non-zero return code', async () => {
    const wrapper = await mountCard(donePart({ returnCode: 1 }))
    const returnCode = wrapper.get('[data-testid="code-execution-return-code"]')

    expect(returnCode.text()).toBe('Exit 1')
    expect(returnCode.classes()).toContain('badge-error')
  })

  it('omits the return code when there is none', async () => {
    const wrapper = await mountCard(donePart({ returnCode: null }))

    expect(wrapper.find('[data-testid="code-execution-return-code"]').exists())
      .toBe(false)
  })

  it('cuts the preview at four lines and expands to the full code',
    async () => {
      const wrapper = await mountCard(donePart({}, { code: LONG_CODE }))

      expect(wrapper.get('[data-testid="code-execution-preview"]').text())
        .toBe(LONG_CODE.split('\n').slice(0, 4).join('\n'))
      expect(wrapper.get('[data-testid="code-execution-show-more"]').text())
        .toBe('Show 2 more lines')

      await wrapper.get('[data-testid="code-execution-show-more"]')
        .trigger('click')

      expect(wrapper.find('[data-testid="code-execution-preview"]').exists())
        .toBe(false)
      expect(wrapper.get('[data-testid="code-execution-code"]').text())
        .toContain('print("done")')
    })

  it('toggles details with an accessible expand button', async () => {
    const wrapper = await mountCard(donePart())
    const toggle = wrapper.get('[data-testid="code-execution-toggle"]')

    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(toggle.attributes('aria-label')).toBe(
      'Show code execution details',
    )

    await toggle.trigger('click')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(toggle.attributes('aria-controls')).toBe(
      wrapper.get('[data-testid="code-execution-details"]').attributes('id'),
    )
    expect(wrapper.get('[data-testid="code-execution-output"]').text())
      .toBe('1')
  })

  it('has no Errors tab when stderr is empty', async () => {
    const wrapper = await mountCard(donePart())

    await wrapper.get('[data-testid="code-execution-toggle"]')
      .trigger('click')

    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="code-execution-tab-errors"]').exists())
      .toBe(false)
  })

  it('offers Output and Errors tabs when stderr is not empty', async () => {
    const wrapper = await mountCard(donePart({
      stdout: 'partial\n',
      stderr: 'Traceback: boom',
      returnCode: 1,
    }))

    await wrapper.get('[data-testid="code-execution-toggle"]')
      .trigger('click')

    const tabs = wrapper.findAll('[role="tab"]')

    expect(tabs.map(tab => tab.text())).toEqual(['Output', 'Errors'])
    expect(tabs[0]!.attributes('aria-selected')).toBe('true')
    expect(tabs[0]!.attributes('tabindex')).toBe('0')
    expect(tabs[1]!.attributes('tabindex')).toBe('-1')
    expect(wrapper.get('[role="tabpanel"]').attributes('aria-labelledby'))
      .toBe(tabs[0]!.attributes('id'))

    await tabs[1]!.trigger('click')

    expect(wrapper.findAll('[role="tab"]')[1]!.attributes('aria-selected'))
      .toBe('true')
    expect(wrapper.get('[data-testid="code-execution-errors"]').text())
      .toBe('Traceback: boom')
  })

  it('moves between tabs with the arrow keys', async () => {
    const wrapper = await mountCard(donePart({
      stdout: 'x',
      stderr: 'bad',
      returnCode: 1,
    }))

    await wrapper.get('[data-testid="code-execution-toggle"]')
      .trigger('click')
    await wrapper.get('[role="tablist"]').trigger('keydown', {
      key: 'ArrowRight',
    })

    expect(wrapper.get('[data-testid="code-execution-tab-errors"]')
      .attributes('aria-selected')).toBe('true')

    await wrapper.get('[role="tablist"]').trigger('keydown', {
      key: 'ArrowLeft',
    })

    expect(wrapper.get('[data-testid="code-execution-tab-output"]')
      .attributes('aria-selected')).toBe('true')
  })

  it('opens on Errors when there is no stdout', async () => {
    const wrapper = await mountCard(donePart({
      stdout: '',
      stderr: 'only errors',
      returnCode: 2,
    }))

    await wrapper.get('[data-testid="code-execution-toggle"]')
      .trigger('click')

    expect(wrapper.get('[data-testid="code-execution-errors"]').text())
      .toBe('only errors')
  })

  it('shows truncation notices for code, output and errors', async () => {
    const wrapper = await mountCard(donePart(
      {
        stdout: 'out\n[truncated]',
        stderr: 'err\n[truncated]',
        stdoutTruncated: true,
        stderrTruncated: true,
        returnCode: 1,
      },
      { codeTruncated: true },
    ))

    await wrapper.get('[data-testid="code-execution-toggle"]')
      .trigger('click')

    expect(wrapper.get('[data-testid="code-execution-code-truncated"]').text())
      .toBe('Code was truncated to 32 KB.')
    expect(wrapper.get('[data-testid="code-execution-output-truncated"]').text())
      .toBe('Output was truncated to 32 KB.')

    await wrapper.get('[data-testid="code-execution-tab-errors"]')
      .trigger('click')

    expect(wrapper.get('[data-testid="code-execution-errors-truncated"]').text())
      .toBe('Output was truncated to 32 KB.')
  })

  it('shows a polite status and a disabled Open button while running',
    async () => {
      const wrapper = await mountCard({
        type: 'tool-code_execution',
        toolCallId: 'call_2',
        state: 'input-available',
        input: { language: 'bash', code: 'sleep 5' },
      })
      const status = wrapper.get('[data-testid="code-execution-status"]')

      expect(status.attributes('role')).toBe('status')
      expect(status.attributes('aria-live')).toBe('polite')
      expect(status.text()).toBe('Running code…')
      expect(wrapper.get('[data-testid="code-execution-language"]').text())
        .toBe('Bash')
      expect(wrapper.get('[data-testid="code-execution-open"]')
        .attributes('disabled')).toBeDefined()
      expect(wrapper.text()).not.toMatch(/\d+\s?%/)
    })

  it('shows the provider error for an output-error part', async () => {
    const wrapper = await mountCard({
      type: 'tool-code_execution',
      toolCallId: 'call_3',
      state: 'output-error',
      input: { language: 'python', code: 'print(1)' },
      errorText: 'The provider refused to run this code.',
    })

    expect(wrapper.get('[data-testid="code-execution-status"]').text())
      .toBe('The provider did not run this code')
    expect(wrapper.get('[data-testid="code-execution-error-summary"]').text())
      .toBe('The provider refused to run this code.')

    await wrapper.get('[data-testid="code-execution-toggle"]')
      .trigger('click')

    expect(wrapper.get('[data-testid="code-execution-errors"]').text())
      .toBe('The provider refused to run this code.')
    expect(wrapper.find('[data-testid="code-execution-error-summary"]').exists())
      .toBe(false)
  })

  it('lists skipped files with the reason text', async () => {
    const wrapper = await mountCard(donePart(), [
      { filename: 'huge.csv', reason: 'too-large' },
      { filename: 'run.exe', reason: 'type-not-allowed' },
    ])
    const items = wrapper.findAll('[data-testid="code-execution-skipped-item"]')

    expect(wrapper.get('[data-testid="code-execution-skipped"]').text())
      .toContain('2 files were not saved')
    expect(items).toHaveLength(2)
    expect(items[0]!.text()).toContain('huge.csv')
    expect(items[0]!.text()).toContain('file not saved: larger than 20 MB')
    expect(items[1]!.text()).toContain('file not saved: type not allowed')
  })

  it('renders no skipped list when every file was saved', async () => {
    const wrapper = await mountCard(donePart())

    expect(wrapper.find('[data-testid="code-execution-skipped"]').exists())
      .toBe(false)
  })

  it('opens the full code and output in the shared side panel', async () => {
    const wrapper = await mountCard(donePart({
      stdout: 'result',
      stderr: 'warn',
      returnCode: 1,
    }, { code: LONG_CODE }))
    const sidePanel = useSidePanel()

    await wrapper.get('[data-testid="code-execution-open"]').trigger('click')

    expect(sidePanel.isOpen.value).toBe(true)
    expect(sidePanel.viewKey.value).toBe('code-execution:call_1')
    expect(sidePanel.title.value).toBe('Code execution')
    expect(sidePanel.currentView.value?.props?.view).toMatchObject({
      code: LONG_CODE,
      stdout: 'result',
      stderr: 'warn',
      returnCode: 1,
    })
    expect(wrapper.get('[data-testid="code-execution-open"]')
      .attributes('aria-current')).toBe('true')

    sidePanel.close()
    await wrapper.vm.$nextTick()

    expect(sidePanel.isOpen.value).toBe(false)
  })

  it('falls back to the given key when the part has no tool call id',
    async () => {
      const part = donePart()
      const wrapper = await mountCard({ ...part, toolCallId: undefined })

      await wrapper.get('[data-testid="code-execution-open"]')
        .trigger('click')

      expect(useSidePanel().viewKey.value).toBe('code-execution:m1-0')
    })

  it('renders nothing for a part that is not a code execution part',
    async () => {
      const wrapper = await mountCard({ type: 'text', text: 'hi' })

      expect(wrapper.find('[data-testid="code-execution-card"]').exists())
        .toBe(false)
    })
})
