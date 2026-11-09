import { expect, test } from '@playwright/test'
import type { FrameLocator, Page } from '@playwright/test'

const FRAME_SELECTOR = '[data-testid="artifact-frame"]'
const DESIGN_STYLE_SELECTOR = 'style[data-besidka-design]'
const COMPILE_MEASURE = 'besidka-design-compile'
const BUILD_MEASURE = 'besidka-design-build'
const RUNTIME_ORIGIN = `http://127.0.0.1:${process.env.ARTIFACTS_RUNTIME_PORT || '8788'}`
const HOST_ORIGIN = `http://127.0.0.1:${process.env.ARTIFACTS_HOST_PORT || '8789'}`

interface ArtifactInput {
  kind: 'html' | 'react' | 'markdown'
  content: string
}

const QUIZ_HTML = `<!doctype html>
<html><head><title>Quiz</title></head>
<body class="bg-base-200 min-h-screen p-4">
  <main class="mx-auto max-w-xl">
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body gap-4">
        <div class="flex items-center justify-between">
          <h1 class="card-title text-2xl">Photosynthesis</h1>
          <span id="badge" class="badge badge-soft badge-accent">1 / 10</span>
        </div>
        <progress class="progress progress-accent w-full" value="10" max="100"></progress>
        <p class="text-base-content/80">Which pigment absorbs light?</p>
        <div id="answers" class="grid gap-2"></div>
        <div class="w-[123px] h-2 rounded-box bg-primary" id="arbitrary"></div>
        <textarea id="notes" class="textarea w-full" placeholder="Notes"></textarea>
        <div class="card-actions justify-end">
          <button id="check" class="btn btn-primary">Check</button>
        </div>
      </div>
    </div>
  </main>
  <script>
    const answers = ['Chlorophyll', 'Keratin', 'Insulin']
    document.getElementById('answers').innerHTML = answers.map((answer) => {
      return '<button class="btn btn-outline justify-start answer">' + answer + '</button>'
    }).join('')
    document.getElementById('check').addEventListener('click', () => {
      document.getElementById('badge').classList.add('badge-success', 'ring-4')
    })
  </script>
</body></html>`

const OVERRIDE_HTML = `<!doctype html>
<html><head><style>.btn { background: rgb(1, 2, 3); }</style></head>
<body><button id="own" class="btn btn-primary">Own colour</button></body></html>`

const REACT_SOURCE = `
import { useState } from 'react'

export default function Counter() {
  const [count, setCount] = useState(0)

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body">
        <p id="count" className={count > 0 ? 'text-success text-3xl' : 'text-3xl'}>{count}</p>
        <button id="increment" className="btn btn-accent" onClick={() => setCount(count + 1)}>Add</button>
      </div>
    </div>
  )
}
`

async function mount(page: Page, theme: 'light' | 'dark' = 'light') {
  await page.goto('/')
  await page.waitForFunction(() => {
    return document.body.dataset.harnessReady === 'true'
  })
  await page.evaluate((mountTheme) => {
    (window as any).harness.mount({ theme: mountTheme })
  }, theme)
  await page.waitForFunction(() => {
    return (window as any).harness.state.ready === true
  })
}

async function render(page: Page, artifact: ArtifactInput) {
  await page.evaluate((payload) => {
    (window as any).harness.sendResult(payload)
  }, { title: 'Design system', ...artifact })
}

function artifactFrame(page: Page): FrameLocator {
  return page.frameLocator(FRAME_SELECTOR)
}

async function computedStyle(
  frame: FrameLocator,
  selector: string,
  property: string,
) {
  return frame.locator(selector).first().evaluate((element, name) => {
    return getComputedStyle(element).getPropertyValue(name)
  }, property)
}

async function themeColor(frame: FrameLocator, token: string) {
  return frame.locator('html').evaluate((root, name) => {
    const probe = document.createElement('span')

    probe.style.color = `var(${name})`
    root.querySelector('body')?.append(probe)

    const color = getComputedStyle(probe).color

    probe.remove()

    return color
  }, token)
}

