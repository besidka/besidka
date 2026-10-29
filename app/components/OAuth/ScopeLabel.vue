<template>
  <span class="grid gap-0.5">
    <span class="font-medium">{{ details.title }}</span>
    <span
      v-if="withDescription && details.description"
      class="text-sm text-base-content/70"
    >
      {{ details.description }}
    </span>
  </span>
</template>
<script setup lang="ts">
interface ScopeDetails {
  title: string
  description: string
}

const props = withDefaults(defineProps<{
  scope: string
  withDescription?: boolean
}>(), {
  withDescription: false,
})

const scopeDetails: Record<string, ScopeDetails> = {
  'chats:read': {
    title: 'Read your chats',
    description: 'See your chat titles and the messages in them.',
  },
  'projects:read': {
    title: 'Read your projects',
    description: 'See your projects, their instructions and knowledge.',
  },
  'memory:read': {
    title: 'Read your memory',
    description: 'See what Besidka remembers about you.',
  },
  'projects:write': {
    title: 'Change your projects',
    description: 'Create and edit projects, their instructions and '
      + 'knowledge.',
  },
  'memory:write': {
    title: 'Change your memory',
    description: 'Add, edit and delete what Besidka remembers about you.',
  },
  'openid': {
    title: 'Know who you are',
    description: 'Confirm that you are signed in to Besidka.',
  },
  'profile': {
    title: 'See your name',
    description: 'Read the name on your Besidka account.',
  },
  'email': {
    title: 'See your email address',
    description: 'Read the email address on your Besidka account.',
  },
  'offline_access': {
    title: 'Stay connected',
    description: 'Keep access without asking you again, until you '
      + 'disconnect it.',
  },
}

const details = computed<ScopeDetails>(() => {
  return scopeDetails[props.scope] ?? {
    title: props.scope,
    description: '',
  }
})
</script>
