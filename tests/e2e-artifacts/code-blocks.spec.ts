import { expect, test } from '@playwright/test'
import type { BrowserContext, FrameLocator, Page } from '@playwright/test'

const HOST_ORIGIN = `http://127.0.0.1:${process.env.ARTIFACTS_HOST_PORT || '8789'}`
const FRAME_SELECTOR = '[data-testid="artifact-frame"]'
const LIGHT_THEME = 'github-light-high-contrast'
const DARK_THEME = 'github-dark-high-contrast'

interface MountOptions {
  theme?: 'light' | 'dark'
  clipboard?: 'write' | 'deny' | 'fallback' | 'absent'
  viewer?: boolean
}

interface ArtifactInput {
  kind: 'html' | 'react' | 'markdown'
  content: string
}

const TS_SOURCE = [
  'interface Answer {',
  '  value: number',
  '}',
  '',
  'const answer: Answer = { value: 42 }',
].join('\n')

const MERMAID_SOURCE = 'graph TD\n  A[Start] --> B[Done]'

const MARKDOWN_DOCUMENT = [
  '# Notes',
  '',
  '```ts',
  TS_SOURCE,
  '```',
  '',
  '```',
  'plain text block',
  '```',
  '',
  '```mermaid',
  MERMAID_SOURCE,
  '```',
].join('\n')

async function mount(page: Page, options: MountOptions = {}) {
  await page.goto('/')
  await page.waitForFunction(() => {
    return document.body.dataset.harnessReady === 'true'
  })
  await page.evaluate((mountOptions) => {
    (window as any).harness.mount(mountOptions)
  }, options)
  await page.waitForFunction(() => {
    return (window as any).harness.state.ready === true
  })
}

async function render(page: Page, artifact: ArtifactInput) {
  await page.evaluate((payload) => {
    (window as any).harness.sendResult(payload)
  }, { title: 'Code blocks', ...artifact })
}

async function harnessState(page: Page) {
  return page.evaluate(() => {
    return JSON.parse(JSON.stringify((window as any).harness.state))
  })
}

async function grantClipboard(context: BrowserContext, browserName: string) {
  if (browserName !== 'chromium') {
    return
  }

  await context.grantPermissions(
    ['clipboard-read', 'clipboard-write'],
    { origin: HOST_ORIGIN },
  )
}

function expectedCopyLabel(result: { copied: boolean }): string {
  return result.copied ? 'Copied!' : 'Copy failed'
}

function artifactFrame(page: Page) {
  return page.frameLocator(FRAME_SELECTOR)
}

function diagramSvg(frame: FrameLocator) {
  return frame.locator('besidka-mermaid')
    .getByTestId('besidka-mermaid-diagram')
    .locator('svg')
    .first()
}

