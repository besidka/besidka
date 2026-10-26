---
title: "Cookie Policy"
description: "Every cookie and browser storage entry Besidka uses, what it is for, how long it lasts, and how to change or withdraw your consent."
updatedAt: 2026-10-26
summary: "Besidka uses a handful of cookies and browser storage keys, and nothing at all for advertising or cross-site tracking. The necessary ones keep you signed in, remember your cookie choice, protect an unsent message you have typed, hand a tapped push notification to the open app, and remember a folder you linked to a project. The optional ones only remember preferences such as your theme and your last used model, and they are kept only if you agree. There is also an optional Analytics category: if you allow it, Besidka loads Cloudflare Web Analytics, a script that measures page views and page-load speed and, according to Cloudflare, sets no cookie and stores nothing on your device. It is off until you allow it. The only other third-party script is a security check on the sign-in forms. There is no marketing category. My own page-view counting happens on the server with no cookie, no identifier and no stored IP address, and the campaign tags in a link you click are read from the web address, never stored on your device. You can change or withdraw your choice at any time, and denying preferences deletes the affected keys from your browser."
---

## What this policy covers

This policy explains what Besidka stores in your browser on the hosted service at **besidka.com**, and why. It sits alongside the [Privacy Policy](/privacy-policy), which covers everything I store on the server.

If you run your own copy of Besidka, this policy does not describe your deployment. You are the operator of it and you set your own policy.

"Cookie" is the familiar word, but the rules apply to any storage on your device, so this policy also lists what I keep in **localStorage** and **sessionStorage**. Where the type matters I say which one it is.

## The rules I follow

Storing information on your device, or reading information already stored there, needs your prior informed consent unless it is strictly necessary to deliver the service you asked for. In Poland that rule lives in the **Prawo komunikacji elektronicznej (PKE)**:

- **PKE Art. 399** — the consent requirement for storing and accessing data on a subscriber's or end-user's terminal equipment, with the exception for what is necessary to transmit a message or to deliver a service the user requested.
- **PKE Art. 400** — the information you must be given before you decide, and the right to withdraw.

Consent under those articles is GDPR consent, so it must be freely given, specific, informed and unambiguous, and it must be as easy to withdraw as it was to give.

Two things follow, and I hold myself to both:

- **No cookie wall.** Besidka works fully whether you accept optional storage or not. Nothing is held back to pressure you into agreeing.
- **Nothing is pre-ticked.** Optional categories start off. I do not treat scrolling, dismissing the banner or continuing to browse as consent.

## How you decide

- **Accept all and Reject all are offered together**, as equal choices on the first screen, next to **Customize** for the per-category switches. Nothing is pre-selected.
- **Closing the banner with the X or the Esc key stores nothing.** It is not a yes and it is not a no, so the banner comes back the next time you open or reload the site, but not when you move between pages.
- **A question at the moment you change something.** If you have not decided yet and you change a setting such as the theme or the model, Besidka may ask, **at most once per page load and only before you have chosen**, whether to remember your preferences on this device. Answering "Remember" grants the preferences category and nothing else. "Not now" and closing the question store nothing.
- **Your choice is kept for 180 days**, then I ask again. I also ask again when I add or remove a category or change what one is for. I did that when I added the Analytics category, so everyone who had already chosen was asked once more.
- **While you have not decided, optional storage is removed.** Nothing from the preferences table below is kept on your device, anything already there is deleted when the page loads, and the analytics script is not loaded. Your settings keep working during that visit, but they are not remembered afterwards.

## Necessary

These are needed to run the service you asked for. They are not consent-gated under PKE Art. 399, and they cannot be switched off in the banner.

