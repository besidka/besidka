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
  assign: vi.fn(),
}))

const oauthActive = ref<boolean>(true)
const connector = ref<ConnectorPageItem>(createConnectorItem())

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('refreshConnectors', () => mocks.refreshConnectors)
mockNuxtImport('useSuccessMessage', () => mocks.success)
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
