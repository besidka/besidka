import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { CodeExecutionView } from '#shared/utils/code-execution'
import Detail from '../../../../../app/components/Chat/CodeExecution/Detail.vue'

enableAutoUnmount(afterEach)

function createView(
  overrides: Partial<CodeExecutionView> = {},
): CodeExecutionView {
  return {
    state: 'done',
    language: 'python',
    code: 'print(1)',
    codeTruncated: false,
    stdout: '1',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    returnCode: 0,
    errorText: null,
    ...overrides,
  }
}

describe('ChatCodeExecutionDetail', () => {
  it('shows the full code, the output and the return code', async () => {
    const wrapper = await mountSuspended(Detail, {
      props: { view: createView() },
    })

    expect(wrapper.get('[data-testid="code-execution-detail-code"]').text())
      .toBe('print(1)')
    expect(wrapper.get('[data-testid="code-execution-detail-output"]').text())
      .toBe('1')
    expect(wrapper.get('[data-testid="code-execution-detail-return-code"]')
      .text()).toBe('Exit 0')
    expect(wrapper.find('[data-testid="code-execution-detail-errors"]')
      .exists()).toBe(false)
  })

  it('shows errors, the error text and truncation notices', async () => {
    const wrapper = await mountSuspended(Detail, {
      props: {
        view: createView({
          state: 'error',
          stderr: 'Traceback',
          errorText: 'Provider failed',
          stderrTruncated: true,
          codeTruncated: true,
          returnCode: 1,
        }),
      },
    })

    expect(wrapper.get('[data-testid="code-execution-detail-errors"]').text())
      .toContain('Traceback')
    expect(wrapper.get('[data-testid="code-execution-detail-errors"]').text())
      .toContain('Provider failed')
    expect(wrapper.get(
      '[data-testid="code-execution-detail-errors-truncated"]',
    ).text()).toBe('Output was truncated to 32 KB.')
    expect(wrapper.get(
      '[data-testid="code-execution-detail-code-truncated"]',
    ).text()).toBe('Code was truncated to 32 KB.')
    expect(wrapper.get('[data-testid="code-execution-detail-return-code"]')
      .classes()).toContain('badge-error')
  })

  it('says so when there is no output', async () => {
    const wrapper = await mountSuspended(Detail, {
      props: { view: createView({ stdout: '', returnCode: null }) },
    })

    expect(wrapper.get('[data-testid="code-execution-detail-output"]').text())
      .toBe('No output.')
    expect(wrapper.find('[data-testid="code-execution-detail-return-code"]')
      .exists()).toBe(false)
  })
})
