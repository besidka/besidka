# Sensitive data in memory: legal research and decision log

Date: 2026-10-25. Scope: Besidka (besidka.com), one natural person in Poland
as controller, GDPR + UODO. This is risk research for an engineering decision,
not legal advice. Companion drafts for counsel live in
`docs/legal/memory-legal-changes-draft.md`. The memory design itself is in
`docs/memory-architecture.md` (sections 3.5 and 3.8 cover sensitivity).

Labels used throughout:

- **[C]** confirmed from a primary source that was read.
- **[I]** inference by the researcher.
- **[L]** needs a Polish *radca prawny* / data-protection counsel.
- **[S]** confirmed only through secondary sources or search snippets.

## Decision summary

- **Recommendation (b): the sensitive-memory opt-in is lawful in principle but
  not lawful to ship as-is.** Explicit consent under Art. 9(2)(a) is
  available, and Claude ships the same toggle **[C]**. It stays **hidden
  behind `NUXT_PUBLIC_MEMORY_SENSITIVE_OPT_IN_ENABLED` (default `false`)**
  until counsel signs off and launch conditions 1-9 (section 6) are met.
- The current published legal pages contradict the memory feature and, more
  urgently, today's production chats. See "Open owner/counsel decisions".
- A DPIA and an Art. 30 record are needed **even with the toggle off**.

## 0. What the repo says today

- Privacy Policy (`content/legal/privacy-policy.md`, `updatedAt: 2026-10-24`)
  says under "Special category data" that Besidka has **no lawful basis** to
  process it, and asks users not to submit it. Under "Automated decision-making
  and profiling" it says Besidka builds **no features that infer, classify,
  score or profile you from the content of your chats**. Under "Getting a copy
  of your data" it says there is **no self-service export button yet**. **[C]**
- Terms of Use, "Do not submit sensitive personal data", prohibits submitting
  special-category data. **[C]**
- `docs/memory-architecture.md` 3.5/3.8 and `shared/utils/memory-policy.ts`:
  `memoryIncludeSensitive: false` by default; a never-store list;
  `memorySensitiveCategories` = the eight Art. 9 categories **plus
  `legal-dispute` and `drugs`**; a `people` category; extraction off by
  default; `memoryEnabled` (injection + explicit `memory_write`) on by default;
  export endpoint `/api/v1/memory/export`; toggle-off deletes
  `sensitivity = special` entries. **[C]**

The memory feature therefore contradicts three published sentences, whatever
is decided about the toggle.

## 1. GDPR Art. 9 for user-volunteered special-category memory

### 1.1 Is Art. 9(2)(a) explicit consent the right basis?

Yes. It is the only realistic exception. **[C/I]** EDPB Guidelines 05/2020
para 99 say Art. 9(2) has no "necessary for the performance of a contract"
exception. If none of (b) to (j) applies, explicit consent is "the only
possible lawful exception". **[C]** None of (b) to (j) fits a consumer chat
app: no employment, vital interest, health-care provision or public interest.
Art. 9(2)(e) also does not fit, because C-252/21 para 77 requires that the
data subject meant, "explicitly and by a clear affirmative action", to make
the data accessible to the general public. A private chat is the opposite.
**[C]** Poland adds no general national ban on Art. 9(2)(a) consent outside
employment. **[I/L]**

What makes the consent valid (Arts. 4(11), 7, 9(2)(a); EDPB 05/2020):

- **Explicit.** An express statement. Example 17 accepts an online consent
  screen with Yes/No boxes if the text "clearly indicates the consent", e.g.
  "I hereby consent...". "It is clear to me that my data will be processed"
  does not qualify. Two-stage verification is offered as a further option, not
  a requirement. **[C]**
- **Specific and informed.** It must name the categories, the purpose
  (personalising future answers), the storage location, the recipients (the
  provider you chat with), and the right to withdraw. **[C, Art. 7/13]**
- **Separate from the ToU.** Art. 7(2) requires it to be "clearly
  distinguishable" from other matters. **[C]**
- **Freely given.** Art. 7(4). The service must work fully with the toggle off,
  and it does. **[C/I]**
