<template>
  <ChatMessage role="assistant">
    <div
      v-if="showLoading && !clarification"
      data-testid="research-clarify-loading"
      class="flex items-center gap-2 text-xs font-medium text-base-content/70"
    >
      <SvgoLoader class="size-3.5" />
      <span>Preparing research questions…</span>
    </div>
    <form
      v-else-if="clarification"
      data-testid="research-clarify-form"
      class="flex flex-col gap-4"
      @submit.prevent="onSubmit"
    >
      <div class="flex items-center gap-2 text-xs font-medium text-base-content/90">
        <Icon name="lucide:telescope" class="size-4 text-accent" />
        <span>A few questions before I start researching</span>
      </div>
      <p
        v-if="clarification.note"
        class="text-sm text-base-content/80"
      >
        {{ clarification.note }}
      </p>
      <div
        v-for="question in clarification.questions"
        :key="question.id"
        :data-testid="`research-clarify-question-${question.id}`"
        class="flex flex-col gap-2"
      >
        <label class="text-xs font-medium text-base-content/90">
          {{ question.question }}
        </label>
        <div
          v-if="question.kind === 'choice'"
          class="flex flex-wrap gap-2"
        >
          <button
            v-for="option in question.options"
            :key="option"
            type="button"
            :data-testid="`research-clarify-option-${question.id}-${option}`"
            class="btn btn-sm"
            :class="{
              'btn-accent': answers[question.id] === option,
              'btn-outline': answers[question.id] !== option,
            }"
            :disabled="isSubmitting"
            @click="selectChoice(question.id, option)"
          >
            {{ option }}
          </button>
        </div>
        <input
          v-else
          type="text"
          :data-testid="`research-clarify-text-${question.id}`"
          class="input input-sm w-full"
          :placeholder="question.placeholder || 'Type your answer'"
          :value="answers[question.id] || ''"
          :disabled="isSubmitting"
          @input="onTextInput(question.id, $event)"
        >
      </div>
      <div class="flex items-center justify-end gap-2">
        <button
          type="button"
          data-testid="research-clarify-skip"
          class="btn btn-ghost btn-sm"
          :disabled="isSubmitting"
          @click="onSkip"
        >
          Skip
        </button>
        <button
          type="submit"
          data-testid="research-clarify-submit"
          class="btn btn-accent btn-sm"
          :disabled="isSubmitting"
        >
          <SvgoLoader
            v-if="isSubmitting"
            class="size-3.5"
          />
          Start research
        </button>
      </div>
    </form>
  </ChatMessage>
</template>

<script setup lang="ts">
import type {
  ResearchClarificationResponse,
  ResearchAnswer,
} from '#shared/types/research.d'

const props = defineProps<{
  clarification?: ResearchClarificationResponse | null
  loading?: boolean
}>()

const emit = defineEmits<{
  submit: [answers: ResearchAnswer[]]
  skip: []
}>()

const answers = reactive<Record<string, string>>({})
const isSubmitting = shallowRef<boolean>(false)
const showLoading = shallowRef<boolean>(false)
let loadingDelayTimeoutId: ReturnType<typeof setTimeout> | undefined

watch(() => props.loading, (loading) => {
  if (loadingDelayTimeoutId !== undefined) {
    clearTimeout(loadingDelayTimeoutId)
    loadingDelayTimeoutId = undefined
  }

  if (!loading) {
    showLoading.value = false

    return
  }

  loadingDelayTimeoutId = setTimeout(() => {
    showLoading.value = true
  }, 300)
}, { immediate: true })

onUnmounted(() => {
  if (loadingDelayTimeoutId !== undefined) {
    clearTimeout(loadingDelayTimeoutId)
  }
})

function selectChoice(questionId: string, option: string) {
  answers[questionId] = option
}

function onTextInput(questionId: string, event: Event) {
  const target = event.target as HTMLInputElement

  answers[questionId] = target.value
}

function buildAnswers(): ResearchAnswer[] {
  if (!props.clarification) {
    return []
  }

  return props.clarification.questions
    .filter((question) => {
      return Boolean(answers[question.id]?.trim().length)
    })
    .map((question) => {
      return {
        id: question.id,
        question: question.question,
        answer: answers[question.id]?.trim() || '',
      }
    })
}

function onSubmit() {
  if (isSubmitting.value) {
    return
  }

  isSubmitting.value = true

  emit('submit', buildAnswers())
}

function onSkip() {
  if (isSubmitting.value) {
    return
  }

  isSubmitting.value = true

  emit('skip')
}
</script>
