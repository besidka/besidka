<script setup lang="ts">
import { accentLight, fontFamily } from './theme'
</script>

<template>
  <ERow>
    <EColumn :style="{ padding: '0 0 20px 0', textAlign: 'center' }">
      <span
        class="email-wordmark"
        :style="{
          color: accentLight,
          fontFamily,
          fontSize: '19px',
          fontWeight: '700',
          letterSpacing: '-0.2px',
          lineHeight: '24px',
        }"
      >Besidka</span>
    </EColumn>
  </ERow>
</template>
