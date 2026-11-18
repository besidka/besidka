import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
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
const connector = ref<ConnectorPageItem | null>(createConnectorItem())

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

function mountDialog(props: Record<string, unknown> = {
  connectorId: 'conn1',
}) {
  return mountSuspended(ConnectDialog, {
    props,
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

    expect(findByTestId('connector-header-name')).toBeNull()
    expect((getByTestId('connector-header-kind-bearer') as HTMLInputElement)
      .checked).toBe(true)
    expect(getByTestId('connector-header-value').getAttribute('type'))
      .toBe('password')

    await setTestIdValue('connector-header-value', 'ghp_secret')
    getByTestId('connector-connect-header-form')
      .dispatchEvent(new Event('submit'))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/connectors/conn1/credentials',
      {
        method: 'POST',
        body: { auth: { kind: 'bearer', token: 'ghp_secret' } },
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
      expect(findByTestId('connector-header-name')).toBeNull()

      await setTestIdValue('connector-header-value', 'secret')
      getByTestId('connector-connect-header-form')
        .dispatchEvent(new Event('submit'))
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/connectors/conn1/credentials',
        {
          method: 'POST',
          body: { auth: { kind: 'bearer', token: 'secret' } },
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

  describe('when the sign-in server does not approve the redirect address',
    () => {
      it('offers a token for a server without a preset', async () => {
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
              message: 'This service does not allow Besidka to sign in',
              code: 'CONNECTOR_OAUTH_REDIRECT_NOT_ALLOWED',
            },
          }),
        })
        await mountDialog()
        await checkTestId('connector-consent-checkbox')
        await clickTestId('connector-consent-continue')
        await clickTestId('connector-connect-sign-in')

        expect(getByTestId('connector-connect-error').textContent)
          .toContain('This service does not allow Besidka to sign in')
        expect(findByTestId('connector-connect-use-token')).not.toBeNull()
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

  describe('a connector that does not exist yet', () => {
    const DRAFT = { presetId: 'linear' }
    const DRAFT_OAUTH_DISCOVERY = {
      ...OAUTH_DISCOVERY,
      title: 'Linear',
      presetId: 'linear',
    }
    const DRAFT_HEADER_DISCOVERY = {
      authType: 'header',
      host: 'api.githubcopilot.com',
      issuerHost: null,
      issuerDiffers: false,
      notice: 'Use a fine-grained token.',
      title: 'GitHub',
      presetId: 'github',
      headerName: 'Authorization',
    }

    function urlsFetched(): string[] {
      return mocks.fetch.mock.calls.map(call => call[0] as string)
    }

    beforeEach(() => {
      connector.value = null
    })

    it('discovers without a row and writes nothing until the connect '
      + 'succeeds', async () => {
      respond({
        '/api/v1/connectors/connect/discover': DRAFT_OAUTH_DISCOVERY,
      })

      const wrapper = await mountDialog({ draft: DRAFT })

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/connectors/connect/discover',
        { method: 'POST', body: DRAFT },
      )
      expect(getByTestId('connector-connect-identity').textContent)
        .toContain('mcp.linear.app')
      expect(getByTestId('connector-connect-identity').textContent)
        .toContain('Linear')

      await checkTestId('connector-consent-checkbox')
      await clickTestId('connector-consent-continue')

      expect(urlsFetched()).toEqual(['/api/v1/connectors/connect/discover'])
      expect(findByTestId('connector-connect-sign-in')).not.toBeNull()

      getByTestId('connector-connect-dialog')
        .querySelector<HTMLButtonElement>('button.btn-ghost')!
        .click()
      await flushPromises()

      expect(wrapper.emitted('close')).toBeTruthy()
      expect(urlsFetched()).toEqual(['/api/v1/connectors/connect/discover'])
      expect(mocks.refreshConnectors).not.toHaveBeenCalled()
    })

    it('sends the draft, the tool mode and the consent with the OAuth '
      + 'start', async () => {
      respond({
        '/api/v1/connectors/connect/discover': DRAFT_OAUTH_DISCOVERY,
        '/api/v1/connectors/oauth/start': {
          authorizationUrl: 'https://auth.linear.app/authorize?state=x',
        },
      })
      await mountDialog({ draft: DRAFT })
      await checkTestId('connector-consent-checkbox')
      await clickTestId('connector-consent-continue')
      await clickTestId('connector-connect-sign-in')

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/connectors/oauth/start',
        {
          method: 'POST',
          body: {
            presetId: 'linear',
            toolMode: 'auto',
            consent: {
              accepted: true,
              version: CONNECTOR_CONSENT_VERSION,
              issuerHost: 'auth.linear.app',
            },
          },
        },
      )
      expect(mocks.assign).toHaveBeenCalledWith(
        'https://auth.linear.app/authorize?state=x',
      )
      expect(urlsFetched()).not.toContain('/api/v1/connectors/conn1/consent')
    })

    it('creates the connector in one request with the key', async () => {
      respond({
        '/api/v1/connectors/connect/discover': DRAFT_HEADER_DISCOVERY,
        '/api/v1/connectors': { connector: { id: 'new1' } },
      })

      const wrapper = await mountDialog({ draft: { presetId: 'github' } })

      await checkTestId('connector-consent-checkbox')
      await clickTestId('connector-consent-continue')

      expect(urlsFetched()).toEqual(['/api/v1/connectors/connect/discover'])

      await setTestIdValue('connector-header-value', 'ghp_secret')
      await clickTestId('connector-header-save')

      expect(mocks.fetch).toHaveBeenLastCalledWith('/api/v1/connectors', {
        method: 'POST',
        body: {
          presetId: 'github',
          toolMode: 'auto',
          consent: {
            accepted: true,
            version: CONNECTOR_CONSENT_VERSION,
            issuerHost: null,
          },
          auth: { kind: 'bearer', token: 'ghp_secret' },
        },
      })
      expect(mocks.refreshConnectors).toHaveBeenCalled()
      expect(mocks.success).toHaveBeenCalledWith('GitHub connected')
      expect(wrapper.emitted('connected')?.[0]).toEqual(['new1'])
    })

    describe('how the key is sent', () => {
      const REGISTRY_DRAFT = { registryId: 'reg1' }

      function registryDiscovery(headerNames: string[]) {
        return {
          authType: 'header',
          host: 'mcp.exa.ai',
          issuerHost: null,
          issuerDiffers: false,
          notice: null,
          title: 'Exa',
          presetId: null,
          headerName: null,
          headerNames,
        }
      }

      async function openKeyForm(headerNames: string[]) {
        respond({
          '/api/v1/connectors/connect/discover': registryDiscovery(
            headerNames,
          ),
          '/api/v1/connectors': { connector: { id: 'new1' } },
        })

        await mountDialog({ draft: REGISTRY_DRAFT })
        await checkTestId('connector-consent-checkbox')
        await clickTestId('connector-consent-continue')
      }

      function kindInput(kind: string) {
        return getByTestId(`connector-header-kind-${kind}`) as HTMLInputElement
      }

      it('defaults to an API key or token when the entry names no header',
        async () => {
          await openKeyForm([])

          expect(kindInput('bearer').checked).toBe(true)
          expect(findByTestId('connector-header-name')).toBeNull()
          expect(getByTestId('connector-header-hint').textContent)
            .toContain('Authorization: Bearer')
        })

      it('defaults to an API key or token when the entry declares '
        + 'Authorization', async () => {
        await openKeyForm(['authorization'])

        expect(kindInput('bearer').checked).toBe(true)
        expect(findByTestId('connector-header-name')).toBeNull()
      })

      it('opens the custom header with the declared name prefilled',
        async () => {
          await openKeyForm(['x-api-key'])

          expect(kindInput('header').checked).toBe(true)
          expect((getByTestId('connector-header-name') as HTMLInputElement)
            .value).toBe('x-api-key')
          expect(getByTestId('connector-header-hint').textContent)
            .toContain('Sent exactly as typed')
        })

      it('sends a pasted key as a bearer token', async () => {
        await openKeyForm([])
        await setTestIdValue('connector-header-value', 'Bearer exa_key')
        await clickTestId('connector-header-save')

        expect(mocks.fetch).toHaveBeenLastCalledWith('/api/v1/connectors', {
          method: 'POST',
          body: {
            registryId: 'reg1',
            toolMode: 'auto',
            consent: {
              accepted: true,
              version: CONNECTOR_CONSENT_VERSION,
              issuerHost: null,
            },
            auth: { kind: 'bearer', token: 'Bearer exa_key' },
          },
        })
      })

      it('sends a custom header exactly as typed after a mode switch',
        async () => {
          await openKeyForm([])
          await setTestIdValue('connector-header-value', 'secret')
          await checkTestId('connector-header-kind-header')

          expect(
            (getByTestId('connector-header-value') as HTMLInputElement).value,
          ).toBe('')
          expect(
            (getByTestId('connector-header-save') as HTMLButtonElement)
              .disabled,
          ).toBe(true)

          await setTestIdValue('connector-header-name', ' x-api-key ')
          await setTestIdValue('connector-header-value', 'raw-key')
          await clickTestId('connector-header-save')

          expect(mocks.fetch).toHaveBeenLastCalledWith(
            '/api/v1/connectors',
            expect.objectContaining({
              body: expect.objectContaining({
                auth: { kind: 'header', name: 'x-api-key', value: 'raw-key' },
              }),
            }),
          )
        })
    })

    it('keeps the form and stores nothing when the server rejects the key',
      async () => {
        respond({
          '/api/v1/connectors/connect/discover': DRAFT_HEADER_DISCOVERY,
          '/api/v1/connectors': Object.assign(new Error('x'), {
            data: {
              message: 'The server did not accept this key',
              fix: 'Check the key and its permissions',
            },
          }),
        })

        const wrapper = await mountDialog({ draft: { presetId: 'github' } })

        await checkTestId('connector-consent-checkbox')
        await clickTestId('connector-consent-continue')
        await setTestIdValue('connector-header-value', 'Bearer wrong')
        await clickTestId('connector-header-save')

        expect(getByTestId('connector-header-error').textContent)
          .toContain('The server did not accept this key')
        expect(findByTestId('connector-header-value')).not.toBeNull()
        expect(wrapper.emitted('connected')).toBeUndefined()
        expect(mocks.refreshConnectors).not.toHaveBeenCalled()
        expect(mocks.success).not.toHaveBeenCalled()
      })

    it('creates a connector that needs no sign-in after the consent',
      async () => {
        respond({
          '/api/v1/connectors/connect/discover': {
            authType: 'none',
            host: 'open.example.com',
            title: 'open.example.com',
            presetId: null,
            issuerHost: null,
            issuerDiffers: false,
            notice: null,
          },
          '/api/v1/connectors': { connector: { id: 'new2' } },
        })

        const wrapper = await mountDialog({
          draft: { url: 'https://open.example.com/mcp' },
        })

        expect(urlsFetched()).toEqual(['/api/v1/connectors/connect/discover'])

        await checkTestId('connector-consent-checkbox')
        await clickTestId('connector-consent-continue')

        expect(mocks.fetch).toHaveBeenLastCalledWith('/api/v1/connectors', {
          method: 'POST',
          body: {
            url: 'https://open.example.com/mcp',
            toolMode: 'auto',
            consent: {
              accepted: true,
              version: CONNECTOR_CONSENT_VERSION,
              issuerHost: null,
            },
          },
        })
        expect(wrapper.emitted('connected')?.[0]).toEqual(['new2'])
      })

    it('links to the page a refusal names, only when it stays on the site',
      async () => {
        respond({
          '/api/v1/connectors/connect/discover': Object.assign(new Error('x'), {
            data: {
              message: 'This is Besidka\'s own MCP server',
              link: '/profile/labs',
            },
          }),
        })
        await mountDialog({ draft: { url: 'https://besidka.com/mcp' } })

        expect(getByTestId('connector-connect-error-link').outerHTML)
          .toContain('/profile/labs')

        document.body.innerHTML = ''
        respond({
          '/api/v1/connectors/connect/discover': Object.assign(new Error('x'), {
            data: {
              message: 'Not allowed',
              link: 'https://evil.example/labs',
            },
          }),
        })
        await mountDialog({ draft: { url: 'https://10.0.0.1/mcp' } })

        expect(findByTestId('connector-connect-error')).not.toBeNull()
        expect(findByTestId('connector-connect-error-link')).toBeNull()
      })
  })
})
