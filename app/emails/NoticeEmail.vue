<script setup lang="ts">
import EmailLayout from './components/EmailLayout.vue'
import { bodyLight, fontFamily, textLight } from './components/theme'

defineProps<{
  preview: string
  heading: string
  body: string
}>()
</script>

<template>
  <EmailLayout :preview="preview">
    <EHeading
      class="email-heading"
      as="h1"
      :style="{
        color: textLight,
        fontFamily,
        fontSize: '23px',
        fontWeight: '700',
        letterSpacing: '-0.4px',
        lineHeight: '30px',
        margin: '0 0 14px 0',
      }"
    >
      {{ heading }}
    </EHeading>
    <EText
      class="email-text"
      :style="{
        color: bodyLight,
        fontFamily,
        fontSize: '15px',
        lineHeight: '25px',
        margin: '0',
      }"
    >
      {{ body }}
    </EText>
  </EmailLayout>
</template>
