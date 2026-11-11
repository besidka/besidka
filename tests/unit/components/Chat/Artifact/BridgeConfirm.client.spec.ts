import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ARTIFACT_BRIDGE_PROMPT_MAX,
  ARTIFACT_BRIDGE_SYSTEM_PREFIX,
  buildArtifactBridgeSystem,
} from '#shared/utils/artifacts'
import type { ArtifactBridgeInfo } from '#shared/utils/artifacts'
import type { PendingArtifactCompletion } from '../../../../../app/composables/artifact-bridge'
import {
  estimateArtifactBridgeMaxCost,
  formatArtifactBridgeCost,
} from '../../../../../app/utils/artifact-bridge'
import BridgeConfirm from '../../../../../app/components/Chat/Artifact/BridgeConfirm.client.vue'

enableAutoUnmount(afterEach)

const LUNA = {
  id: 'gpt-6-luna',
  name: 'GPT-6 Luna',
  providerId: 'openai',
  providerName: 'OpenAI',
  inputPricePerMillion: 0.1,
  outputPricePerMillion: 0.5,
}

const HAIKU = {
  id: 'claude-haiku-5-5',
  name: 'Claude Haiku 5.5',
  providerId: 'anthropic',
  providerName: 'Anthropic',
  inputPricePerMillion: 0.1,
  outputPricePerMillion: 0.5,
}

const PRICEY = {
  id: 'pricey-model',
  name: 'Pricey',
  providerId: 'google',
  providerName: 'Google AI Studio',
  inputPricePerMillion: 1000,
  outputPricePerMillion: 1000,
}

const UNPRICED = {
  id: 'unpriced-model',
  name: 'Unpriced',
  providerId: 'xai',
  providerName: 'xAI',
  inputPricePerMillion: null,
  outputPricePerMillion: null,
}

const INFO: ArtifactBridgeInfo = {
  models: [LUNA, HAIKU, PRICEY, UNPRICED],
  defaultModelId: HAIKU.id,
  remaining: { hour: 12, day: 150 },
  limits: { hour: 30, day: 200 },
}

function createPending(
  overrides: Partial<PendingArtifactCompletion> = {},
): PendingArtifactCompletion {
  return {
    artifactId: 'art_1',
    title: 'Photosynthesis quiz',
    prompt: 'Explain photosynthesis',
    system: undefined,
    maxOutputTokens: 1000,
    allowRemember: true,
    info: INFO,
    infoError: null,
    isLoadingInfo: false,
    isRunning: false,
    error: null,
    lastFailure: null,
    ...overrides,
  }
}

function byTestId(testId: string) {
  return `[data-testid="${testId}"]`
}

const ARMING_DELAY_MS = 700
const OPENED_AT = 1_000_000

async function pressAllow(
  wrapper: Awaited<ReturnType<typeof mountConfirm>>,
  options: { pointer?: boolean, waitMs?: number } = {},
) {
  const { pointer = true, waitMs = ARMING_DELAY_MS + 100 } = options
  const button = wrapper.find(byTestId('artifact-bridge-allow'))

  vi.setSystemTime(Date.now() + waitMs)

  if (pointer) {
    await button.trigger('pointerdown')
  }

  await button.trigger('click', { detail: pointer ? 1 : 0 })
}

async function mountConfirm(
  overrides: Partial<PendingArtifactCompletion> = {},
) {
  return await mountSuspended(BridgeConfirm, {
    attachTo: document.body,
    props: { pending: createPending(overrides) },
    global: {
      stubs: {
        teleport: true,
        NuxtLink: {
          props: ['to'],
          template: '<a :href="to"><slot /></a>',
        },
      },
    },
  })
}

