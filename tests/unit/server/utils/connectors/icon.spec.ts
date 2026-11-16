import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECTOR_ICON_MAX_BYTES,
  CONNECTOR_ICON_MISS_TTL_SECONDS,
  CONNECTOR_ICON_RESOLVE_BUDGET_MS,
  CONNECTOR_ICON_TTL_SECONDS,
} from '#shared/utils/connectors-policy'
import {
  CONNECTOR_ICON_BUSY,
  connectorIconKey,
  connectorIconLockKey,
  connectorIconSourcesKey,
  deleteConnectorIconCache,
  fetchConnectorIconHtml,
  fetchConnectorIconImage,
  parentIconOrigin,
  parseConnectorIconLinks,
  readHtmlHead,
  parseDeclaredConnectorIcons,
  readConnectorIconDimensions,
  recordDeclaredConnectorIcons,
  resolveConnectorIcon,
  sniffConnectorIconType,
} from '~~/server/utils/connectors/icon'
import type { ConnectorIconImage } from '~~/server/utils/connectors/icon'
import {
  ICO_BYTES,
  PNG_BYTES,
  SVG_BYTES,
  createFakeIconKv,
  createGifBytes,
  createIcoBytes,
  createPngBytes,
} from '../../../../setup/helpers/connector-icon-kv'

const connector = { id: 'conn1', origin: 'https://mcp.notion.com' }
const NOTION_ICON_REQUESTS = [
  'https://mcp.notion.com/favicon.ico',
  'https://mcp.notion.com/apple-touch-icon.png',
  'https://notion.com/favicon.ico',
  'https://notion.com/apple-touch-icon.png',
]

const fetchHtml = vi.fn(async () => null)

function asKv(kv: ReturnType<typeof createFakeIconKv>) {
  return kv as never
}

function image(contentType: ConnectorIconImage['contentType']) {
  return {
    bytes: PNG_BYTES.buffer.slice(0) as ArrayBuffer,
    contentType,
  } satisfies ConnectorIconImage
}

function dataUri(bytes: Uint8Array, mime = 'image/png') {
  return `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`
}

describe('sniffConnectorIconType', () => {
  it('names the raster types by their magic bytes', () => {
    expect(sniffConnectorIconType(PNG_BYTES)).toBe('image/png')
    expect(sniffConnectorIconType(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])))
      .toBe('image/jpeg')
    expect(sniffConnectorIconType(new TextEncoder().encode('GIF89a....')))
      .toBe('image/gif')
    expect(sniffConnectorIconType(new TextEncoder().encode(
      'RIFF\u0000\u0000\u0000\u0000WEBPVP8 ',
    ))).toBe('image/webp')
    expect(sniffConnectorIconType(ICO_BYTES)).toBe('image/x-icon')
  })

  it('names an SVG by its text start only, and refuses HTML, an empty ICO '
    + 'and cursors', () => {
    expect(sniffConnectorIconType(SVG_BYTES)).toBe('image/svg+xml')
    expect(sniffConnectorIconType(new TextEncoder().encode(
      '\n<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>',
    ))).toBe('image/svg+xml')
    expect(sniffConnectorIconType(new TextEncoder().encode('<html></html>')))
      .toBeNull()
    expect(sniffConnectorIconType(
      new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x00, 0x00]),
    )).toBeNull()
    expect(sniffConnectorIconType(
      new Uint8Array([0x00, 0x00, 0x02, 0x00, 0x01, 0x00]),
    )).toBeNull()
    expect(sniffConnectorIconType(new Uint8Array())).toBeNull()
  })
})

