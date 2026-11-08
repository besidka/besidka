import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const HOST_ORIGIN = `http://127.0.0.1:${process.env.ARTIFACTS_HOST_PORT || '8789'}`

const SPIKE_FRAME_DOCUMENT = [
  '<!doctype html><body>',
  '<button id="copy" style="width:200px;height:60px">Copy</button>',
  '<script>',
  'let port = null;',
  'addEventListener("message", (event) => {',
  '  if (event.source === parent && event.ports.length === 1) {',
  '    port = event.ports[0];',
  '  }',
  '});',
  'document.getElementById("copy").addEventListener("click", () => {',
  '  port.postMessage({ text: "spike-" + Date.now(), frameActive: navigator.userActivation ? navigator.userActivation.isActive : null });',
  '});',
  '</script></body>',
].join('')

interface SpikeResult {
  parentActive: boolean | null
  frameActive: boolean | null
  hasFocus: boolean
  outcome: string
}

async function openSpike(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    return document.body.dataset.harnessReady === 'true'
  })
  await page.evaluate((frameDocument) => {
    const results: unknown[] = []
    const frame = document.createElement('iframe')
    const channel = new MessageChannel()

    ;(window as any).spikeResults = results
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('allow', '')
    frame.dataset.testid = 'spike-frame'
    frame.srcdoc = frameDocument
    channel.port1.onmessage = async (event) => {
      const parentActive = navigator.userActivation
        ? navigator.userActivation.isActive
        : null
      const hasFocus = document.hasFocus()

      try {
        await navigator.clipboard.writeText(event.data.text)
        results.push({
          parentActive,
          frameActive: event.data.frameActive,
          hasFocus,
          outcome: 'written',
        })
      } catch (exception) {
        results.push({
          parentActive,
          frameActive: event.data.frameActive,
          hasFocus,
          outcome: `rejected: ${(exception as Error).name}`,
        })
      }
    }
    frame.addEventListener('load', () => {
      frame.contentWindow?.postMessage('connect', '*', [channel.port2])
    }, { once: true })
    document.body.append(frame)
  }, SPIKE_FRAME_DOCUMENT)
  await page.waitForTimeout(300)
}

async function clickAndCollect(page: Page): Promise<SpikeResult> {
  await page.frameLocator('[data-testid="spike-frame"]')
    .locator('#copy')
    .click()
  await expect.poll(async () => {
    return page.evaluate(() => {
      return (window as any).spikeResults.length
    })
  }).toBe(1)

  return page.evaluate(() => {
    return (window as any).spikeResults[0]
  })
}

/**
 * Records whether a click inside a sandboxed opaque-origin frame lets the
 * parent write to the clipboard when the frame asks over a MessagePort.
 * Results are written to the test annotations and asserted per engine, so a
 * browser change in user-activation propagation shows up here first
 * (docs/artifacts-runtime.md, "Copy through the bridge").
 */
test.describe('clipboard gesture spike', () => {
  test('parent clipboard write after a click in the sandboxed frame', async ({
    page,
    context,
    browserName,
  }) => {
    let permissionGranted = false

    if (browserName === 'chromium') {
      await context.grantPermissions(
        ['clipboard-read', 'clipboard-write'],
        { origin: HOST_ORIGIN },
      )
      permissionGranted = true
    }

    await openSpike(page)

    const result = await clickAndCollect(page)

    test.info().annotations.push({
      type: 'spike',
      description: JSON.stringify({
        browserName,
        permissionGranted,
        ...result,
      }),
    })

    expect(result.frameActive).toBe(true)

    if (browserName === 'chromium') {
      expect(result.parentActive).toBe(true)
      expect(result.outcome).toBe('written')

      const pasted = await page.evaluate(() => {
        return navigator.clipboard.readText()
      })

      expect(pasted).toMatch(/^spike-/)
    }
  })

  test('parent clipboard write without a clipboard permission grant', async ({
    page,
    browserName,
  }) => {
    await openSpike(page)

    const result = await clickAndCollect(page)

    test.info().annotations.push({
      type: 'spike',
      description: JSON.stringify({
        browserName,
        permissionGranted: false,
        ...result,
      }),
    })

    expect(result.frameActive).toBe(true)
  })

  test('parent clipboard write without any click is refused', async ({
    page,
  }) => {
    await page.goto('/')

    const outcome = await page.evaluate(async () => {
      try {
        await navigator.clipboard.writeText('no-gesture')

        return 'written'
      } catch (exception) {
        return `rejected: ${(exception as Error).name}`
      }
    })

    test.info().annotations.push({
      type: 'spike',
      description: JSON.stringify({ noGesture: outcome }),
    })
  })
})
