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
  'files:read': {
    title: 'Read your files',
    description: 'See your file list and storage use, and read text files.',
  },
  'settings:read': {
    title: 'Read your settings',
    description: 'See your preferences and memory switches.',
  },
  'projects:write': {
    title: 'Change your projects',
    description: 'Create, rename, pin, archive and edit projects, their '
      + 'instructions and knowledge.',
  },
  'memory:write': {
    title: 'Change your memory',
    description: 'Add and edit what Besidka remembers about you.',
  },
  'chats:write': {
    title: 'Change your chats',
    description: 'Rename, pin, move and branch chats, exclude them from '
      + 'memory and stop sharing. It cannot send messages.',
  },
  'files:write': {
    title: 'Change your files',
    description: 'Create text files and rename files.',
  },
  'settings:write': {
    title: 'Change your settings',
    description: 'Change your preferences, favourite models and the memory '
      + 'and chat search switches. It cannot add keys, turn on automatic '
      + 'memory updates or change the models memory uses.',
  },
  'data:delete': {
    title: 'Delete your data',
    description: 'Permanently delete chats, messages, projects, knowledge, '
      + 'files and memory, and reset memory. Deleted data cannot be '
      + 'restored.',
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