describe('Chat/Artifact/BridgeConfirm.client', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(OPENED_AT)
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(() => {})
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('what the viewer reads', () => {
    it('opens as a modal dialog and names the artifact', async () => {
      const wrapper = await mountConfirm()

      expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1)
      expect(wrapper.find(byTestId('artifact-bridge-modal')).exists())
        .toBe(true)
      expect(wrapper.find(byTestId('artifact-bridge-artifact-title')).text())
        .toContain('Photosynthesis quiz')
    })

    it('says the author wrote the prompt, not the viewer', async () => {
      const wrapper = await mountConfirm()

      expect(wrapper.find(byTestId('artifact-bridge-author-note')).text())
        .toContain('The author of this artifact wrote these prompts')
    })

    it('shows a prompt of 8,000 characters in full', async () => {
      const prompt = `${'a'.repeat(ARTIFACT_BRIDGE_PROMPT_MAX - 3)}END`
      const wrapper = await mountConfirm({ prompt })
      const shown = wrapper.find(byTestId('artifact-bridge-prompt')).text()

      expect(prompt).toHaveLength(ARTIFACT_BRIDGE_PROMPT_MAX)
      expect(shown).toBe(prompt)
      expect(shown.endsWith('END')).toBe(true)
      expect(wrapper.text()).toContain('Prompt (8,000 characters, 1 line)')
    })

    it('counts the lines of the prompt, one in the singular', async () => {
      const single = await mountConfirm({ prompt: 'x' })

      expect(single.text()).toContain('1 line)')
      expect(single.text()).not.toContain('1 lines')

      const multiple = await mountConfirm({ prompt: 'a\nb\nc' })

      expect(multiple.text()).toContain('Prompt (5 characters, 3 lines)')
    })

    it('collapses long runs of empty lines into a visible note', async () => {
      const wrapper = await mountConfirm({
        prompt: 'Harmless\n\n\n\n\n\nReal instruction',
      })

      expect(wrapper.find(byTestId('artifact-bridge-prompt')).text())
        .toBe('Harmless\n[5 empty lines]\nReal instruction')
    })

    it('keeps one or two empty lines as they are', async () => {
      const prompt = 'One\n\nTwo\n\n\nThree'
      const wrapper = await mountConfirm({ prompt })

      expect(wrapper.find(byTestId('artifact-bridge-prompt')).element
        .textContent).toBe(prompt)
    })

    it('collapses a long run of spaces into a visible note', async () => {
      const wrapper = await mountConfirm({
        prompt: `Harmless${' '.repeat(40)}Real instruction`,
        system: `Quiet${'\u00A0'.repeat(20)}text`,
      })

      expect(wrapper.find(byTestId('artifact-bridge-prompt')).text())
        .toBe('Harmless[40 spaces]Real instruction')
      expect(wrapper.find(byTestId('artifact-bridge-system')).text())
        .toContain('Quiet[20 spaces]text')
    })

    it('shows the artifact title with hidden characters revealed inside '
      + 'an isolating wrapper', async () => {
      const wrapper = await mountConfirm({ title: 'Quiz\u202Egnp.exe' })
      const shown = wrapper.find(byTestId('artifact-bridge-artifact-title'))

      expect(shown.find('bdi').text()).toBe('Quiz[U+202E]gnp.exe')
      expect(shown.text()).toContain('wants to ask an AI model')
    })

    it('shows the newly covered invisible code points as markers',
      async () => {
        const wrapper = await mountConfirm({
          prompt: 'a\u061Cb\u180Bc\uFFF9d\u{1D173}e',
        })

        expect(wrapper.find(byTestId('artifact-bridge-prompt')).text())
          .toBe('a[U+061C]b[U+180B]c[U+FFF9]d[U+1D173]e')
      })

    it('keeps the prompt line breaks and spaces', async () => {
      const prompt = 'Line one\n\n  indented line\ttabbed'
      const wrapper = await mountConfirm({ prompt })

      expect(wrapper.find(byTestId('artifact-bridge-prompt')).element
        .textContent).toBe(prompt)
    })

    it('shows the fixed Besidka prefix as the whole system text when '
      + 'the artifact gave none', async () => {
      const wrapper = await mountConfirm()

      expect(wrapper.find(byTestId('artifact-bridge-system')).text())
        .toBe(ARTIFACT_BRIDGE_SYSTEM_PREFIX)
    })

    it('shows the prefix and the artifact system text exactly as sent',
      async () => {
        const wrapper = await mountConfirm({ system: 'Answer in French.' })
        const shown = wrapper.find(byTestId('artifact-bridge-system')).text()

        expect(shown.startsWith(ARTIFACT_BRIDGE_SYSTEM_PREFIX)).toBe(true)
        expect(shown).toBe(buildArtifactBridgeSystem('Answer in French.'))
        expect(shown.endsWith('\n\nAnswer in French.')).toBe(true)
      })

    it('shows hidden and direction-changing characters as markers',
      async () => {
        const wrapper = await mountConfirm({
          prompt: 'Pay ‮nothing‬ now​',
          system: 'Ignore﻿this',
        })

        expect(wrapper.find(byTestId('artifact-bridge-prompt')).text())
          .toBe('Pay [U+202E]nothing[U+202C] now[U+200B]')
        expect(wrapper.find(byTestId('artifact-bridge-system')).text())
          .toContain('Ignore[U+FEFF]this')
      })

    it('renders prompt, system and title as text, never as markup',
      async () => {
        const wrapper = await mountConfirm({
          title: '<img src=x onerror=alert(1)>',
          prompt: '<script>alert(1)</script><b>bold</b>',
          system: '<i>italic</i>',
        })

        expect(wrapper.find('img').exists()).toBe(false)
        expect(wrapper.find('script').exists()).toBe(false)
        expect(wrapper.find('b').exists()).toBe(false)
        expect(wrapper.find('i').exists()).toBe(false)
        expect(wrapper.find(byTestId('artifact-bridge-prompt')).text())
          .toBe('<script>alert(1)</script><b>bold</b>')
      })
  })

  describe('models', () => {
    it('lists every model with its provider name', async () => {
      const wrapper = await mountConfirm()
      const labels = wrapper.findAll(`${byTestId('artifact-bridge-model')} option`)
        .map((option) => {
          return option.text()
        })

      expect(labels).toEqual([
        'OpenAI · GPT-6 Luna',
        'Anthropic · Claude Haiku 5.5',
        'Google AI Studio · Pricey',
        'xAI · Unpriced',
      ])
    })

    it('selects the default model from the server', async () => {
      const wrapper = await mountConfirm()
      const select = wrapper.find(byTestId('artifact-bridge-model'))

      expect((select.element as HTMLSelectElement).value).toBe(HAIKU.id)
    })

    it('falls back to the first model without a default', async () => {
      const wrapper = await mountConfirm({
        info: { ...INFO, defaultModelId: null },
      })
      const select = wrapper.find(byTestId('artifact-bridge-model'))

      expect((select.element as HTMLSelectElement).value).toBe(LUNA.id)
    })

    it('selects the default once the models arrive', async () => {
      const wrapper = await mountConfirm({ info: null, isLoadingInfo: true })

      expect(wrapper.find(byTestId('artifact-bridge-model')).exists())
        .toBe(false)

      await wrapper.setProps({ pending: createPending() })

      expect((wrapper.find(byTestId('artifact-bridge-model')).element as
        HTMLSelectElement).value).toBe(HAIKU.id)
    })

    it('keeps the viewer choice when the pending state changes', async () => {
      const wrapper = await mountConfirm()
      const select = wrapper.find(byTestId('artifact-bridge-model'))

      await select.setValue(PRICEY.id)
      await wrapper.setProps({ pending: createPending({ isRunning: true }) })

      expect((wrapper.find(byTestId('artifact-bridge-model')).element as
        HTMLSelectElement).value).toBe(PRICEY.id)
    })
  })

  describe('cost and limits', () => {
    function costLine(wrapper: Awaited<ReturnType<typeof mountConfirm>>) {
      return wrapper.find(byTestId('artifact-bridge-cost')).text()
    }

    it('shows an upper cost estimate for the selected model', async () => {
      const prompt = 'x'.repeat(500)
      const wrapper = await mountConfirm({ prompt, maxOutputTokens: 2000 })
      const expected = formatArtifactBridgeCost(
        estimateArtifactBridgeMaxCost(
          HAIKU,
          prompt.length + ARTIFACT_BRIDGE_SYSTEM_PREFIX.length,
          2000,
        ),
      )

      expect(costLine(wrapper)).toContain(`Maximum cost: ${expected}`)
      expect(costLine(wrapper)).toContain('billed by Anthropic to your key')
    })

    it('says under one cent for a cheap model and a short prompt',
      async () => {
        const wrapper = await mountConfirm()

        expect(costLine(wrapper)).toContain('Maximum cost: under $0.01')
      })

    it('counts the artifact system text in the input size', async () => {
      const wrapper = await mountConfirm({
        info: { ...INFO, defaultModelId: PRICEY.id },
        prompt: 'x'.repeat(100),
        system: 'y'.repeat(1000),
        maxOutputTokens: 1,
      })
      const expected = formatArtifactBridgeCost(
        estimateArtifactBridgeMaxCost(
          PRICEY,
          100 + buildArtifactBridgeSystem('y'.repeat(1000)).length,
          1,
        ),
      )

      expect(costLine(wrapper)).toContain(expected)
    })

    it('updates the cost and provider when the model changes', async () => {
      const wrapper = await mountConfirm()

      await wrapper.find(byTestId('artifact-bridge-model'))
        .setValue(PRICEY.id)

      expect(costLine(wrapper)).toContain('about $')
      expect(costLine(wrapper)).toContain('billed by Google AI Studio')
    })

    it('says the price is unknown for a model without a published price',
      async () => {
        const wrapper = await mountConfirm()

        await wrapper.find(byTestId('artifact-bridge-model'))
          .setValue(UNPRICED.id)

        expect(costLine(wrapper))
          .toContain('unknown (no published price)')
      })

    it('shows the output token budget', async () => {
      const wrapper = await mountConfirm({ maxOutputTokens: 2000 })

      expect(wrapper.find(byTestId('artifact-bridge-tokens')).text())
        .toBe('At most 2,000 output tokens')
    })

    it('shows the remaining hourly and daily calls', async () => {
      const wrapper = await mountConfirm()

      expect(wrapper.find(byTestId('artifact-bridge-remaining')).text())
        .toBe(
          '12 of 30 requests left this hour for this artifact, '
          + '150 of 200 today',
        )
    })

    it('names the provider terms that apply', async () => {
      const wrapper = await mountConfirm()

      expect(wrapper.find(byTestId('artifact-bridge-facts')).text())
        .toContain('Anthropic\'s terms apply to this request')
    })
  })

  describe('remember checkbox', () => {
    it('is shown when the artifact may be remembered', async () => {
      const wrapper = await mountConfirm({ allowRemember: true })

      expect(wrapper.find(byTestId('artifact-bridge-remember')).exists())
        .toBe(true)
    })

    it('says later requests are sent without showing them', async () => {
      const wrapper = await mountConfirm()
      const label = wrapper
        .find('label:has([data-testid="artifact-bridge-remember"])')
        .text()

      expect(label).toContain('until I close it')
      expect(label).toContain('sent without showing them')
      expect(label).toContain('up to 12 more this hour')
    })

    it('is hidden when remembering is not allowed', async () => {
      const wrapper = await mountConfirm({ allowRemember: false })

      expect(wrapper.find(byTestId('artifact-bridge-remember')).exists())
        .toBe(false)
    })

    it('starts unticked', async () => {
      const wrapper = await mountConfirm()

      expect((wrapper.find(byTestId('artifact-bridge-remember')).element as
        HTMLInputElement).checked).toBe(false)
    })
  })

  describe('buttons', () => {
    it('focuses Cancel when the modal opens', async () => {
      const wrapper = await mountConfirm()

      await vi.waitFor(() => {
        expect(document.activeElement)
          .toBe(wrapper.find(byTestId('artifact-bridge-cancel')).element)
      })
    })

    it('emits cancel from the Cancel button', async () => {
      const wrapper = await mountConfirm()

      await wrapper.find(byTestId('artifact-bridge-cancel')).trigger('click')

      expect(wrapper.emitted('cancel')).toHaveLength(1)
      expect(wrapper.emitted('allow')).toBeUndefined()
    })

    it('emits cancel when the browser asks to close the dialog',
      async () => {
        const wrapper = await mountConfirm()
        const dialog = wrapper.find(byTestId('artifact-bridge-modal'))
        const event = new Event('cancel', { cancelable: true })

        dialog.element.dispatchEvent(event)

        expect(event.defaultPrevented).toBe(true)
        expect(wrapper.emitted('cancel')).toHaveLength(1)
      })

    it('closes the dialog when the component goes away', async () => {
      const wrapper = await mountConfirm()

      wrapper.unmount()

      expect(HTMLDialogElement.prototype.close).toHaveBeenCalled()
    })

    it('emits allow with the default model and remember off', async () => {
      const wrapper = await mountConfirm()

      await pressAllow(wrapper)

      expect(wrapper.emitted('allow')).toEqual([[HAIKU.id, false]])
    })

    it('emits allow with the chosen model and the ticked checkbox',
      async () => {
        const wrapper = await mountConfirm()

        await wrapper.find(byTestId('artifact-bridge-model'))
          .setValue(LUNA.id)
        await wrapper.find(byTestId('artifact-bridge-remember'))
          .setValue(true)
        await pressAllow(wrapper)

        expect(wrapper.emitted('allow')).toEqual([[LUNA.id, true]])
      })

    it('shows Try again instead of Allow after an error', async () => {
      const wrapper = await mountConfirm({
        error: { message: 'The model request failed' },
      })

      expect(wrapper.find(byTestId('artifact-bridge-allow')).text())
        .toBe('Try again')
    })

    it('says Allow without an error', async () => {
      const wrapper = await mountConfirm()

      expect(wrapper.find(byTestId('artifact-bridge-allow')).text())
        .toBe('Allow')
    })
  })

  describe('Allow arming', () => {
    it('ignores a keyboard click within 700 ms of Allow becoming usable',
      async () => {
        const wrapper = await mountConfirm()

        await pressAllow(wrapper, {
          pointer: false,
          waitMs: ARMING_DELAY_MS - 100,
        })

        expect(wrapper.emitted('allow')).toBeUndefined()
      })

    it('accepts a keyboard click after 700 ms', async () => {
      const wrapper = await mountConfirm()

      await pressAllow(wrapper, { pointer: false })

      expect(wrapper.emitted('allow')).toEqual([[HAIKU.id, false]])
    })

    it('ignores a pointer click within 700 ms as well', async () => {
      const wrapper = await mountConfirm()

      await pressAllow(wrapper, { waitMs: ARMING_DELAY_MS - 100 })

      expect(wrapper.emitted('allow')).toBeUndefined()
    })

    it('accepts a pointer click after 700 ms when the press started on '
      + 'Allow', async () => {
      const wrapper = await mountConfirm()

      await pressAllow(wrapper)

      expect(wrapper.emitted('allow')).toEqual([[HAIKU.id, false]])
    })

    it('ignores a pointer click without a pointerdown on Allow',
      async () => {
        const wrapper = await mountConfirm()

        vi.setSystemTime(OPENED_AT + 5_000)
        await wrapper.find(byTestId('artifact-bridge-allow'))
          .trigger('click', { detail: 1 })

        expect(wrapper.emitted('allow')).toBeUndefined()
      })

    it('needs a new pointerdown for every pointer click', async () => {
      const wrapper = await mountConfirm()

      await pressAllow(wrapper)
      await wrapper.find(byTestId('artifact-bridge-allow'))
        .trigger('click', { detail: 1 })

      expect(wrapper.emitted('allow')).toHaveLength(1)
    })

    it('starts counting again when Allow becomes usable again', async () => {
      const wrapper = await mountConfirm()

      vi.setSystemTime(OPENED_AT + 5_000)
      await wrapper.setProps({ pending: createPending({ isRunning: true }) })
      await wrapper.setProps({ pending: createPending() })
      await wrapper.find(byTestId('artifact-bridge-allow'))
        .trigger('pointerdown')
      await wrapper.find(byTestId('artifact-bridge-allow'))
        .trigger('click', { detail: 1 })

      expect(wrapper.emitted('allow')).toBeUndefined()

      await pressAllow(wrapper)

      expect(wrapper.emitted('allow')).toHaveLength(1)
    })

    it('counts from the moment the models arrive, not from the mount',
      async () => {
        const wrapper = await mountConfirm({
          info: null,
          isLoadingInfo: true,
        })

        vi.setSystemTime(OPENED_AT + 10_000)
        await wrapper.setProps({ pending: createPending() })
        await wrapper.find(byTestId('artifact-bridge-allow'))
          .trigger('pointerdown')
        await wrapper.find(byTestId('artifact-bridge-allow'))
          .trigger('click', { detail: 0 })

        expect(wrapper.emitted('allow')).toBeUndefined()

        await pressAllow(wrapper)

        expect(wrapper.emitted('allow')).toHaveLength(1)
      })

    it('never guards Cancel', async () => {
      const wrapper = await mountConfirm()

      vi.setSystemTime(OPENED_AT + 10)
      await wrapper.find(byTestId('artifact-bridge-cancel'))
        .trigger('click', { detail: 0 })

      expect(wrapper.emitted('cancel')).toHaveLength(1)
    })
  })

  describe('native close event', () => {
    it('opens the dialog again while the call runs', async () => {
      const wrapper = await mountConfirm({ isRunning: true })

      wrapper.find(byTestId('artifact-bridge-modal')).element
        .dispatchEvent(new Event('close'))

      expect(HTMLDialogElement.prototype.showModal)
        .toHaveBeenCalledTimes(2)
      expect(wrapper.emitted('cancel')).toBeUndefined()
    })

    it('emits cancel when nothing is running', async () => {
      const wrapper = await mountConfirm()

      wrapper.find(byTestId('artifact-bridge-modal')).element
        .dispatchEvent(new Event('close'))

      expect(HTMLDialogElement.prototype.showModal)
        .toHaveBeenCalledTimes(1)
      expect(wrapper.emitted('cancel')).toHaveLength(1)
    })

    it('does nothing when the close comes from unmounting', async () => {
      vi.mocked(HTMLDialogElement.prototype.close)
        .mockImplementation(function (this: HTMLDialogElement) {
          this.dispatchEvent(new Event('close'))
        })

      const wrapper = await mountConfirm()

      wrapper.unmount()

      expect(wrapper.emitted('cancel')).toBeUndefined()
      expect(HTMLDialogElement.prototype.showModal)
        .toHaveBeenCalledTimes(1)
    })
  })

  describe('states that block Allow', () => {
    function allowButton(wrapper: Awaited<ReturnType<typeof mountConfirm>>) {
      return wrapper.find(byTestId('artifact-bridge-allow'))
    }

    it('disables Allow and shows a skeleton while loading', async () => {
      const wrapper = await mountConfirm({
        info: null,
        isLoadingInfo: true,
      })

      expect(allowButton(wrapper).attributes('disabled')).toBeDefined()
      expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
      expect(wrapper.find(byTestId('artifact-bridge-model')).exists())
        .toBe(false)
    })

    it('shows the load error and disables Allow', async () => {
      const wrapper = await mountConfirm({
        info: null,
        infoError: { message: 'Could not load models' },
      })

      expect(wrapper.find(byTestId('artifact-bridge-info-error')).text())
        .toBe('Could not load models')
      expect(allowButton(wrapper).attributes('disabled')).toBeDefined()
    })

    it('shows the no-key state with a link to the API keys page',
      async () => {
        const wrapper = await mountConfirm({
          info: { ...INFO, models: [], defaultModelId: null },
        })
        const noKey = wrapper.find(byTestId('artifact-bridge-no-key'))

        expect(noKey.text()).toContain('This needs a direct provider key')
        expect(noKey.find('a').attributes('href')).toBe('/profile/keys')
        expect(wrapper.find(byTestId('artifact-bridge-model')).exists())
          .toBe(false)
        expect(allowButton(wrapper).attributes('disabled')).toBeDefined()
      })

    it('does not emit allow from the disabled no-key state', async () => {
      const wrapper = await mountConfirm({
        info: { ...INFO, models: [], defaultModelId: null },
      })

      await pressAllow(wrapper)

      expect(wrapper.emitted('allow')).toBeUndefined()
    })

    it('disables Allow when no hourly request is left', async () => {
      const wrapper = await mountConfirm({
        info: { ...INFO, remaining: { hour: 0, day: 150 } },
      })

      expect(allowButton(wrapper).attributes('disabled')).toBeDefined()
      expect(wrapper.find(byTestId('artifact-bridge-remaining')).text())
        .toContain('0 of 30 requests left this hour')
    })

    it('disables Allow when no daily request is left', async () => {
      const wrapper = await mountConfirm({
        info: { ...INFO, remaining: { hour: 12, day: 0 } },
      })

      expect(allowButton(wrapper).attributes('disabled')).toBeDefined()
    })

    it('does not emit allow when the click reaches a blocked button',
      async () => {
        const wrapper = await mountConfirm({
          info: { ...INFO, remaining: { hour: 0, day: 0 } },
        })

        vi.setSystemTime(OPENED_AT + 5_000)
        allowButton(wrapper).element.dispatchEvent(
          new MouseEvent('pointerdown', { bubbles: true }),
        )
        allowButton(wrapper).element.dispatchEvent(
          new MouseEvent('click', { detail: 1, bubbles: true }),
        )

        expect(wrapper.emitted('allow')).toBeUndefined()
      })

    it('locks everything while the call runs', async () => {
      const wrapper = await mountConfirm({ isRunning: true })

      expect(allowButton(wrapper).attributes('disabled')).toBeDefined()
      expect(wrapper.find(byTestId('artifact-bridge-cancel'))
        .attributes('disabled')).toBeDefined()
      expect(wrapper.find(byTestId('artifact-bridge-model'))
        .attributes('disabled')).toBeDefined()
      expect(wrapper.find(byTestId('artifact-bridge-remember'))
        .attributes('disabled')).toBeDefined()
      expect(wrapper.find('.loading-spinner').exists()).toBe(true)
    })

    it('does not emit cancel while the call runs', async () => {
      const wrapper = await mountConfirm({ isRunning: true })
      const event = new Event('cancel', { cancelable: true })

      wrapper.find(byTestId('artifact-bridge-modal')).element
        .dispatchEvent(event)

      expect(event.defaultPrevented).toBe(true)
      expect(wrapper.emitted('cancel')).toBeUndefined()
    })
  })

  describe('inline error', () => {
    it('shows the message and the reason', async () => {
      const wrapper = await mountConfirm({
        error: {
          message: 'The model request failed',
          why: 'The provider is unavailable',
        },
      })
      const error = wrapper.find(byTestId('artifact-bridge-error'))

      expect(error.text()).toContain('The model request failed')
      expect(error.text()).toContain('The provider is unavailable')
      expect(error.find('a').exists()).toBe(false)
    })

    it('links to more information when the server gave a link', async () => {
      const wrapper = await mountConfirm({
        error: {
          message: 'Consent is required',
          link: '/privacy-policy#transfers-outside-the-eu',
        },
      })
      const link = wrapper.find(`${byTestId('artifact-bridge-error')} a`)

      expect(link.text()).toBe('Learn more')
      expect(link.attributes('href'))
        .toBe('/privacy-policy#transfers-outside-the-eu')
    })

    it('is absent without an error', async () => {
      const wrapper = await mountConfirm()

      expect(wrapper.find(byTestId('artifact-bridge-error')).exists())
        .toBe(false)
    })

    it('keeps the Allow button usable for a retry', async () => {
      const wrapper = await mountConfirm({
        error: { message: 'The model request failed' },
      })

      await pressAllow(wrapper)

      expect(wrapper.emitted('allow')).toEqual([[HAIKU.id, false]])
    })
  })
})