describe('readConnectorIconDimensions', () => {
  it('reads the size from the header of each type', () => {
    expect(readConnectorIconDimensions(createPngBytes(48, 32), 'image/png'))
      .toEqual({ width: 48, height: 32 })
    expect(readConnectorIconDimensions(createGifBytes(20, 10), 'image/gif'))
      .toEqual({ width: 20, height: 10 })
    expect(readConnectorIconDimensions(
      createIcoBytes({ size: 32 }),
      'image/x-icon',
    )).toEqual({ width: 32, height: 32 })
    expect(readConnectorIconDimensions(
      createIcoBytes({ size: 0 }),
      'image/x-icon',
    )).toEqual({ width: 256, height: 256 })
  })

  it('reads the three WebP layouts', () => {
    const lossy = new Uint8Array(30)

    lossy.set(new TextEncoder().encode('RIFF'), 0)
    lossy.set(new TextEncoder().encode('WEBPVP8 '), 8)
    lossy.set([64, 0, 32, 0], 26)

    expect(readConnectorIconDimensions(lossy, 'image/webp'))
      .toEqual({ width: 64, height: 32 })

    const lossless = new Uint8Array(30)
    const bits = (64 - 1) | ((32 - 1) << 14)

    lossless.set(new TextEncoder().encode('RIFF'), 0)
    lossless.set(new TextEncoder().encode('WEBPVP8L'), 8)
    lossless[20] = 0x2F
    lossless.set([
      bits & 0xFF,
      (bits >> 8) & 0xFF,
      (bits >> 16) & 0xFF,
      (bits >>> 24) & 0xFF,
    ], 21)

    expect(readConnectorIconDimensions(lossless, 'image/webp'))
      .toEqual({ width: 64, height: 32 })

    const extended = new Uint8Array(30)

    extended.set(new TextEncoder().encode('RIFF'), 0)
    extended.set(new TextEncoder().encode('WEBPVP8X'), 8)
    extended.set([99, 0, 0], 24)
    extended.set([49, 0, 0], 27)

    expect(readConnectorIconDimensions(extended, 'image/webp'))
      .toEqual({ width: 100, height: 50 })
  })

  it('reads a JPEG frame header after other segments', () => {
    const jpeg = new Uint8Array([
      0xFF, 0xD8,
      0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00,
      0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x20, 0x00, 0x40,
      0x01, 0x01, 0x11, 0x00,
    ])

    expect(readConnectorIconDimensions(jpeg, 'image/jpeg'))
      .toEqual({ width: 64, height: 32 })
  })

  it('returns null for a header that cannot be read', () => {
    expect(readConnectorIconDimensions(
      new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      'image/png',
    )).toBeNull()
    expect(readConnectorIconDimensions(
      new Uint8Array([0xFF, 0xD8, 0xFF]),
      'image/jpeg',
    )).toBeNull()
    expect(readConnectorIconDimensions(
      createIcoBytes({ offset: 500 }),
      'image/x-icon',
    )).toBeNull()
    expect(readConnectorIconDimensions(
      new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x03, 0x00]),
      'image/x-icon',
    )).toBeNull()
  })
})

describe('parseDeclaredConnectorIcons', () => {
  it('keeps string sources, drops dark icons and caps the list at four', () => {
    const declared = parseDeclaredConnectorIcons({
      icons: [
        { src: 'https://a.example.com/1.png' },
        { src: 'https://a.example.com/dark.png', theme: 'dark' },
        { src: 42 },
        null,
        { src: 'https://a.example.com/2.png', theme: 'light' },
        { src: '/3.png' },
        { src: '/4.png' },
        { src: '/5.png' },
      ],
    })

    expect(declared.map(icon => icon.src)).toEqual([
      'https://a.example.com/1.png',
      'https://a.example.com/2.png',
      '/3.png',
      '/4.png',
    ])
  })

  it('returns nothing for a server without icons', () => {
    expect(parseDeclaredConnectorIcons(undefined)).toEqual([])
    expect(parseDeclaredConnectorIcons({ name: 'x' })).toEqual([])
    expect(parseDeclaredConnectorIcons({ icons: 'no' })).toEqual([])
  })
})

