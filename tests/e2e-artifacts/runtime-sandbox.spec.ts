import { expect, test } from '@playwright/test'
import type { Frame, Page } from '@playwright/test'

const RUNTIME_ORIGIN = `http://127.0.0.1:${process.env.ARTIFACTS_RUNTIME_PORT || '8788'}`
const OUTSIDE_ORIGIN = `http://127.0.0.1:${process.env.ARTIFACTS_OUTSIDE_PORT || '8790'}`
const FRAME_SELECTOR = '[data-testid="artifact-frame"]'

interface MountOptions {
  storage?: boolean
  complete?: boolean
  theme?: 'light' | 'dark'
}

interface ArtifactInput {
  kind: 'html' | 'react' | 'svg' | 'mermaid' | 'markdown'
  title?: string
  content: string
}

async function openHarness(page: Page, path = '/') {
  await page.goto(path)
  await page.waitForFunction(() => {
    return document.body.dataset.harnessReady === 'true'
  })
}

async function mount(page: Page, options: MountOptions = {}, path = '/') {
  await openHarness(page, path)
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
  }, { title: 'Test artifact', ...artifact })
}

function artifactFrame(page: Page) {
  return page.frameLocator(FRAME_SELECTOR)
}

function runtimeFrame(page: Page): Frame {
  const frame = page.frames().find((candidate) => {
    return candidate.url().startsWith(RUNTIME_ORIGIN)
  })

  if (!frame) {
    throw new Error('Runtime frame not found')
  }

  return frame
}

async function harnessState(page: Page) {
  return page.evaluate(() => {
    return JSON.parse(JSON.stringify((window as any).harness.state))
  })
}

async function outsideRequests(page: Page): Promise<string[]> {
  const response = await page.request.get('/__outside-requests')

  return response.json()
}

async function resetOutsideRequests(page: Page) {
  await page.request.get('/__outside-requests/reset')
}

