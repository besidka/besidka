import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import ActionEmail from '../../../app/emails/ActionEmail.vue'
import NoticeEmail from '../../../app/emails/NoticeEmail.vue'

/**
 * `nuxt-email-renderer`'s `package.json` `exports` map only lists "." and
 * "./components", and "." has no `require` condition, so resolving the
 * package specifier through Node/Vite's exports algorithm is unreliable
 * across dependency versions (works under some, throws
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` under others). The deep runtime file
 * (`dist/runtime/server/utils/render.js`) isn't in `exports` at all either.
 * Separately, the module's public `renderEmailComponent` resolves templates
 * through the `#email-templates` virtual module, which is only registered
 * inside a Nitro build and does not exist under Vitest. Locating the
 * package root as a plain filesystem path from `process.cwd()` (pnpm
 * symlinks direct dependencies at the workspace root's `node_modules`;
 * `import.meta.url` is unreliable here because Vitest's module runner does
 * not always give it a real `file:` URL) and importing the runtime file
 * directly bypasses exports resolution entirely, and `render()` accepts an
 * already-imported component directly, bypassing the virtual template
 * registry too. The result is the real Vue SSR render path
 * (`vue/server-renderer` + the module's own email component registration),
 * not a mock.
 */
async function importRealRender() {
  const packageRoot = join(process.cwd(), 'node_modules/nuxt-email-renderer')
  const renderPath = join(packageRoot, 'dist/runtime/server/utils/render.js')

  return import(pathToFileURL(renderPath).href)
}

const actionEmailProps = {
  preview: 'Reset your Besidka account password',
  heading: 'Reset your password',
  intro: 'We received a request to reset your Besidka account password.',
  ctaLabel: 'Reset password',
  url: 'https://besidka.com/reset?token=abc123',
  footnote: 'If you didn\'t request this, you can safely ignore this email.',
}

const noticeEmailProps = {
  preview: 'Your password was changed',
  heading: 'Your password was changed',
  body: 'Your Besidka account password was just changed. If this was not '
    + 'you, reset your password immediately.',
}

describe('email template rendering', () => {
  it('renders ActionEmail html with heading, cta href and footer links',
    async () => {
      const { render } = await importRealRender()
      const html = await render(ActionEmail, actionEmailProps)

      expect(html).toContain(actionEmailProps.heading)
      expect(html).toContain(`href="${actionEmailProps.url}"`)
      expect(html).toContain('https://github.com/besidka/besidka')
      expect(html).toContain('https://besidka.com/privacy-policy')
      expect(html).toContain('https://besidka.com/terms-of-use')
      expect(html).toContain('data-id="__nuxt-email-style"')
      expect(html).toContain('prefers-color-scheme: dark')
    })

  it('renders NoticeEmail html with heading, body and footer links',
    async () => {
      const { render } = await importRealRender()
      const html = await render(NoticeEmail, noticeEmailProps)

      expect(html).toContain(noticeEmailProps.heading)
      expect(html).toContain(noticeEmailProps.body)
      expect(html).toContain('https://github.com/besidka/besidka')
      expect(html).toContain('https://besidka.com/privacy-policy')
      expect(html).toContain('https://besidka.com/terms-of-use')
      expect(html).toContain('data-id="__nuxt-email-style"')
      expect(html).toContain('prefers-color-scheme: dark')
    })

  it('renders ActionEmail plain text with heading, body and raw url',
    async () => {
      const { render } = await importRealRender()
      const text = await render(ActionEmail, actionEmailProps, {
        plainText: true,
      })
      const normalizedText = text.replace(/\s+/g, ' ').toLowerCase()

      expect(normalizedText).toContain(
        actionEmailProps.heading.toLowerCase(),
      )
      expect(normalizedText).toContain(actionEmailProps.intro.toLowerCase())
      expect(text).toContain(actionEmailProps.url)
      expect(text).not.toMatch(/<\/?[a-z][^>]*>/i)
    })

  it('renders NoticeEmail plain text with heading and body, no html tags',
    async () => {
      const { render } = await importRealRender()
      const text = await render(NoticeEmail, noticeEmailProps, {
        plainText: true,
      })
      const normalizedText = text.replace(/\s+/g, ' ').toLowerCase()

      expect(normalizedText).toContain(
        noticeEmailProps.heading.toLowerCase(),
      )
      expect(normalizedText).toContain(noticeEmailProps.body.toLowerCase())
      expect(text).not.toMatch(/<\/?[a-z][^>]*>/i)
    })
})