describe('resolveConnectorIcon', () => {
  it('prefers a declared icon on the server origin over the favicon', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => image('image/png'))

    await recordDeclaredConnectorIcons(asKv(kv), connector.id, {
      icons: [{ src: 'https://mcp.notion.com/icon.png' }],
    })

    const result = await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml },
    })

    expect(result?.contentType).toBe('image/png')
    expect(fetchImage).toHaveBeenCalledTimes(1)
    expect(fetchImage).toHaveBeenCalledWith(
      'https://mcp.notion.com/icon.png',
      undefined,
    )
    expect(kv.entries.get(connectorIconKey(connector.id))?.metadata)
      .toMatchObject({ origin: 'declared', contentType: 'image/png' })
    expect(kv.entries.get(connectorIconKey(connector.id))?.ttl)
      .toBe(CONNECTOR_ICON_TTL_SECONDS)
  })

  it('resolves a relative declared source against the origin', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => image('image/png'))

    await recordDeclaredConnectorIcons(asKv(kv), connector.id, {
      icons: [{ src: '/assets/logo.png' }],
    })
    await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml },
    })

    expect(fetchImage).toHaveBeenCalledWith(
      'https://mcp.notion.com/assets/logo.png',
      undefined,
    )
  })

  it('uses a declared data image without any request', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => null)

    await recordDeclaredConnectorIcons(asKv(kv), connector.id, {
      icons: [{ src: dataUri(PNG_BYTES) }],
    })

    const result = await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml },
    })

    expect(result?.contentType).toBe('image/png')
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('rejects a data URI that is not a raster image by its bytes', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => null)

    await recordDeclaredConnectorIcons(asKv(kv), connector.id, {
      icons: [{ src: dataUri(SVG_BYTES, 'image/png') }],
    })

    const result = await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml },
    })

    expect(result).toBeNull()
    expect(fetchImage.mock.calls.map(call => (call as unknown[])[0]))
      .toEqual(NOTION_ICON_REQUESTS)
  })

  it('never fetches a declared icon on another origin', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => null)

    await recordDeclaredConnectorIcons(asKv(kv), connector.id, {
      icons: [
        { src: 'https://evil.example.net/logo.png' },
        { src: 'http://169.254.169.254/latest' },
      ],
    })
    await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml },
    })

    expect(fetchImage.mock.calls.map(call => (call as unknown[])[0]))
      .toEqual(NOTION_ICON_REQUESTS)
  })

  it('falls back to the favicon of the host, then to nothing', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => image('image/x-icon'))

    const result = await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml },
    })

    expect(result?.contentType).toBe('image/x-icon')
    expect(fetchImage).toHaveBeenCalledWith(
      'https://mcp.notion.com/favicon.ico',
      undefined,
    )
    expect(kv.entries.get(connectorIconKey(connector.id))?.metadata)
      .toMatchObject({ origin: 'favicon' })

    const emptyKv = createFakeIconKv()
    const none = await resolveConnectorIcon(asKv(emptyKv), connector, {
      dependencies: { fetchImage: async () => null, fetchHtml },
    })

    expect(none).toBeNull()
  })

  it('serves a stored icon without asking the network again', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => image('image/png'))

    await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml },
    })
    const second = await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml },
    })

    expect(fetchImage).toHaveBeenCalledTimes(1)
    expect(second?.contentType).toBe('image/png')
  })

  it('remembers a miss for a day instead of asking on every render', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => null)

    await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml },
    })
    await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml },
    })

    expect(fetchImage).toHaveBeenCalledTimes(NOTION_ICON_REQUESTS.length)
    expect(kv.entries.get(connectorIconKey(connector.id))?.ttl)
      .toBe(CONNECTOR_ICON_MISS_TTL_SECONDS)
  })

  it('lets a declared icon replace a cached miss or favicon', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async (url: string) => {
      return url.endsWith('/icon.png') ? image('image/png') : null
    })

    expect(await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml },
    })).toBeNull()

    await recordDeclaredConnectorIcons(asKv(kv), connector.id, {
      icons: [{ src: '/icon.png' }],
    })

    expect(kv.entries.has(connectorIconKey(connector.id))).toBe(false)
    expect((await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml },
    }))?.contentType).toBe('image/png')
    expect(kv.entries.get(connectorIconKey(connector.id))?.metadata)
      .toMatchObject({ origin: 'declared' })
  })

  it('keeps a cached icon while the declared sources are unchanged', async () => {
    const kv = createFakeIconKv()
    const icons = { icons: [{ src: '/icon.png' }] }
    const fetchImage = vi.fn(async () => image('image/png'))

    await recordDeclaredConnectorIcons(asKv(kv), connector.id, icons)
    await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml },
    })
    await recordDeclaredConnectorIcons(asKv(kv), connector.id, icons)
    await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml },
    })

    expect(fetchImage).toHaveBeenCalledTimes(1)
  })

  it('reads a miss from its metadata, whatever the stored value', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => image('image/png'))

    await kv.put(connectorIconKey(connector.id), new ArrayBuffer(0), {
      metadata: { origin: 'none' },
    })

    expect(await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml },
    })).toBeNull()
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('ignores a stored value whose type is not an allowed image type', async () => {
    const kv = createFakeIconKv()

    await kv.put(
      connectorIconKey(connector.id),
      SVG_BYTES.buffer as ArrayBuffer,
      {
        metadata: { contentType: 'image/bmp', origin: 'declared' },
      },
    )

    const result = await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage: vi.fn(async () => null), fetchHtml },
    })

    expect(result).toBeNull()
  })

  it('refuses an image larger than 512 by 512 pixels', async () => {
    const kv = createFakeIconKv()

    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(createPngBytes(600, 600))
    }))

    const result = await resolveConnectorIcon(asKv(kv), connector)

    vi.unstubAllGlobals()

    expect(result).toBeNull()
    expect(kv.entries.get(connectorIconKey(connector.id))?.metadata)
      .toMatchObject({ origin: 'none' })
  })

  it('accepts an image of exactly 512 by 512 pixels', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(createPngBytes(512, 512))
    }))

    const result = await resolveConnectorIcon(
      asKv(createFakeIconKv()),
      connector,
    )

    vi.unstubAllGlobals()

    expect(result).toMatchObject({ contentType: 'image/png' })
  })

  it('answers busy while another request fetches, without fetching', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => image('image/png'))

    await kv.put(connectorIconLockKey(connector.id), '1', {
      expirationTtl: 60,
    })

    expect(await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml },
    })).toBe(CONNECTOR_ICON_BUSY)
    expect(fetchImage).not.toHaveBeenCalled()
    expect(kv.entries.has(connectorIconKey(connector.id))).toBe(false)
  })

  it('takes the lock while fetching and releases it afterwards', async () => {
    const kv = createFakeIconKv()
    let lockDuringFetch: unknown = null

    await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: {
        fetchImage: async () => {
          lockDuringFetch = kv.entries.get(connectorIconLockKey(connector.id))

          return image('image/png')
        },
      },
    })

    expect(lockDuringFetch).toMatchObject({ ttl: 60 })
    expect(kv.entries.has(connectorIconLockKey(connector.id))).toBe(false)
  })

  it('releases the lock when the fetch throws', async () => {
    const kv = createFakeIconKv()

    await expect(resolveConnectorIcon(asKv(kv), connector, {
      dependencies: {
        fetchImage: async () => {
          throw new Error('boom')
        },
      },
    })).rejects.toThrow('boom')

    expect(kv.entries.has(connectorIconLockKey(connector.id))).toBe(false)
  })

  it('removes the icon and its sources with the connector', async () => {
    const kv = createFakeIconKv()

    await recordDeclaredConnectorIcons(asKv(kv), connector.id, {
      icons: [{ src: '/a.png' }],
    })
    await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage: async () => image('image/png') },
    })
    await deleteConnectorIconCache(asKv(kv), connector.id)

    expect(kv.entries.has(connectorIconKey(connector.id))).toBe(false)
    expect(kv.entries.has(connectorIconSourcesKey(connector.id))).toBe(false)
  })
})

