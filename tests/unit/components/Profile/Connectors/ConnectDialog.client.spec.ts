import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import ConnectDialog from '../../../../../app/components/Profile/Connectors/ConnectDialog.client.vue'
import { CONNECTOR_CONSENT_VERSION } from '#shared/utils/connectors-policy'
import type { ConnectorPageItem } from '#shared/types/connectors.d'
import { createConnectorItem } from '../../../../setup/helpers/connectors-ui'
import {
  checkTestId,
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
  success: vi.fn(),
  errorMessage: vi.fn(),
  assign: vi.fn(),
}))

const oauthActive = ref<boolean>(true)
const connector = ref<ConnectorPageItem>(createConnectorItem())

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('refreshConnectors', () => mocks.refreshConnectors)
mockNuxtImport('useSuccessMessage', () => mocks.success)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)
mockNuxtImport('useConnectorById', () => {
  return () => computed(() => connector.value)
})
mockNuxtImport('useFeature', () => {
  return () => computed(() => ({
    enabled: oauthActive.value,
    active: oauthActive.value,
    variant: null,
  }))
})

function respond(routes: Record<string, unknown>) {
  mocks.fetch.mockImplementation(async (url: string) => {
    const match = Object.keys(routes).find(suffix => url.endsWith(suffix))

    if (!match) {
      throw new Error(`Unexpected ${url}`)
    }

    const value = routes[match]

    if (value instanceof Error) {
      throw value
    }

    return value
  })
}

function mountDialog() {
  return mountSuspended(ConnectDialog, {
    props: { connectorId: 'conn1' },
    attachTo: document.body,
    global: { stubs: { teleport: false } },
  })
}

const OAUTH_DISCOVERY = {
  authType: 'oauth',
  host: 'mcp.linear.app',
  issuerHost: 'auth.linear.app',
  issuerDiffers: true,
  notice: null,
}

