import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createWebMcpTools,
  getWebMcpMarkdownPath,
  registerWebMcpTools,
  resolveWebMcpModelContext,
  resolveWebMcpPath,
  WEBMCP_CONTENT_PATHS,
} from '../../../app/utils/webmcp'

const ORIGIN = 'https://besidka.com'
const AUTH_PATHS = ['/signin', '/signup']
const EXECUTE_OPTIONS = { signal: new AbortController().signal }

function findTool(name: string): WebMcpTool {
  const tools = createWebMcpTools({
    origin: ORIGIN,
    listKeyGuides: vi.fn().mockResolvedValue([]),
    navigate: vi.fn().mockResolvedValue(undefined),
  })

  return tools.find(tool => tool.name === name)!
}

describe('webmcp utils', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'modelContext')
    Reflect.deleteProperty(navigator, 'modelContext')
    vi.unstubAllGlobals()
  })

  describe('resolveWebMcpPath', () => {
    it('accepts the public content paths', () => {
      expect(WEBMCP_CONTENT_PATHS).toEqual([
        '/',
        '/byok',
        '/memory',
        '/privacy-policy',
        '/terms-of-use',
        '/cookie-policy',
      ])

      for (const path of WEBMCP_CONTENT_PATHS) {
        expect(resolveWebMcpPath(path, ORIGIN)).toBe(path)
      }
    })

    it('accepts key guide paths', () => {
      expect(resolveWebMcpPath('/guides/claude-api-key', ORIGIN))
        .toBe('/guides/claude-api-key')
    })

    it('normalizes trailing slashes, queries and hashes', () => {
      expect(resolveWebMcpPath('/byok/', ORIGIN)).toBe('/byok')
      expect(resolveWebMcpPath('/byok?x=1#top', ORIGIN)).toBe('/byok')
    })

    it('rejects private and unknown paths', () => {
      for (const path of [
        '/chats/new',
        '/profile',
        '/api/v1/chats',
        '/guides',
        '/guides/Claude_Key',
        '/guides/a/b',
        '/signin',
      ]) {
        expect(resolveWebMcpPath(path, ORIGIN)).toBeNull()
      }
    })

    it('rejects traversal, encoded segments and foreign origins', () => {
      for (const path of [
        '/guides/../profile',
        '/guides/%2e%2e/profile',
        '/guides/%41',
        'https://evil.example/byok',
        '//evil.example/byok',
        '',
      ]) {
        expect(resolveWebMcpPath(path, ORIGIN)).toBeNull()
      }
    })

    it('rejects non-string input', () => {
      expect(resolveWebMcpPath(undefined, ORIGIN)).toBeNull()
      expect(resolveWebMcpPath({ path: '/byok' }, ORIGIN)).toBeNull()
    })

    it('accepts extra paths only when passed', () => {
      expect(resolveWebMcpPath('/signup', ORIGIN)).toBeNull()
      expect(resolveWebMcpPath('/signup', ORIGIN, AUTH_PATHS))
        .toBe('/signup')
    })
  })

  describe('getWebMcpMarkdownPath', () => {
    it('maps pages to their markdown twins', () => {
      expect(getWebMcpMarkdownPath('/')).toBe('/raw/index.md')
      expect(getWebMcpMarkdownPath('/byok')).toBe('/byok.md')
      expect(getWebMcpMarkdownPath('/guides/claude-api-key'))
        .toBe('/guides/claude-api-key.md')
    })
  })

  describe('resolveWebMcpModelContext', () => {
    it('returns null when no API exists', () => {
      expect(resolveWebMcpModelContext()).toBeNull()
    })

    it('returns null when the object has no registerTool', () => {
      Object.defineProperty(document, 'modelContext', {
        value: {},
        configurable: true,
      })

      expect(resolveWebMcpModelContext()).toBeNull()
    })
  })

  describe('get_page_markdown', () => {
    it('fetches the markdown twin with the markdown Accept header', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('# Besidka', {
          headers: { 'content-type': 'text/markdown; charset=utf-8' },
        }),
      )

      vi.stubGlobal('fetch', fetchMock)

      const result = await findTool('get_page_markdown')
        .execute({ path: '/byok' }, EXECUTE_OPTIONS)

      expect(result).toBe('# Besidka')

      const [url, init] = fetchMock.mock.calls[0]!

      expect(String(url)).toBe(`${ORIGIN}/byok.md`)
      expect(init.headers).toEqual({ Accept: 'text/markdown' })
      expect(init.signal).toBe(EXECUTE_OPTIONS.signal)
    })

    it('rejects paths outside the allowlist without fetching', async () => {
      const fetchMock = vi.fn()

      vi.stubGlobal('fetch', fetchMock)

      await expect(
        findTool('get_page_markdown')
          .execute({ path: '/profile/keys' }, EXECUTE_OPTIONS),
      ).rejects.toThrow('Unsupported path')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rejects a response that is not markdown', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        new Response('<html></html>', {
          headers: { 'content-type': 'text/html' },
        }),
      ))

      await expect(
        findTool('get_page_markdown')
          .execute({ path: '/' }, EXECUTE_OPTIONS),
      ).rejects.toThrow('unavailable')
    })

    it('rejects an unsuccessful response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        new Response('missing', { status: 404 }),
      ))

      await expect(
        findTool('get_page_markdown')
          .execute({ path: '/guides/nope' }, EXECUTE_OPTIONS),
      ).rejects.toThrow('404')
    })
  })

  describe('list_key_guides', () => {
    it('retries after a failed lookup instead of caching the failure', async () => {
      const listKeyGuides = vi.fn()
        .mockRejectedValueOnce(new Error('rate limited'))
        .mockResolvedValueOnce([{ path: '/guides/a-key', title: 'A' }])
      const tool = createWebMcpTools({
        origin: ORIGIN,
        listKeyGuides,
        navigate: vi.fn(),
      })[0]!

      await expect(tool.execute({}, EXECUTE_OPTIONS))
        .rejects.toThrow('rate limited')
      expect(JSON.parse(await tool.execute({}, EXECUTE_OPTIONS)))
        .toEqual([{ slug: 'a-key', title: 'A', url: `${ORIGIN}/guides/a-key` }])
    })
  })

  describe('registerWebMcpTools', () => {
    it('passes the signal to every registration', async () => {
      const registerTool = vi.fn().mockResolvedValue(undefined)
      const controller = new AbortController()
      const tools = createWebMcpTools({
        origin: ORIGIN,
        listKeyGuides: vi.fn(),
        navigate: vi.fn(),
      })

      await registerWebMcpTools({ registerTool }, tools, controller.signal)

      expect(registerTool).toHaveBeenCalledTimes(3)

      for (const call of registerTool.mock.calls) {
        expect(call[1]).toEqual({ signal: controller.signal })
      }
    })
  })
})