- **Withdrawable as easily as given.** Art. 7(3). The toggle-off purge does
  this. **[C]**
- **Provable.** Art. 7(1) puts the burden on the controller. **[C]**

**Does a UI toggle plus confirmation dialog suffice?** Yes, if the dialog
contains a positive consent statement the user actively confirms (an unticked
checkbox plus a "Turn on" button, or a button labelled "I consent") and a
per-user receipt is stored. A bare toggle without the dialog is weaker,
because flipping a switch is a "clear affirmative action" but not obviously an
"express statement". **[I]**

Dialog outline:

1. "Allow Besidka to keep sensitive information about you in memory." List the
   categories in plain words. Label `legal-dispute` and `drugs` honestly as
   "other sensitive topics", not as GDPR special categories. Substance use is
   likely health data. A criminal legal dispute is Art. 10 data, already
   never-store.
2. Purpose: to tailor future answers. Not required to use Besidka.
3. Storage: Besidka's database on Cloudflare (EU/US). Backups persist up to 30
   days after deletion.
4. Recipients: sensitive entries are sent only to the AI providers listed
   (section 3), under your own key. Those providers keep data under their own
   terms.
5. What it never stores (link the never-store list), and that it never stores
   sensitive facts about *other people*.
6. You get a notice each time a sensitive item is saved. Turning this off
   deletes all sensitive entries.
7. Statement and confirm: "I consent to Besidka storing and using sensitive
   information I share about myself, as described in the Privacy Policy."
   Link `#sensitive-topics-in-memory`.

### 1.2 DPIA (Art. 35)

**Required, in the researcher's assessment.** **[I, strong; L to confirm]**
The UODO list (Komunikat Prezesa UODO z 17.06.2019, M.P. 2019 poz. 666) says
that "co do zasady" processing meeting **at least two** criteria needs a DPIA.
**[C]** Memory meets three:

- **Criterion 4** (special categories / "dane wrażliwe wg opinii WP29"). Its
  example area describes cloud services for "purely personal" activities,
  including "life-logging" apps that may hold information "o bardzo osobistym
  charakterze", whose processing for non-household purposes may be "bardzo
  ingerujące w prywatność". That is a near-verbatim description of AI memory.
  **[C]**
- **Criterion 8**: comparison, evaluation or inference from data from
  different sources, i.e. building profiles by combining datasets. Cross-chat
  extraction fits. **[C/I]**
- **Criterion 10**: innovative technological solutions (an LLM extractor).
  **[C/I]**

Criterion 1 (profiling with negative effects) and Art. 35(3)(b) (large scale)
are probably not met. **[I]** The DPIA is needed **even with the toggle OFF**:
chat content is "highly personal" data under criterion 4's example, and
extraction plus LLM adds criteria 8 and 10. A one-person operator can write a
proportionate DPIA of 6-10 pages. Art. 36 prior consultation only applies if
high residual risk remains. **[I]**

### 1.3 Art. 30 records, retention, minimisation

- **Art. 30.** The under-250 exemption in Art. 30(5) does **not** apply when
  processing "is not occasional" or "includes special categories". **[C]**
  Besidka needs a written record now, for chats already. It must list memory,
  the sensitivity classifier, extraction and the consent-receipt store. **[I]**
- **Retention.** Keep memory until the user deletes it, the toggle goes off,
  or the account is deleted. Disclose the 30-day D1 Time Travel residue.
  Suggested addition: a periodic "review your sensitive memories" prompt, e.g.
  every 12 months. **[I]**
