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
  complaintUrl: string
  shortNoticeReason?: string
  availabilityNote?: string
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
      v-if="availabilityNote"
      class="email-text"
      :style="{
        color: bodyLight,
        fontFamily,
        fontSize: '15px',
        lineHeight: '25px',
        margin: '0 0 6px 0',
      }"
    >
      {{ availabilityNote }}
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
      You're receiving this because you have a Besidka account. I'm Serhii
      Chernenko, who runs Besidka and is the controller of your data.
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
      If you don't agree, you can object or withdraw consent in Profile →
      Security → Privacy &amp; consent, or delete your account before
      {{ effectiveDate }}. Deleting your account is the only way to stop
      these notices; they are service notices about changes to the terms,
      not marketing.
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
      You also have the right to complain to a data protection supervisory
      authority. The Privacy Policy describes how, under
      <a
        class="email-footer-link"
        :href="complaintUrl"
        :style="{ color: mutedLight }"
      >Complaining</a>.
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
      Questions about this change? Email {{ contactEmail }}.
    </EText>
  </EmailLayout>
</template>