test.describe('artifact design system', () => {
  test('styles an html artifact with daisyUI, Tailwind and the Besidka theme', async ({ page }) => {
    const requestOrigins = new Set<string>()

    page.on('request', (request) => {
      requestOrigins.add(new URL(request.url()).origin)
    })

    await mount(page)
    await render(page, { kind: 'html', content: QUIZ_HTML })

    const frame = artifactFrame(page)

    await expect(frame.locator('#check')).toBeVisible()
    await expect(frame.locator(DESIGN_STYLE_SELECTOR)).toHaveCount(1)

    const primary = await themeColor(frame, '--color-primary')

    expect(await computedStyle(frame, '#check', 'background-color'))
      .toBe(primary)
    expect(await computedStyle(frame, '#arbitrary', 'width')).toBe('123px')
    expect(await computedStyle(frame, '.answer', 'border-top-style'))
      .toBe('solid')
    expect(await computedStyle(frame, 'body', 'font-family'))
      .toContain('Nunito')
    expect(await computedStyle(frame, '#notes', 'border-top-left-radius'))
      .toBe('8px')
    expect(await frame.locator('html').evaluate(async () => {
      const faces = await document.fonts.load('700 16px Nunito', 'Ab Жж')

      return faces.length
    })).toBeGreaterThan(0)

    await frame.locator('#check').click()
    await expect.poll(async () => {
      return computedStyle(frame, '#badge', 'box-shadow')
    }).not.toBe('none')

    const state = await page.evaluate(() => {
      return (window as any).harness.state
    })

    expect(state.messages).toEqual([])
    expect([...requestOrigins].sort())
      .toEqual([HOST_ORIGIN, RUNTIME_ORIGIN].sort())
  })

  test('follows the host theme without a reload', async ({ page }) => {
    await mount(page, 'light')
    await render(page, { kind: 'html', content: QUIZ_HTML })

    const frame = artifactFrame(page)

    await expect(frame.locator('.card')).toBeVisible()

    const lightCard = await computedStyle(frame, '.card', 'background-color')

    await page.evaluate(() => {
      (window as any).harness.setTheme('dark')
    })
    await expect.poll(async () => {
      return computedStyle(frame, '.card', 'background-color')
    }).not.toBe(lightCard)
    expect(await frame.locator('html').getAttribute('data-theme')).toBe('dark')
  })

  test('lets the artifact\'s own CSS win over daisyUI', async ({ page }) => {
    await mount(page)
    await render(page, { kind: 'html', content: OVERRIDE_HTML })

    const frame = artifactFrame(page)

    await expect(frame.locator('#own')).toBeVisible()
    expect(await computedStyle(frame, '#own', 'background-color'))
      .toBe('rgb(1, 2, 3)')
    expect(await computedStyle(frame, '#own', 'border-top-left-radius'))
      .not.toBe('0px')
  })

  test('styles a React artifact and classes added by state changes', async ({ page }) => {
    await mount(page)
    await render(page, { kind: 'react', content: REACT_SOURCE })

    const frame = artifactFrame(page)

    await expect(frame.locator('#increment')).toBeVisible()

    const accent = await themeColor(frame, '--color-accent')
    const success = await themeColor(frame, '--color-success')

    expect(await computedStyle(frame, '#increment', 'background-color'))
      .toBe(accent)
    expect(await computedStyle(frame, '#count', 'font-size')).toBe('30px')
    expect(await computedStyle(frame, '#root', 'padding-top')).toBe('16px')
    expect(await computedStyle(frame, 'body', 'font-family'))
      .toContain('Nunito')

    await frame.locator('#increment').click()
    await expect.poll(async () => {
      return computedStyle(frame, '#count', 'color')
    }).toBe(success)
  })

  test('gives a classless html artifact the same base styles', async ({ page }) => {
    await mount(page)
    await render(page, {
      kind: 'html',
      content: '<!doctype html><body><h1 id="plain">Plain</h1></body>',
    })

    const frame = artifactFrame(page)

    await expect(frame.locator('#plain')).toBeVisible()
    await expect(frame.locator(DESIGN_STYLE_SELECTOR)).toHaveCount(1)
    expect(await computedStyle(frame, '#plain', 'font-size')).toBe('16px')
    expect(await computedStyle(frame, '#plain', 'font-family'))
      .toContain('Nunito')
  })

  test('leaves markdown artifacts on the shell styles', async ({ page }) => {
    await mount(page)
    await render(page, { kind: 'html', content: QUIZ_HTML })

    const frame = artifactFrame(page)

    await expect(frame.locator(DESIGN_STYLE_SELECTOR)).toHaveCount(1)
    await render(page, { kind: 'markdown', content: '# Notes\n\n- one\n- two' })
    await expect(frame.locator('.besidka-markdown li')).toHaveCount(2)
    await expect(frame.locator(DESIGN_STYLE_SELECTOR)).toHaveCount(0)
    expect(await computedStyle(frame, '.besidka-markdown ul', 'list-style-type'))
      .toBe('disc')
  })

  test('records compile and build timings', async ({ page, browserName }, testInfo) => {
    await mount(page)
    await render(page, { kind: 'html', content: QUIZ_HTML })

    const frame = artifactFrame(page)

    await expect(frame.locator('#check')).toBeVisible()

    const timings = await frame.locator('html').evaluate((_root, names) => {
      const read = (name: string) => {
        return performance.getEntriesByName(name).map((entry) => {
          return Math.round(entry.duration * 10) / 10
        })
      }

      return {
        compile: read(names.compile),
        build: read(names.build),
        cssBytes: document.querySelector('style[data-besidka-design]')
          ?.textContent?.length ?? 0,
      }
    }, { compile: COMPILE_MEASURE, build: BUILD_MEASURE })

    testInfo.annotations.push({
      type: 'design-timings',
      description: `${browserName} ${JSON.stringify(timings)}`,
    })
    expect(timings.compile).toHaveLength(1)
    expect(timings.build.length).toBeGreaterThan(0)
  })
})
