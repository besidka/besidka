<template>
  <div class="fixed z-30 bottom-0 sm:left-1/2 sm:-translate-x-1/2 max-sm:inset-x-3">
    <UiBubble
      class="!pb-0 z-50 !rounded-b-none !rounded-t-[calc(var(--radius-xl)_+_var(--spacing)_*_2)] !bg-accent/20 transition-transform duration-500 ease-in-out"
      :class="{
        'translate-y-full': !visible,
        'translate-y-0': visible,
      }"
    >
      <div
        class="p-1 pb-0 max-sm:pb-16 rounded-t-xl bg-base-100/80 dark:bg-base-100/80 shadow-lg"
      >
        <textarea
          v-model="message"
          class="textarea textarea-ghost !bg-transparent w-lg max-w-full h-12 resize-none rounded-[calc(var(--radius-field))]"
          placeholder="Type your message here..."
          :disabled="pending"
          @keydown.enter.exact.prevent="sendMessage"
        />
        <div class="flex items-center justify-between p-2">
          <div>
            <div class="dropdown dropdown-top">
              <div
                tabindex="0"
                role="button"
                aria-label="Select model"
                class="btn btn-ghost btn-sm [--size:calc(var(--size-field)_*_6)] transition-colors duration-200"
              >
                {{ getModelName(userModel) }}
                <Icon name="lucide:chevron-up" size="14" />
              </div>
              <div
                tabindex="0"
                class="dropdown-content menu bg-base-100 rounded-box z-50 w-64 shadow-sm"
              >
                <ul class="menu menu-xs w-full">
                  <li
                    v-for="provider in providers"
                    :key="provider.id"
                  >
                    <span class="menu-title">{{ provider.name }}</span>
                    <ul>
                      <li v-for="model in provider.models" :key="model.id">
                        <button
                          type="button"
                          @click="userModel = model.id"
                        >
                          {{ model.name }}
                        </button>
                      </li>
                    </ul>
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <div>
            <UiButton
              mode="accent"
              circle
              :disabled="!message.trim() || pending"
              title="Send Message"
              icon-name="lucide:arrow-up"
              icon-only
              tooltip-position="left"
              @click="sendMessage"
            />
          </div>
        </div>
      </div>
    </UiBubble>
  </div>
</template>
<script setup lang="ts">
const { data: providers } = await useFetch('/api/v1/providers', {
  cache: 'reload',
})

defineProps<{
  pending?: boolean
}>()

const emit = defineEmits<{
  submit: [string]
}>()

const visible = shallowRef<boolean>(false)

onMounted(() => {
  setTimeout(() => {
    visible.value = true
  }, 100)
})

onBeforeUnmount(() => {
  visible.value = false
})

const { userModel } = useUserModel()
const { replaceUserPre } = useChatInput()

function getModelName(modelId: string): string {
  const emptyTitle = 'Select Model'
  let modelName

  for (const provider of Object.values(providers.value ?? {})) {
    for (const model of provider.models) {
      if (model.id === modelId) {
        modelName = model.name
        break
      }
    }
  }

  return modelName ?? emptyTitle
}

const message = defineModel<string>({
  default: '',
  get: (value: string) => {
    value = replaceUserPre(value)

    return value
  },
  set: (value: string) => {
    value = replaceUserPre(value)

    return value
  },
})

function sendMessage() {
  if (!message.value?.trim()) {
    return useWarningMessage('Please enter a message before sending.')
  }

  emit('submit', message.value)
  message.value = ''
}
</script>