describe('fetchConnectorIconImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch(response: Response) {
    const fetchMock = vi.fn(async () => response)

    vi.stubGlobal('fetch', fetchMock)

    return fetchMock
  }

  it('returns a raster image answered with a success', async () => {
    const fetchMock = stubFetch(new Response(PNG_BYTES, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }))

    const result = await fetchConnectorIconImage(
      'https://mcp.notion.com/favicon.ico',
    )

    expect(result?.contentType).toBe('image/png')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses an answer that is not an image by its bytes', async () => {
    stubFetch(new Response(SVG_BYTES, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }))

    expect(await fetchConnectorIconImage('https://mcp.notion.com/favicon.ico'))
      .toBeNull()
  })

  it('refuses a failed answer', async () => {
    stubFetch(new Response('nope', { status: 404 }))

    expect(await fetchConnectorIconImage('https://mcp.notion.com/favicon.ico'))
      .toBeNull()
  })

  it('stops at the size cap', async () => {
    const big = new Uint8Array(CONNECTOR_ICON_MAX_BYTES + 1)

    big.set(PNG_BYTES)
    stubFetch(new Response(big, { status: 200 }))

    expect(await fetchConnectorIconImage('https://mcp.notion.com/favicon.ico'))
      .toBeNull()
  })

  it('refuses private and local addresses without a request', async () => {
    const fetchMock = stubFetch(new Response(PNG_BYTES))

    expect(await fetchConnectorIconImage('https://192.168.0.1/favicon.ico'))
      .toBeNull()
    expect(await fetchConnectorIconImage('http://mcp.notion.com/favicon.ico'))
      .toBeNull()
    expect(await fetchConnectorIconImage('https://localhost/favicon.ico'))
      .toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('network down')
    }))

    expect(await fetchConnectorIconImage('https://mcp.notion.com/favicon.ico'))
      .toBeNull()
  })
})