describe('Profile/Connectors/ConnectDialog', () => {
  beforeEach(() => {
    stubDialogElement()
    oauthActive.value = true
    connector.value = createConnectorItem({
      status: 'needs-auth',
      consent: { state: 'missing', issuerHost: null, givenAt: null },
    })
    mocks.fetch.mockReset()
    mocks.refreshConnectors.mockReset().mockResolvedValue(undefined)
    mocks.success.mockReset()
    mocks.errorMessage.mockReset()
    mocks.assign.mockReset()
    vi.spyOn(window.location, 'assign').mockImplementation(mocks.assign)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the consent with the host and the sign-in host before any '
    + 'sign-in, and needs the tick', async () => {
    respond({ '/connect/discover': OAUTH_DISCOVERY })
    await mountDialog()

    const text = getByTestId('connector-consent-text').textContent ?? ''

    expect(text).toContain('mcp.linear.app')
    expect(text).toContain('auth.linear.app')
    expect(text).toContain('outside the European Economic Area')
    expect(findByTestId('connector-connect-sign-in')).toBeNull()
    expect((getByTestId('connector-consent-continue') as HTMLButtonElement)
      .disabled).toBe(true)
    expect(getByTestId('connector-connect-live').textContent)
      .toContain('Review the consent')
  })

  it('records the consent for the issuer host and starts the OAuth sign-in',
    async () => {
      respond({
        '/connect/discover': OAUTH_DISCOVERY,
        '/consent': { connector: {} },
        '/oauth/start': {
          authorizationUrl: 'https://auth.linear.app/authorize?state=x',
        },
      })
      await mountDialog()
      await checkTestId('connector-consent-checkbox')
      await clickTestId('connector-consent-continue')

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/connectors/conn1/consent',
        {
          method: 'POST',
          body: {
            accepted: true,
            version: CONNECTOR_CONSENT_VERSION,
            issuerHost: 'auth.linear.app',
          },
        },
      )

      await clickTestId('connector-connect-sign-in')

      expect(mocks.assign)
        .toHaveBeenCalledWith('https://auth.linear.app/authorize?state=x')
    })

  it('offers the three modes on the consent step, preselected to the '
    + 'current one, and leaves an unchanged mode alone', async () => {
    respond({
      '/connect/discover': OAUTH_DISCOVERY,
      '/consent': { connector: {} },
    })
    await mountDialog()

    expect((getByTestId('connector-connect-mode-auto') as HTMLInputElement)
      .checked).toBe(true)
    expect(findByTestId('connector-connect-mode-manual')).not.toBeNull()
    expect(findByTestId('connector-connect-mode-always-on')).not.toBeNull()

    await checkTestId('connector-consent-checkbox')
    await clickTestId('connector-consent-continue')

    expect(mocks.fetch.mock.calls.filter(([, options]) => {
      return options?.method === 'PATCH'
    })).toHaveLength(0)
  })

  it('saves a changed mode before the sign-in step', async () => {
    respond({
      '/connect/discover': OAUTH_DISCOVERY,
      '/consent': { connector: {} },
      '/api/v1/connectors/conn1': { connector: {} },
    })
    await mountDialog()
    await checkTestId('connector-connect-mode-manual')
    await checkTestId('connector-consent-checkbox')
    await clickTestId('connector-consent-continue')

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/connectors/conn1', {
      method: 'PATCH',
      body: { toolMode: 'manual' },
    })
    expect(findByTestId('connector-connect-sign-in')).not.toBeNull()
  })

  it('stays on the consent step and shows the error when the mode cannot '
    + 'be saved', async () => {
    respond({
      '/connect/discover': OAUTH_DISCOVERY,
      '/api/v1/connectors/conn1': Object.assign(new Error('boom'), {
        data: { message: 'Could not save the mode' },
      }),
    })
    await mountDialog()
    await checkTestId('connector-connect-mode-always-on')
    await checkTestId('connector-consent-checkbox')
    await clickTestId('connector-consent-continue')

    expect(mocks.errorMessage).toHaveBeenCalledTimes(1)
    expect(findByTestId('connector-consent-continue')).not.toBeNull()
    expect(findByTestId('connector-connect-sign-in')).toBeNull()
    expect(mocks.fetch).not.toHaveBeenCalledWith(
      '/api/v1/connectors/conn1/consent',
      expect.anything(),
    )
  })

  it('skips the consent when it is current for the same issuer, and keeps '
    + 'sign-in off without the OAuth flag', async () => {
    oauthActive.value = false
    connector.value = createConnectorItem({
      consent: {
        state: 'current',
        issuerHost: 'auth.linear.app',
        givenAt: '2026-11-15T10:00:00.000Z',
      },
    })
    respond({ '/connect/discover': OAUTH_DISCOVERY })
    await mountDialog()

    expect(findByTestId('connector-consent-text')).toBeNull()
    expect(findByTestId('connector-connect-oauth-off')).not.toBeNull()
    expect((getByTestId('connector-connect-sign-in') as HTMLButtonElement)
      .disabled).toBe(true)
  })

  it('saves a header key and reports the connection', async () => {
    connector.value = createConnectorItem({
      title: 'GitHub',
      presetId: 'github',
      status: 'needs-auth',
      consent: { state: 'missing', issuerHost: null, givenAt: null },
    })
    respond({
      '/connect/discover': {
        authType: 'header',
        host: 'api.githubcopilot.com',
        issuerHost: null,
        issuerDiffers: false,
        notice: 'Use a fine-grained personal access token.',
      },
      '/consent': { connector: {} },
      '/credentials': { connector: {} },
    })

    const wrapper = await mountDialog()

    expect(getByTestId('connector-connect-notice').textContent)
      .toContain('fine-grained')

    await checkTestId('connector-consent-checkbox')
    await clickTestId('connector-consent-continue')

    expect((getByTestId('connector-header-name') as HTMLInputElement).value)
      .toBe('Authorization')
    expect(getByTestId('connector-header-value').getAttribute('type'))
      .toBe('password')

    await setTestIdValue('connector-header-value', 'Bearer ghp_secret')
    getByTestId('connector-connect-header-form')
      .dispatchEvent(new Event('submit'))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/connectors/conn1/credentials',
      {
        method: 'POST',
        body: { headerName: 'Authorization', headerValue: 'Bearer ghp_secret' },
      },
    )
    expect(mocks.success).toHaveBeenCalledWith('GitHub connected')
    expect(wrapper.emitted('connected')?.[0]).toEqual(['conn1'])
  })

  it('names the host first for a connector an app added over MCP',
    async () => {
      connector.value = createConnectorItem({
        title: 'Google Drive',
        host: 'drive.evil.example',
        createdVia: 'mcp',
        addedByApp: 'Some agent',
        status: 'needs-auth',
        consent: { state: 'missing', issuerHost: null, givenAt: null },
      })
      respond({
        '/connect/discover': {
          authType: 'none',
          host: 'drive.evil.example',
          issuerHost: null,
          issuerDiffers: false,
          notice: null,
        },
      })
      await mountDialog()

      const dialog = document.body.querySelector(
        'dialog.js-connector-connect-modal',
      )!

      expect(dialog.querySelector('h2')?.textContent?.trim())
        .toBe('Connect drive.evil.example')
      expect(getByTestId('connector-connect-identity').textContent)
        .toContain('drive.evil.example')
      expect(getByTestId('connector-connect-mcp-badge').textContent?.trim())
        .toBe('Added by a connected app')
      expect(getByTestId('connector-consent-text').textContent)
        .toContain('drive.evil.example')
    })

  describe('when the sign-in server needs a pre-registered client', () => {
    function noRegistrationError() {
      return Object.assign(new Error('x'), {
        data: {
          message: 'This server needs a pre-registered client',
          code: 'CONNECTOR_OAUTH_NO_REGISTRATION',
          why: 'No client registration',
          fix: 'Use an API key if the server offers one',
        },
      })
    }

    async function failSignIn() {
      respond({
        '/connect/discover': OAUTH_DISCOVERY,
        '/consent': { connector: {} },
        '/oauth/start': noRegistrationError(),
        '/credentials': { connector: {} },
      })

      const wrapper = await mountDialog()

      await checkTestId('connector-consent-checkbox')
      await clickTestId('connector-consent-continue')
      await clickTestId('connector-connect-sign-in')

      return wrapper
    }

    it('offers a token for a server without a preset and opens the header '
      + 'form for the same connector', async () => {
      connector.value = createConnectorItem({
        presetId: null,
        status: 'needs-auth',
        consent: { state: 'missing', issuerHost: null, givenAt: null },
      })

      const wrapper = await failSignIn()

      expect(getByTestId('connector-connect-error').textContent)
        .toContain('This server needs a pre-registered client')

      await clickTestId('connector-connect-use-token')

      expect(findByTestId('connector-connect-error')).toBeNull()
      expect((getByTestId('connector-header-name') as HTMLInputElement).value)
        .toBe('Authorization')

      await setTestIdValue('connector-header-value', 'Bearer secret')
      getByTestId('connector-connect-header-form')
        .dispatchEvent(new Event('submit'))
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/connectors/conn1/credentials',
        {
          method: 'POST',
          body: { headerName: 'Authorization', headerValue: 'Bearer secret' },
        },
      )
      expect(wrapper.emitted('connected')?.[0]).toEqual(['conn1'])
    })

    it('offers a token for a preset that allows header auth', async () => {
      connector.value = createConnectorItem({
        presetId: 'linear',
        status: 'needs-auth',
        consent: { state: 'missing', issuerHost: null, givenAt: null },
      })

      await failSignIn()

      expect(findByTestId('connector-connect-use-token')).not.toBeNull()
    })

    it('does not offer a token for an OAuth-only preset', async () => {
      connector.value = createConnectorItem({
        title: 'Notion',
        presetId: 'notion',
        status: 'needs-auth',
        consent: { state: 'missing', issuerHost: null, givenAt: null },
      })

      await failSignIn()

      expect(findByTestId('connector-connect-error')).not.toBeNull()
      expect(findByTestId('connector-connect-use-token')).toBeNull()
    })

    it('does not offer a token for other failures', async () => {
      connector.value = createConnectorItem({
        presetId: null,
        status: 'needs-auth',
        consent: { state: 'missing', issuerHost: null, givenAt: null },
      })
      respond({
        '/connect/discover': OAUTH_DISCOVERY,
        '/consent': { connector: {} },
        '/oauth/start': Object.assign(new Error('x'), {
          data: {
            message: 'The sign-in server refused to register Besidka',
            code: 'CONNECTOR_OAUTH_REGISTRATION_FAILED',
          },
        }),
      })
      await mountDialog()
      await checkTestId('connector-consent-checkbox')
      await clickTestId('connector-consent-continue')
      await clickTestId('connector-connect-sign-in')

      expect(findByTestId('connector-connect-use-token')).toBeNull()
    })
  })

  it('shows a fixed error when the server cannot be reached', async () => {
    respond({
      '/connect/discover': Object.assign(new Error('x'), {
        data: {
          message: 'The server did not answer as an MCP server',
          why: 'No MCP answer',
        },
      }),
    })
    await mountDialog()

    expect(getByTestId('connector-connect-error').textContent)
      .toContain('The server did not answer as an MCP server')
    expect(findByTestId('connector-connect-retry')).not.toBeNull()
  })
})
