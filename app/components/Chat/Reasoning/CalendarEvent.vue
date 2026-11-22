<template>
  <div
    class="min-w-0 rounded-box bg-base-200 p-2 text-xs"
    data-testid="reasoning-approval-step-calendar-event"
  >
    <dl class="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
      <dt class="text-base-content/60">
        Title
      </dt>
      <dd
        class="min-w-0 break-words font-medium"
        data-testid="reasoning-approval-step-calendar-event-title"
      >
        {{ view.title }}
      </dd>
      <dt class="text-base-content/60">
        Kind
      </dt>
      <dd data-testid="reasoning-approval-step-calendar-event-kind">
        {{ view.isAllDay ? 'All-day event' : 'Timed event' }}
      </dd>
      <dt class="text-base-content/60">
        {{ view.isAllDay ? 'First day' : 'Start' }}
      </dt>
      <dd
        class="min-w-0 break-words"
        data-testid="reasoning-approval-step-calendar-event-start"
      >
        <time :datetime="view.start">{{ view.startLabel }}</time>
        <span
          class="block break-all text-base-content/60"
          data-testid="reasoning-approval-step-calendar-event-start-exact"
        >{{ view.start }}</span>
      </dd>
      <dt class="text-base-content/60">
        {{ view.isAllDay ? 'End (not included)' : 'End' }}
      </dt>
      <dd
        class="min-w-0 break-words"
        data-testid="reasoning-approval-step-calendar-event-end"
      >
        <time :datetime="view.end">{{ view.endLabel }}</time>
        <span
          class="block break-all text-base-content/60"
          data-testid="reasoning-approval-step-calendar-event-end-exact"
        >{{ view.end }}</span>
      </dd>
      <template v-if="view.lastDay">
        <dt class="text-base-content/60">
          Last day
        </dt>
        <dd
          class="min-w-0 break-words"
          data-testid="reasoning-approval-step-calendar-event-last-day"
        >
          <time :datetime="view.lastDay">{{ view.lastDayLabel }}</time>
          <span
            class="block break-all text-base-content/60"
            data-testid="reasoning-approval-step-calendar-event-last-day-exact"
          >{{ view.lastDay }}</span>
        </dd>
      </template>
      <dt class="text-base-content/60">
        Length
      </dt>
      <dd data-testid="reasoning-approval-step-calendar-event-duration">
        {{ view.durationLabel }}
      </dd>
      <dt class="text-base-content/60">
        Time zone
      </dt>
      <dd
        class="min-w-0 break-all"
        data-testid="reasoning-approval-step-calendar-event-time-zone"
      >
        {{ view.timeZone }}
      </dd>
      <template v-if="view.location">
        <dt class="text-base-content/60">
          Location
        </dt>
        <dd
          class="min-w-0 break-words"
          data-testid="reasoning-approval-step-calendar-event-location"
        >
          {{ view.location }}
        </dd>
      </template>
    </dl>
    <template v-if="view.description">
      <p
        class="mt-2 text-base-content/60"
        data-testid="reasoning-approval-step-calendar-event-lines"
      >
        Description · {{ lineCountText }}
      </p>
      <p
        class="mt-0.5 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-box outline-offset-2 focus:outline-2 focus:outline-accent"
        tabindex="0"
        role="region"
        aria-label="Event description"
        data-testid="reasoning-approval-step-calendar-event-description"
      >{{ view.cardDescription }}</p>
    </template>
    <p
      class="mt-2 text-base-content/60"
      data-testid="reasoning-approval-step-calendar-event-note"
    >
      {{ GOOGLE_CALENDAR_NO_INVITE_NOTE }}
    </p>
  </div>
</template>

<script setup lang="ts">
import type { CalendarEventApprovalView } from '#shared/utils/google-calendar-event'
import { GOOGLE_CALENDAR_NO_INVITE_NOTE } from '#shared/utils/google-calendar-tools'

const props = defineProps<{
  view: CalendarEventApprovalView
}>()

const lineCountText = computed<string>(() => {
  const count = props.view.descriptionLineCount

  return count === 1 ? '1 line' : `${count} lines`
})
</script>
