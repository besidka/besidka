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
        You have <span class="font-semibold">{{ chats?.length }}</span> chats in history
      </li>
      <li
        v-for="chat in chats"
        :key="chat.id"
        class="list-row"
      >
        <NuxtLink
          :to="`/chats/${chat.slug}`"
          :data-tip="`Open chat: ${chat.title?.substring(0, 20)}...`"
          class="tooltip tooltip-bottom"
        >
          {{ chat.title }}
        </NuxtLink>
      </li>
    </ul>
  </UiBubble>
</template>
<script setup lang="ts">
const { data: chats, error } = await useFetch('/api/v1/chats/history')

if (error.value) {
  throw createError({
    statusCode: error.value.status || 500,
    statusMessage:
      error.value.statusMessage || 'An error occurred while fetching the chats',
    data: error.value,
  })
}

</script>
