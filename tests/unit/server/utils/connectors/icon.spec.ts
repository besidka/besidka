import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECTOR_ICON_MAX_BYTES,
  CONNECTOR_ICON_MISS_TTL_SECONDS,
  CONNECTOR_ICON_TTL_SECONDS,
} from '#shared/utils/connectors-policy'
import {
  CONNECTOR_ICON_BUSY,
  connectorIconKey,
  connectorIconLockKey,
  connectorIconSourcesKey,
  deleteConnectorIconCache,
  fetchConnectorIconImage,
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

  it('refuses SVG, HTML, an empty ICO and cursors', () => {
    expect(sniffConnectorIconType(SVG_BYTES)).toBeNull()
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
      dependencies: { fetchImage },
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
      dependencies: { fetchImage },
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
      dependencies: { fetchImage },
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
      dependencies: { fetchImage },
    })

    expect(result).toBeNull()
    expect(fetchImage).toHaveBeenCalledTimes(1)
    expect(fetchImage).toHaveBeenCalledWith(
      'https://mcp.notion.com/favicon.ico',
      undefined,
    )
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
      dependencies: { fetchImage },
    })

    expect(fetchImage.mock.calls.map(call => (call as unknown[])[0]))
      .toEqual(['https://mcp.notion.com/favicon.ico'])
  })

  it('falls back to the favicon of the host, then to nothing', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => image('image/x-icon'))

    const result = await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage },
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
      dependencies: { fetchImage: async () => null },
    })

    expect(none).toBeNull()
  })

  it('serves a stored icon without asking the network again', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => image('image/png'))

    await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage },
    })
    const second = await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage },
    })

    expect(fetchImage).toHaveBeenCalledTimes(1)
    expect(second?.contentType).toBe('image/png')
  })

  it('remembers a miss for a day instead of asking on every render', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async () => null)

    await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage },
    })
    await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage },
    })

    expect(fetchImage).toHaveBeenCalledTimes(1)
    expect(kv.entries.get(connectorIconKey(connector.id))?.ttl)
      .toBe(CONNECTOR_ICON_MISS_TTL_SECONDS)
  })

  it('lets a declared icon replace a cached miss or favicon', async () => {
    const kv = createFakeIconKv()
    const fetchImage = vi.fn(async (url: string) => {
      return url.endsWith('/favicon.ico') ? null : image('image/png')
    })

    expect(await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage },
    })).toBeNull()

    await recordDeclaredConnectorIcons(asKv(kv), connector.id, {
      icons: [{ src: '/icon.png' }],
    })

    expect(kv.entries.has(connectorIconKey(connector.id))).toBe(false)
    expect((await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage },
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
      dependencies: { fetchImage },
    })
    await recordDeclaredConnectorIcons(asKv(kv), connector.id, icons)
    await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage },
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
      dependencies: { fetchImage },
    })).toBeNull()
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('ignores a stored value whose type is not an allowed image type', async () => {
    const kv = createFakeIconKv()

    await kv.put(
      connectorIconKey(connector.id),
      SVG_BYTES.buffer as ArrayBuffer,
      {
        metadata: { contentType: 'image/svg+xml', origin: 'declared' },
      },
    )

    const result = await resolveConnectorIcon(asKv(kv), connector, {
      dependencies: { fetchImage: vi.fn(async () => null) },
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
      dependencies: { fetchImage },
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