const SAFE_SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">'
  + '<circle cx="4" cy="4" r="3"/></svg>',
)

describe('SVG icons', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps a safe SVG fetched over the network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(SAFE_SVG)))

    const result = await fetchConnectorIconImage(
      'https://mcp.notion.com/icon.svg',
    )

    expect(result?.contentType).toBe('image/svg+xml')
    expect(new Uint8Array(result!.bytes)).toEqual(SAFE_SVG)
  })

  it('refuses an SVG with script, however the server labels it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(SVG_BYTES, {
        headers: { 'content-type': 'image/svg+xml' },
      })
    }))

    expect(await fetchConnectorIconImage('https://mcp.notion.com/icon.svg'))
      .toBeNull()
  })

  it('refuses an SVG over the size cap', async () => {
    const padding = '<g/>'.repeat(CONNECTOR_ICON_MAX_BYTES)
    const big = new TextEncoder().encode(
      `<svg xmlns="http://www.w3.org/2000/svg">${padding}</svg>`,
    )

    vi.stubGlobal('fetch', vi.fn(async () => new Response(big)))

    expect(await fetchConnectorIconImage('https://mcp.notion.com/icon.svg'))
      .toBeNull()
  })

  it('serves a stored SVG back with its type', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => ({
      bytes: SAFE_SVG.buffer.slice(0) as ArrayBuffer,
      contentType: 'image/svg+xml',
    } satisfies ConnectorIconImage))

    await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml },
    })

    const stored = await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml },
    })

    expect(stored).toMatchObject({ contentType: 'image/svg+xml' })
    expect(fetchImage).toHaveBeenCalledTimes(1)
  })
})

describe('parseConnectorIconLinks', () => {
  const page = 'https://linear.app/'

  it('ranks the Apple touch icon first, then plain icons, in page order', () => {
    const html = `<head>
      <link rel="icon" href="/a.png">
      <link rel="shortcut icon" href="/b.ico">
      <link href="/touch.png" rel="apple-touch-icon" sizes="180x180">
      <link rel="stylesheet" href="/x.css">
      <link rel="mask-icon" href="/mask.svg">
    </head>`

    expect(parseConnectorIconLinks(html, page)).toEqual([
      'https://linear.app/touch.png',
      'https://linear.app/a.png',
      'https://linear.app/b.ico',
    ])
  })

  it('resolves relative links against the page and keeps at most three', () => {
    const html = [1, 2, 3, 4]
      .map(index => `<link rel="icon" href="i${index}.png">`)
      .join('')

    expect(parseConnectorIconLinks(html, 'https://linear.app/app/index.html'))
      .toEqual([
        'https://linear.app/app/i1.png',
        'https://linear.app/app/i2.png',
        'https://linear.app/app/i3.png',
      ])
  })

  it('drops other origins, data, javascript and unparsable links', () => {
    const html = `
      <link rel="icon" href="https://cdn.evil.example/a.png">
      <link rel="icon" href="//cdn.evil.example/b.png">
      <link rel="icon" href="data:image/png;base64,AAAA">
      <link rel="icon" href="javascript:alert(1)">
      <link rel="icon" href="http://linear.app/plain.png">
      <link rel="icon">`

    expect(parseConnectorIconLinks(html, page)).toEqual([])
  })

  it('returns nothing for a bad page address and for text without links', () => {
    expect(parseConnectorIconLinks('<link rel="icon" href="/a.png">', 'nope'))
      .toEqual([])
    expect(parseConnectorIconLinks('<p>hello</p>', page)).toEqual([])
  })
})