- **Minimisation (Art. 5(1)(c), Art. 25).** The existing caps (30 entries,
  2 KB) help. The bigger lever is **what the extractor writes**. Store the
  preference, not the sensitive reason ("vegetarian", not "vegetarian for
  religious reasons"). **[I]**

### 1.4 Derived and inferred data

Inference widens Art. 9:

- **C-184/20 OT (Grand Chamber, 1 Aug 2022).** Paras 120-128: data that can
  reveal sensitive information "following an intellectual operation involving
  deduction or cross-referencing" is special-category data. The protective
  regime cannot exclude indirectly revealing data. **[C]** An LLM extractor is
  a deduction engine. A memory saying "fasts during Ramadan" or "goes to AA
  meetings" is Art. 9 data even though no category was named. **[I]**
- **C-252/21 Meta v Bundeskartellamt (4 Jul 2023).** Para 68: Art. 9 applies
  wherever processing allows such information to be revealed, whoever it
  concerns. Para 69: the prohibition applies whether or not the information is
  correct, and whether or not the controller aims to obtain it. Paras 77-79:
  the "manifestly made public" test, as above. **[C]** Consequence: the
  **toggle-OFF classifier that detects and drops sensitive items is itself
  Art. 9 processing**. It is defensible as the safeguard the EDPB ChatGPT
  Taskforce recommends (report para 19, filtering Art. 9 data), but it must be
  in the Art. 30 record and the Privacy Policy. **[I]**
- **C-21/23 Lindenapotheke (4 Oct 2024).** Pharmacy order data are health data
  because health can be inferred by "mental association or inference".
  Explicit consent is needed. **[S]**
- **Third parties.** The `people` category will capture "my wife's
  chemotherapy" or "my brother is gay". The user's consent cannot legitimise
  *someone else's* Art. 9 data. Recital 18 keeps Besidka in scope even where
  the user acts privately (see 1.6). **Recommend: special-category data about
  identifiable third parties is never-store, regardless of the toggle.**
  **[I/L]**

### 1.5 Chats already contain such data

This makes the current position **worse, not better**. **[I]**

- EDPB ChatGPT Taskforce report (23/24 May 2024) paras 23-25: under fairness
  there must be no risk transfer to data subjects. Responsibility must not be
  shifted "by placing a clause in the Terms and Conditions that data subjects
  are responsible for their chat inputs". A public chatbot should assume
  people will input personal data, and the controller "should not argue that
  the input of certain personal data was prohibited in first place." **[C]**
  Besidka's ToU prohibition plus "I have no lawful basis" is exactly that
  pattern. It amounts to a written admission of unlawful processing. **[I]**
- A possible fallback for *passive* chat storage is the C-136/17 GC v CNIL
  (24 Sep 2019) reasoning. Paras 45-47: a search-engine operator's Art. 9
  duties are shaped by its "responsibilities, powers and capabilities", i.e.
  ex post on request. **[C]** That analogy weakens once Besidka *actively*
  classifies and extracts from chat content. **[I/L]**
- Practical answer: give chat storage its own Art. 9(2)(a) basis. Use a
  one-time explicit consent, separate from the ToU, shown before the first
  message (or at sign-up). It covers storing what you choose to type,
  including special categories, and sending it to the provider you pick. Keep
  the "please think before sharing" advice as advice, not as a prohibition.
  **[I/L]**
- **[L] Open question: what happens if the user declines?** If the service
  still works, Besidka falls back to the passive-storage argument (C-136/17)
  for that user. If declining blocks the service, Art. 7(4) "freely given" is
  at risk, because consent becomes a condition of the service. Counsel should
  choose between the two.

### 1.6 Any lighter regime for a one-person non-commercial operator?

**No.** **[C]** Art. 2(2)(c) household exemption: Recital 18 says the GDPR
"applies to controllers or processors which provide the means for processing
personal data for such personal or household activities". Besidka serves other
people, so it is such a provider. Art. 30(5) fails as above. GDPR has no
non-commercial carve-out. The UŚUDE analysis in `docs/legal.md` concerns
information duties under Polish e-services law, not the GDPR. **[C/I]**

## 2. Provider terms under BYOK

The user is the API customer. Besidka is the application. The Privacy Policy
already treats providers as independent controllers with no Besidka contract.
**[C]**

| Provider | Special-category / profiling restrictions | Training on API data |
|---|---|---|
| **Anthropic** | Usage Policy (version effective **12 Nov 2026**, upcoming): no collecting private information "such as ... health data" *without permission*. No compiling profiles "for sale, licensing, or disclosure to third parties" without awareness and agreement. No *biometric* categorisation to infer Art. 9 traits. Chatbots must disclose AI. **[C]** The version in force today was not read; check it via the page's version history. **[unverified]** A memory the user consents to, for the user's own use, is not caught. **[I]** | No, for API. 30-day deletion per the Privacy Center. **[S]** BAA only for HIPAA (US); irrelevant here. **[I]** |
| **OpenAI** | Usage policies (in force: **29 Oct 2025**; new version effective **20 Nov 2026**): no attempts to "aggregate, monitor, profile, or distribute individuals' private or sensitive information *without their authorization*". **Never** use for "evaluation or classification of individuals based on their social behavior, personal traits, or biometric data (including social scoring, profiling, or inferring sensitive attributes)". **[C]** See 2.1. | Not by default; logs up to 30 days (Privacy Policy, already cited). **[S]** |
| **Google Gemini API** | Additional Terms (last updated 2026-04-28): no clinical practice or medical advice. Use is "for professional or business purposes, not for consumer use". **[C]** | Unpaid: Google may use content and human reviewers may read it; "Do not submit sensitive, confidential, or personal information". **But for EEA, Switzerland and UK users the Paid data terms "apply to all Services, including ... unpaid quota".** API Clients for EEA/CH/UK users may use "only Paid Services". **[C]** The current Privacy Policy's free-tier warning omits the EEA rule. BYOK-wide issue: 2.2. |
| **xAI** | No special-category clause found. **[S]** | Not without permission; 30-day retention; ZDR enterprise-only. DPA as processor for the customer. **[S]** |
| **DeepSeek** | Privacy Policy (10 Feb 2026): "do not provide sensitive Personal Data". Data stored **in the PRC**. Lists model training with an opt-out right. Says it does not cover end-user data of developer apps, whose developers are controllers. EU representative: Prighter. **[C]** | Unclear for API traffic. **[S]** Garante block (Jan 2025); Berlin DPA DSA notice (27 Jun 2025) calling the China transfer unlawful. **[S]** |
| **Moonshot (Kimi)** | OpenPlatform Privacy Policy (30 Apr 2025), contracting entity **MOONSHOT AI PTE. LTD., servers in Singapore**. "User content" is used to optimise and train models. Uploading "sensitive information" is listed as a "high-risk operation". Besidka calls `api.moonshot.ai`. **[C]** | Yes, per the policy text. **[C]** |
| **Alibaba Qwen** | Besidka calls `dashscope-intl.aliyuncs.com` (**Singapore**, ap-southeast-1). **[C]** | "Will never use your data for model training" (Model Studio FAQ); 30-day retention at most. **[S]** |
| **OpenRouter** | ToS (31 Aug 2026): the user decides fitness for "sensitive" use. Prompt logging (opt-in) grants a broad licence. Some upstream models "may store or train on your Inputs". Routes to any vendor, including PRC-hosted. **[C]** | OpenRouter: no; upstream: varies. **[C]** |
| **Vercel / Cloudflare AI Gateway** | No special-category clauses found. Cloudflare logs prompts to the user's dashboard by default (Privacy Policy, already cited). Vercel routes to the vendor behind the model. **[S]** | Stated no. **[S]** |

**Model behaviour.** Anthropic's memory-tool documentation says model refusals
are not a control. This is the basis for 3.5 in the architecture doc. **[C, as
recorded in repo]** No provider documentation was found saying a model refuses
to process user-volunteered health content in ordinary chat. Do not rely on
refusals. **[I]**

### 2.1 The sharpest provider-terms risk is extraction

OpenAI's "never" list includes "inferring sensitive attributes", with no
consent carve-out. **[C]** In context, the list sits under protecting
*others'* privacy and mirrors AI Act social-scoring language. A user asking
"remember I'm diabetic" is not inference. **[I]** An extractor that reads "I'm
vegetarian for religious reasons" on the user's OpenAI key and writes
`sensitivity=special, category=religion-or-belief` is, on a literal reading,
inferring and classifying a sensitive attribute. **[I/L]** Claude.ai and
ChatGPT run *their own* extractors under *their own* policies. Besidka runs
one under the user's contract with a third party.

**Design rule: `origin = extraction` never writes `sensitivity = special`.**
Sensitive entries come only from explicit user saves (UI, "remember this",
import reviewed by the user) with the toggle on. Extraction keeps the
non-sensitive core ("vegetarian") and drops the sensitive reason. **[I]**

### 2.2 Gemini consumer-use clause (BYOK-wide, independent of memory)

The Gemini terms say use is "not for consumer use" and that EEA/CH/UK API
Clients must use only Paid Services. **[C]** Whether a BYOK consumer chat app
with users' free AI Studio keys complies is a question for the user's
contract and for counsel. The Privacy Policy should at least state the EEA
paid-terms rule. **[L]**

## 3. International transfers

- **Facts.** DeepSeek: PRC. Moonshot and Qwen as Besidka calls them:
  **Singapore**, not China. Neither the PRC nor Singapore has an EU adequacy
  decision. **[C/I]**
- **Is Besidka the exporter?** EDPB Guidelines 05/2021 (v2.0, 14 Feb 2023) set
  three cumulative criteria. Example 1 says a data subject typing directly
  into a third-country site is *not* a transfer. **[C]** Memory is different.
  Besidka stores it in D1 and, as controller, decides to put it into a prompt
  sent from its server. That is Besidka "making available" data to a
  third-country importer, so criterion 2 is met. **[I, strong]** Example 1
  might at most soften live chat pass-through. It does nothing for
  re-injected stored memory. **[I/L]**
- **Tools available.** Art. 46 SCCs need a contract with the importer, and
  Besidka has none. **[C/I]** Art. 49(1)(a) explicit consent requires the user
  be "informed of the possible risks". **[C]** But EDPB 05/2020 footnote 47
  records WP29's view that consent for transfers "that occur periodically or
  on an on-going basis is inappropriate". EDPB 2/2018 treats derogations as a
  last resort. **[C]** Per-message transfers are systematic. **[I]**
- **Recommendation.** Inject `sensitivity = special` entries **only** for
  recipients covered by adequacy: an EEA contracting entity, or a US entity on
  the EU-US DPF list (Decision 2023/1795). Allowlist candidates: Anthropic
  (Anthropic Ireland is confirmed only as the *consumer* controller; the API
  contracting entity and DPF status were not verified **[S/unverified]**),
  OpenAI (EEA API customers contract with OpenAI Ireland **[S]**), Google (DPF
  **[S]**), xAI (DPF unverified), Cloudflare Workers AI. **Verify each name on
  dataprivacyframework.gov before shipping.** **[L]** Exclude DeepSeek,
  Moonshot and Qwen. For Vercel and OpenRouter, exclude unless the routed
  vendor is itself allowlisted and pinned. Simplest v1: exclude both.
  Non-sensitive memory to non-adequate providers stays the same problem as
  chats today. Disclose it and give counsel the Art. 49 question. **[L]**

## 4. What Claude.ai and ChatGPT do

- **Claude.** Sensitive topics are off by default. The toggle is "Include
  sensitive topics in memory", and the off state covers health, politics,
  religion and similar topics. It applies prospectively only, with no
  retroactive save. A notice appears on each sensitive save. Turning it off
  "removes any sensitive items already saved". Government ID numbers, criminal
  history, financial account numbers and immigration status are "never saved to
  memory, even if you ask". Not available to HIPAA or public-sector
  organisations. Deleting a chat does not delete derived memory. **[C,
  support.claude.com]** No public statement on EU-specific timing for Claude
  memory was found. **[unverified]**
- **ChatGPT.** OpenAI says ChatGPT is "trained not to proactively remember
  sensitive information, such as health details, unless you explicitly ask".
  **[S, help-center snippet; the Memory FAQ returned 403]** It points users to
  Temporary Chat. The April 2025 "reference chat history" rollout excluded the
  EEA, UK, Switzerland, Norway, Iceland and Liechtenstein. **[S]** Current EEA
  status: unverified.
- **Why they are cautious.**
  1. Art. 9 has no contract basis (EDPB 05/2020 para 99), so every sensitive
     memory needs provable explicit consent. **[C]**
  2. The Garante restricted ChatGPT in March 2023 and fined OpenAI **EUR 15M**
     in Dec 2024 for lack of legal basis and transparency (OpenAI is
     appealing). **[S]**
  3. The Garante fined Replika's operator **EUR 5M** (decision 10 Apr 2025)
     for lacking a valid legal basis, among other findings. **[S, EDPB news]**
  4. The Garante blocked DeepSeek in Jan 2025. **[S]**
  5. The EDPB ChatGPT Taskforce (May 2024) rejected the "users were told not
     to input it" defence (paras 24-25). **[C]**
  6. Inference case law (C-184/20, C-252/21) makes almost any rich profile
     Art. 9-relevant. **[C]**

Off-by-default plus a hard never-store list is the industry's answer.
Besidka's design copies it. **[I]**

## 5. Legal pages: what is missing

Detailed clause outlines are in `docs/legal/memory-legal-changes-draft.md`.
Summary of the gaps, for the Privacy Policy:

1. New `## Memory` section (anchor `#memory`).
2. New `### Sensitive topics in memory` (anchor `#sensitive-topics-in-memory`).
3. Legal-basis table rows. Explicit saves and injection: Art. 6(1)(b).
   Extraction: Art. 6(1)(a), because it is opt-in profiling and matches
   withdrawal semantics. Sensitive memory: Art. 6(1)(a) + Art. 9(2)(a). Chat
   storage of special categories: Art. 9(2)(a) (see 1.5). Sensitivity
   classifier: 6(1)(f) as a safeguard plus 9(2)(a)? **[L]** Consent receipts:
   Art. 6(1)(c)/(f), accountability. **[I/L]**
4. Replace "Special category data": delete "I have no lawful basis to process
   it", state the basis and safeguards, keep the advice as advice.
5. Replace the profiling sentence: memory is profiling under Art. 4(4); state
   that it only personalises answers for the user, that no decisions are made
   about the user, and that Art. 22 does not apply.
6. Recipients and transfers: sensitive memory goes only to allowlisted
   providers; name the excluded providers and why.
7. Retention row: memory entries; sensitive entries; consent receipts; 30-day
   backups.
8. Rights: fix "no self-service export button yet"; document per-entry delete,
   reset, toggle-off purge and the chat-deletion cascade.
9. Gemini paragraph: add the EEA/CH/UK paid-terms rule.
10. Bump `updatedAt` and give in-app notice before the change (the policy's own
    "Changes" clause).

Terms of Use: rewrite "Do not submit sensitive personal data" into "Sensitive
information and memory". Keep the practical advice. Do not prohibit or shift
responsibility (EDPB TF para 24). Add: do not save other people's sensitive
data; memory output can be wrong; memory is optional and user-controlled; the
never-store list applies even on request.

## 6. Recommendation: (b), with a hard launch gate

Lawful in principle: explicit consent under Art. 9(2)(a) is available, and
Claude ships the same toggle. **[C]** It is **not** lawful to ship as-is. The
current Privacy Policy says there is no basis. There is no DPIA, no consent
receipt, no transfer gate, and the extractor can infer Art. 9 data on
third-party models. **[I]** Keep the toggle hidden until conditions 1-9 are
done:

1. **Consent dialog** per 1.1, separate from the ToU, with an "I consent"
   confirmation and versioned text.
2. **Consent receipt table**, per user, not pseudonymous like cookie records:
   userId, consent type, text version, categories shown, UI surface,
   grantedAt, withdrawnAt. Keep it while the account exists plus a short
   accountability period. **[L]**
3. **Re-consent** when the consent text or the provider allowlist changes
   materially.
4. **Extraction never writes `special`**; extraction stores only the
   non-sensitive core.
5. **No Art. 9 data about third parties**, toggle or not (add to never-store).
6. **Provider gate** for injecting `special` entries: an adequacy/DPF
   allowlist, verified on the DPF list; exclude DeepSeek, Moonshot, Qwen and
   unpinned gateways. Tell the user when a sensitive entry was withheld.
7. **DPIA** (UODO criteria 4, 8 and 10) and an **Art. 30 record**, before GA.
8. **Legal-page changes** per section 5.
9. **Export and delete**: done in code; document it and test the toggle-off
   purge and the chat-deletion cascade.

**Must do even with the toggle OFF:**

- Remove the "no lawful basis" admission and the ToU prohibition. Give chat
  storage an Art. 9(2)(a) basis with a one-time explicit consent. **[L,
  highest priority]**
- Disclose memory, extraction-as-profiling and the classifier. Fix the export
  and Gemini statements.
- Extractor rule: drop sensitive reasons ("vegetarian", not "vegetarian for
  religious reasons"). C-184/20 makes the inferred reason Art. 9 data.
- Never store third-party sensitive data. Do the DPIA and Art. 30 record
  anyway; chats alone trigger criterion 4.
- Ask counsel about Art. 49 for chats and non-sensitive memory sent to
  DeepSeek, Moonshot and Qwen.

## Engineering decisions taken 2026-10-25

These are engineering choices that hold regardless of how counsel rules. None
of them is a legal conclusion.

- **No LLM classification of Art. 9 data.** Detection is a deterministic
  server-side classifier only. An LLM classifier would send candidate special
  category content to a model for a second time and would itself be the kind
  of inference the provider terms (2.1) and C-184/20 warn about.
- **Extraction never writes special-category entries.** `origin = extraction`
  cannot produce `sensitivity = special`; sensitive entries come only from
  explicit user saves with the toggle on (2.1).
- **Third-party (people) special-category data is always rejected**, with the
  toggle on or off (1.4).
- **The sensitive-memory provider allowlist exists and is empty.** Until it is
  filled, no `special` entry is injected into any provider. The owner fills it
  after DPF/adequacy checks on dataprivacyframework.gov (section 3).
- **The sensitive-memory toggle is hidden behind
  `NUXT_PUBLIC_MEMORY_SENSITIVE_OPT_IN_ENABLED` (default `false`).**
- **Consent receipts will reuse `CONSENT_DB`** (`server/db/consent/schema.ts`,
  `server/api/v1/consents/index.post.ts`) with a `memory_sensitive` kind and a
  text version. Note for the implementer: the current `consent_receipts` table
  is pseudonymous (no user id, no kind column, `granted`/`denied` JSON lists),
  while section 6 condition 2 asks for a per-user receipt. The schema needs a
  user-linked extension, and the `CONSENT_DB` isolation rule still applies (no
  sharing a database with the main `DB`). Whether a user-linked receipt may
  live in the isolated consent database is a design point to settle when it
  is built.

## Open owner/counsel decisions

Ordered by urgency.

1. **[L, most urgent] The published "no lawful basis" statement and ToU
   prohibition.** The Privacy Policy currently says Besidka has no lawful
   basis for special-category data, and the Terms of Use ban submitting it.
   The research reads this as the EDPB-rejected risk-shifting pattern
   (ChatGPT Taskforce paras 23-25) and as a written admission of unlawful
   processing. It affects **chats in production today, independent of
   memory**, and does not wait for the memory launch. Needs a counsel decision
   on the replacement wording and on a one-time Art. 9(2)(a) consent for chat
   storage (1.5).
2. **[L] What happens if a user declines Art. 9 consent for chat storage.**
   Service keeps working (fall back to the C-136/17 passive-storage argument)
   or service is blocked (Art. 7(4) "freely given" risk). Counsel picks one.
3. **[L] "No profiling" and "no export button" sentences.** Update the
   profiling sentence (memory is profiling under Art. 4(4), no Art. 22
   decisions) and the "no self-service export button yet" sentence once memory
   ships. Both are false from the day memory is generally available.
4. **[L] Art. 49 for non-sensitive data** sent to DeepSeek, Moonshot and Qwen
   (chats and non-sensitive memory), and the legal-basis row for the
   sensitivity classifier (6(1)(f) as a safeguard plus 9(2)(a)?).
5. **Owner: fill the provider allowlist** after DPF/adequacy verification,
   including Anthropic's API contracting entity and xAI's DPF status.
6. **Owner/counsel: DPIA and Art. 30 record** before GA, even with the toggle
   off. Skeletons are in `docs/legal/memory-legal-changes-draft.md`.
7. **Owner/counsel: Gemini paragraph** (EEA/CH/UK paid-terms rule and the
   "not for consumer use" clause, 2.2).
8. **Counsel: consent receipt retention period** and re-consent triggers.

## Sources

- GDPR (Regulation 2016/679), Recital 18, Arts. 7, 9, 30(5), 35, 49:
  https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679
- CJEU C-184/20 OT, 1 Aug 2022, paras 120-128:
  https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62020CJ0184
- CJEU C-252/21 Meta v Bundeskartellamt, 4 Jul 2023, paras 68-69, 77-79:
  https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62021CJ0252
- CJEU C-136/17 GC v CNIL, 24 Sep 2019, paras 45-47:
  https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62017CJ0136
- CJEU C-21/23 Lindenapotheke, 4 Oct 2024 (secondary):
  https://www.thomashelbing.com/en/wissen/dsgvo-hub/rechtsprechung/1.4.31-eugh-lindenapotheke
- UODO DPIA list, M.P. 2019 poz. 666:
  https://eli.gov.pl/api/acts/MP/2019/666/text/O/M20190666.pdf
- EDPB Guidelines 05/2020 on consent, section 4:
  https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf
- EDPB Guidelines 05/2021 (Art. 3 / Chapter V), Example 1:
  https://edpb.europa.eu/system/files/2023-02/edpb_guidelines_05-2021_interplay_between_the_application_of_art3-chapter_v_of_the_gdpr_v2_en_0.pdf
- EDPB Guidelines 2/2018 on Art. 49 derogations:
  https://www.edpb.europa.eu/sites/edpb/files/files/file1/edpb_guidelines_2_2018_derogations_en.pdf
- EDPB ChatGPT Taskforce report, May 2024, paras 18-19, 23-25:
  https://www.edpb.europa.eu/system/files/2024-05/edpb_20240523_report_chatgpt_taskforce_en.pdf
- EDPB news, Garante fines Replika operator:
  https://www.edpb.europa.eu/news/national-news/2025/ai-italian-supervisory-authority-fines-company-behind-chatbot-replika_sv
- Garante EUR 15M OpenAI fine (press):
  https://www.euronews.com/2024/12/20/italys-privacy-watchdog-fines-openai-15-million-after-probe-into-chatgpt-data-collection
- Berlin DPA on DeepSeek (press):
  https://www.jurist.org/news/2025/06/germany-data-commissioner-orders-apple-and-google-to-remove-deepseek-over-data-concerns
- Claude memory help:
  https://support.claude.com/en/articles/11817273-using-claude-s-chat-search-and-memory-to-build-on-previous-context
- OpenAI Memory FAQ (403 to fetch):
  https://help.openai.com/en/articles/8590148-memory-faq ; "Your Year with
  ChatGPT" FAQ: https://help.openai.com/en/articles/20001042-your-year-with-chatgpt-faqs
- ChatGPT reference-chat-history EEA exclusion (press):
  https://techcrunch.com/2025/04/10/openai-updates-chatgpt-to-reference-your-other-chats/
- Anthropic Usage Policy: https://www.anthropic.com/legal/aup ; Anthropic API
  retention:
  https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-personal-data
- OpenAI usage policies (in force 29 Oct 2025):
  https://openai.com/policies/usage-policies/revisions/2025-10-29/ ; upcoming
  version: https://openai.com/policies/usage-policies/
- Gemini API Additional Terms: https://ai.google.dev/gemini-api/terms
- xAI security FAQ: https://docs.x.ai/docs/resources/faq-api/security ;
  enterprise FAQ: https://x.ai/legal/faq-enterprise
- DeepSeek Privacy Policy:
  https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html
- Kimi OpenPlatform Privacy Policy:
  https://platform.kimi.ai/docs/agreement/userprivacy
- Alibaba Model Studio: https://www.alibabacloud.com/help/en/model-studio
- OpenRouter Terms: https://openrouter.ai/terms
- Vercel DPF statement:
  https://vercel.com/kb/guide/is-vercel-certified-under-dpf
- DPF participant list (verify each provider):
  https://www.dataprivacyframework.gov/list
