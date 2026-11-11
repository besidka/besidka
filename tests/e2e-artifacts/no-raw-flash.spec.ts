import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

interface Sample {
  blocks: number
  exposedRaw: number
  partialShown: boolean
  designMissing: boolean
}

type Kind = 'html' | 'react' | 'svg' | 'mermaid' | 'markdown'

const SAMPLER_FLAG = '__besidkaSampling'

const SAMPLER_KEY = '__besidkaSamples'

const DIAGRAM = 'graph TD\n  A[Start] --> B[Done]'

const CODE_BLOCK = 'const answer: number = 42'

const ARTIFACTS: Record<Kind, string> = {
  html: `<!doctype html>
<html><head><title>Page</title></head>
<body class="bg-base-200 p-4">
  <div class="card bg-base-100"><div class="card-body">
    <h1 class="card-title">Report</h1>
    <button class="btn btn-primary">Go</button>
    <pre><code class="language-ts">${CODE_BLOCK}</code></pre>
    <pre><code class="language-mermaid">${DIAGRAM}</code></pre>
  </div></div>
</body></html>`,
  react: `import { useState } from 'react'

export default function Counter() {
  const [count, setCount] = useState(0)

  return (
    <div className="card bg-base-100">
      <div className="card-body">
        <p id="count">{count}</p>
        <button className="btn btn-accent" onClick={() => setCount(count + 1)}>Add</button>
      </div>
    </div>
  )
}
`,
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="teal"/></svg>',
  mermaid: DIAGRAM,
  markdown: [
    '# Notes',
    '',
    `\`\`\`ts\n${CODE_BLOCK}\n\`\`\``,
    '',
    `\`\`\`mermaid\n${DIAGRAM}\n\`\`\``,
  ].join('\n'),
}

async function installSampler(page: Page) {
  await page.addInitScript(({ flag, key }) => {
    if (window.parent === window) {
      return
    }

    const samples: unknown[] = []

    ;(window as any)[key] = samples

    function sample() {
      if (!(window as any)[flag]) {
        return
      }

      const root = document.documentElement

      if (getComputedStyle(root).visibility === 'hidden') {
        return
      }

      const exposedRaw = [
        ...document.querySelectorAll('besidka-code, besidka-mermaid'),
      ].filter((block) => {
        return !block.hasAttribute('data-besidka-ready')
          && getComputedStyle(block).visibility !== 'hidden'
      }).length
      const shellRoot = document.getElementById('root')
      const hasDesign = !!document.querySelector('style[data-besidka-design]')
      const isReactContent = !!shellRoot?.firstElementChild
        && !shellRoot.querySelector('.besidka-partial')
        && !shellRoot.querySelector('.besidka-markdown')
        && !shellRoot.querySelector('.besidka-svg')
        && !shellRoot.querySelector('.besidka-mermaid')

      samples.push({
        blocks: document.querySelectorAll('besidka-code, besidka-mermaid').length,
        exposedRaw,
        partialShown: !!document.querySelector('.besidka-partial'),
        designMissing: !hasDesign && (!shellRoot || isReactContent),
      })
    }

    new MutationObserver(sample).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })

    const loop = () => {
      sample()
      requestAnimationFrame(loop)
    }

    requestAnimationFrame(loop)
    setInterval(sample, 4)
  }, { flag: SAMPLER_FLAG, key: SAMPLER_KEY })
}

async function openHarness(page: Page) {
  await installSampler(page)
  await page.goto('/')
  await page.waitForFunction(() => {
    return document.body.dataset.harnessReady === 'true'
  })
  await page.evaluate(() => {
    (window as any).harness.mount({})
  })
  await page.waitForFunction(() => {
    return (window as any).harness.state.ready === true
  })
}

function runtimeFrame(page: Page) {
  const frame = page.frames().find((candidate) => {
    return candidate !== page.mainFrame()
  })

  if (!frame) {
    throw new Error('The runtime frame is missing')
  }

  return frame
}

async function readSamples(page: Page): Promise<Sample[]> {
  return runtimeFrame(page).evaluate((key) => {
    return (window as any)[key] as Sample[]
  }, SAMPLER_KEY)
}

async function renderAndRecord(page: Page, kind: Kind) {
  await runtimeFrame(page).evaluate((flag) => {
    (window as any)[flag] = true
  }, SAMPLER_FLAG)
  await page.evaluate((payload) => {
    (window as any).harness.sendResult(payload)
  }, { kind, title: 'Sampler', content: ARTIFACTS[kind] })
  await page.waitForFunction((expectedKind) => {
    return (window as any).harness.state.rendered.some(
      (entry: { kind: string, partial: boolean }) => {
        return entry.kind === expectedKind && !entry.partial
      },
    )
  }, kind)
  await page.waitForTimeout(300)
}

test.describe('Artifact reveal', () => {
  for (const kind of Object.keys(ARTIFACTS) as Kind[]) {
    test(`${kind} never shows its source or an unstyled page before the final render`, async ({ page }, testInfo) => {
      await openHarness(page)
      await renderAndRecord(page, kind)

      const samples = await readSamples(page)

      expect(samples.length).toBeGreaterThan(0)
      expect(samples.filter(sample => sample.exposedRaw > 0)).toEqual([])
      expect(samples.filter(sample => sample.partialShown)).toEqual([])
      expect(samples.filter(sample => sample.designMissing)).toEqual([])

      await page.screenshot({
        path: testInfo.outputPath(`${kind}-final.png`),
      })
    })
  }

  test('reports one final render per result, also for a script error', async ({ page }) => {
    await openHarness(page)
    await renderAndRecord(page, 'markdown')

    await page.evaluate((payload) => {
      (window as any).harness.sendResult(payload)
    }, {
      kind: 'html',
      title: 'Broken',
      content: '<!doctype html><body><script>throw new Error("boom")</script></body>',
    })
    await page.waitForFunction(() => {
      return (window as any).harness.state.rendered.filter(
        (entry: { kind: string }) => entry.kind === 'html',
      ).length === 1
    })

    const rendered = await page.evaluate(() => {
      return (window as any).harness.state.rendered
    })

    expect(rendered).toEqual([
      { kind: 'markdown', partial: false },
      { kind: 'html', partial: false },
    ])
  })
})
