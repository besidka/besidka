<script setup lang="ts">
import EmailLayout from './components/EmailLayout.vue'
import {
  accentContentLight,
  accentLight,
  bodyLight,
  borderLight,
  fontFamily,
  mutedLight,
  textLight,
} from './components/theme'

defineProps<{
  preview: string
  heading: string
  intro: string
  ctaLabel: string
  url: string
  footnote: string
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
        textAlign: 'center',
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
        margin: '0 0 28px 0',
        textAlign: 'center',
      }"
    >
      {{ intro }}
    </EText>
    <ERow>
      <EColumn :style="{ padding: '0', textAlign: 'center' }">
        <EButton
          class="email-button"
          :href="url"
          :style="{
            backgroundColor: accentLight,
            border: `1px solid ${accentLight}`,
            borderRadius: '999px',
            color: accentContentLight,
            fontFamily,
            fontSize: '15px',
            fontWeight: '600',
            letterSpacing: '0.1px',
            padding: '14px 30px',
            textAlign: 'center',
          }"
        >
          {{ ctaLabel }}
        </EButton>
      </EColumn>
    </ERow>
    <ERow>
      <EColumn :style="{ padding: '30px 0 0 0' }">
        <div
          class="email-divider"
          :style="{
            borderTop: `1px solid ${borderLight}`,
            fontSize: '0px',
            lineHeight: '0px',
          }"
        />
      </EColumn>
    </ERow>
    <EText
      class="email-muted"
      :style="{
        color: mutedLight,
        fontFamily,
        fontSize: '13px',
        lineHeight: '21px',
        margin: '22px 0 6px 0',
      }"
    >
      Or copy this link into your browser:
    </EText>
    <EText
      class="email-copy-link"
      :style="{
        color: accentLight,
        fontFamily,
        fontSize: '13px',
        lineHeight: '21px',
        margin: '0',
        wordBreak: 'break-all',
      }"
    >
      {{ url }}
    </EText>
    <EText
      class="email-muted"
      :style="{
        color: mutedLight,
        fontFamily,
        fontSize: '13px',
        lineHeight: '21px',
        margin: '20px 0 0 0',
      }"
    >
      {{ footnote }}
    </EText>
  </EmailLayout>
</template>
