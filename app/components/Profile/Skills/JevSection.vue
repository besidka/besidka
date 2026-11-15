<template>
  <section
    v-if="view.kind !== 'hidden'"
    class="grid gap-2 rounded-box border border-base-300 p-3"
    aria-labelledby="skill-jev-title"
    data-testid="skill-jev-section"
  >
    <div class="flex items-center gap-1">
      <h4
        id="skill-jev-title"
        class="text-sm font-semibold"
      >
        Extra check by TypeSafe AI (your key)
      </h4>
      <button
        type="button"
        class="inline-grid size-5 shrink-0 cursor-pointer place-items-center rounded-full text-base-content/60 hover:text-accent"
        aria-label="Why this check ran"
        :aria-expanded="isExplanationOpen"
        :aria-controls="explanationId"
        data-testid="skill-jev-info"
        @click="isExplanationOpen = !isExplanationOpen"
      >
        <Icon
          name="lucide:info"
          size="14"
        />
      </button>
    </div>

    <ChatInputToolsMenuInfoNote
      v-show="isExplanationOpen"
      :id="explanationId"
      data-testid="skill-jev-info-note"
    >
      This ran automatically because you saved a TypeSafe AI key and
      Prompt-injection screening is on. Your key sends this skill's text to
      TypeSafe AI to look for passages that try to steer the assistant. It
      only adds highlights, never removes ours, and costs a fraction of a
      cent. Turn it off in
      <NuxtLink
        :to="checksSettingsPath"
        class="link"
        data-testid="skill-jev-info-settings-link"
      >Settings → Smart checks</NuxtLink>.
    </ChatInputToolsMenuInfoNote>

    <p
      v-if="view.kind === 'checking'"
      class="flex items-center gap-2 text-sm"
      role="status"
      data-testid="skill-jev-checking"
    >
      <span
        class="loading loading-spinner loading-xs"
        aria-hidden="true"
      />
      Checking…
    </p>

    <p
      v-else-if="view.kind === 'still-checking'"
      class="text-sm"
      role="status"
      data-testid="skill-jev-still-checking"
    >
      Still checking. Open this screen again in a moment to see the result.
    </p>

    <template v-else>
      <p
        v-if="marksSummary"
        class="text-sm"
        data-testid="skill-jev-marked"
      >
        {{ marksSummary }}
      </p>

      <div
        v-if="view.kind === 'failed'"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
        role="status"
        data-testid="skill-jev-failed"
      >
        <span data-testid="skill-jev-failed-text">{{ failureText }}</span>
        <button
          type="button"
          class="btn btn-xs"
          :disabled="view.isBusy"
          data-testid="skill-jev-retry"
          @click="emit('retry')"
        >
          Try again
        </button>
      </div>

      <div
        v-else-if="view.unchecked.length"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
        data-testid="skill-jev-unchecked"
      >
        <span data-testid="skill-jev-unchecked-text">
          Not checked: {{ partsLabel }}.
        </span>
        <button
          v-if="view.canCheckRest"
          type="button"
          class="btn btn-xs"
          :disabled="view.isBusy"
          data-testid="skill-jev-check-rest"
          @click="emit('checkRest')"
        >
          Check the rest
        </button>
        <span
          v-else
          class="text-xs text-base-content/70"
          data-testid="skill-jev-budget"
        >
          The check budget for this review is used up.
        </span>
      </div>

      <p
        v-else-if="!view.marks.length"
        class="text-sm text-base-content/70"
        data-testid="skill-jev-all-parts"
      >
        Checked every part. It marked nothing.
      </p>

      <p
        class="text-xs text-base-content/70"
        data-testid="skill-jev-caption"
      >
        A second look on your own key. It can miss things and it does not
        change the highlights from Besidka.
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
import {
  describeSkillLineRange,
  getSkillJevReason,
} from '#shared/utils/skills/jev-findings'
import type { SkillJevScreenView } from '~/composables/skill-jev-screen'

const MAX_LISTED_MARKS = 3
const checksSettingsPath = '/profile/keys?tab=memory-checks'

const props = defineProps<{
  view: SkillJevScreenView
}>()

const emit = defineEmits<{
  retry: []
  checkRest: []
}>()

const explanationId = useId()
const isExplanationOpen = shallowRef<boolean>(false)

function pluralizeParts(count: number): string {
  return `${count} ${count === 1 ? 'part' : 'parts'}`
}

const partsLabel = computed<string>(() => {
  return pluralizeParts(props.view.unchecked.length)
})

const marksSummary = computed<string>(() => {
  const { marks } = props.view

  if (marks.length === 0) {
    return ''
  }

  const listed = marks.slice(0, MAX_LISTED_MARKS).map((mark) => {
    return `${getSkillJevReason(mark.rule)} (${mark.path} ${
      describeSkillLineRange(mark)
    })`
  })
  const hidden = marks.length - listed.length
  const noun = marks.length === 1 ? 'passage' : 'passages'
  const more = hidden > 0 ? ` and ${hidden} more` : ''

  return `Marked ${marks.length} ${noun}: ${listed.join(', ')}${more}.`
})

const failureText = computed<string>(() => {
  const { view } = props

  if (view.message) {
    return `Did not finish: ${view.message}`
  }

  const reason = view.isKeyRejected
    ? 'TypeSafe AI did not accept your key.'
    : 'TypeSafe AI did not answer.'

  return view.unchecked.length
    ? `Did not finish: ${reason} ${
      pluralizeParts(view.unchecked.length)
    } not checked.`
    : `Did not finish: ${reason}`
})
</script>