| Name | Type | Set by | Purpose | Duration |
| --- | --- | --- | --- | --- |
| `cookies_consent` | Cookie | Besidka | Remembers the cookie choice you made, so I do not ask again and can honour it | 180 days |
| `better-auth.session_token` | Cookie | Besidka (Better Auth) | Keeps you signed in. `HttpOnly` | 7 days |
| `better-auth.session_data` | Cookie | Besidka (Better Auth) | Short-lived cache of your session so every page load does not have to hit the database | 5 minutes |
| `better-auth.dont_remember` | Cookie | Besidka (Better Auth) | Set only if you untick "Remember me" when signing in. Records that you did not ask to be remembered, so the session ends when you close the browser | Until you close the browser |
| `better-auth.state` | Cookie | Besidka (Better Auth) | One-time value that ties a Google or GitHub sign-in redirect back to the request that started it. This is what stops a sign-in from being hijacked | 5 minutes |
| `better-auth.two_factor` | Cookie | Besidka (Better Auth) | Set only if you have two-factor authentication. Holds the pending sign-in step between your password and your verification code | 10 minutes |
| `better-auth.trust_device` | Cookie | Besidka (Better Auth) | Set only if you tick "Trust this device for 30 days" on the two-factor screen. Lets you skip the verification code on this device | 30 days |
| `better-auth.better-auth-passkey` | Cookie | Besidka (Better Auth) | Set when you open the sign-in page, so passkey autofill can work, and again while you register or sign in with a passkey. A one-time challenge that the passkey check has to answer | 5 minutes |
| `chat_input_backup` | localStorage | Besidka | **Holds the text of a message you typed but have not sent yet**, so a failed send, a session that expires mid-message, a re-login or a reinstalled app does not lose what you wrote. It holds your words verbatim, in your browser only — it is never sent to me. It is discarded when the message is sent, and it expires about **24 hours** after it was saved | About 24 hours |
| `besidka:push-endpoint` | localStorage | Besidka | Written only after you turn on push notifications. Holds the address of this browser's push subscription, so I can refresh or remove it when it changes. Removed when you turn notifications off | Until you turn notifications off |
| `besidka-push` | IndexedDB | Besidka | A small database that hands a tapped push notification to the open app. It is created only after you turn on push notifications and tap one, and only by the app's background worker; the page itself never creates it, and only looks for it when notifications are allowed. If you never enable push, it does not exist on your device. It briefly holds the page the notification should open and a timestamp, which are deleted as soon as they are read and ignored after 5 minutes | Until you clear site data (its content is deleted as soon as it is read) |
| `besidka-knowledge` | IndexedDB | Besidka | Created only if you link a folder from your computer to a project, in a browser that supports it (Chrome or Edge on desktop). Holds the browser's permission handle for that folder, one per project, so **Sync** can read the folder again without asking you to pick it each time. It holds no file contents. The entry is removed when you unlink the folder | Until you unlink the folder or clear site data |
| `knowledge-folders:<project id>` | localStorage | Besidka | Created only if you add a folder to a project. Holds the folder's own name, which the server never stores, and which folder is linked to the handle above, so the project shows your folder by name and **Sync** knows which folder to read. In your browser only, never sent to me | Until removed |
| `pwa:refresher-dismissed-until` | sessionStorage | Besidka | Remembers, for the current tab only, that you dismissed the "new version available" prompt, so it does not come straight back | 30 minutes, and gone when the tab closes |
| `pwa:auto-refresh-applied-until` | sessionStorage | Besidka | Stops the installed app from reloading itself over and over while it applies an update in the background. Current tab only | 5 minutes, and gone when the tab closes |

I treat the two folder entries as necessary because they exist only to run the folder link you asked for. The folder name stays in your browser on purpose, so that I never receive it.

I treat `chat_input_backup` as necessary because it exists solely to protect your own input in the service you asked for, and because losing a long message is exactly the kind of failure the storage prevents. It stays in your browser. If you would rather it did not exist at all, clear your site data — the app works without it, you just lose the safety net.

All the `better-auth.*` cookies are `HttpOnly`, so the page cannot read them. The sign-in library names them without a `__Secure-` prefix on besidka.com, because it decides the prefix from its runtime environment and not from the HTTPS connection. The cookies marked "set only if" do not exist unless you use the feature they belong to.

## Preferences

These only remember how you like the app set up. They are kept **only if you agree** to the preferences category. The server checks your cookie choice before it sets `better-auth.last_used_login_method` while you sign in, so that cookie is only ever set if you have allowed preferences.

