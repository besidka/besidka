import { describe, expect, it } from 'vitest'
import type { Model } from '../../../shared/types/providers.d'
import type { ModelSelection } from '../../../shared/types/model-selection.d'
import { gatewayIds } from '../../../shared/utils/gateways'
import { resolveFileDelivery } from '../../../shared/utils/file-delivery'
import { getModelInputModalities } from '../../../shared/utils/model'
import {
  OFFICE_MEDIA_TYPES,
  OFFICE_TEXT_INLINE_MAX_BYTES,
} from '../../../shared/utils/office-files'
import {
  SENT_AS_TEXT_DESCRIPTION,
  SENT_AS_TEXT_LABEL,
  SENT_AS_TEXT_SHORTENED_DESCRIPTION,
  SENT_AS_TEXT_SHORTENED_LABEL,
  buildFileDeliveryInput,
  createFileDeliveryResolver,
  createPredicateDeliveryResolver,
  getClientTextStatus,
  getFileDeliveryContext,
  getBlockedFileMessages,
  getFileDeliveryHint,
  getFileRejection,
  getRejectionCaption,
  getRejectionMessages,
  isTextTruncated,
} from '../../../app/utils/file-delivery-hints'
import type { DeliveryFile } from '../../../app/utils/file-delivery-hints'

const DOCX = OFFICE_MEDIA_TYPES.docx
const XLSX = OFFICE_MEDIA_TYPES.xlsx
const PPTX = OFFICE_MEDIA_TYPES.pptx
const FAIL_OPEN_MODALITIES = ['image', 'pdf']
const TERMINAL_STATUSES = ['empty', 'failed', 'too_large']

const PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'xai',
  'deepseek',
  'moonshotai',
  'qwen',
] as const

const MODALITY_SETS: Array<string[] | undefined> = [
  ['text'],
  ['text', 'image'],
  ['text', 'pdf'],
  ['text', 'image', 'pdf'],
  undefined,
]

const MEDIA_TYPES = [
  'image/png',
  'application/pdf',
  'text/plain',
  'text/csv',
  DOCX,
  XLSX,
  PPTX,
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/zip',
]

const TEXT_STATUSES = [undefined, null, 'ready', 'empty', 'failed', 'too_large']

const directSelection = {
  source: 'provider',
  modelId: 'direct-model',
} as ModelSelection

function createModel(inputModalities: string[] | undefined): Model | null {
  if (!inputModalities) {
    return null
  }

  return {
    modalities: { input: inputModalities, output: ['text'] },
  } as Model
}

function selectGateway(gatewayId: string): ModelSelection {
  return {
    source: 'gateway',
    gatewayId,
    modelId: 'vendor/model',
  } as ModelSelection
}

describe('getClientTextStatus', () => {
  it('treats a missing status as readable so the server can extract it', () => {
    expect(getClientTextStatus({ type: DOCX })).toBe('ready')
    expect(getClientTextStatus({ type: DOCX, textStatus: null })).toBe('ready')
    expect(getClientTextStatus({ type: DOCX, textStatus: 'ready' }))
      .toBe('ready')
  })

  it('keeps a terminal status', () => {
    for (const textStatus of TERMINAL_STATUSES) {
      expect(getClientTextStatus({ type: DOCX, textStatus })).toBe(textStatus)
    }
  })
})

describe('isTextTruncated', () => {
  it('prefers the flag the files list returns', () => {
    expect(isTextTruncated({ type: DOCX, textTruncated: true })).toBe(true)
    expect(isTextTruncated({
      type: DOCX,
      textTruncated: false,
      textBytes: OFFICE_TEXT_INLINE_MAX_BYTES + 1,
    })).toBe(false)
  })

  it('derives it from the text size when the flag is absent', () => {
    expect(isTextTruncated({
      type: DOCX,
      textBytes: OFFICE_TEXT_INLINE_MAX_BYTES,
    })).toBe(false)
    expect(isTextTruncated({
      type: DOCX,
      textBytes: OFFICE_TEXT_INLINE_MAX_BYTES + 1,
    })).toBe(true)
    expect(isTextTruncated({ type: DOCX })).toBe(false)
    expect(isTextTruncated({ type: DOCX, textBytes: null })).toBe(false)
  })
})

