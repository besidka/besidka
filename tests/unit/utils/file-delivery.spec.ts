import { describe, expect, it } from 'vitest'
import {
  CODE_EXECUTION_CONTAINER_MEDIA_TYPES,
  CODE_EXECUTION_FILE_DELIVERY,
  DIRECT_PROVIDER_OFFICE_DELIVERY,
  GATEWAY_OFFICE_DELIVERY,
  resolveFileDelivery,
} from '../../../shared/utils/file-delivery'
import type {
  FileDeliveryRoute,
} from '../../../shared/utils/file-delivery'
import { gatewayIds } from '../../../shared/utils/gateways'
import { OFFICE_MEDIA_TYPES } from '../../../shared/utils/office-files'
import { resolveContainerFileType } from '../../../server/utils/code-execution/file-types'

const PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'xai',
  'deepseek',
  'moonshotai',
  'qwen',
] as const

const ROUTES: Array<{ route: FileDeliveryRoute, providerId?: string }> = [
  ...PROVIDERS.map((providerId) => {
    return { route: 'direct' as const, providerId }
  }),
  ...gatewayIds.map((gatewayId) => {
    return { route: gatewayId }
  }),
]

const OFFICE_KINDS = Object.entries(OFFICE_MEDIA_TYPES)

describe('resolveFileDelivery', () => {
  describe('Office files', () => {
    for (const { route, providerId } of ROUTES) {
      const label = providerId ?? route

      for (const [format, mediaType] of OFFICE_KINDS) {
        it(`sends ${format} text from ${label} when the text is ready`, () => {
          expect(resolveFileDelivery({
            route,
            providerId,
            mediaType,
            modalities: ['text'],
            textStatus: 'ready',
          })).toEqual({ delivery: 'text' })
        })

        it(`refuses ${format} on ${label} when no text was read`, () => {
          for (const textStatus of [null, undefined, 'failed', 'empty', 'too_large']) {
            expect(resolveFileDelivery({
              route,
              providerId,
              mediaType,
              textStatus,
            })).toEqual({
              delivery: 'unsupported',
              reason: 'office-unreadable',
            })
          }
        })
      }
    }

    it('keeps one extract row per provider and gateway', () => {
      expect(Object.keys(DIRECT_PROVIDER_OFFICE_DELIVERY).sort())
        .toEqual([...PROVIDERS].sort())
      expect(Object.keys(GATEWAY_OFFICE_DELIVERY).sort())
        .toEqual([...gatewayIds].sort())

      for (const mode of [
        ...Object.values(DIRECT_PROVIDER_OFFICE_DELIVERY),
        ...Object.values(GATEWAY_OFFICE_DELIVERY),
      ]) {
        expect(mode).toBe('extract')
      }
    })

    it('treats an unknown provider as extract', () => {
      expect(resolveFileDelivery({
        route: 'direct',
        providerId: 'unheard-of',
        mediaType: OFFICE_MEDIA_TYPES.docx,
        textStatus: 'ready',
      })).toEqual({ delivery: 'text' })
    })

    it('normalises the media type before matching', () => {
      expect(resolveFileDelivery({
        route: 'direct',
        providerId: 'anthropic',
        mediaType: ` ${OFFICE_MEDIA_TYPES.xlsx.toUpperCase()}; charset=binary`,
        textStatus: 'ready',
      })).toEqual({ delivery: 'text' })
    })
  })

  describe('legacy and macro Office files', () => {
    for (const mediaType of [
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'application/vnd.ms-word.document.macroEnabled.12',
      'application/vnd.ms-excel.sheet.macroEnabled.12',
    ]) {
      it(`refuses ${mediaType} with a legacy reason`, () => {
        expect(resolveFileDelivery({
          route: 'direct',
          providerId: 'openai',
          mediaType,
          textStatus: 'ready',
        })).toEqual({ delivery: 'unsupported', reason: 'legacy-office' })
      })
    }
  })

  describe('images and PDFs', () => {
    for (const { route, providerId } of ROUTES) {
      const label = providerId ?? route

      it(`sends an image natively on ${label} when it is allowed`, () => {
        expect(resolveFileDelivery({
          route,
          providerId,
          mediaType: 'image/png',
          modalities: ['text', 'image'],
        })).toEqual({ delivery: 'native' })
      })

      it(`refuses an image on ${label} for a text-only model`, () => {
        expect(resolveFileDelivery({
          route,
          providerId,
          mediaType: 'image/webp',
          modalities: ['text', 'pdf'],
        })).toEqual({ delivery: 'unsupported', reason: 'model-no-image' })
      })

      it(`sends a PDF natively on ${label} when it is allowed`, () => {
        expect(resolveFileDelivery({
          route,
          providerId,
          mediaType: 'application/pdf',
          modalities: ['text', 'pdf'],
        })).toEqual({ delivery: 'native' })
      })

      it(`refuses a PDF on ${label} for a model without PDF input`, () => {
        expect(resolveFileDelivery({
          route,
          providerId,
          mediaType: 'application/pdf',
          modalities: ['text', 'image'],
        })).toEqual({ delivery: 'unsupported', reason: 'model-no-pdf' })
      })
    }

    it('fails open when the modalities are unknown', () => {
      expect(resolveFileDelivery({
        route: 'vercel',
        mediaType: 'image/jpeg',
      })).toEqual({ delivery: 'native' })
      expect(resolveFileDelivery({
        route: 'openrouter',
        mediaType: 'application/pdf',
      })).toEqual({ delivery: 'native' })
    })
  })

  describe('text files', () => {
    for (const mediaType of [
      'text/plain',
      'text/markdown',
      'text/csv',
      'text/tab-separated-values',
      'text/html; charset=utf-8',
    ]) {
      it(`sends ${mediaType} as text on every route`, () => {
        for (const { route, providerId } of ROUTES) {
          expect(resolveFileDelivery({
            route,
            providerId,
            mediaType,
            modalities: [],
          })).toEqual({ delivery: 'text' })
        }
      })
    }
  })

  describe('unknown types', () => {
    for (const mediaType of [
      '',
      'application/octet-stream',
      'application/zip',
      'application/json',
      'audio/mpeg',
      'video/mp4',
      'application/x-besidka-hidden-file',
      'not a media type',
    ]) {
      it(`is total for "${mediaType}"`, () => {
        expect(resolveFileDelivery({
          route: 'direct',
          providerId: 'anthropic',
          mediaType,
          modalities: ['text', 'image', 'pdf'],
        })).toEqual({ delivery: 'unsupported', reason: 'unsupported-type' })
      })
    }
  })
})