test.describe('artifacts runtime sandbox', () => {
  test('serves the document with the sandbox CSP and an opaque origin', async ({ page }) => {
    const response = await page.request.get(`${RUNTIME_ORIGIN}/v1/index.html`)
    const policy = response.headers()['content-security-policy'] ?? ''

    expect(policy).toContain('sandbox allow-scripts')
    expect(policy).toContain('default-src \'none\'')
    expect(policy).toContain('connect-src \'none\'')
    expect(policy).toContain('form-action \'none\'')
    expect(policy).not.toContain('esm.sh')
    expect(response.headers()['cache-control']).toBe('no-cache')

    const notices = await page.request.get(
      `${RUNTIME_ORIGIN}/v1/THIRD_PARTY_NOTICES.txt`,
    )

    expect(notices.ok()).toBe(true)
    expect(await notices.text()).toContain('react@')

    await page.goto(`${RUNTIME_ORIGIN}/v1/index.html`)

    await expect(page.getByText('It does nothing on its own')).toBeVisible()
    expect(await page.evaluate(() => {
      return self.origin
    })).toBe('null')
    expect(await page.evaluate(() => {
      try {
        return document.cookie
      } catch (exception) {
        return `blocked: ${(exception as Error).name}`
      }
    })).toMatch(/^blocked/)
  })

  test('blocks network, cookies, storage and top navigation in the frame', async ({ page }) => {
    await mount(page, { storage: true })
    await resetOutsideRequests(page)

    const hostUrl = page.url()

    await render(page, {
      kind: 'html',
      content: `<!doctype html><body><p id="ready">probe</p><script>
        const results = {};
        async function attempt(name, run) {
          try {
            await run();
            results[name] = 'allowed';
          } catch (exception) {
            results[name] = 'blocked: ' + (exception && exception.name);
          }
        }
        (async () => {
          await attempt('fetch', () => fetch('${OUTSIDE_ORIGIN}/from-fetch'));
          await attempt('cookie', () => { document.cookie = 'probe=1'; return document.cookie; });
          await attempt('localStorage', () => window.localStorage.setItem('probe', '1'));
          await attempt('top', () => { window.top.location.href = '${OUTSIDE_ORIGIN}/from-top'; });
          const image = new Image();
          image.src = '${OUTSIDE_ORIGIN}/from-image';
          await new Promise((resolve) => setTimeout(resolve, 500));
          await window.besidka.storage.set('results', results);
        })();
      </script></body>`,
    })

    await expect.poll(async () => {
      return (await harnessState(page)).storage.results ?? null
    }).not.toBeNull()

    const { storage } = await harnessState(page)

    expect(storage.results.fetch).toMatch(/^blocked/)
    expect(storage.results.cookie).toMatch(/^blocked/)
    expect(storage.results.localStorage).toMatch(/^blocked/)
    expect(page.url()).toBe(hostUrl)

    const requests = await outsideRequests(page)

    expect(requests.filter((path) => {
      return path.startsWith('/from-')
    })).toEqual([])
  })

  test('ignores a forged connect from another window and a second connect', async ({ page }) => {
    await openHarness(page)
    await page.evaluate(() => {
      (window as any).harness.mountUnconnected()
    })
    await page.waitForFunction(() => {
      return (window as any).harness.state.loads === 1
    })
    await page.evaluate(() => {
      (window as any).harness.forgeConnectFromSibling()
    })
    await page.waitForFunction(() => {
      return (window as any).harness.probes.siblingPosted === true
    })
    await page.waitForTimeout(500)

    expect(await page.evaluate(() => {
      return [...(window as any).harness.probes.forgedSibling]
    })).toEqual([])

    await page.evaluate(() => {
      (window as any).harness.connectManually()
    })
    await expect.poll(async () => {
      return page.evaluate(() => {
        return [...(window as any).harness.probes.manual]
      })
    }).toContain('ui/initialize')

    await page.evaluate(() => {
      (window as any).harness.forgeSecondConnect()
    })
    await page.waitForTimeout(500)

    expect(await page.evaluate(() => {
      return [...(window as any).harness.probes.secondConnect]
    })).toEqual([])
  })

  test('renders all five kinds from tool results', async ({ page }) => {
    await mount(page)

    const frame = artifactFrame(page)

    await render(page, {
      kind: 'markdown',
      content: '# Quarterly report\n\n| Month | Sales |\n| --- | --- |\n| May | 12 |',
    })
    await expect(frame.getByRole('heading', { name: 'Quarterly report' }))
      .toBeVisible()
    await expect(frame.getByRole('cell', { name: '12' })).toBeVisible()

    await render(page, {
      kind: 'svg',
      content: '<svg data-testid="art-svg" xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="50" fill="tomato"/></svg>',
    })
    await expect(frame.getByTestId('art-svg')).toBeVisible()

    await render(page, {
      kind: 'mermaid',
      content: 'graph TD\n  Start --> Finish',
    })
    await expect(frame.locator('.besidka-mermaid')
      .getByTestId('besidka-mermaid-diagram')
      .locator('svg')
      .first()).toBeVisible({ timeout: 15_000 })
    await expect(frame.locator('.besidka-mermaid')).toContainText('Finish')

    await render(page, {
      kind: 'react',
      content: `import { useState } from 'react'
import { Line, LineChart, XAxis, YAxis } from 'recharts'
import { Star } from 'lucide-react'

type Point = { x: number, y: number }

const data: Point[] = [{ x: 1, y: 2 }, { x: 2, y: 5 }, { x: 3, y: 3 }]

export default function Chart() {
  const [count, setCount] = useState<number>(0)

  return (
    <div>
      <button data-testid="counter" onClick={() => setCount(count + 1)}>Clicked {count}</button>
      <Star data-testid="star" />
      <LineChart width={400} height={200} data={data}>
        <XAxis dataKey="x" />
        <YAxis />
        <Line dataKey="y" />
      </LineChart>
    </div>
  )
}`,
    })
    await expect(frame.locator('.recharts-surface')).toBeVisible({
      timeout: 15_000,
    })
    await expect(frame.getByTestId('star')).toBeVisible()
    await frame.getByTestId('counter').click()
    await expect(frame.getByTestId('counter')).toHaveText('Clicked 1')

    await render(page, {
      kind: 'html',
      content: '<!doctype html><html><head><title>Plain page</title></head><body><h1 id="html-title">Hello from HTML</h1></body></html>',
    })
    await expect(frame.locator('#html-title')).toHaveText('Hello from HTML')
    expect(await runtimeFrame(page).evaluate(() => {
      return {
        bridge: typeof (window as any).besidka,
        frozen: Object.isFrozen((window as any).besidka),
        generatedMark: document
          .querySelector('meta[name="ai-generated"]')
          ?.getAttribute('content'),
      }
    })).toEqual({ bridge: 'object', frozen: true, generatedMark: 'true' })

    await render(page, {
      kind: 'markdown',
      content: '## Back to markdown',
    })
    await expect(frame.getByRole('heading', { name: 'Back to markdown' }))
      .toBeVisible()

    const state = await harnessState(page)

    expect(state.loads).toBe(1)
    expect(state.navigations).toBe(0)
  })

  test('runs module scripts before load and keeps navigating markup inert', async ({ page }) => {
    await mount(page)
    await render(page, {
      kind: 'html',
      content: `<!doctype html><html><head>
        <meta http-equiv="refresh" content="0;url=${OUTSIDE_ORIGIN}/refresh">
        <noscript><style>body { background: rgb(255, 0, 0) }</style></noscript>
      </head><body>
        <p id="module">pending</p>
        <svg width="80" height="40"><a xlink:href="https://example.com/svg-link"><text data-testid="svg-link" x="0" y="20">open</text></a></svg>
        <script type="module">
          window.addEventListener('load', () => {
            document.getElementById('module').textContent = 'loaded'
          })
        </script>
      </body></html>`,
    })

    const frame = artifactFrame(page)

    await expect(frame.locator('#module')).toHaveText('loaded')
    expect(await runtimeFrame(page).evaluate(() => {
      return getComputedStyle(document.body).backgroundColor
    })).not.toBe('rgb(255, 0, 0)')

    await frame.getByTestId('svg-link').click()
    await expect.poll(async () => {
      return (await harnessState(page)).links
    }).toEqual(['https://example.com/svg-link'])
    await page.waitForTimeout(500)

    const state = await harnessState(page)

    expect(state.navigations).toBe(0)
    expect(state.loads).toBe(1)
  })

  test('previews streaming input without running partial code', async ({ page }) => {
    await mount(page)

    const frame = artifactFrame(page)

    await page.evaluate(() => {
      (window as any).harness.sendPartial({
        kind: 'markdown',
        title: 'Draft',
        content: '# Streaming head',
      })
    })
    await expect(frame.getByRole('heading', { name: 'Streaming head' }))
      .toBeVisible()

    await page.evaluate(() => {
      (window as any).harness.sendPartial({
        kind: 'html',
        title: 'Draft',
        content: '<body><script>document.title = "ran"</script><p>partial',
      })
    })
    await expect(frame.locator('.besidka-partial'))
      .toContainText('Writing HTML page')
    expect(await runtimeFrame(page).evaluate(() => {
      return document.title
    })).not.toBe('ran')

    await render(page, {
      kind: 'mermaid',
      content: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy',
    })
    await expect(frame.locator('.besidka-mermaid')
      .getByTestId('besidka-mermaid-diagram')
      .locator('svg')
      .first()).toBeVisible({ timeout: 15_000 })
  })

  test('reports a Mermaid diagram over the edge limit once, with a neutral placeholder', async ({ page }) => {
    await mount(page)

    const edges = Array.from({ length: 520 }, (_unused, index) => {
      return `  N${index} --> N${index + 1}`
    })

    await render(page, {
      kind: 'mermaid',
      content: `flowchart TD\n${edges.join('\n')}`,
    })

    const frame = artifactFrame(page)

    await expect(frame.getByTestId('besidka-diagram-limit'))
      .toHaveText('This diagram is too large to draw.')
    await expect.poll(async () => {
      return (await harnessState(page)).messages.length
    }).toBe(1)

    const [message] = (await harnessState(page)).messages

    expect(message.level).toBe('error')
    expect(message.data.code).toBe('mermaid-edge-limit')
    expect(message.data.limit).toBe(500)
    expect(message.data.message).toContain('This diagram is too large to draw')
    expect(message.data.message).not.toMatch(/initialize|maxEdges/i)
    expect(message.data.stack).toContain('Edge limit exceeded')
    await expect(frame.locator('#besidka-runtime-error')).toHaveCount(0)
  })

  test('rejects an unknown bare import with an in-frame error and no request', async ({ page }) => {
    const requestedUrls: string[] = []

    page.on('request', (request) => {
      requestedUrls.push(request.url())
    })

    await mount(page)
    await render(page, {
      kind: 'react',
      content: 'import pad from \'left-pad\'\nexport default function App() { return <p>{pad(\'1\', 3)}</p> }',
    })

    await expect(artifactFrame(page).getByRole('alert'))
      .toContainText('not available here: left-pad')
    expect(requestedUrls.filter((url) => {
      return url.includes('left-pad')
    })).toEqual([])

    const state = await harnessState(page)

    expect(state.messages.some((message: any) => {
      return message.level === 'error'
        && message.data.message.includes('left-pad')
    })).toBe(true)
  })

  test('reports size changes and errors, and re-themes without a reload', async ({ page }) => {
    await mount(page)
    await render(page, { kind: 'markdown', content: 'Short' })

    await expect.poll(async () => {
      return (await harnessState(page)).sizes.length
    }).toBeGreaterThan(0)

    const firstHeight = (await harnessState(page)).sizes.at(-1)

    await render(page, {
      kind: 'markdown',
      content: Array.from({ length: 30 }, (_value, index) => {
        return `Paragraph ${index}`
      }).join('\n\n'),
    })
    await expect.poll(async () => {
      return (await harnessState(page)).sizes.at(-1)
    }).toBeGreaterThan(firstHeight)

    const frame = artifactFrame(page)
    const backgroundOf = () => {
      return runtimeFrame(page).evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor
      })
    }
    const lightBackground = await backgroundOf()

    await page.evaluate(() => {
      (window as any).harness.setTheme('dark')
    })
    await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await backgroundOf()).not.toBe(lightBackground)

    await render(page, {
      kind: 'html',
      content: '<body><p id="theme">none</p><script>window.besidka.onThemeChange((theme) => { document.getElementById("theme").textContent = theme })</script></body>',
    })
    await expect(frame.locator('#theme')).toHaveText('none')
    await page.evaluate(() => {
      (window as any).harness.setTheme('light')
    })
    await expect(frame.locator('#theme')).toHaveText('light')
    await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light')

    await render(page, {
      kind: 'html',
      content: '<body><p>broken</p><script>throw new Error("boom from artifact")</script></body>',
    })
    const expectedErrorText = test.info().project.name === 'webkit'
      ? 'Script error.'
      : 'boom from artifact'

    await expect.poll(async () => {
      return (await harnessState(page)).messages.some((message: any) => {
        return message.level === 'error'
          && message.data.message.includes(expectedErrorText)
      })
    }).toBe(true)
    await expect(frame.getByRole('alert')).toContainText(expectedErrorText)

    expect((await harnessState(page)).loads).toBe(1)
  })

  test('hands external links to the host instead of navigating', async ({ page }) => {
    await mount(page)
    await render(page, {
      kind: 'markdown',
      content: '[Read the docs](https://example.com/docs)',
    })
    await artifactFrame(page).getByRole('link', { name: 'Read the docs' })
      .click()

    await expect.poll(async () => {
      return (await harnessState(page)).links
    }).toEqual(['https://example.com/docs'])

    const state = await harnessState(page)

    expect(state.loads).toBe(1)
    expect(state.navigations).toBe(0)
  })

  test('destroys the frame when it navigates itself to another origin', async ({ page }) => {
    await mount(page)
    await resetOutsideRequests(page)
    await render(page, {
      kind: 'html',
      content: `<body><script>setTimeout(() => { location.href = '${OUTSIDE_ORIGIN}/nav?d=secret' }, 50)</script></body>`,
    })

    await expect.poll(async () => {
      return (await harnessState(page)).navigations
    }).toBe(1)

    const state = await harnessState(page)

    expect(state.frameRemoved).toBe(true)
    await expect(page.locator(FRAME_SELECTOR)).toHaveCount(0)

    const requests = await outsideRequests(page)

    test.info().annotations.push({
      type: 'residual-risk',
      description: `Requests that reached the outside origin before teardown: ${JSON.stringify(requests)}`,
    })
  })

  test('a host frame-src policy stops self-navigation before any request', async ({ page }) => {
    await mount(page, {}, '/?frame-src')
    await resetOutsideRequests(page)
    await render(page, {
      kind: 'html',
      content: `<body><script>setTimeout(() => { location.href = '${OUTSIDE_ORIGIN}/nav?d=blocked' }, 50)</script></body>`,
    })
    await expect.poll(async () => {
      return (await harnessState(page)).navigations
    }).toBe(1)

    expect(await outsideRequests(page)).toEqual([])
    expect((await harnessState(page)).frameRemoved).toBe(true)
  })

  test('closes WebRTC and records the 204 navigation residual', async ({ page }) => {
    await mount(page, { storage: true })
    await resetOutsideRequests(page)
    await render(page, {
      kind: 'html',
      content: `<body><script>
        const turnUrl = 'turn:127.0.0.1:${process.env.ARTIFACTS_OUTSIDE_TCP_PORT || '8791'}?transport=tcp';
        function leak(PeerConnection) {
          const connection = new PeerConnection({ iceServers: [{ urls: turnUrl, username: 'secret', credential: 'x' }] });
          connection.createDataChannel('leak');
          connection.createOffer().then((offer) => connection.setLocalDescription(offer));
        }
        const results = { direct: typeof window.RTCPeerConnection, childFrame: 'none' };
        try {
          const child = document.createElement('iframe');
          document.body.append(child);
          const ChildPeerConnection = child.contentWindow && child.contentWindow.RTCPeerConnection;
          results.childFrame = typeof ChildPeerConnection;
          if (ChildPeerConnection) { leak(ChildPeerConnection) }
        } catch (exception) {
          results.childFrame = 'blocked: ' + exception.name;
        }
        window.besidka.storage.set('webrtc', results);
        setTimeout(() => { location.href = '${OUTSIDE_ORIGIN}/no-content?d=secret' }, 50)
      </script></body>`,
    })
    await page.waitForTimeout(2_000)

    const requests = await outsideRequests(page)
    const state = await harnessState(page)

    expect(state.storage.webrtc.direct).toBe('undefined')
    expect(state.storage.webrtc.childFrame).not.toBe('function')
    expect(requests.filter((path) => {
      return path.startsWith('tcp:')
    })).toEqual([])
    test.info().annotations.push({
      type: 'residual-risk',
      description: `webrtc ${JSON.stringify(state.storage.webrtc)}, outside requests ${JSON.stringify(requests)}, navigations ${state.navigations}`,
    })
  })

  test('falls back to memory storage and explains missing completions', async ({ page }) => {
    await mount(page)
    await render(page, {
      kind: 'html',
      content: `<body><script>
        (async () => {
          await window.besidka.storage.set('answer', { value: 42 });
          const stored = await window.besidka.storage.get('answer');
          let completeError = null;
          try {
            await window.besidka.complete('hello');
          } catch (exception) {
            completeError = exception.message;
          }
          document.body.dataset.result = JSON.stringify({
            stored,
            persistent: window.besidka.storage.persistent,
            completeError,
          });
        })();
      </script></body>`,
    })

    await expect(artifactFrame(page).locator('body[data-result]'))
      .toHaveCount(1)

    const result = JSON.parse(
      await artifactFrame(page).locator('body').getAttribute('data-result')
      ?? '{}',
    )

    expect(result).toEqual({
      stored: { value: 42 },
      persistent: false,
      completeError: 'AI completions are not available here.',
    })
  })

  test('uses host storage and completions when the host offers them', async ({ page }) => {
    await mount(page, { storage: true, complete: true })
    await render(page, {
      kind: 'html',
      content: `<body><script>
        (async () => {
          await window.besidka.storage.set('score', 7);
          const keys = await window.besidka.storage.list();
          const answer = await window.besidka.complete('hello');
          let declined = null;
          try {
            await window.besidka.complete('decline');
          } catch (exception) {
            declined = { message: exception.message, code: exception.code };
          }
          document.body.dataset.result = JSON.stringify({
            keys,
            answer,
            declined,
            persistent: window.besidka.storage.persistent,
          });
        })();
      </script></body>`,
    })

    await expect(artifactFrame(page).locator('body[data-result]'))
      .toHaveCount(1)

    const result = JSON.parse(
      await artifactFrame(page).locator('body').getAttribute('data-result')
      ?? '{}',
    )

    expect(result).toEqual({
      keys: ['score'],
      answer: 'echo: hello',
      declined: {
        message: 'The viewer declined this AI completion.',
        code: -32011,
      },
      persistent: true,
    })
    expect((await harnessState(page)).storage.score).toBe(7)
  })

  test('transpiles and mounts TSX within a few seconds', async ({ page }) => {
    await mount(page, { storage: true })

    const timings: number[] = []

    for (const run of [1, 2]) {
      const startedAt = await page.evaluate(() => {
        return Date.now()
      })

      await render(page, {
        kind: 'react',
        content: `import { useEffect } from 'react'

interface Props { label?: string }

export default function Timed({ label = 'run ${run}' }: Props) {
  useEffect(() => {
    window.besidka.storage.set('mounted-${run}', Date.now())
  }, [])

  return <p data-testid="timed">{label}</p>
}`,
      })
      await expect.poll(async () => {
        return (await harnessState(page)).storage[`mounted-${run}`] ?? null
      }).not.toBeNull()

      const mountedAt = (await harnessState(page)).storage[`mounted-${run}`]

      timings.push(mountedAt - startedAt)
    }

    test.info().annotations.push({
      type: 'tsx-render-ms',
      description: `cold ${timings[0]} ms, warm ${timings[1]} ms`,
    })
    expect(timings[0]).toBeLessThan(5_000)
    expect(timings[1]).toBeLessThan(2_000)
  })
})
