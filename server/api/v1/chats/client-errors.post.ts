import { useLogger } from 'evlog'

interface ChatClientErrorReportBody {
  message?: string
  code?: string
  requestId?: string
  transportRequestId?: string
  chatId?: string
  modelId?: string
  providerId?: string
  reason?: string
  status?: number
}

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)
  const session = await useUserSession()
  const body = await readBody<ChatClientErrorReportBody>(event)

  logger.set({
    message: body.message || 'Client chat transport error',
    requestId: body.requestId,
    transportRequestId: body.transportRequestId,
    chatId: body.chatId,
    userId: session ? Number(session.user.id) : undefined,
    status: body.status,
    stage: 'client-transport',
    why: body.reason,
    attributes: {
      clientError: {
        modelId: body.modelId,
        providerId: body.providerId,
        errorCode: body.code,
      },
    },
  })

  setResponseStatus(event, 204)

  return null
})
