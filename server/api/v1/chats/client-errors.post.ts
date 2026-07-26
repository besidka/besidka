import { useLogger, createError } from 'evlog'

const clientErrorReportBodySchema = z.object({
  message: z.string().max(500).optional(),
  code: z.string().max(64).optional(),
  requestId: z.string().max(100).optional(),
  transportRequestId: z.string().max(100).optional(),
  chatId: z.string().max(64).optional(),
  modelId: z.string().max(200).optional(),
  providerId: z.string().max(64).optional(),
  reason: z.string().max(500).optional(),
  status: z.number().int().min(0).max(599).optional(),
})

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)
  const session = await useUserSession()

  const body = await readValidatedBody(
    event,
    clientErrorReportBodySchema.safeParse,
  )

  if (body.error) {
    throw createError({
      message: 'Invalid client error report body',
      status: 400,
      why: body.error.message,
    })
  }

  logger.set({
    message: body.data.message || 'Client chat transport error',
    requestId: body.data.requestId,
    transportRequestId: body.data.transportRequestId,
    chatId: body.data.chatId,
    userId: session ? Number(session.user.id) : undefined,
    status: body.data.status,
    stage: 'client-transport',
    why: body.data.reason,
    attributes: {
      clientError: {
        modelId: body.data.modelId,
        providerId: body.data.providerId,
        errorCode: body.data.code,
      },
    },
  })

  setResponseStatus(event, 204)

  return null
})
