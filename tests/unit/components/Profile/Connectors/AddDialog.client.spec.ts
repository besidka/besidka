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

function serverError(
  message: string,
  why: string,
  fix: string,
  link?: string,
) {
  return Object.assign(new Error(message), {
    data: { message, why, fix, ...(link ? { link } : {}) },
    statusCode: 400,
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

  it('adds a preset by id and marks presets that exist', async () => {
    mocks.fetch.mockResolvedValue({ connector: { id: 'new1' } })

    const wrapper = await mountDialog({
      addedPresetIds: new Set(['github']),
    })

    expect((getByTestId('connector-preset-add-github') as HTMLButtonElement)
      .disabled).toBe(true)

    await clickTestId('connector-preset-add-notion')

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/connectors', {
      method: 'POST',
      body: { presetId: 'notion' },
    })
    expect(mocks.refreshConnectors).toHaveBeenCalled()
    expect(wrapper.emitted('added')?.[0]).toEqual(['new1'])
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

  it('shows the server\'s refusal inline, as for a private address',
    async () => {
      mocks.fetch.mockRejectedValue(serverError(
        'This address is not allowed',
        'The connector address is not a public https URL with a host name',
        'Use the https address of the MCP server',
      ))

      const wrapper = await mountDialog({ initialTab: 'url' })

      await setTestIdValue('connector-add-url', 'https://10.0.0.1/mcp')
      await setTestIdValue('connector-add-title', 'Internal')
      await clickTestId('connector-add-url-submit')

      expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/connectors', {
        method: 'POST',
        body: { url: 'https://10.0.0.1/mcp', title: 'Internal' },
      })

      const error = getByTestId('connector-add-url-error')

      expect(error.textContent).toContain('This address is not allowed')
      expect(error.getAttribute('role')).toBe('alert')
      expect(getByTestId('connector-add-url').getAttribute('aria-invalid'))
        .toBe('true')
      expect(wrapper.emitted('added')).toBeUndefined()
    })

  it('says Besidka\'s own MCP server cannot be added and links to Labs',
    async () => {
      mocks.fetch.mockRejectedValue(serverError(
        'This is Besidka\'s own MCP server',
        'Besidka does not call itself as a connector',
        'To let the model use your Besidka data in chats, turn on Besidka '
        + 'tools in Labs',
        '/profile/labs',
      ))

      await mountDialog({ initialTab: 'url' })
      await setTestIdValue('connector-add-url', 'https://besidka.com/mcp')
      await clickTestId('connector-add-url-submit')

      const error = getByTestId('connector-add-url-error')

      expect(error.textContent).toContain(
        'This is Besidka\'s own MCP server. To let the model use your '
        + 'Besidka data in chats, turn on Besidka tools in Labs.',
      )
      expect(getByTestId('connector-add-url-error-link').outerHTML)
        .toContain('/profile/labs')
    })

  it('shows no link for an ordinary refusal, or one that leaves the site',
    async () => {
      mocks.fetch.mockRejectedValue(serverError(
        'This address is not allowed',
        'Not public',
        'Use the https address of the MCP server',
        'https://evil.example/labs',
      ))

      await mountDialog({ initialTab: 'url' })
      await setTestIdValue('connector-add-url', 'https://10.0.0.1/mcp')
      await clickTestId('connector-add-url-submit')

      expect(findByTestId('connector-add-url-error')).not.toBeNull()
      expect(findByTestId('connector-add-url-error-link')).toBeNull()
    })
})
