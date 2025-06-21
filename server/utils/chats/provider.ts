export function useChatProvider() {
  const event = useEvent()
  const { model } = parseCookies(event)

  if (!model) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Please select a model to continue.',
    })
  }

  const { providers } = useRuntimeConfig(event)
  const provider = Object.values(providers).find((p) => {
    return p.models.some((m: any) => m.id === model)
  })

  if (!provider) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'Current model is not supported by any provider. Please select a different model.',
    })
  }

  return {
    model,
    provider,
  }
}
