<template>
  <details
    ref="dropdown"
    class="group dropdown dropdown-top"
  >
    <summary
      aria-label="Select model"
      class="btn btn-ghost btn-sm rounded-full [--size:calc(var(--size-field)_*_6)] transition-colors duration-200"
      :class="{ 'btn-active': isDropdownHovered }"
    >
      <SvgoGeminiShort
        v-if="getModel(toValue(userModel)).provider?.id === 'google'"
        class="w-4 fill-base-content/40"
      />
      <SvgoOpenai
        v-if="getModel(toValue(userModel)).provider?.id === 'openai'"
        class="w-4 fill-base-content/40"
      />
      <span
        class="block truncate text-left"
        :class="{
          'max-xs:w-20 max-xxs:w-auto':
            !(isWebSearchEnabled && isReasoningEnabled)
              && (isWebSearchEnabled || isReasoningEnabled),
        }"
      >
        {{ getModelName(toValue(userModel)) }}
      </span>
      <Icon
        name="lucide:chevron-down"
        size="14"
        class="group-open:scale-y-[-1]"
      />
    </summary>
    <ClientOnly>
      <div class="dropdown-content z-50 w-64 pb-2">
        <div class="bg-base-100 rounded-box w-full shadow-sm">
          <ul class="menu menu-xs w-full">
            <li
              v-for="provider in providers"
              :key="provider.id"
            >
              <span class="menu-title flex items-center gap-2">
                <SvgoGeminiShort
                  v-if="provider.id === 'google'"
                  class="w-4 fill-base-content/40"
                />
                <SvgoOpenai
                  v-if="provider.id === 'openai'"
                  class="w-4 fill-base-content/40"
                />
                {{ provider.name }}
              </span>
              <ul>
                <li
                  v-for="model in provider.models"
                  :key="model.id"
                >
                  <button
                    type="button"
                    class="flex items-center"
                    :class="{
                      'bg-accent text-accent-content pointer-events-none':
                        userModel === model.id,
                      'tooltip tooltip-right': $device.isDesktop
                    }"
                    :aria-label="`Choose ${model.name}`"
                    :data-tip="model.price
                      ? `${model.price.input} / ${model.price.output}`
                      : undefined
                    "
                    @click="selectModel(model.id)"
                  >
                    <span class="grow">{{ model.name }}</span>
                    <span class="shrink-0 flex gap-1 items-center">
                      <span
                        v-if="model.reasoning"
                        class="shrink-0 flex items-center p-0.5 rounded-full bg-warning-content"
                        :class="{
                          'tooltip tooltip-warning tooltip-top':
                            $device.isDesktop
                        }"
                        data-tip="Thinking"
                      >
                        <Icon
                          name="lucide:brain"
                          class="text-warning"
                        />
                      </span>
                      <span
                        v-if="model.tools.includes('web_search')"
                        class="shrink-0 flex items-center p-0.5 rounded-full bg-info-content"
                        :class="{
                          'tooltip tooltip-info tooltip-top':
                            $device.isDesktop
                        }"
                        data-tip="Web search"
                      >
                        <Icon
                          v-if="model.tools.includes('web_search')"
                          name="lucide:globe"
                          class="text-info"
                        />
                      </span>
                    </span>
                  </button>
                </li>
              </ul>
            </li>
          </ul>
        </div>
      </div>
    </ClientOnly>
  </details>
</template>

<script setup lang="ts">
defineProps<{
  isWebSearchEnabled: boolean
  isReasoningEnabled: boolean
}>()

const { userModel } = useUserModel()
const { providers } = getProviders()
const { isIos, isAndroid } = useDevice()

const dropdown = useTemplateRef<HTMLDetailsElement>('dropdown')
const isDropdownHovered = useElementHover(dropdown)

onClickOutside(dropdown, () => {
  if (dropdown.value?.open) {
    dropdown.value.open = false
  }
})

watch(isDropdownHovered, (hovered) => {
  if (!dropdown.value || isIos || isAndroid) {
    return
  }

  dropdown.value.open = hovered
}, {
  immediate: false,
  flush: 'post',
})

function selectModel(modelId: string) {
  userModel.value = modelId

  if (dropdown.value) {
    dropdown.value.open = false
  }
}
</script>