test.describe('artifact code and Mermaid blocks', () => {
  test('upgrades fenced code and Mermaid in a markdown artifact', async ({ page }) => {
    await mount(page)
    await render(page, { kind: 'markdown', content: MARKDOWN_DOCUMENT })

    const frame = artifactFrame(page)
    const codeBlocks = frame.locator('besidka-code')

    await expect(codeBlocks).toHaveCount(2)
    await expect(codeBlocks.first()).toHaveAttribute('lang', 'ts')
    await expect(codeBlocks.first().locator(`pre.shiki.${LIGHT_THEME}`))
      .toBeVisible()
    await expect(codeBlocks.first().getByTestId('besidka-code'))
      .toContainText('ts')

    const keywordColor = await codeBlocks.first()
      .locator('pre.shiki span')
      .filter({ hasText: /^interface$/ })
      .first()
      .evaluate((span) => {
        return getComputedStyle(span).color
      })

    expect(keywordColor).not.toBe('rgb(0, 0, 0)')
    await expect(codeBlocks.nth(1).locator('pre.shiki'))
      .toContainText('plain text block')
    await expect(diagramSvg(frame)).toBeVisible()
    await expect(frame.locator('.besidka-markdown > pre')).toHaveCount(0)
  })

  test('upgrades language-tagged blocks in html and honours the opt-out', async ({ page }) => {
    await mount(page)
    await render(page, {
      kind: 'html',
      content: `<!doctype html><body>
        <pre id="tagged"><code class="language-js">const total = 1 + 2</code></pre>
        <pre id="raw" data-besidka-raw><code class="language-js">const kept = true</code></pre>
        <pre id="plain"><code>untagged stays</code></pre>
        <pre><code class="language-mermaid">${MERMAID_SOURCE}</code></pre>
        <besidka-code lang="ts">
          const isSmaller = 1 &lt; 2
          const both = true &amp;&amp; isSmaller
        </besidka-code>
        <script>
          window.besidkaCodeCount = document.querySelectorAll('besidka-code').length;
        </script>
      </body>`,
    })

    const frame = artifactFrame(page)

    await expect(frame.locator('besidka-code')).toHaveCount(2)
    await expect(frame.locator('#raw code')).toHaveText('const kept = true')
    await expect(frame.locator('#plain code')).toHaveText('untagged stays')
    await expect(diagramSvg(frame)).toBeVisible()
    await expect(frame.locator('besidka-code').nth(1).locator('pre.shiki'))
      .toContainText('const isSmaller = 1 < 2')
    await expect(frame.locator('besidka-code').first().locator('pre.shiki'))
      .toContainText('const total = 1 + 2')
  })

  test('works from JSX in a React artifact and follows prop changes', async ({ page }) => {
    await mount(page)
    await render(page, {
      kind: 'react',
      content: `import { useState } from 'react'

export default function App() {
  const [source, setSource] = useState('const first: number = 1')

  return (
    <main>
      <button onClick={() => setSource('const second: string = "two"')}>Change</button>
      <besidka-code lang="ts">{source}</besidka-code>
      <besidka-mermaid>{${JSON.stringify(MERMAID_SOURCE)}}</besidka-mermaid>
    </main>
  )
}`,
    })

    const frame = artifactFrame(page)
    const code = frame.locator('besidka-code')

    await expect(code.locator('pre.shiki')).toContainText('const first')
    await expect(diagramSvg(frame)).toBeVisible()
    await frame.getByRole('button', { name: 'Change' }).click()
    await expect(code.locator('pre.shiki')).toContainText('const second')
  })

  test('re-highlights code and re-renders diagrams when the theme changes', async ({ page }) => {
    await mount(page)
    await render(page, { kind: 'markdown', content: MARKDOWN_DOCUMENT })

    const frame = artifactFrame(page)
    const firstCode = frame.locator('besidka-code').first()
    const diagram = frame.locator('besidka-mermaid')
      .getByTestId('besidka-mermaid-diagram')

    await expect(firstCode.locator(`pre.shiki.${LIGHT_THEME}`)).toBeVisible()
    await expect(diagram).toHaveAttribute('data-theme', 'light')

    const lightBackground = await firstCode.getByTestId('besidka-code')
      .evaluate((block) => {
        return getComputedStyle(block).borderColor
      })

    await page.evaluate(() => {
      (window as any).harness.setTheme('dark')
    })

    await expect(firstCode.locator(`pre.shiki.${DARK_THEME}`)).toBeVisible()
    await expect(diagram).toHaveAttribute('data-theme', 'dark')
    expect(await firstCode.getByTestId('besidka-code').evaluate((block) => {
      return getComputedStyle(block).borderColor
    })).not.toBe(lightBackground)
  })

  test('copies the exact source through the host', async ({ page, context, browserName }) => {
    await grantClipboard(context, browserName)
    await mount(page, { clipboard: 'write' })
    await render(page, { kind: 'markdown', content: MARKDOWN_DOCUMENT })

    const frame = artifactFrame(page)
    const copyButton = frame.locator('besidka-code').first()
      .getByTestId('besidka-code-copy')

    await expect(frame.locator('besidka-code').first().locator('pre.shiki'))
      .toBeVisible()
    await copyButton.click()
    await expect.poll(async () => {
      return (await harnessState(page)).clipboardWrites.length
    }).toBe(1)

    const [firstWrite] = (await harnessState(page)).clipboardWrites

    expect(firstWrite.text).toBe(TS_SOURCE)
    await expect(copyButton).toContainText(
      expectedCopyLabel(firstWrite.result),
    )

    if (browserName === 'chromium') {
      expect(firstWrite.result).toEqual({ copied: true })
      expect(await page.evaluate(() => {
        return navigator.clipboard.readText()
      })).toBe(TS_SOURCE)
    }

    const mermaidCopy = frame.locator('besidka-mermaid')
      .getByTestId('besidka-mermaid-copy')

    await mermaidCopy.click()
    await expect.poll(async () => {
      return (await harnessState(page)).clipboardWrites.length
    }).toBe(2)

    const secondWrite = (await harnessState(page)).clipboardWrites[1]

    expect(secondWrite.text).toBe(MERMAID_SOURCE)
    await expect(mermaidCopy).toContainText(
      expectedCopyLabel(secondWrite.result),
    )
    await expect(copyButton).toContainText('Copy', { timeout: 5_000 })
  })

  test('falls back to a copy button in the host when the browser refuses', async ({ page, context, browserName }) => {
    await grantClipboard(context, browserName)
    await mount(page, { clipboard: 'fallback' })
    await render(page, { kind: 'markdown', content: MARKDOWN_DOCUMENT })

    const copyButton = artifactFrame(page).locator('besidka-code').first()
      .getByTestId('besidka-code-copy')

    await copyButton.click()
    await page.getByTestId('host-copy-fallback').click()
    await expect.poll(async () => {
      return (await harnessState(page)).clipboardWrites.length
    }).toBe(1)

    const [write] = (await harnessState(page)).clipboardWrites

    expect(write.text).toBe(TS_SOURCE)
    await expect(copyButton).toContainText(expectedCopyLabel(write.result))

    if (browserName === 'chromium') {
      expect(write.result).toEqual({ copied: true })
    }
  })

  test('shows Copy failed when the host denies or cannot copy', async ({ page }) => {
    await mount(page, { clipboard: 'deny' })
    await render(page, { kind: 'markdown', content: MARKDOWN_DOCUMENT })

    let copyButton = artifactFrame(page).locator('besidka-code').first()
      .getByTestId('besidka-code-copy')

    await copyButton.click()
    await expect(copyButton).toContainText('Copy failed')
    await expect(copyButton).toHaveAttribute(
      'title',
      'The browser denied access to the clipboard.',
    )

    await mount(page, { clipboard: 'absent' })
    await render(page, { kind: 'markdown', content: MARKDOWN_DOCUMENT })

    copyButton = artifactFrame(page).locator('besidka-code').first()
      .getByTestId('besidka-code-copy')

    await copyButton.click()
    await expect(copyButton).toContainText('Copy failed')
    await expect(copyButton).toHaveAttribute('title', 'Not available here.')
  })

  test('asks the host to open its diagram viewer', async ({ page }) => {
    await mount(page, { viewer: true })
    await render(page, { kind: 'markdown', content: MARKDOWN_DOCUMENT })

    const mermaid = artifactFrame(page).locator('besidka-mermaid')

    await expect(diagramSvg(artifactFrame(page))).toBeVisible()
    await mermaid.getByTestId('besidka-mermaid-fullscreen').click()
    await expect.poll(async () => {
      return (await harnessState(page)).diagramViews
    }).toEqual([MERMAID_SOURCE])

    await mount(page)
    await render(page, { kind: 'markdown', content: MARKDOWN_DOCUMENT })

    const fullscreen = artifactFrame(page).locator('besidka-mermaid')
      .getByTestId('besidka-mermaid-fullscreen')

    await expect(fullscreen).toBeEnabled()
    await fullscreen.click()
    await expect(fullscreen).toContainText('Unavailable')
  })

  test('ignores forged, synthetic and oversized copy requests', async ({ page }) => {
    await mount(page, { clipboard: 'write', viewer: true })
    await render(page, {
      kind: 'html',
      content: `<!doctype html><body>
        <besidka-code lang="ts" id="small">const secret = 1</besidka-code>
        <besidka-code lang="text" id="huge"></besidka-code>
        <script>
          document.getElementById('huge').textContent = 'x'.repeat(600 * 1024);
          const forged = {
            jsonrpc: '2.0',
            id: 7,
            method: 'ui/clipboard-write',
            params: { text: 'forged', userActivation: true },
          };
          window.parent.postMessage(forged, '*');
          window.top.postMessage(forged, '*');
          window.parent.postMessage({
            jsonrpc: '2.0',
            id: 8,
            method: 'besidka/open-diagram-viewer',
            params: { source: 'graph TD; A-->B', userActivation: true },
          }, '*');
          const timer = setInterval(() => {
            const button = document.getElementById('small').shadowRoot
              ?.querySelector('[data-testid="besidka-code-copy"]');
            if (button) {
              clearInterval(timer);
              button.click();
              window.syntheticClicked = true;
            }
          }, 20);
        </script>
      </body>`,
    })

    const frame = artifactFrame(page)
    const smallCopy = frame.locator('#small').getByTestId('besidka-code-copy')
    const hugeCopy = frame.locator('#huge').getByTestId('besidka-code-copy')

    await expect(smallCopy).toContainText('Copy failed')
    await expect(smallCopy).toHaveAttribute(
      'title',
      'The browser blocked copying from the artifact.',
    )
    await hugeCopy.click()
    await expect(hugeCopy).toContainText('Copy failed')
    await expect(hugeCopy).toHaveAttribute('title', 'Too large to send.')
    await page.waitForTimeout(300)

    const state = await harnessState(page)

    expect(state.clipboardWrites).toEqual([])
    expect(state.diagramViews).toEqual([])
  })
})
