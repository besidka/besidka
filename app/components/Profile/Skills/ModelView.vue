<template>
  <div
    class="grid min-w-0 gap-3"
    data-testid="skill-model-view"
  >
    <section
      v-if="isSkillMd"
      class="grid gap-1"
      aria-labelledby="skill-model-catalog-title"
    >
      <h3
        id="skill-model-catalog-title"
        class="text-xs font-semibold uppercase tracking-wide text-base-content/70"
      >
        In the model's list of skills
      </h3>
      <pre
        v-if="catalogLine"
        class="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-box bg-base-200 p-3 font-mono text-xs"
        tabindex="0"
        data-testid="skill-model-catalog-line"
      >{{ showHiddenCharacters(catalogLine) }}</pre>
      <p
        v-else
        class="rounded-box bg-base-200 p-3 text-xs text-base-content/70"
        data-testid="skill-model-catalog-off"
      >
        This skill is not in the list. The model does not see it until you
        run it with its / command.
      </p>
      <p
        v-if="catalogLine"
        class="text-xs text-base-content/70"
        data-testid="skill-model-catalog-tokens"
      >
        ≈ {{ catalogTokens.toLocaleString() }} tokens in every message.
      </p>
    </section>

    <section class="grid gap-1">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-base-content/70">
        {{ bodyHeading }}
      </h3>
      <ProfileSkillsFileViewer
        :path="path"
        :text="text"
        :findings="findings"
      />
      <p
        class="text-xs"
        :class="isOverCap ? 'text-error' : 'text-base-content/70'"
        data-testid="skill-model-body-tokens"
      >
        ≈ {{ bodyTokens.toLocaleString() }} tokens
        <template v-if="isSkillMd">
          when the skill is used. The model reads up to
          {{ SKILL_ACTIVATE_MAX_TOKENS.toLocaleString() }}; the rest is cut.
        </template>
      </p>
      <p
        v-if="findings.length"
        class="text-xs text-base-content/70"
        data-testid="skill-model-findings-note"
      >
        Highlighted: {{ describeFindingCounts(findingCounts) }}.
        Besidka highlights links and commands so you can review them. It cannot
        tell whether a skill is safe.
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { SKILL_ACTIVATE_MAX_TOKENS } from '#shared/utils/skills-policy'
import type { SkillFinding } from '#shared/utils/skills/findings'
import { showHiddenCharacters } from '#shared/utils/skills/hidden-characters'

const props = withDefaults(defineProps<{
  path: string
  text: string
  isSkillMd?: boolean
  catalogLine?: string
  catalogTokens?: number
  bodyTokens?: number
  findings?: SkillFinding[]
  findingCounts?: Record<string, number>
}>(), {
  isSkillMd: false,
  catalogLine: '',
  catalogTokens: 0,
  bodyTokens: 0,
  findings: () => [],
  findingCounts: () => ({}),
})

const bodyHeading = computed<string>(() => {
  return props.isSkillMd
    ? 'Instructions the model reads'
    : 'File the model can read'
})

const isOverCap = computed<boolean>(() => {
  return props.isSkillMd && props.bodyTokens > SKILL_ACTIVATE_MAX_TOKENS
})
</script>
