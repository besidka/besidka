<template>
  <section
    class="grid grid-cols-[minmax(0,1fr)] gap-2"
    aria-labelledby="connector-directory-built-in"
    data-testid="connector-directory-section-built-in"
  >
    <h3
      id="connector-directory-built-in"
      class="flex items-center gap-2 text-sm font-semibold"
    >
      Built into Besidka
      <span class="badge badge-soft badge-sm">{{ entries.length }}</span>
    </h3>
    <ul class="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
      <li
        v-for="entry in entries"
        :key="entry.id"
        class="card card-border card-sm relative transition-colors hover:bg-base-200/60"
        data-testid="google-entry-card"
        :data-entry-id="entry.id"
      >
        <div class="card-body gap-2">
          <div class="flex items-start gap-3">
            <div
              class="avatar shrink-0"
              aria-hidden="true"
            >
              <div class="grid w-10 place-items-center rounded-full bg-base-200">
                <Icon
                  :name="entry.icon"
                  size="24"
                />
              </div>
            </div>
            <div class="min-w-0 grow">
              <p class="flex min-w-0 items-center gap-1 font-medium">
                <button
                  type="button"
                  class="min-w-0 truncate text-left after:absolute after:inset-0 after:rounded-box after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-primary"
                  :aria-label="`Details of ${entry.title}`"
                  data-testid="google-entry-card-open"
                  @click="emit('open', entry.id)"
                >
                  {{ entry.title }}
                </button>
                <span
                  class="badge badge-soft badge-xs shrink-0"
                  data-testid="google-entry-card-badge"
                >
                  Built in
                </span>
              </p>
            </div>
            <span
              v-if="isConnected(entry)"
              class="badge badge-soft badge-success badge-sm relative z-10 shrink-0 gap-1"
              data-testid="google-entry-card-connected"
            >
              <Icon
                name="lucide:check"
                size="12"
                aria-hidden="true"
              />
              Connected
            </span>
            <button
              v-else
              type="button"
              class="btn btn-primary btn-sm relative z-10 shrink-0 min-h-11 sm:min-h-8"
              :aria-label="`Connect ${entry.title}`"
              data-testid="google-entry-card-connect"
              @click="emit('open', entry.id)"
            >
              Connect
            </button>
          </div>
          <p class="line-clamp-2 break-words text-sm text-base-content/80">
            {{ entry.description }}
          </p>
        </div>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { GoogleEntryId } from '#shared/utils/google-connectors'
import type { GoogleEntry } from '~/utils/google-entries'

defineProps<{
  entries: GoogleEntry[]
}>()

const emit = defineEmits<{
  open: [entryId: GoogleEntryId]
}>()

function isConnected(entry: GoogleEntry): boolean {
  return entry.state === 'connected' || entry.state === 'partial'
}
</script>
