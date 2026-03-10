<template>
  <div class="mb-8 text-center">
    <h1 class="text-4xl font-bold">
      History
    </h1>
    <h2 class="mt-2">
      View your chat history and revisit past conversations
    </h2>
  </div>
  <UiBubble>
    <ul class="list">
      <li class="p-4 pb-2 text-xs opacity-60 tracking-wide">
        You have <span class="font-semibold">{{ totalChats }}</span> chats in history
      </li>

      <template v-if="history?.pinned?.length">
        <li class="p-4 pb-2 text-xs opacity-60 tracking-wide uppercase">
          Pinned
        </li>
        <li
          v-for="chat in history.pinned"
          :key="chat.id"
          class="list-row items-center"
        >
          <NuxtLink
            :to="`/chats/${chat.slug}`"
            class="list-col-grow flex-1 truncate"
          >
            {{ chat.title || 'Untitled Chat' }}
          </NuxtLink>
          <UiButton
            icon-name="lucide:pin-off"
            :icon-size="16"
            text="Unpin"
            :tooltip="null"
            :icon-only="true"
            :ghost="true"
            size="xs"
            circle
            @click="togglePin(chat.id)"
          />
        </li>
      </template>

      <li class="p-4 pb-2 text-xs opacity-60 tracking-wide uppercase">
        All
      </li>
      <li
        v-for="chat in history?.all"
        :key="chat.id"
        class="list-row items-center"
      >
        <NuxtLink
          :to="`/chats/${chat.slug}`"
          class="list-col-grow flex-1 truncate"
        >
          {{ chat.title || 'Untitled Chat' }}
        </NuxtLink>
        <UiButton
          icon-name="lucide:pin"
          :icon-size="16"
          text="Pin"
          :tooltip="null"
          :icon-only="true"
          :ghost="true"
          size="xs"
          circle
          tooltip-position="left"
          @click="togglePin(chat.id)"
        />
      </li>
    </ul>
  </UiBubble>
</template>
<script setup lang="ts">
definePageMeta({
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Chats History',
})

const { data: history, error, refresh } = await useFetch('/api/v1/chats/history')

if (error.value) {
  throw createError({
    statusCode: error.value.status || 500,
    statusMessage:
      error.value.statusMessage || 'An error occurred while fetching the chats',
    data: error.value,
  })
}

const totalChats = computed(() =>
  (history.value?.pinned?.length ?? 0) + (history.value?.all?.length ?? 0),
)

async function togglePin(chatId: string) {
  await $fetch('/api/v1/chats/history/pin', {
    method: 'POST',
    body: { chatId },
  })
  await refresh()
}
</script>
