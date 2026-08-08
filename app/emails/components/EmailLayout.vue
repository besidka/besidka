<script setup lang="ts">
import EmailFooter from './EmailFooter.vue'
import EmailHeader from './EmailHeader.vue'
import {
  accentContentDark,
  accentDark,
  bodyDark,
  borderDark,
  borderLight,
  fontFamily,
  mutedDark,
  pageDark,
  pageLight,
  subtleDark,
  surfaceDark,
  surfaceLight,
  textDark,
} from './theme'

defineProps<{
  preview: string
}>()

const darkModeCss = `
  @media (prefers-color-scheme: dark) {
    body,
    .email-page {
      background-color: ${pageDark} !important;
    }
    body > table > tbody > tr > td {
      background-color: ${pageDark} !important;
    }
    .email-card {
      background-color: ${surfaceDark} !important;
      border-color: ${borderDark} !important;
      border-top-color: ${accentDark} !important;
    }
    .email-wordmark {
      color: ${accentDark} !important;
    }
    .email-heading {
      color: ${textDark} !important;
    }
    .email-text {
      color: ${bodyDark} !important;
    }
    .email-copy-link {
      color: ${accentDark} !important;
    }
    .email-muted {
      color: ${mutedDark} !important;
    }
    .email-button {
      background-color: ${accentDark} !important;
      border-color: ${accentDark} !important;
      color: ${accentContentDark} !important;
    }
    .email-divider {
      border-top-color: ${borderDark} !important;
    }
    .email-footer-link {
      color: ${mutedDark} !important;
    }
    .email-footer-separator {
      color: ${subtleDark} !important;
    }
  }
`
</script>

<template>
  <EHtml>
    <EHead>
      <meta name="color-scheme" content="light dark">
      <meta name="supported-color-schemes" content="light dark">
      <EStyle>
        :root {
          color-scheme: light dark;
        }
        @media only screen and (max-width: 600px) {
          .email-card {
            padding: 28px 22px !important;
          }
        }
        {{ darkModeCss }}
      </EStyle>
    </EHead>
    <div id="__vue-email-preview">
      <EPreview>{{ preview }}</EPreview>
    </div>
    <EBody
      class="email-page"
      :style="{
        backgroundColor: pageLight,
        fontFamily,
        margin: '0',
        padding: '32px 16px 40px 16px',
      }"
    >
      <EContainer :style="{ maxWidth: '520px', margin: '0 auto' }">
        <EmailHeader />
        <ERow>
          <EColumn
            class="email-card"
            :style="{
              backgroundColor: surfaceLight,
              border: `1px solid ${borderLight}`,
              borderRadius: '14px',
              padding: '36px 32px',
            }"
          >
            <slot />
          </EColumn>
        </ERow>
        <EmailFooter />
      </EContainer>
    </EBody>
  </EHtml>
</template>
