import type { ModelSelection } from '#shared/types/model-selection.d'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { computed, nextTick, shallowRef } from 'vue'
import ModelsTrigger from '../../../../app/components/ChatInput/ModelsTrigger.vue'

const mocks = vi.hoisted(() => ({
  getModel: vi.fn(),
  getModelName: vi.fn(),
  getProviders: vi.fn(),
  onClickOutside: vi.fn(),
  useDevice: vi.fn(),
  useUserModel: vi.fn(),
  useUserSetting: vi.fn(),
  useUserKeys: vi.fn(),
  useGatewayCatalog: vi.fn(),
  requestPersistence: vi.fn(),
}))

mockNuxtImport('getModel', () => mocks.getModel)
mockNuxtImport('getModelName', () => mocks.getModelName)
mockNuxtImport('getProviders', () => mocks.getProviders)
mockNuxtImport('onClickOutside', () => mocks.onClickOutside)
mockNuxtImport('useDevice', () => mocks.useDevice)
mockNuxtImport('useUserModel', () => mocks.useUserModel)
mockNuxtImport('useUserSetting', () => mocks.useUserSetting)
mockNuxtImport('useUserKeys', () => mocks.useUserKeys)
mockNuxtImport('useGatewayCatalog', () => mocks.useGatewayCatalog)
mockNuxtImport('requestPersistence', () => mocks.requestPersistence)
mockNuxtImport('useMediaQuery', () => {
  return () => isPopoverLayout
})

const isPopoverLayout = shallowRef<boolean>(false)

enableAutoUnmount(afterEach)

const baseModel = {
  description: 'A model',
  contextLength: 32_768,
  maxOutputTokens: 32_768,
  priceTier: '$$',
  price: {
    tokens: 1,
    input: '$0.30',
    output: '$30.00',
  },
  modalities: {
    input: ['text'],
    output: ['text'],
  },
  tools: [],
  toolCall: false,
  reasoning: false,
}

const firstModel = { ...baseModel, id: 'first-model', name: 'First model' }
const secondModel = { ...baseModel, id: 'second-model', name: 'Second model' }

function createSelectionMock(modelId: string) {
  const selection = shallowRef<ModelSelection>({
    source: 'provider',
    modelId,
  })
  const userModel = computed<string>(() => {
    return selection.value.modelId
  })

  return { selection, userModel }
}

let selectionMock = createSelectionMock('first-model')

function stubDialog() {
  const showModal = vi
    .spyOn(HTMLDialogElement.prototype, 'showModal')
    .mockImplementation(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    })
  const close = vi
    .spyOn(HTMLDialogElement.prototype, 'close')
    .mockImplementation(function (this: HTMLDialogElement) {
      if (!this.hasAttribute('open')) {
        return
      }

      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    })

  return { showModal, close }
}

async function mountPicker() {
  const wrapper = await mountSuspended(ModelsTrigger, {
    attachTo: document.body,
    global: {
      stubs: {
        ClientOnly: {
          template: '<slot />',
        },
      },
    },
  })

  return wrapper
}

type PickerWrapper = Awaited<ReturnType<typeof mountPicker>>

async function openSheet(wrapper: PickerWrapper) {
  await wrapper.get('[data-testid="current-model-trigger"]').trigger('click')
  await flushPromises()
}

function getSheet(wrapper: PickerWrapper) {
  return wrapper.get<HTMLDialogElement>('[data-testid="models-picker-panel"]')
}

function isSheetOpen(wrapper: PickerWrapper): boolean {
  return getSheet(wrapper).element.hasAttribute('open')
}

