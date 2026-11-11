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
  'artifacts:read': {
    title: 'Read your artifacts and their share links',
    description: 'See your artifacts, their content and versions, and the '
      + 'public links that are active.',
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
    description: 'Create text files and documents (PDF, Word, PowerPoint, '
      + 'Excel) and rename files.',
  },
  'settings:write': {
    title: 'Change your settings',
    description: 'Change your preferences, favourite models and the memory '
      + 'and chat search switches. It cannot add keys, turn on automatic '
      + 'memory updates or change the models memory uses.',
  },
  'artifacts:write': {
    title: 'Create and edit your artifacts',
    description: 'Create artifacts, add new versions to them and stop their '
      + 'public links. It cannot publish a link.',
  },
  'artifacts:share': {
    title: 'Publish artifacts as public links (up to 30 days)',
    description: 'Create a public link to one of your artifacts. Anyone who '
      + 'has the link can open it and report it. The link expires within 30 '
      + 'days, you can revoke it, and the app can create only a few a day.',
  },
  'data:delete': {
    title: 'Delete your data',
    description: 'Permanently delete chats, messages, projects, knowledge, '
      + 'files, artifacts and memory, and reset memory. Deleted data cannot be '
      + 'restored.',
  },
  'admin:features': {
    title: 'Manage feature access (admin)',
    description: 'Grant or revoke experimental features for individual '
      + 'users. Cannot change rollout or switch features off for everyone.',
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
