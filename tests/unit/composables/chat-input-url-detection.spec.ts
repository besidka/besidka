import { describe, expect, it } from 'vitest'
import { nextTick, ref, watch } from 'vue'

const URL_PATTERN = /https?:\/\//

describe('chat input URL detection', () => {
  describe('URL_PATTERN', () => {
    it('detects http:// URLs', () => {
      expect(URL_PATTERN.test('http://example.com')).toBe(true)
    })

    it('detects https:// URLs', () => {
      expect(URL_PATTERN.test('https://example.com')).toBe(true)
    })

    it('detects URL within text', () => {
      expect(
        URL_PATTERN.test('check this https://example.com'),
      ).toBe(true)
    })

    it('does not match partial "http" without slashes', () => {
      expect(URL_PATTERN.test('http')).toBe(false)
    })

    it('does not match partial "https" without slashes', () => {
      expect(URL_PATTERN.test('https')).toBe(false)
    })

    it('does not match "http:" without slashes', () => {
      expect(URL_PATTERN.test('http:')).toBe(false)
    })

    it('does not match plain text', () => {
      expect(URL_PATTERN.test('hello world')).toBe(false)
    })
  })

  describe('watcher behavior', () => {
    function setupWatcher(options: {
      initialTools?: string[]
      webSearchSupported?: boolean
    } = {}) {
      const {
        initialTools = [],
        webSearchSupported = true,
      } = options

      const input = ref<string>('')
      const tools = ref<string[]>(initialTools)

      const isWebSearchEnabled = () => {
        return tools.value.includes('web_search')
      }

      watch(input, (newValue) => {
        if (
          !isWebSearchEnabled()
          && webSearchSupported
          && URL_PATTERN.test(newValue)
        ) {
          tools.value = [...tools.value, 'web_search']
        }
      }, {
        immediate: true,
        flush: 'post',
      })

      return { input, tools }
    }

    it('enables web search when URL is typed', async () => {
      const { input, tools } = setupWatcher()

      input.value = 'https://example.com'
      await nextTick()

      expect(tools.value).toContain('web_search')
    })

    it('enables web search for http:// URLs', async () => {
      const { input, tools } = setupWatcher()

      input.value = 'http://example.com'
      await nextTick()

      expect(tools.value).toContain('web_search')
    })

    it('does not enable for text without URLs', async () => {
      const { input, tools } = setupWatcher()

      input.value = 'hello world'
      await nextTick()

      expect(tools.value).not.toContain('web_search')
    })

    it('does not re-enable if already enabled', async () => {
      const { input, tools } = setupWatcher({
        initialTools: ['web_search'],
      })

      input.value = 'https://example.com'
      await nextTick()

      expect(
        tools.value.filter(tool => tool === 'web_search'),
      ).toHaveLength(1)
    })

    it(
      'does not enable if model does not support web search',
      async () => {
        const { input, tools } = setupWatcher({
          webSearchSupported: false,
        })

        input.value = 'https://example.com'
        await nextTick()

        expect(tools.value).not.toContain('web_search')
      },
    )

    it('works with pasted content containing URL', async () => {
      const { input, tools } = setupWatcher()

      input.value = 'Check this link: https://example.com/page'
      await nextTick()

      expect(tools.value).toContain('web_search')
    })

    it(
      'does not auto-disable when URL is removed',
      async () => {
        const { input, tools } = setupWatcher()

        input.value = 'https://example.com'
        await nextTick()
        expect(tools.value).toContain('web_search')

        input.value = 'no url here'
        await nextTick()
        expect(tools.value).toContain('web_search')
      },
    )
  })
})
