import { streamText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

const { OPENAI_API_KEY, OPENAI_API_PROJECT_KEY } = process.env

const rules = z.object({
  model: z.string(),
  message: z.string().trim().min(1),
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, rules.safeParse)

  if (body.error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Message and model are required',
    })
  }

  setResponseHeader(event, 'Content-Type', 'text/html')
  setResponseHeader(event, 'Cache-Control', 'no-cache')
  setResponseHeader(event, 'Transfer-Encoding', 'chunked')

  // let interval: NodeJS.Timeout
  // const stream = new ReadableStream({
  //   start(controller) {
  //     controller.enqueue('<ul>')

  //     interval = setInterval(() => {
  //       controller.enqueue('<li>' + Math.random() + '</li>')
  //     }, 100)

  //     setTimeout(() => {
  //       clearInterval(interval)
  //       controller.close()
  //     }, 1000)
  //   },
  //   cancel() {
  //     clearInterval(interval)
  //   },
  // })

  // return sendStream(event, stream)

  const { model, message } = body.data

  const openai = createOpenAI({
    apiKey: OPENAI_API_KEY,
    ...OPENAI_API_PROJECT_KEY ? { project: OPENAI_API_PROJECT_KEY } : {},
  })

  const result = streamText({
    model: openai(model),
    messages: [
      {
        role: 'user',
        content: message,
      },
    ],
  })

  return result.toDataStreamResponse()
})
