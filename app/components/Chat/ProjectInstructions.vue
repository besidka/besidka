<template>
  <div class="w-screen sm:w-4xl sm:max-w-screen mx-auto px-4 sm:px-24">
    <UiBubble class="!block shadow-none">
      <details
        v-if="instructions"
        class="group collapse"
        :open="isInstructionsExpanded"
      >
        <summary
          class="collapse-title flex items-center gap-1 p-0 text-xs"
          @click.prevent="isInstructionsExpanded = !isInstructionsExpanded"
        >
          <Icon name="lucide:folder-cog" size="12" />
          <span>Project instructions</span>
          <Icon
            name="lucide:chevron-right"
            class="
              size-4 text-base-content/60 transition-transform
              group-open:rotate-90
            "
          />
        </summary>
        <div
          v-if="isInstructionsExpanded"
          class="collapse-content mt-3 px-0 pb-0"
        >
          <div class="mb-2 text-xs font-medium text-base-content/70">
            {{ projectName || 'Project' }}
          </div>
          <p class="whitespace-pre-wrap text-sm leading-6">
            {{ instructions }}
          </p>
          <div
            v-if="projectId"
            class="mt-3"
          >
            <NuxtLink
              :to="`/chats/projects/${projectId}`"
              class="btn btn-sm"
            >
              <Icon name="lucide:settings-2" />
              Project settings
            </NuxtLink>
          </div>
        </div>
      </details>

      <span v-if="memory" class="divider my-1"/>

      <details
        v-if="memory"
        class="group collapse !rounded-none"
        :open="isMemoryExpanded"
      >
        <summary
          class="collapse-title flex items-center gap-1 p-0 text-xs"
          @click.prevent="isMemoryExpanded = !isMemoryExpanded"
        >
          <Icon name="lucide:database-search" size="12" />
          <span>Project memory</span>
          <Icon
            name="lucide:chevron-right"
            class="
              size-4 text-base-content/60 transition-transform
              group-open:rotate-90
            "
          />
        </summary>
        <div
          v-if="isMemoryExpanded"
          class="collapse-content mt-3 px-0 pb-0"
        >
          <p class="whitespace-pre-wrap text-sm leading-6">
            {{ memory }}
          </p>
          <div
            v-if="projectId"
            class="mt-3"
          >
            <NuxtLink
              :to="`/chats/projects/${projectId}`"
              class="btn btn-sm"
            >
              <Icon name="lucide:settings-2" />
              Project settings
            </NuxtLink>
          </div>
        </div>
      </details>
    </UiBubble>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  projectId?: string | null
  projectName: string | null
  instructions?: string | null
  memory?: string | null
}>()

const isInstructionsExpanded = shallowRef<boolean>(false)
const isMemoryExpanded = shallowRef<boolean>(false)
</script>