| Name | Type | Set by | Purpose | Duration |
| --- | --- | --- | --- | --- |
| `better-auth.last_used_login_method` | Cookie | Besidka (Better Auth) | Remembers whether you last signed in with a password, Google, GitHub or a passkey, so that option is offered first. Readable by the page, so the sign-in screen can highlight it | 30 days |
| `nuxt-color-mode` | localStorage | Besidka | Your colour theme (light, dark or system), so the app opens in the theme you chose | Until removed |
| `nuxt-color-mode` | Cookie | Besidka | A cookie of the same name for the same purpose. In the current setup the theme is kept in localStorage and this cookie is not written; I list it because it is part of the theme setting, and I clear it if you deny preferences | Not set in the current setup |
| `file-manager-view-mode` | localStorage | Besidka | Whether the file manager shows a grid or a list | Until removed |
| `settings_reasoning_expanded` | localStorage | Besidka | Whether a model's reasoning block starts expanded | Until removed |
| `settings_reasoning_auto_hide` | localStorage | Besidka | Whether reasoning collapses by itself once an answer is done | Until removed |
| `settings_reasoning_level` | localStorage | Besidka | Your preferred reasoning effort level | Until removed |
| `settings_sidebar_pinned` | localStorage | Besidka | Whether the sidebar stays pinned open | Until removed |
| `settings_favorite_models` | localStorage | Besidka | Your favorited models in the model picker, mirrored from your account settings | Until removed |
| `settings_favorite_gateway_models` | localStorage | Besidka | Your favorited models for each AI gateway in the model picker, mirrored from your account settings | Until removed |
| `settings_web_search_tool` | localStorage | Besidka | Which web search tool you last chose for new chats | Until removed |
| `settings_exa_search_level` | localStorage | Besidka | Which Exa web search level (Lite, Auto or Deep) you last chose | Until removed |
| `model` | localStorage | Besidka | The model you used last, so a new chat starts with it | Until removed |
| `chat_input` | localStorage | Besidka | The draft of the message currently in the input box, so it is still there if you navigate away and come back. Like the backup above it holds **your text verbatim**, in your browser only. Unlike the backup it is a convenience, so it is consent-gated and is deleted if you deny preferences | Until sent, cleared, or removed |
| `video-player` | localStorage | Besidka | Video player preferences such as volume, mute, speed, quality and captions | Until removed |
| `knowledge-cache-info-seen` | localStorage | Besidka | Remembers that you have seen the note about how project knowledge and memory are cached, so it starts collapsed. Holds the list of projects where you have seen it | Until removed |

## Security check on sign-in forms

The **sign-in, sign-up and reset-password** pages include a bot check from Cloudflare called **Turnstile**. It loads a script and an embedded frame from `challenges.cloudflare.com`, and only on those three pages. Nowhere else on Besidka loads it.

This check exists to keep automated sign-up and password-guessing out of the service you are about to use, so it does not need your consent and it is not part of the banner. Cloudflare processes the data it collects as described in the [Privacy Policy](/privacy-policy). Anything Turnstile itself stores sits in Cloudflare's own origin, not on besidka.com, and I do not read it.

## Analytics

Analytics is an **optional category and it is off until you turn it on**. It covers one thing: **Cloudflare Web Analytics**, which measures how many people visit Besidka and how fast its pages load. Besidka does not load the script unless you allow the category, so until then nothing is requested from Cloudflare for it. Nothing is pre-ticked, and Besidka works exactly the same whichever you choose.

