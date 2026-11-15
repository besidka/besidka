import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECTOR_ICON_MAX_BYTES,
  CONNECTOR_ICON_MISS_TTL_SECONDS,
  CONNECTOR_ICON_TTL_SECONDS,
} from '#shared/utils/connectors-policy'
import {
  connectorIconKey,
  connectorIconSourcesKey,
  deleteConnectorIconCache,
  fetchConnectorIconImage,
  parseDeclaredConnectorIcons,
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
