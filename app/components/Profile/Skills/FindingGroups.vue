<template>
  <div
    v-if="findings.length"
    class="grid gap-2"
    :data-testid="testId"
  >
    <details
      v-for="group in groups"
      :key="group.severity"
      class="rounded-box border border-base-300"
      :open="group.isOpenByDefault"
      :data-testid="`${testId}-${group.severity}`"
    >
      <summary class="cursor-pointer px-3 py-2 text-sm font-medium">
        {{ group.title }} ({{ group.findings.length }})
      </summary>
      <ul class="grid max-h-72 gap-1 overflow-auto border-t border-base-300 p-2 text-xs">
        <li
          v-for="(finding, index) in group.findings"
          :key="index"
        >
          <component
            :is="isSelectable ? 'button' : 'div'"
            :type="isSelectable ? 'button' : undefined"
            class="grid w-full min-w-0 gap-1 rounded-field px-1 py-1 text-left"
            :class="{ 'hover:bg-base-200': isSelectable }"
            data-testid="skill-review-finding"
            @click="isSelectable && emit('select', finding.path, finding.line)"
          >
            <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span
                class="badge badge-soft badge-xs shrink-0"
                :class="group.severity === 'high' ? 'badge-warning' : ''"
                data-testid="skill-review-finding-marker"
              >
                {{ getFindingMarker(finding.type) }}
              </span>
              <span
                v-if="finding.source === 'jev'"
                class="badge badge-soft badge-info badge-xs shrink-0"
                data-testid="skill-review-finding-source"
              >
                TypeSafe AI
              </span>
              <span class="shrink-0 font-mono">
                {{ showPath ? `${finding.path}:` : 'Line ' }}{{ finding.line }}
              </span>
              <span
                v-if="describeQuotedMention(finding)"
                class="shrink-0 text-base-content/70"
                data-testid="skill-review-finding-quoted"
              >
                {{ describeQuotedMention(finding) }}
              </span>
            </span>
            <span
              class="min-w-0 break-words"
              data-testid="skill-review-finding-explanation"
            >
              {{ describeFinding(finding).explanation }}
              <span
                v-if="describeFinding(finding).detail"
                class="text-base-content/70"
                data-testid="skill-review-finding-detail"
              >
                {{ describeFinding(finding).detail }}
              </span>
            </span>
            <span
              v-if="describeFinding(finding).callout"
              class="font-medium"
              data-testid="skill-review-finding-callout"
            >
              {{ describeFinding(finding).callout }}
            </span>
            <code
              v-if="finding.snippet"
              class="min-w-0 break-all text-base-content/70"
            >{{ finding.snippet }}</code>
          </component>
        </li>
      </ul>
    </details>
  </div>
</template>

<script setup lang="ts">
import type { SkillFinding } from '#shared/utils/skills/findings'

const props = withDefaults(defineProps<{
  findings: SkillFinding[]
  isSelectable?: boolean
  showPath?: boolean
  testId?: string
}>(), {
  isSelectable: true,
  showPath: true,
  testId: 'skill-review-findings',
})

const emit = defineEmits<{
  select: [path: string, line: number]
}>()

const groups = computed(() => {
  return groupFindingsBySeverity(props.findings)
})
</script>
