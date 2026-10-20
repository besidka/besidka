import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiagramFontDescriptor } from '~/types/diagram.d'
import {
  buildFontFaceCss,
  clearEncodedFontCache,
  isAllowedFontUrl,
  loadEmbeddedFontFaces,
  selectLatinFontFaces,
} from '~/utils/diagram-export-fonts'

function createFace(
  overrides: Partial<DiagramFontDescriptor>,
): DiagramFontDescriptor {
  return {
    family: 'Nunito',
    src: 'url("/_fonts/latin-400.woff2") format("woff2")',
    weight: '400',
    unicodeRange: 'U+0000-00FF, U+0131',
    ...overrides,
  }
}

function stubFetch(failingUrls: string[] = []) {
  const fetchMock = vi.fn(async (url: string) => {
    if (failingUrls.includes(url)) {
      return { ok: false, arrayBuffer: async () => new ArrayBuffer(0) }
    }

    return {
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }
  })

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

describe('utils/diagram-export-fonts', () => {
  afterEach(() => {
    clearEncodedFontCache()
    vi.unstubAllGlobals()
  })

  it('selects only latin faces of the requested family and used weights', () => {
    const faces = [
      createFace({}),
      createFace({
        weight: '700',
        src: 'url("/_fonts/latin-700.woff2") format("woff2")',
      }),
      createFace({
        src: 'url("/_fonts/cyrillic-400.woff2")',
        unicodeRange: 'U+0301, U+0400-045F',
      }),
      createFace({
        weight: '500',
        src: 'url("/_fonts/latin-500.woff2")',
      }),
      createFace({ family: 'Atkinson Hyperlegible Mono' }),
    ]

    expect(selectLatinFontFaces(faces, 'Nunito').map(face => face.weight))
      .toEqual(['400', '700'])
  })

  it('treats a face without unicode-range as latin and dedupes by source', () => {
    const faces = [
      createFace({ unicodeRange: undefined }),
      createFace({ unicodeRange: undefined }),
    ]

    expect(selectLatinFontFaces(faces, 'Nunito')).toHaveLength(1)
  })

  it('embeds a family only when the svg uses it', async () => {
    const fetchMock = stubFetch()
    const faces = await loadEmbeddedFontFaces(
      [
        createFace({}),
        createFace({
          family: 'Atkinson Hyperlegible Mono',
          src: 'url("/_fonts/mono-400.woff2") format("woff2")',
        }),
      ],
      '<svg font-family="\'Nunito\', sans-serif"/>',
    )

    expect(faces.map(face => face.family)).toEqual(['Nunito'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(faces[0]?.dataUrl).toBe('data:font/woff2;base64,AQID')
  })

  it('caches encoded fonts across calls', async () => {
    const fetchMock = stubFetch()
    const markup = '<svg font-family="Nunito"/>'

    await loadEmbeddedFontFaces([createFace({})], markup)
    await loadEmbeddedFontFaces([createFace({})], markup)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('skips fonts that cannot be fetched and retries them next time', async () => {
    const fetchMock = stubFetch(['/_fonts/latin-400.woff2'])
    const markup = '<svg font-family="Nunito"/>'

    expect(await loadEmbeddedFontFaces([createFace({})], markup)).toEqual([])

    await loadEmbeddedFontFaces([createFace({})], markup)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('skips fonts when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))

    expect(await loadEmbeddedFontFaces(
      [createFace({})],
      '<svg font-family="Nunito"/>',
    )).toEqual([])
  })

  it('allows data and same-origin urls only', () => {
    const baseHref = 'https://besidka.com/chats/new'

    expect(isAllowedFontUrl('data:font/woff2;base64,AAAA', baseHref)).toBe(true)
    expect(isAllowedFontUrl('/_fonts/latin-400.woff2', baseHref)).toBe(true)
    expect(isAllowedFontUrl('https://besidka.com/_fonts/a.woff2', baseHref))
      .toBe(true)
    expect(isAllowedFontUrl('https://fonts.gstatic.com/a.woff2', baseHref))
      .toBe(false)
    expect(isAllowedFontUrl('http://besidka.com/a.woff2', baseHref))
      .toBe(false)
    expect(isAllowedFontUrl('//evil.example/a.woff2', baseHref)).toBe(false)
    expect(isAllowedFontUrl('http://[bad', baseHref)).toBe(false)
  })

  it('never fetches a cross-origin font source', async () => {
    const fetchMock = stubFetch()
    const faces = await loadEmbeddedFontFaces(
      [createFace({
        src: 'url("https://fonts.gstatic.com/latin-400.woff2") format("woff2")',
      })],
      '<svg font-family="Nunito"/>',
    )

    expect(faces).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('embeds a data url source without a cross-origin request', async () => {
    const fetchMock = stubFetch()
    const faces = await loadEmbeddedFontFaces(
      [createFace({
        src: 'url("data:font/woff2;base64,AQID") format("woff2")',
      })],
      '<svg font-family="Nunito"/>',
    )

    expect(faces).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a response that redirected to another origin', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      url: 'https://evil.example/latin-400.woff2',
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    })))

    expect(await loadEmbeddedFontFaces(
      [createFace({})],
      '<svg font-family="Nunito"/>',
    )).toEqual([])
  })

  it('writes one @font-face rule per embedded face', () => {
    const css = buildFontFaceCss([
      {
        family: 'Nunito',
        weight: '400',
        dataUrl: 'data:font/woff2;base64,AAAA',
        format: 'woff2',
      },
    ])

    expect(css).toBe(
      '@font-face{font-family:\'Nunito\';font-style:normal;font-weight:400;'
      + 'src:url(data:font/woff2;base64,AAAA) format(\'woff2\');}',
    )
  })
})
