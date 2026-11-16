import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import AddDialog from '../../../../../app/components/Profile/Connectors/AddDialog.client.vue'
import {
  clickTestId,
  findByTestId,
  getByTestId,
  setTestIdValue,
  stubDialogElement,
} from '../../../../setup/helpers/dom-dialog'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refreshConnectors: vi.fn(),
}))

const registryActive = ref<boolean>(false)

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('refreshConnectors', () => mocks.refreshConnectors)
mockNuxtImport('useFeature', () => {
  return () => computed(() => ({
    enabled: registryActive.value,
    active: registryActive.value,
    variant: null,
  }))
})

function mountDialog(props: Record<string, unknown> = {}) {
  return mountSuspended(AddDialog, {
    props: { addedPresetIds: new Set<string>(), ...props },
    attachTo: document.body,
    global: { stubs: { teleport: false } },
  })
}

describe('Profile/Connectors/AddDialog', () => {
  beforeEach(() => {
    stubDialogElement()
    registryActive.value = false
    mocks.fetch.mockReset()
    mocks.refreshConnectors.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens as a bottom sheet with presets and Add by URL, and hides the '
    + 'Browse tab until the registry flag is on', async () => {
    await mountDialog()

    const dialog = document.body.querySelector('dialog.js-connector-add-modal')

    expect(dialog?.classList.contains('modal-bottom')).toBe(true)
    expect(findByTestId('connector-add-tab-presets')).not.toBeNull()
    expect(findByTestId('connector-add-tab-url')).not.toBeNull()
    expect(findByTestId('connector-add-tab-directory')).toBeNull()
    expect(getByTestId('connector-add-presets').textContent)
      .toContain('Atlassian')
    expect(document.body.querySelector('img')).toBeNull()
  })

  it('shows only the address form when the registry flag is on, whatever '
    + 'tab is asked for', async () => {
    registryActive.value = true

    for (const initialTab of [undefined, 'presets', 'directory', 'url']) {
      document.body.innerHTML = ''

      await mountDialog(initialTab ? { initialTab } : {})

      expect(findByTestId('connector-add-tab-url')).toBeNull()
      expect(findByTestId('connector-add-tab-presets')).toBeNull()
      expect(findByTestId('connector-add-presets')).toBeNull()
      expect(getByTestId('connector-add-url-form')).not.toBeNull()
      expect(document.body.querySelector('h2')?.textContent)
        .toContain('Add by URL')
    }

    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('falls back to Presets when Browse is asked for without the registry flag', async () => {
    await mountDialog({ initialTab: 'directory' })

    expect(findByTestId('connector-add-tab-directory')).toBeNull()
    expect(getByTestId('connector-add-tab-presets')
      .getAttribute('aria-selected')).toBe('true')
  })

  it('picks a preset by id without any request and marks presets that '
    + 'exist', async () => {
    const wrapper = await mountDialog({
      addedPresetIds: new Set(['github']),
    })

    expect((getByTestId('connector-preset-add-github') as HTMLButtonElement)
      .disabled).toBe(true)

    await clickTestId('connector-preset-add-notion')

    expect(wrapper.emitted('picked')?.[0]).toEqual([{ presetId: 'notion' }])
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.refreshConnectors).not.toHaveBeenCalled()
  })

  it('refuses a non-https address before asking the server', async () => {
    await mountDialog({ initialTab: 'url' })
    await setTestIdValue('connector-add-url', 'http://mcp.example.com')
    getByTestId('connector-add-url-form')
      .dispatchEvent(new Event('submit'))
    await Promise.resolve()

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(getByTestId('connector-add-url-error').textContent)
      .toContain('https')
  })

  it('picks the address and the name without any request', async () => {
    const wrapper = await mountDialog({ initialTab: 'url' })

    await setTestIdValue('connector-add-url', ' https://mcp.example.com/mcp ')
    await setTestIdValue('connector-add-title', 'Example')
    await clickTestId('connector-add-url-submit')

    expect(wrapper.emitted('picked')?.[0]).toEqual([{
      url: 'https://mcp.example.com/mcp',
      title: 'Example',
    }])
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(findByTestId('connector-add-url-error')).toBeNull()
  })

  it('leaves out an empty name', async () => {
    const wrapper = await mountDialog({ initialTab: 'url' })

    await setTestIdValue('connector-add-url', 'https://mcp.example.com/mcp')
    await clickTestId('connector-add-url-submit')

    expect(wrapper.emitted('picked')?.[0]).toEqual([{
      url: 'https://mcp.example.com/mcp',
    }])
  })
})
