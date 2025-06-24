<template>
  <LazyChatInput
    v-model="message"
    visible
    :pending="pending"
    @submit="onSubmit"
  />
</template>
<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
  layout: 'chat',
})

useSeoMeta({
  title: 'New Chat',
})

const message = shallowRef<string>()
const pending = shallowRef<boolean>(false)

async function onSubmit(message: MaybeRefOrGetter<string>) {
  pending.value = true

  try {
    const response = await $fetch('/api/v1/chats/new', {
      method: 'put',
      body: {
        message: toValue(message),
      },
      cache: 'no-cache',
    })

    if (!response?.slug) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to create a new chat.',
      })
    }

    navigateTo(`/chats/${response.slug}`)
  } catch (exception: any) {
    throw createError({
      statusCode: exception.status || 500,
      statusMessage: exception.statusMessage || 'An error occurred while sending the message.',
    })
  } finally {
    pending.value = false
  }
}
</script>
