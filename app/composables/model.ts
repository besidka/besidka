import type { ModelSelection } from '#shared/types/model-selection.d'

export function useUserModel() {
  const { defaultModel } = useRuntimeConfig().public
  const prefStorage = usePreferenceStorage()

  const selection = customRef<ModelSelection>((track, trigger) => ({
    get() {
      track()

      const parsed = parseModelSelection(
        prefStorage.getItem('model'),
        defaultModel as string,
      )

      if (parsed.source === 'provider' && !getModel(parsed.modelId).model) {
        return { source: 'provider', modelId: defaultModel as string }
      }

      return parsed
    },
    set(value) {
      prefStorage.setItem('model', serializeModelSelection(value))
      trigger()
    },
  }))

  const userModel = computed<string>({
    get() {
      return selection.value.modelId
    },
    set(value) {
      selection.value = { source: 'provider', modelId: value }
    },
  })

  return {
    selection,
    userModel,
  }
}
