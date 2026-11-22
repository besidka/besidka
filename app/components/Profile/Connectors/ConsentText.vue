<template>
  <div
    class="grid gap-3 text-sm"
    data-testid="connector-consent-text"
  >
    <div
      class="alert alert-warning alert-soft items-start"
      role="note"
    >
      <Icon
        name="lucide:triangle-alert"
        size="18"
        class="shrink-0"
        aria-hidden="true"
      />
      <p>
        <span data-connector-consent-text>
          Besidka will send data to <strong class="break-all font-mono font-semibold">{{ host }}</strong>.
        </span>
        <span
          v-if="issuerHost && issuerHost !== host"
          data-connector-consent-text
        >
          You sign in through <strong class="break-all font-mono font-semibold">{{ issuerHost }}</strong>.
        </span>
        <span data-connector-consent-text>
          This server may be outside the European Economic Area, in a country
          without an adequacy decision. Besidka cannot tell you which country,
          has no contract with this server and offers no safeguard for what it
          receives.
        </span>
      </p>
    </div>
    <p>
      <span data-connector-consent-text>
        What is sent: the arguments the AI writes into each tool call, which
        can include anything from the chat, and your access token or key for
        this server.
      </span>
    </p>
    <p>
      <span data-connector-consent-text>
        What comes back: the server's results are stored in the chat. The
        server keeps, uses and shares what it receives under its own terms.
      </span>
    </p>
    <p>
      <span data-connector-consent-text>
        Results can hold other people's data. Your consent covers only your
        own data, so take care with what you keep or share.
      </span>
    </p>
    <p>
      <span data-connector-consent-text>
        You can withdraw this consent at any time on the Connectors page. After
        that, nothing more is sent to this server.
      </span>
    </p>
    <label
      class="flex min-h-11 cursor-pointer items-start gap-3 rounded-box border border-base-300 p-3"
      data-testid="connector-consent-label"
    >
      <input
        v-model="accepted"
        type="checkbox"
        class="checkbox checkbox-sm mt-0.5"
        :disabled="isDisabled"
        data-testid="connector-consent-checkbox"
      >
      <span data-connector-consent-text>
        I explicitly consent to Besidka sending data from my chats to
        {{ host }}, a server that may be outside the European Economic Area
        without safeguards, including sensitive data such as health, beliefs
        or sexual orientation if it is in what the AI sends, and to storing
        what this server returns in my chats.
      </span>
    </label>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  host: string
  issuerHost: string | null
  isDisabled?: boolean
}>()

const accepted = defineModel<boolean>('accepted', { default: false })
</script>