- **What loads.** A script called `beacon.min.js`, fetched from `static.cloudflareinsights.com`, and only after you allow Analytics. It sends its measurements to Cloudflare at `cloudflareinsights.com`.
- **What it measures.** Page views, and how long the page took to load, using your browser's standard page-timing data (Navigation Timing) and the Core Web Vitals speed measurements.
- **What it stores on your device.** According to Cloudflare, nothing: it sets no cookie, uses no localStorage and does no fingerprinting. That is Cloudflare's own statement, not something I can check on your device for you. See [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) and [how it collects data](https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/). Because of that, there is no cookie row for it in the tables above.
- **Why it still needs your consent.** Reading information from your browser, such as its page-timing data, is access to your device under **PKE Art. 399**, so I ask first, and the processing of the resulting data rests on your consent under **GDPR Art. 6(1)(a)**.
- **Who receives it.** Cloudflare, which already hosts Besidka. It acts for me as a processor. Your browser contacts Cloudflare's servers to send the measurements, so Cloudflare sees your IP address and browser details, as in any web request. Cloudflare states that it does not track individual end users across its customers' sites. What I see are aggregate figures in a dashboard. The [Privacy Policy](/privacy-policy#analytics) has the details.
- **How long it is kept.** For the period Cloudflare states for Web Analytics data, which is described in the [Privacy Policy](/privacy-policy#how-long-i-keep-things). I do not choose or change it.
- **Withdrawing.** Turn Analytics off in the cookie settings. If the script was already running, the page reloads once so it stops; on a chat page I wait until you next move to another page, so I never interrupt a reply that is being written. Nothing on your device needs deleting, because nothing was stored there.

Besidka loads this script on the production site only. It is never loaded on a test copy of the site.

## There is no marketing category

I have **no marketing cookies**, so that category does not appear in the banner. There are no advertising pixels, no social media trackers, no fingerprinting and no cross-site tracking of any kind on this site.

### How I count visits on the server

Separately from the optional script above, I count page views and a small number of interface events (for example that a button was clicked) **on the server**. That counting:

- sets **no cookie** and reads nothing from your device;
- uses **no user identifier**, no visitor id and no session id;
- **stores no IP address**; and
- records only the event name, the path, a coarse **country**, a **device class** (mobile, tablet or desktop) worked out from your browser's User-Agent string, and the campaign tags of the link you opened, if it had any.

The result is a counter, not a profile. Because it is aggregate and cannot be traced back to you, it is not personal data and it is not consent-gated. It also means nothing you do or do not consent to here changes it.

### Campaign links

If you open a link that carries campaign tags (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`), Besidka reads them **from the web address** of the page. It keeps them in the page's memory and adds them to the address of the sign-up and sign-in links, so they reach the sign-up. They are **not written to a cookie, localStorage, sessionStorage or IndexedDB**, and nothing is read back from your device. Opening the site again without the campaign link forgets them. While you use the sign-up page, the tags stay in its web address.

If you then create an account, I store the tags with your account on the server. That is described in the [Privacy Policy](/privacy-policy#campaign-attribution). It is not a cookie and it is not browser storage, so it does not need consent under PKE Art. 399.

I considered a cookie that would remember a campaign across visits. I do **not** use one. If I ever add one, it will go under the Analytics category, which is off until you agree, and this page will list it before it is set.

## Cookies set by other companies

I do not embed advertising scripts, so no advertiser sets a cookie through my pages. Besidka has two third-party scripts, both from Cloudflare:

- **Cloudflare Turnstile**, a security check that runs only on the sign-in, sign-up and reset-password pages. It is not consent-gated (see above).
- **Cloudflare Web Analytics**, which loads only if you allow the Analytics category. According to Cloudflare it sets no cookie (see above).

Some things happen off my site and are worth knowing about:

- **Signing in with Google or GitHub** sends you to their domain, where they set their own cookies under their own policies. That is their sign-in flow, not mine.
- **Your AI provider**, or the **AI gateway** you route a chat through, receives your prompts through a server-to-server API call, and the **search provider** you turn on (Brave Search or Exa) receives your search queries the same way. No cookie from any of them is set in your browser by that.

## Consent records

When you make a choice in the banner I keep a record of it, so I can show the choice was made. Those records live in a **separate database and are pseudonymous**: no user id, no IP address, no email address. Each record holds a random id, a timestamp, the banner version, which categories were granted, denied or changed, how the choice was made, and a coarse country.

## Changing or withdrawing your consent

Withdrawing is as easy as giving consent, and it is always available.

- Open the cookie settings from wherever you are: the **Cookie settings** button in the site footer, the **floating cookie icon** on pages without the chat sidebar, or **Cookie settings** in the sidebar menu on chat pages. The settings dialog opens with your current selection, and no option is pre-ticked in your favour.
- Once you have chosen, the settings popup offers **Withdraw consent** and **Change preferences** as two equal buttons, so withdrawing is exactly as easy as agreeing was.
- **Reject all** or **Withdraw consent** removes the optional storage immediately, with no reload needed. If the analytics script was already running on that page, the page reloads once so the script stops; on a chat page I wait until you next move to another page, so I never interrupt a reply that is being written.
- If you turn the **preferences** category off, I delete the localStorage keys and cookies listed in that table from your browser and stop writing them. You keep using Besidka exactly as before; the app simply stops remembering those preferences between visits.
- The `better-auth.last_used_login_method` cookie is written by the sign-in library rather than directly by me, but only when your cookie choice already allows preferences. It is deleted when you deny the preferences category. It holds nothing but the word `email`, `google`, `github` or `passkey`.
- If you turn the **Analytics** category off, Besidka stops loading Cloudflare Web Analytics. If the script was already running, the page reloads once (on a chat page, when you next move to another page), and the script does not load again until you turn the category back on.
- Withdrawing does not undo storage that was lawful while your consent was in place, and it does not affect the necessary items, which are not based on consent.

You can also clear or block storage in your browser settings. Blocking the necessary items will sign you out and stop the app from remembering your cookie choice, so you will be asked again.

## Changes to this policy

If I add or remove a cookie or a storage key, I update this table and the date at the top. If a change means I need new consent, I will ask you again before storing anything new.

## Contact

Questions about anything on this page: **:privacy-email-link{}**.
