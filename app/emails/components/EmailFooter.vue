<script setup lang="ts">
import { fontFamily, mutedLight, subtleLight } from './theme'

const separatorStyle = `color: ${subtleLight}`
const linkStyle = `color: ${mutedLight}; text-decoration: none`
</script>

<template>
  <ERow>
    <EColumn :style="{ padding: '28px 8px 0 8px', textAlign: 'center' }">
      <p
        class="email-muted"
        :style="{
          color: mutedLight,
          fontFamily,
          fontSize: '12px',
          lineHeight: '20px',
          margin: '0',
        }"
      >
        <a
          class="email-footer-link"
          href="https://besidka.com"
          :style="linkStyle"
        >besidka.com</a>
        <span
          class="email-footer-separator"
          :style="separatorStyle"
        >&nbsp;&middot;&nbsp;</span>
        <a
          class="email-footer-link"
          href="https://besidka.com/privacy-policy"
          :style="linkStyle"
        >Privacy policy</a>
        <span
          class="email-footer-separator"
          :style="separatorStyle"
        >&nbsp;&middot;&nbsp;</span>
        <a
          class="email-footer-link"
          href="https://besidka.com/terms-of-use"
          :style="linkStyle"
        >Terms of use</a>
        <span
          class="email-footer-separator"
          :style="separatorStyle"
        >&nbsp;&middot;&nbsp;</span>
        <a
          class="email-footer-link"
          href="https://github.com/besidka/besidka"
          :style="linkStyle"
        >GitHub</a>
      </p>
    </EColumn>
  </ERow>
</template>