describe('resolveConnectorIcon beyond the favicon', () => {
  it('reads the icon links of the page when /favicon.ico is missing', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async (url: string) => {
      return url === 'https://mcp.notion.com/touch.png'
        ? image('image/png')
        : null
    })
    const pageFetch = vi.fn(async () => ({
      html: '<link rel="apple-touch-icon" href="/touch.png">',
      url: 'https://mcp.notion.com/',
    }))

    const result = await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage, fetchHtml: pageFetch },
    })

    expect(result?.contentType).toBe('image/png')
    expect(pageFetch).toHaveBeenCalledWith('https://mcp.notion.com/', undefined)
    expect(kv.entries.get(connectorIconKey(connector.id))?.metadata)
      .toMatchObject({ origin: 'favicon' })
  })

  it('never asks a shared hosting platform as the parent', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => null)

    await resolveConnectorIcon(
      asKv(kv),
      { id: 'vercel1', origin: 'https://mcp.vercel.app' },
      { dependencies: { fetchImage, fetchHtml } },
    )

    expect(fetchImage.mock.calls.map(call => (call as unknown[])[0]))
      .toEqual([
        'https://mcp.vercel.app/favicon.ico',
        'https://mcp.vercel.app/apple-touch-icon.png',
      ])
    expect(fetchHtml).toHaveBeenCalledWith('https://mcp.vercel.app/', undefined)
    expect(fetchHtml).not.toHaveBeenCalledWith('https://vercel.app/', undefined)
  })

  it('falls back to the site of a service subdomain', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async (url: string) => {
      return url === 'https://example.com/favicon.ico'
        ? image('image/png')
        : null
    })

    const result = await resolveConnectorIcon(
      asKv(kv),
      { id: 'api1', origin: 'https://api.example.com' },
      { dependencies: { fetchImage, fetchHtml } },
    )

    expect(result?.contentType).toBe('image/png')
    expect(fetchImage.mock.calls.map(call => (call as unknown[])[0]))
      .toEqual([
        'https://api.example.com/favicon.ico',
        'https://api.example.com/apple-touch-icon.png',
        'https://example.com/favicon.ico',
      ])
  })

  it('stops trying sources once the time budget is spent', async () => {
    const kv = createFakeIconKv()
    const now = vi.spyOn(Date, 'now')
    let clock = 0

    now.mockImplementation(() => clock)

    const fetchImage = vi.fn(async () => {
      clock += CONNECTOR_ICON_RESOLVE_BUDGET_MS + 1

      return null
    })

    await resolveConnectorIcon(
      asKv(kv),
      {
        ...connector,
        readRemoteSources: async () => [
          { src: 'https://static.example.com/a.png' },
          { src: 'https://static.example.com/b.png' },
        ],
      },
      { dependencies: { fetchImage, fetchHtml } },
    )
    now.mockRestore()

    expect(fetchImage).toHaveBeenCalledTimes(1)
    expect(fetchHtml).not.toHaveBeenCalled()
  })

  it('fetches remote sources from any https host, before the origin', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => image('image/png'))

    const result = await resolveConnectorIcon(
      asKv(kv),
      {
        ...connector,
        readRemoteSources: async () => [
          { src: 'http://insecure.example/a.png' },
          { src: 'https://static.linear.app/icon-256.png' },
        ],
      },
      { dependencies: { fetchImage, fetchHtml } },
    )

    expect(result?.contentType).toBe('image/png')
    expect(fetchImage.mock.calls.map(call => (call as unknown[])[0]))
      .toEqual(['https://static.linear.app/icon-256.png'])
    expect(kv.entries.get(connectorIconKey(connector.id))?.metadata)
      .toMatchObject({ origin: 'declared' })
  })

  it('does not read remote sources when a copy is already stored', async () => {
    const kv = createFakeIconKv()
    const readRemoteSources = vi.fn(async () => [])
    const fetchImage = vi.fn(async () => image('image/png'))
    const target = { ...connector, readRemoteSources }

    await resolveConnectorIcon(asKv(kv), target, {
      dependencies: { fetchImage, fetchHtml },
    })
    await resolveConnectorIcon(asKv(kv), target, {
      dependencies: { fetchImage, fetchHtml },
    })

    expect(readRemoteSources).toHaveBeenCalledTimes(1)
  })
})

