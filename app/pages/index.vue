<template>
  <h1>T3 Chat Cloneathon</h1>
  <button @click="signOut">Sign out</button>
  <NuxtLink to="/signin">Sign in</NuxtLink>
</template>
<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
})

useSeoMeta({
  title: 'Home',
})

async function signOut() {
  try {
    await $fetch('/api/v1/auth/sign-out', {
      method: 'post',
    })

    await navigateTo('/signin')
  } catch (exception: any) {
    useErrorMessage(exception.statusMessage)
    throw createError(exception)
  }
}
</script>