describe('getFileDeliveryHint', () => {
  const resolve = createFileDeliveryResolver({
    route: 'direct',
    providerId: 'anthropic',
    modalities: ['text', 'image', 'pdf'],
  })

  it('says an Office file is sent as text', () => {
    for (const type of [DOCX, XLSX, PPTX]) {
      expect(getFileDeliveryHint({ type, textStatus: 'ready' }, resolve))
        .toEqual({
          label: SENT_AS_TEXT_LABEL,
          description: SENT_AS_TEXT_DESCRIPTION,
          isBlocking: false,
        })
    }
  })

  it('says so for a stored file whose text is not read yet', () => {
    const hint = getFileDeliveryHint({ type: DOCX, textStatus: null }, resolve)

    expect(hint?.label).toBe(SENT_AS_TEXT_LABEL)
  })

  it('says the text is shortened when it is over the per-file cap', () => {
    expect(getFileDeliveryHint({
      type: XLSX,
      textStatus: 'ready',
      textBytes: OFFICE_TEXT_INLINE_MAX_BYTES + 10,
    }, resolve)).toEqual({
      label: SENT_AS_TEXT_SHORTENED_LABEL,
      description: SENT_AS_TEXT_SHORTENED_DESCRIPTION,
      isBlocking: false,
    })
    expect(getFileDeliveryHint({
      type: XLSX,
      textStatus: 'ready',
      textTruncated: true,
    }, resolve)?.label).toBe('Sent as text (shortened)')
  })

  it('shows nothing for files that are not converted to text', () => {
    for (const type of ['image/png', 'application/pdf', 'text/plain']) {
      expect(getFileDeliveryHint({ type }, resolve)).toBeNull()
    }
  })

  it('marks a file that cannot be read as blocking, with the reason', () => {
    const unreadable = getFileDeliveryHint(
      { type: DOCX, textStatus: 'empty' },
      resolve,
    )
    const legacy = getFileDeliveryHint({ type: 'application/msword' }, resolve)

    expect(unreadable).toMatchObject({
      label: 'No readable text',
      isBlocking: true,
    })
    expect(unreadable?.description).toContain('No text could be read')
    expect(legacy).toMatchObject({ label: 'Old Office format', isBlocking: true })
  })

  describe('with Run code', () => {
    const context = {
      route: 'direct' as const,
      providerId: 'anthropic',
      modalities: ['text', 'image', 'pdf'],
    }
    const withoutRunCode = createFileDeliveryResolver(context)
    const withRunCode = createFileDeliveryResolver({
      ...context,
      codeExecutionFiles: true,
    })

    it('says a JSON file needs Run code while Run code is off', () => {
      expect(getFileDeliveryHint(
        { type: 'application/json' },
        withoutRunCode,
        withRunCode,
      )).toEqual({
        label: 'Needs Run code',
        description: 'Turn on Run code to send this file, or remove it.',
        isBlocking: true,
      })
    })

    it('shows nothing for a JSON file once Run code is on', () => {
      expect(getFileDeliveryHint(
        { type: 'application/json' },
        withRunCode,
        withRunCode,
      )).toBeNull()
    })

    it('gives the plain reason when Run code is not available', () => {
      expect(getFileDeliveryHint({ type: 'application/json' }, withoutRunCode))
        .toMatchObject({ label: 'Type not supported', isBlocking: true })
    })

    it('blocks a send with one message naming the files that need Run code',
      () => {
        const messages = getBlockedFileMessages(
          [
            { type: 'application/json', name: 'data.json' },
            { type: DOCX, textStatus: 'failed', name: 'broken.docx' },
            { type: 'text/plain', name: 'notes.txt' },
          ],
          withoutRunCode,
          withRunCode,
          () => true,
        )

        expect(messages).toEqual([
          'data.json, broken.docx: Turn on Run code to send these files, '
          + 'or remove them.',
        ])
      })

    it('blocks a send with the plain reason when Run code is not available',
      () => {
        const messages = getBlockedFileMessages(
          [{ type: 'application/zip', name: 'backup.zip' }],
          withoutRunCode,
          undefined,
          () => true,
        )

        expect(messages).toHaveLength(1)
        expect(messages[0]).toContain('backup.zip: This file type cannot be')
      })

    it('does not block a send when every file can be delivered', () => {
      expect(getBlockedFileMessages(
        [{ type: 'application/json', name: 'data.json' }],
        withRunCode,
        withRunCode,
        () => true,
      )).toEqual([])
    })
  })
})