describe('ChatInput/ModelsTrigger below md', () => {
  let dialog: ReturnType<typeof stubDialog>

  beforeEach(() => {
    isPopoverLayout.value = false
    useState('chat-input:open-popover').value = null
    selectionMock = createSelectionMock('first-model')
    dialog = stubDialog()

    mocks.getModel.mockReturnValue({ provider: { id: 'google' } })
    mocks.getModelName.mockReturnValue('First model')
    mocks.getProviders.mockReturnValue({
      providers: [
        {
          id: 'google',
          name: 'Google AI Studio',
          models: [firstModel],
        },
        {
          id: 'openai',
          name: 'OpenAI',
          models: [secondModel],
        },
      ],
    })
    mocks.useDevice.mockReturnValue({
      isIos: true,
      isAndroid: false,
      isDesktop: true,
    })
    mocks.useUserModel.mockReturnValue(selectionMock)
    mocks.useUserSetting.mockReturnValue({
      favoriteModels: shallowRef<string[]>([]),
      favoriteGatewayModels: shallowRef({}),
      getFavoriteGatewayModels: () => [],
      toggleFavoriteModel: vi.fn(),
      toggleFavoriteGatewayModel: vi.fn(),
    })
    mocks.useUserKeys.mockReturnValue({
      hasKeyForProvider: () => true,
      hasAnyKey: shallowRef(true),
    })
    mocks.useGatewayCatalog.mockReturnValue({
      models: shallowRef([]),
      pending: shallowRef(false),
      error: shallowRef(null),
      refresh: vi.fn(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens a labelled bottom sheet with the tools sheet chrome', async () => {
    const wrapper = await mountPicker()
    const trigger = wrapper.get('[data-testid="current-model-trigger"]')

    expect(trigger.attributes('aria-haspopup')).toBe('dialog')

    await openSheet(wrapper)

    const sheet = getSheet(wrapper)
    const heading = sheet.get(`#${sheet.attributes('aria-labelledby')}`)
    const box = sheet.get('[data-testid="models-picker-sheet-box"]')

    expect(sheet.element.tagName).toBe('DIALOG')
    expect(sheet.classes()).toEqual(
      expect.arrayContaining(['modal', 'modal-bottom']),
    )
    expect(dialog.showModal).toHaveBeenCalledOnce()
    expect(isSheetOpen(wrapper)).toBe(true)
    expect(heading.text()).toBe('Models')
    expect(box.classes()).toEqual(
      expect.arrayContaining(['rounded-t-box', 'rounded-b-none', 'h-[85dvh]']),
    )
    expect(box.attributes('autofocus')).toBeDefined()
    expect(sheet.find('[data-testid="models-picker-close"]').exists())
      .toBe(true)
    expect(sheet.find('form[method="dialog"].modal-backdrop').exists())
      .toBe(true)
    expect(trigger.attributes('aria-expanded')).toBe('true')
  })

  it('never focuses the search input, even on a desktop user agent',
    async () => {
      const wrapper = await mountPicker()

      await openSheet(wrapper)
      await nextTick()

      expect(document.activeElement).not.toBe(
        wrapper.get('[data-testid="models-picker-search"]').element,
      )
    })

  it('keeps focus off the search when showModal ignores autofocus (iOS)',
    async () => {
      dialog.showModal.mockImplementation(function (this: HTMLDialogElement) {
        this.setAttribute('open', '')

        const firstLinkOrField = Array.from(
          this.querySelectorAll<HTMLElement>('a[href], input'),
        ).find((element) => {
          return !element.closest('[inert]')
        })

        firstLinkOrField?.focus()
      })

      const wrapper = await mountPicker()

      await openSheet(wrapper)

      const box = wrapper.get('[data-testid="models-picker-sheet-box"]')
      const search = wrapper.get('[data-testid="models-picker-search"]')

      expect(document.activeElement).toBe(box.element)

      await nextTick()

      expect(search.element.closest('[inert]')).toBeNull()
      expect(document.activeElement).toBe(box.element)
    })

  it('releases the panel when the sheet closes before showModal runs',
    async () => {
      const wrapper = await mountPicker()
      const trigger = wrapper.get('[data-testid="current-model-trigger"]')

      trigger.element.click()
      trigger.element.click()
      await flushPromises()

      expect(dialog.showModal).not.toHaveBeenCalled()
      expect(wrapper.find('[inert]').exists()).toBe(false)

      await trigger.trigger('click')
      await flushPromises()

      expect(dialog.showModal).toHaveBeenCalledOnce()
      expect(wrapper.find('[inert]').exists()).toBe(false)
    })

  it('lays the provider rail out as a horizontal chip row', async () => {
    const wrapper = await mountPicker()

    await openSheet(wrapper)

    const rail = wrapper.get('[data-testid="models-picker-rail"]')

    expect(rail.classes()).toEqual(
      expect.arrayContaining(['overflow-x-auto', 'border-b']),
    )
    expect(rail.classes()).not.toContain('flex-col')
    expect(wrapper.get('[data-testid="models-picker-rail-google-count"]')
      .text()).toBe('1')
  })

  it('keeps the gateway row as the sheet footer with safe-area padding',
    async () => {
      const wrapper = await mountPicker()

      await openSheet(wrapper)

      const gatewayRail = wrapper.get(
        '[data-testid="models-picker-gateway-rail"]',
      )

      expect(gatewayRail.classes())
        .toContain('pb-[var(--models-sheet-bottom-padding,0.375rem)]')
      expect(gatewayRail.classes()).not.toContain('rounded-b-2xl')
    })

  it('opens and closes the filters inline without closing the sheet',
    async () => {
      const wrapper = await mountPicker()

      await openSheet(wrapper)

      const filterTrigger = wrapper.get(
        '[data-testid="models-picker-filter-trigger"]',
      )

      expect(wrapper.find('details.dropdown').exists()).toBe(false)
      expect(filterTrigger.attributes('aria-expanded')).toBe('false')

      await filterTrigger.trigger('click')

      expect(filterTrigger.attributes('aria-expanded')).toBe('true')
      expect(wrapper.find('[data-testid="models-picker-filter-section"]')
        .exists()).toBe(true)

      await wrapper.get('[data-testid="models-picker-filter-chat"]')
        .trigger('click')
      await wrapper.get('[data-testid="models-picker-filter-vision"]')
        .trigger('click')

      expect(wrapper.get('[data-testid="models-picker-filter-chat"]')
        .attributes('aria-pressed')).toBe('true')
      expect(wrapper.find('[data-testid="models-picker-filter-section"]')
        .exists()).toBe(true)
      expect(isSheetOpen(wrapper)).toBe(true)

      await filterTrigger.trigger('click')

      expect(wrapper.find('[data-testid="models-picker-filter-section"]')
        .exists()).toBe(false)
      expect(isSheetOpen(wrapper)).toBe(true)
      expect(dialog.close).not.toHaveBeenCalled()
    })

  it('closes on a model pick and returns focus to the trigger', async () => {
    const wrapper = await mountPicker()

    await openSheet(wrapper)
    await wrapper.get('button[aria-label="Choose Second model"]')
      .trigger('click')
    await flushPromises()

    expect(selectionMock.selection.value).toEqual({
      source: 'provider',
      modelId: 'second-model',
    })
    expect(isSheetOpen(wrapper)).toBe(false)
    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="current-model-trigger"]').element,
    )
    expect(wrapper.get('[data-testid="current-model-trigger"]')
      .attributes('aria-expanded')).toBe('false')
  })

  it('closes from the X button and returns focus to the trigger',
    async () => {
      const wrapper = await mountPicker()

      await openSheet(wrapper)
      await wrapper.get('[data-testid="models-picker-close"]').trigger('click')

      expect(isSheetOpen(wrapper)).toBe(false)
      expect(document.activeElement).toBe(
        wrapper.get('[data-testid="current-model-trigger"]').element,
      )
    })

  it('syncs its state when the dialog closes natively (backdrop, Escape)',
    async () => {
      const wrapper = await mountPicker()

      await openSheet(wrapper)

      getSheet(wrapper).element.close()
      await flushPromises()

      const trigger = wrapper.get('[data-testid="current-model-trigger"]')

      expect(trigger.attributes('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(trigger.element)
      expect(useState('chat-input:open-popover').value).toBe(null)
    })

  it('lets cancel close the sheet when nothing is left to unwind',
    async () => {
      const wrapper = await mountPicker()

      await openSheet(wrapper)

      const cancel = new Event('cancel', { cancelable: true })

      getSheet(wrapper).element.dispatchEvent(cancel)

      expect(cancel.defaultPrevented).toBe(false)
    })

  it('makes cancel clear the search and the filters before closing',
    async () => {
      const wrapper = await mountPicker()

      await openSheet(wrapper)
      await wrapper.get('[data-testid="models-picker-search"]')
        .setValue('second')
      await wrapper.get('[data-testid="models-picker-filter-trigger"]')
        .trigger('click')

      const filtersCancel = new Event('cancel', { cancelable: true })

      getSheet(wrapper).element.dispatchEvent(filtersCancel)
      await nextTick()

      expect(filtersCancel.defaultPrevented).toBe(true)
      expect(wrapper.find('[data-testid="models-picker-filter-section"]')
        .exists()).toBe(false)

      const searchCancel = new Event('cancel', { cancelable: true })

      getSheet(wrapper).element.dispatchEvent(searchCancel)
      await nextTick()

      expect(searchCancel.defaultPrevented).toBe(true)
      expect(wrapper.get<HTMLInputElement>(
        '[data-testid="models-picker-search"]',
      ).element.value).toBe('')
      expect(isSheetOpen(wrapper)).toBe(true)
    })

  it('leaves Escape to the dialog instead of closing from the window',
    async () => {
      const wrapper = await mountPicker()

      await openSheet(wrapper)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await nextTick()

      expect(isSheetOpen(wrapper)).toBe(true)
    })

  it('ignores outside clicks, which only the popover closes on',
    async () => {
      const wrapper = await mountPicker()

      await openSheet(wrapper)

      const outsideHandler = mocks.onClickOutside.mock.calls.at(-1)?.[1] as
        (() => void) | undefined

      outsideHandler?.()
      await nextTick()

      expect(outsideHandler).toBeTypeOf('function')
      expect(isSheetOpen(wrapper)).toBe(true)
    })

  it('closes cleanly when the viewport crosses into the popover layout',
    async () => {
      const wrapper = await mountPicker()

      await openSheet(wrapper)

      isPopoverLayout.value = true
      await flushPromises()

      expect(dialog.close).toHaveBeenCalled()
      expect(wrapper.get('[data-testid="current-model-trigger"]')
        .attributes('aria-expanded')).toBe('false')
      expect(wrapper.get('[data-testid="models-picker-panel"]').element.tagName)
        .toBe('DIV')
    })

  describe('with the on-screen keyboard up', () => {
    let viewport: EventTarget & { height: number, offsetTop: number }

    beforeEach(() => {
      viewport = Object.assign(new EventTarget(), {
        height: window.innerHeight,
        offsetTop: 0,
      })
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: viewport,
      })
    })

    afterEach(() => {
      Reflect.deleteProperty(window, 'visualViewport')
    })

    it('sits on the visual viewport above the keyboard', async () => {
      const wrapper = await mountPicker()

      await openSheet(wrapper)

      const box = wrapper.get<HTMLElement>(
        '[data-testid="models-picker-sheet-box"]',
      )

      expect(box.element.style.height).toBe('')

      viewport.height = 400
      viewport.dispatchEvent(new Event('resize'))
      await nextTick()

      const keyboardHeight = window.innerHeight - 400

      expect(box.element.style.height).toBe('340px')
      expect(box.element.style.marginBottom).toBe(`${keyboardHeight}px`)
      expect(
        box.element.style.getPropertyValue('--models-sheet-bottom-padding'),
      ).toBe('0.375rem')

      viewport.height = window.innerHeight
      viewport.dispatchEvent(new Event('resize'))
      await nextTick()

      expect(box.element.style.height).toBe('')
    })
  })
})