describe('resolveFileDelivery with Run code files', () => {
  const docx = OFFICE_MEDIA_TYPES.docx
  const sandboxProviders = Object.keys(CODE_EXECUTION_FILE_DELIVERY)

  it('names how each sandbox provider takes files', () => {
    expect(CODE_EXECUTION_FILE_DELIVERY).toEqual({
      anthropic: 'upload',
      openai: 'upload',
      google: 'inline',
    })
  })

  it('lists only types the code-execution allowlist accepts', () => {
    const samples: Record<string, [string, Uint8Array]> = {
      'application/json': ['out.json', new TextEncoder().encode('{}')],
      [OFFICE_MEDIA_TYPES.docx]: ['a.docx', new Uint8Array([0x50, 0x4b, 3, 4])],
      [OFFICE_MEDIA_TYPES.xlsx]: ['a.xlsx', new Uint8Array([0x50, 0x4b, 3, 4])],
      [OFFICE_MEDIA_TYPES.pptx]: ['a.pptx', new Uint8Array([0x50, 0x4b, 3, 4])],
    }

    expect([...CODE_EXECUTION_CONTAINER_MEDIA_TYPES].sort())
      .toEqual(Object.keys(samples).sort())

    for (const [mediaType, [fileName, bytes]] of Object.entries(samples)) {
      const result = resolveContainerFileType(fileName, bytes)

      expect(result.ok && result.type.mediaType).toBe(mediaType)
    }
  })

  for (const providerId of sandboxProviders) {
    const container = CODE_EXECUTION_FILE_DELIVERY[providerId]

    it(`hands ${providerId} an unreadable Office file as ${container}`, () => {
      expect(resolveFileDelivery({
        route: 'direct',
        providerId,
        mediaType: docx,
        textStatus: 'failed',
        codeExecutionFiles: true,
      })).toEqual({ delivery: 'container', container })
    })

    it(`keeps the text for ${providerId} and adds the sandbox copy`, () => {
      expect(resolveFileDelivery({
        route: 'direct',
        providerId,
        mediaType: docx,
        textStatus: 'ready',
        codeExecutionFiles: true,
      })).toEqual({ delivery: 'text', container })
    })

    it(`hands ${providerId} a JSON file as ${container}`, () => {
      expect(resolveFileDelivery({
        route: 'direct',
        providerId,
        mediaType: 'application/json',
        codeExecutionFiles: true,
      })).toEqual({ delivery: 'container', container })
    })
  }

  it('does nothing for providers without a sandbox', () => {
    for (const providerId of ['xai', 'deepseek', 'moonshotai', 'qwen']) {
      expect(resolveFileDelivery({
        route: 'direct',
        providerId,
        mediaType: 'application/json',
        codeExecutionFiles: true,
      })).toEqual({ delivery: 'unsupported', reason: 'unsupported-type' })
      expect(resolveFileDelivery({
        route: 'direct',
        providerId,
        mediaType: docx,
        textStatus: 'failed',
        codeExecutionFiles: true,
      })).toEqual({ delivery: 'unsupported', reason: 'office-unreadable' })
    }
  })

  it('does nothing on a gateway or without the files switch', () => {
    for (const route of gatewayIds) {
      expect(resolveFileDelivery({
        route,
        providerId: 'anthropic',
        mediaType: 'application/json',
        codeExecutionFiles: true,
      })).toEqual({ delivery: 'unsupported', reason: 'unsupported-type' })
    }

    expect(resolveFileDelivery({
      route: 'direct',
      providerId: 'anthropic',
      mediaType: 'application/json',
      codeExecutionFiles: false,
    })).toEqual({ delivery: 'unsupported', reason: 'unsupported-type' })
    expect(resolveFileDelivery({
      route: 'direct',
      providerId: 'anthropic',
      mediaType: docx,
      textStatus: 'failed',
    })).toEqual({ delivery: 'unsupported', reason: 'office-unreadable' })
  })

  it('never opens the sandbox path for legacy or unknown types', () => {
    for (const mediaType of [
      'application/msword',
      'application/zip',
      'application/octet-stream',
      'audio/mpeg',
    ]) {
      expect(resolveFileDelivery({
        route: 'direct',
        providerId: 'anthropic',
        mediaType,
        codeExecutionFiles: true,
      }).delivery).toBe('unsupported')
    }
  })
})