describe('resolveConnectorIcon with an origin key', () => {
  const first = {
    id: 'registry:one',
    origin: 'https://gateway.example.com',
    originKey: 'registry-origin:abc',
  }
  const second = { ...first, id: 'registry:two' }

  it('fetches a shared host once for many entries', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => image('image/png'))

    await resolveConnectorIcon(asKv(kv), first, {
      dependencies: { fetchImage, fetchHtml },
    })

    const result = await resolveConnectorIcon(asKv(kv), second, {
      dependencies: { fetchImage, fetchHtml },
    })

    expect(result?.contentType).toBe('image/png')
    expect(fetchImage).toHaveBeenCalledTimes(1)
    expect(kv.entries.has(connectorIconKey(first.originKey))).toBe(true)
    expect(kv.entries.has(connectorIconKey(second.id))).toBe(true)
  })

  it('remembers a miss for the origin and asks it once', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => null)

    await resolveConnectorIcon(asKv(kv), first, {
      dependencies: { fetchImage, fetchHtml },
    })

    const imageRequests = fetchImage.mock.calls.length
    const pageRequests = fetchHtml.mock.calls.length

    await resolveConnectorIcon(asKv(kv), second, {
      dependencies: { fetchImage, fetchHtml },
    })

    expect(fetchImage).toHaveBeenCalledTimes(imageRequests)
    expect(fetchHtml).toHaveBeenCalledTimes(pageRequests)
    expect(kv.entries.get(connectorIconKey(first.originKey))?.ttl)
      .toBe(CONNECTOR_ICON_MISS_TTL_SECONDS)
  })

  it('answers busy while another request fetches the origin, and keeps '
    + 'nothing for its own entry', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => image('image/png'))

    await kv.put(connectorIconLockKey(first.originKey), '1', {
      expirationTtl: 60,
    })

    expect(await resolveConnectorIcon(asKv(kv), second, {
      dependencies: { fetchImage, fetchHtml },
    })).toBe(CONNECTOR_ICON_BUSY)
    expect(fetchImage).not.toHaveBeenCalled()
    expect(kv.entries.has(connectorIconKey(second.id))).toBe(false)
  })

  it('releases the origin lock after the fetch', async () => {
    const kv = createFakeIconKv()

    await resolveConnectorIcon(asKv(kv), first, {
      dependencies: {
        fetchImage: vi.fn(async () => image('image/png')),
        fetchHtml,
      },
    })

    expect(kv.entries.has(connectorIconLockKey(first.originKey))).toBe(false)
  })
})

describe('fetchConnectorIconHtml', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the page text for a successful HTML answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response('<link rel="icon" href="/a.png">', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }))

    expect(await fetchConnectorIconHtml('https://linear.app/'))
      .toMatchObject({ html: '<link rel="icon" href="/a.png">' })
  })

  it('refuses a non-HTML answer, a failure and a private address', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response('{}', {
        headers: { 'content-type': 'application/json' },
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchConnectorIconHtml('https://linear.app/')).toBeNull()

    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })))

    expect(await fetchConnectorIconHtml('https://linear.app/')).toBeNull()

    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchConnectorIconHtml('https://192.168.0.1/')).toBeNull()
    expect(await fetchConnectorIconHtml('https://localhost/')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads only the head of a page larger than the HTML cap', async () => {
    const head = '<html><head><link rel="icon" href="/favicon.png"></head>'
    const body = `<body>${'x'.repeat(300 * 1024)}</body></html>`

    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(head + body, {
        headers: { 'content-type': 'text/html' },
      })
    }))

    const page = await fetchConnectorIconHtml('https://doop.design/')

    expect(page?.html.startsWith(head)).toBe(true)
    expect(page?.html.length).toBeLessThan(200 * 1024)
  })
})

describe('readHtmlHead', () => {
  it('stops at the end of the head', async () => {
    const response = new Response(
      '<head><link rel="icon" href="/a.png"></head><body>rest</body>',
    )

    expect(await readHtmlHead(response))
      .toContain('<link rel="icon" href="/a.png">')
  })

  it('cuts a page without a head end at the byte cap', async () => {
    const response = new Response('a'.repeat(5000))

    expect((await readHtmlHead(response, 1000)).length).toBe(1000)
  })
})

describe('parentIconOrigin', () => {
  it.each([
    ['https://api.axiomide.com', 'https://axiomide.com'],
    ['https://mcp.notion.com', 'https://notion.com'],
    ['https://mcp-server.egnyte.com', 'https://egnyte.com'],
    ['https://mcp.foo.vercel.app', 'https://foo.vercel.app'],
  ])('gives the site of %s', (origin, parent) => {
    expect(parentIconOrigin(origin)).toBe(parent)
  })

  it.each([
    'https://doop.design',
    'https://agentready.vercel.app',
    'https://mcp.vercel.app',
    'https://api.co.uk',
    'https://docs.example.com',
    'not a url',
  ])('gives nothing for %s', (origin) => {
    expect(parentIconOrigin(origin)).toBeNull()
  })
})
