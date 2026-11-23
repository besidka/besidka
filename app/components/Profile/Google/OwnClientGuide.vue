<template>
  <details
    class="group/guide rounded-box border border-base-300 bg-base-200/40"
    data-testid="google-byo-guide"
  >
    <summary
      class="flex cursor-pointer list-none items-center gap-2 px-4 py-3
        font-bold [&::-webkit-details-marker]:hidden"
      data-testid="google-byo-guide-summary"
    >
      <Icon
        name="lucide:circle-question-mark"
        size="16"
        class="shrink-0"
      />
      <span class="grow">{{ GOOGLE_BYO_GUIDE_SUMMARY }}</span>
      <Icon
        name="lucide:chevron-down"
        size="16"
        class="shrink-0 text-base-content/60 transition-transform
          group-open/guide:rotate-180"
      />
    </summary>
    <div class="grid gap-4 px-4 pb-4">
      <div class="prose prose-sm max-w-none">
        <ol data-testid="google-byo-guide-steps">
          <li>
            <strong>Create or choose a Google Cloud project.</strong>
            Use a project of your own. The console opens the project it
            used last, so check that the project picker at the top shows
            the project you created before you open the links below.
            <NuxtLink
              :to="GOOGLE_CLOUD_CONSOLE_LINKS.createProject.url"
              class="link"
              target="_blank"
              rel="noopener"
            >
              {{ GOOGLE_CLOUD_CONSOLE_LINKS.createProject.label }}
            </NuxtLink>
          </li>
          <li>
            <strong>Turn on the APIs you will use.</strong>
            Open each page and press Enable. Gmail access needs the Gmail
            API, Google Calendar needs the Google Calendar API, and Drive
            search needs the Google Drive API. Before you press Enable,
            check that the project picker at the top still shows your
            project. Enabling an API in the wrong project produces the
            "API is not turned on" error.
            <ul data-testid="google-byo-guide-apis">
              <li
                v-for="api in GOOGLE_BYO_GUIDE_APIS"
                :key="api.url"
              >
                <NuxtLink
                  :to="api.url"
                  class="link"
                  target="_blank"
                  rel="noopener"
                >
                  {{ api.label }}
                </NuxtLink>
              </li>
            </ul>
          </li>
          <li>
            <strong>Set up the consent screen.</strong>
            Give the app a name that shows it is yours, for example
            "Your name's client for Besidka". Use your own email as the
            support email. Google's Branding page also asks for a developer
            contact email: use your own again. Set the audience to
            External. For an external app in production, Google asks for an
            application home page and a privacy policy link on the Branding
            page. For a personal setup, a link to any page you control is
            enough. Then choose how long the access lasts.
            <ul data-testid="google-byo-guide-audience-choice">
              <li data-testid="google-byo-guide-publish">
                <strong>Recommended: publish the app.</strong>
                On the Audience page press Publish app, so the status is
                "In production". This ends the 7-day expiry of the access.
                The app stays unverified, so Google still shows the "Google
                hasn't verified this app" warning. That is expected for
                your own client.
              </li>
              <li data-testid="google-byo-guide-testing">
                <strong>Alternative: stay in Testing.</strong>
                Add your own Google account as a test user on the Audience
                page. In Testing, Google ends the access every 7 days, and
                you connect again each time.
              </li>
            </ul>
            <ul>
              <li>
                <NuxtLink
                  :to="GOOGLE_CLOUD_CONSOLE_LINKS.branding.url"
                  class="link"
                  target="_blank"
                  rel="noopener"
                >
                  {{ GOOGLE_CLOUD_CONSOLE_LINKS.branding.label }}
                </NuxtLink>
                for the name, the two emails, the home page and the privacy
                policy link
              </li>
              <li>
                <NuxtLink
                  :to="GOOGLE_CLOUD_CONSOLE_LINKS.audience.url"
                  class="link"
                  target="_blank"
                  rel="noopener"
                >
                  {{ GOOGLE_CLOUD_CONSOLE_LINKS.audience.label }}
                </NuxtLink>
                for External, Publish app and the test users
              </li>
            </ul>
          </li>
          <li>
            <strong>Add the scopes Besidka asks for.</strong>
            Open
            <NuxtLink
              :to="GOOGLE_CLOUD_CONSOLE_LINKS.dataAccess.url"
              class="link"
              target="_blank"
              rel="noopener"
            >
              {{ GOOGLE_CLOUD_CONSOLE_LINKS.dataAccess.label }}
            </NuxtLink>
            and add these scopes. Always add the first two. Add the others
            only for what you will turn on in Besidka.
            <ul data-testid="google-byo-guide-scopes">
              <li
                v-for="scope in GOOGLE_BYO_GUIDE_SIGN_IN_SCOPES"
                :key="scope"
              >
                <code>{{ scope }}</code>
              </li>
              <li
                v-for="group in scopeGroups"
                :key="group.capability"
                :data-testid="`google-byo-guide-scope-${group.capability}`"
              >
                {{ group.label }}:
                <template
                  v-for="(scope, scopeIndex) in group.scopes"
                  :key="scope"
                >
                  <template v-if="scopeIndex > 0">
                    and
                  </template>
                  <code>{{ scope }}</code>
                </template>
              </li>
            </ul>
            Google Calendar needs both of its scopes. Besidka offers
            Google Calendar only while it is turned on in Labs.
          </li>
          <li>
            <strong>Create an OAuth client.</strong>
            Open
            <NuxtLink
              :to="GOOGLE_CLOUD_CONSOLE_LINKS.clients.url"
              class="link"
              target="_blank"
              rel="noopener"
            >
              {{ GOOGLE_CLOUD_CONSOLE_LINKS.clients.label }}
            </NuxtLink>
            and create a client of type "Web application". Under
            authorized redirect URIs, add the address shown below this
            guide, exactly as it is shown. Its path is
            <code>{{ GOOGLE_BYO_CALLBACK_PATH }}</code>. If you open
            Besidka on more than one address, add one for each. You do not
            need JavaScript origins.
          </li>
          <li>
            <strong>Save the client in Besidka.</strong>
            Google shows the client secret in full only once, in the
            dialog that appears when you create the client. Copy the
            client ID and the secret into the two fields below and press
            Save client. Besidka never shows them again.
          </li>
          <li v-if="reduced">
            <strong>Connect and approve.</strong>
            Go to the
            <NuxtLink
              :to="GOOGLE_CONNECTORS_PATH"
              class="link"
              data-testid="google-byo-guide-connectors-link"
            >
              Connectors page</NuxtLink>,
            connect Gmail, Google Calendar or Drive search, and approve on
            Google's screen.
          </li>
          <li v-else>
            <strong>Connect and approve.</strong>
            Tick what Besidka may request below, press Connect and approve
            on Google's screen.
          </li>
        </ol>
        <p data-testid="google-byo-guide-warning">
          Google shows a "Google hasn't verified this app" warning. That is
          expected for your own client. Continue only on your own account.
          If you stayed in Testing, Google ends the access every 7 days.
          When that happens, connect again:
          <template v-if="reduced">
            use the Connectors page.
          </template>
          <template v-else>
            press Reconnect on this card.
          </template>
          Publishing the app on the Audience page (step 3) ends the 7-day
          expiry. The app stays unverified.
        </p>
        <h4>If something fails</h4>
        <ul data-testid="google-byo-guide-failures">
          <li>
            <strong>"Google could not be connected".</strong>
            Check the client ID, the secret and the redirect address on
            your client, as described in the next entries.
          </li>
          <li data-testid="google-byo-guide-redirect-mismatch">
            <strong><code>redirect_uri_mismatch</code> on Google's own
              page.</strong>
            A wrong redirect address fails on Google's page, so Besidka
            never shows its own message for it. The redirect address sent
            in the authorization request does not match an authorized
            redirect URI for the OAuth client ID. It must match exactly
            (scheme, host, path, no trailing slash) the address shown on
            this card, with one entry for each host you open Besidka on. A
            change to the client can take from about 5 minutes to a few
            hours to apply.
          </li>
          <li>
            <strong>"Google was not connected: you canceled on the Google
              page".</strong>
            Besidka shows this when Google reports access denied. Connect
            again and press Continue. If you did not cancel and the app is
            in Testing, check that your account is on the test list.
          </li>
          <li data-testid="google-byo-guide-test-users">
            <strong>Your account is not on the test list.</strong>
            While the app is in Testing, only listed test users can
            connect. Add your Google account under Audience, Test users.
            This applies only in Testing.
          </li>
          <li>
            <strong>"The Gmail API is not turned on" (or the Google
              Calendar API, or the Google Drive API).</strong>
            Besidka says this in chat when that API is off in your Google
            Cloud project. Turn it on as in step 2 and try again.
          </li>
          <li>
            <strong>A wrong client ID or secret.</strong>
            Google may answer <code>invalid_client</code>, for example
            after you replace a secret. Enter the client ID and the new
            secret in the fields and save again. If you lost the secret,
            add a new one to the client in the console.
          </li>
        </ul>
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import { GOOGLE_BYO_CALLBACK_PATH } from '#shared/utils/google-byo'
import {
  GOOGLE_BYO_GUIDE_APIS,
  GOOGLE_BYO_GUIDE_SIGN_IN_SCOPES,
  GOOGLE_BYO_GUIDE_SUMMARY,
  GOOGLE_CLOUD_CONSOLE_LINKS,
  getGoogleByoGuideScopeGroups,
} from '#shared/utils/google-byo-guide'
import { GOOGLE_CONNECTORS_PATH } from '#shared/utils/google-connectors'

withDefaults(defineProps<{
  reduced?: boolean
}>(), {
  reduced: false,
})

const scopeGroups = getGoogleByoGuideScopeGroups()
</script>