describe('getFileRejection and getRejectionMessages', () => {
  const textOnly = createFileDeliveryResolver({
    route: 'direct',
    modalities: ['text'],
  })
  const canAttach = (mediaType: string) => {
    return mediaType.startsWith('text/')
  }

  it('returns no rejection for a deliverable file', () => {
    expect(getFileRejection({ type: DOCX, textStatus: 'ready' }, textOnly))
      .toBeNull()
    expect(getFileRejection({ type: 'text/plain' }, textOnly)).toBeNull()
  })

  it('names each disabled reason', () => {
    const cases: Array<[DeliveryFile, string | undefined]> = [
      [{ type: 'image/png' }, 'model-no-image'],
      [{ type: 'application/pdf' }, 'model-no-pdf'],
      [{ type: DOCX, textStatus: 'failed' }, 'office-unreadable'],
      [{ type: XLSX, textStatus: 'empty' }, 'office-unreadable'],
      [{ type: PPTX, textStatus: 'too_large' }, 'office-unreadable'],
      [{ type: 'application/vnd.ms-excel' }, 'legacy-office'],
      [{ type: 'application/msword' }, 'legacy-office'],
      [{ type: 'application/zip' }, 'unsupported-type'],
    ]

    for (const [file, reason] of cases) {
      expect(getFileRejection(file, textOnly)?.reason).toBe(reason)
    }
  })

  it('keeps the model-switch wording for images and PDFs', () => {
    const [message] = getRejectionMessages([
      { reason: 'model-no-image', type: 'image/png' },
    ], canAttach)

    expect(message).toBe(
      'This model does not support image input. Attach a text file '
      + 'instead, or switch models.',
    )
  })

  it('explains an unreadable document with the file name', () => {
    const [message] = getRejectionMessages([
      { reason: 'office-unreadable', type: DOCX, name: 'Plan.docx' },
    ], canAttach)

    expect(message).toContain('Plan.docx: No text could be read')
    expect(message).toContain('.docx, .xlsx or .pptx')
    expect(message).not.toContain('..')
    expect(message.endsWith('again.')).toBe(true)
  })

  it('explains a legacy Office file with the save-as hint', () => {
    const [message] = getRejectionMessages([
      { reason: 'legacy-office', type: 'application/vnd.ms-excel' },
    ], canAttach)

    expect(message).toContain('cannot be read')
    expect(message).toContain('Save the file as .docx, .xlsx or .pptx')
  })

  it('groups one message per reason', () => {
    const messages = getRejectionMessages([
      { reason: 'model-no-image', type: 'image/png' },
      { reason: 'model-no-pdf', type: 'application/pdf' },
      { reason: 'office-unreadable', type: DOCX, name: 'a.docx' },
      { reason: 'office-unreadable', type: XLSX, name: 'b.xlsx' },
      { reason: 'unsupported-type', type: 'application/zip' },
    ], canAttach)

    expect(messages).toHaveLength(3)
    expect(messages[0]).toContain('image or PDF input')
    expect(messages[1]).toContain('a.docx, b.xlsx')
    expect(messages[2]).toContain('cannot be sent to a model')
  })
})

describe('getRejectionCaption', () => {
  it('has a short caption for every reason', () => {
    expect(getRejectionCaption('model-no-image')).toBe('Model can\'t read images')
    expect(getRejectionCaption('model-no-pdf')).toBe('Model can\'t read PDFs')
    expect(getRejectionCaption('office-unreadable')).toBe('No readable text')
    expect(getRejectionCaption('legacy-office')).toBe('Old Office format')
    expect(getRejectionCaption('unsupported-type')).toBe('Type not supported')
    expect(getRejectionCaption(undefined)).toBe('Type not supported')
  })
})

describe('createPredicateDeliveryResolver', () => {
  it('follows the image and PDF support of the predicate', () => {
    const resolve = createPredicateDeliveryResolver((mediaType) => {
      return !mediaType.startsWith('image/')
    })

    expect(resolve({ type: 'image/png' }))
      .toEqual({ delivery: 'unsupported', reason: 'model-no-image' })
    expect(resolve({ type: 'application/pdf' })).toEqual({ delivery: 'native' })
    expect(resolve({ type: DOCX })).toEqual({ delivery: 'text' })
  })
})

