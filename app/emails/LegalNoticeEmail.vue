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
  summary: string[]
  effectiveDate: string
  documents: { label: string, url: string }[]
  contactEmail: string
  shortNoticeReason?: string
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
        margin: '0 0 12px 0',
      }"
    >
      {{ intro }}
    </EText>
    <ul
      :style="{
        margin: '0 0 18px 0',
        padding: '0 0 0 20px',
      }"
    >
      <li
        v-for="(item, index) in summary"
        :key="index"
        class="email-text"
        :style="{
          color: bodyLight,
          fontFamily,
          fontSize: '15px',
          lineHeight: '25px',
          margin: '0 0 8px 0',
        }"
      >
        {{ item }}
      </li>
    </ul>
    <EText
      class="email-heading"
      :style="{
        color: textLight,
        fontFamily,
        fontSize: '15px',
        fontWeight: '700',
        lineHeight: '25px',
        margin: '0 0 6px 0',
      }"
    >
      The changes take effect on {{ effectiveDate }}.
    </EText>
    <EText
      v-if="shortNoticeReason"
      class="email-text"
      :style="{
        color: bodyLight,
        fontFamily,
        fontSize: '15px',
        lineHeight: '25px',
        margin: '0 0 6px 0',
      }"
    >
      {{ shortNoticeReason }}
    </EText>
    <EText
      class="email-text"
      :style="{
        color: bodyLight,
        fontFamily,
        fontSize: '15px',
        lineHeight: '25px',
        margin: '0 0 20px 0',
      }"
    >
      The full text is already published. The change history of each
      document lists what changed and when.
    </EText>
    <ERow
      v-for="legalDocument in documents"
      :key="legalDocument.url"
    >
      <EColumn :style="{ padding: '0 0 10px 0' }">
        <EButton
          class="email-button"
          :href="legalDocument.url"
          :style="{
            backgroundColor: accentLight,
            border: `1px solid ${accentLight}`,
            borderRadius: '999px',
            color: accentContentLight,
            fontFamily,
            fontSize: '15px',
            fontWeight: '600',
            letterSpacing: '0.1px',
            padding: '12px 26px',
            textAlign: 'center',
          }"
        >
          Read the {{ legalDocument.label }} changes
        </EButton>
      </EColumn>
    </ERow>
    <ERow>
      <EColumn :style="{ padding: '20px 0 0 0' }">
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
        margin: '20px 0 0 0',
      }"
    >
      If you don't agree, you can object or withdraw consent in Profile →
      Security, or delete your account before {{ effectiveDate }}. Deleting
      your account is the only way to stop these notices; they are legally
      required service notices, not marketing.
    </EText>
    <EText
      class="email-muted"
      :style="{
        color: mutedLight,
        fontFamily,
        fontSize: '13px',
        lineHeight: '21px',
        margin: '12px 0 0 0',
      }"
    >
      Questions about this change? Write to
      <a
        class="email-footer-link"
        :href="`mailto:${contactEmail}`"
        :style="{ color: mutedLight }"
      >{{ contactEmail }}</a>.
    </EText>
  </EmailLayout>
</template>