describe('client and server agree on how a file reaches the model', () => {
  describe('direct providers', () => {
    for (const providerId of PROVIDERS) {
      for (const modalities of MODALITY_SETS) {
        const label = `${providerId} with ${modalities?.join('+') ?? 'unknown'}`
        const model = createModel(modalities)
        const serverModalities = model
          ? getModelInputModalities(model)
          : FAIL_OPEN_MODALITIES

        it(`builds the inputs the send route builds for ${label}`, () => {
          const context = getFileDeliveryContext({
            selection: directSelection,
            model,
            providerId,
          })

          for (const type of MEDIA_TYPES) {
            for (const textStatus of TEXT_STATUSES) {
              expect(buildFileDeliveryInput(context, { type, textStatus }))
                .toEqual({
                  route: 'direct',
                  providerId,
                  modalities: serverModalities,
                  codeExecutionFiles: undefined,
                  mediaType: type,
                  textStatus: textStatus
                    && TERMINAL_STATUSES.includes(textStatus)
                    ? textStatus
                    : 'ready',
                })
            }
          }
        })

        it(`resolves every file as the server does for ${label}`, () => {
          const resolve = createFileDeliveryResolver(getFileDeliveryContext({
            selection: directSelection,
            model,
            providerId,
          }))

          for (const type of MEDIA_TYPES) {
            for (const textStatus of TEXT_STATUSES) {
              const serverResult = resolveFileDelivery({
                route: 'direct',
                providerId,
                modalities: serverModalities,
                mediaType: type,
                textStatus: textStatus ?? 'ready',
              })

              expect(resolve({ type, textStatus })).toEqual(serverResult)
            }
          }
        })
      }
    }
  })

  describe('gateways', () => {
    for (const gatewayId of gatewayIds) {
      it(`mirrors the PDF and image checks of the send route on ${gatewayId}`,
        () => {
          const resolveWith = (
            catalogInput: string[] | null,
          ) => {
            return createFileDeliveryResolver(getFileDeliveryContext({
              selection: selectGateway(gatewayId),
              model: null,
              gatewayModel: catalogInput
                ? { modalities: { input: catalogInput } }
                : null,
            }))
          }
          const withVision = resolveWith(['text', 'image'])
          const withoutVision = resolveWith(['text'])
          const unknownCatalog = resolveWith(null)

          expect(withVision({ type: 'image/png' }))
            .toEqual({ delivery: 'native' })
          expect(withoutVision({ type: 'image/png' })).toEqual(
            resolveFileDelivery({
              route: gatewayId,
              modalities: ['text'],
              mediaType: 'image/png',
            }),
          )
          expect(withoutVision({ type: 'application/pdf' }))
            .toEqual({ delivery: 'native' })
          expect(unknownCatalog({ type: 'image/png' }))
            .toEqual({ delivery: 'native' })

          for (const type of [DOCX, XLSX, PPTX]) {
            expect(withoutVision({ type, textStatus: 'ready' })).toEqual(
              resolveFileDelivery({
                route: gatewayId,
                mediaType: type,
                textStatus: 'ready',
              }),
            )
          }

          expect(withVision({ type: 'application/vnd.ms-excel' })).toEqual({
            delivery: 'unsupported',
            reason: 'legacy-office',
          })
        })
    }
  })

  describe('Run code with files', () => {
    const CONTAINER_TYPES = [DOCX, XLSX, PPTX, 'application/json']
    const SANDBOX_PROVIDERS = ['anthropic', 'openai', 'google']

    for (const providerId of PROVIDERS) {
      for (const codeExecutionFiles of [true, false]) {
        const label = `${providerId} with Run code files `
          + `${codeExecutionFiles ? 'on' : 'off'}`

        it(`builds the inputs and answers like the server for ${label}`,
          () => {
            const model = createModel(['text', 'image', 'pdf'])
            const context = getFileDeliveryContext({
              selection: directSelection,
              model,
              providerId,
              codeExecutionFiles,
            })
            const resolve = createFileDeliveryResolver(context)

            for (const type of CONTAINER_TYPES) {
              for (const textStatus of TEXT_STATUSES) {
                const serverInput = {
                  route: 'direct' as const,
                  providerId,
                  modalities: getModelInputModalities(model!),
                  codeExecutionFiles,
                  mediaType: type,
                  textStatus: textStatus
                    && TERMINAL_STATUSES.includes(textStatus)
                    ? textStatus
                    : 'ready',
                }

                expect(buildFileDeliveryInput(context, { type, textStatus }))
                  .toEqual(serverInput)
                expect(resolve({ type, textStatus }))
                  .toEqual(resolveFileDelivery(serverInput))
              }
            }
          })
      }
    }

    it('keeps JSON and unreadable Office files attachable with Run code on',
      () => {
        for (const providerId of SANDBOX_PROVIDERS) {
          const resolve = createFileDeliveryResolver(getFileDeliveryContext({
            selection: directSelection,
            model: createModel(['text', 'image', 'pdf']),
            providerId,
            codeExecutionFiles: true,
          }))

          expect(resolve({ type: 'application/json' }).delivery)
            .toBe('container')
          expect(resolve({ type: DOCX, textStatus: 'failed' }).delivery)
            .toBe('container')
          expect(getFileRejection({ type: 'application/json' }, resolve))
            .toBeNull()
        }
      })

    it('still disables them with Run code off or on another provider', () => {
      const withoutRunCode = createFileDeliveryResolver(getFileDeliveryContext({
        selection: directSelection,
        model: createModel(['text', 'image', 'pdf']),
        providerId: 'anthropic',
      }))
      const otherProvider = createFileDeliveryResolver(getFileDeliveryContext({
        selection: directSelection,
        model: createModel(['text', 'image', 'pdf']),
        providerId: 'xai',
        codeExecutionFiles: true,
      }))

      expect(withoutRunCode({ type: 'application/json' }).delivery)
        .toBe('unsupported')
      expect(otherProvider({ type: 'application/json' }).delivery)
        .toBe('unsupported')
    })
  })
})
