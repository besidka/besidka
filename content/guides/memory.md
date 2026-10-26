---
title: "How memory works in Besidka"
description: "What Besidka remembers about you and your projects, how to see, edit and delete it, how chat search and project files work, what is never stored, and what runs on your own API key."
updatedAt: 2026-10-26
summary: 'Besidka keeps small, editable memory entries about you and about each project, can search your past chats, and lets a project hold files and notes. You can see, edit, export and delete all of it. Nothing runs in the background on your API key until you switch it on, and sensitive data is refused, not stored.'
---

## What Besidka remembers

Memory is a short list of small notes, called entries. Each entry has a title, a one-line description of up to 100 characters and a body of up to 4 KB. Entries sit in five categories: profile, preferences, areas, topics and people. You can have up to 30 entries about you and up to 15 per project.

Your profile and preferences entries are sent with every message, so the model always knows them. For every other entry the model sees only the title and the one-line description. When a question needs the details, it reads the entry itself. That keeps each message small, and you pay for fewer tokens on your own key.

## How do I see and edit what Besidka remembers?

Open **Profile**, then **Memory**. You can open any entry, edit it or delete it, and **Add memory** writes one by hand. **Export JSON** downloads your entries, and **Reset memory…** deletes them all.

The quickest way to change memory is the **Tell Besidka what to remember or change** box. Write loose facts or instructions in any language, such as "I moved to Kraków. Forget the coffee thing." Besidka shows a preview with each proposed change, and nothing is saved until you press **Apply**. Additions and edits start ticked and deletions start unticked, so a delete only happens when you tick it. The preview runs once on your own API key.

You can also ask in a chat, for example "remember that I prefer short answers". Besidka saves an entry only when your current message asks for it, and the chat shows a **Saved to memory** step with an **Undo** button.

## What is the difference between profile memory and project memory?

Profile memory is about you and follows you into every chat. Project memory belongs to one project and is used only in that project's chats. Projects can also use your profile memory: each project has a **Use account memory** switch. When it is off, the project's chats see only that project's entries, and chat search stays inside the project.

A project's memory card has its own **Refresh memory** and **Add memory** buttons and the same **Tell Besidka what to remember or change** box. If a project had the older single block of memory text, it was turned into one editable project entry.

## Can a project have files and notes?

Yes. **Project knowledge** is files, Markdown notes and folders you attach to a project. It is separate from memory: memory is short notes about you, knowledge is your own material of any size.

In **Auto** mode, which is the default, Besidka sends all of it with each message when it fits. The limit is the smaller of 64,000 tokens and 7% of the context window of the model you are using. If it does not fit, the model gets tools to search and read the files. You can switch a project to **Always include everything** or **Always search**. The capacity meter on the project shows the numbers for the model you picked.

Knowledge text counts toward your storage quota, and a project holds up to 2 MB of extracted text. Because knowledge is your own material and not something Besidka inferred about you, it is not run through the sensitive-data filter below. It does go to the provider of the model you chat with, so do not attach what you would not send there. If you add a TypeSafe AI key, project files and notes are also screened for hidden instructions; a flagged file waits for your review and nothing is deleted.

## Can Besidka search my past chats?

Yes, when **Search and reference chats** is on, which is the default. The model can search your chat history and read short excerpts, and every use shows a **Searched your chats** step with links to the chats it used. The chat you are in is left out. Inside a project that does not use account memory, only that project's chats are searched. With a TypeSafe AI key, Besidka can also use it to order the search results and, for models that cannot call tools, to decide whether your message refers to an earlier chat worth searching first. In that case Besidka searches your chats itself and adds up to three short excerpts to your message, and the reply shows a **Used 3 earlier chats** step with links instead. Both are optional and can be switched off. Ordering only sorts what the search already found, and the search matches words, so it does not find a chat written in another language than your search words.

## How do I keep a chat out of memory?

Switch on **Don't use this chat for memory**. You find it in the chat's menu in your history list, as the eye icon on the chat page, and next to the message box before you send the first message of a new chat. A marked chat shows **Not used for memory**.

The chat stays in your history and in your own history search. Memory stops using it: it is not read for new entries, the model cannot search it or read it, and entries that were generated only from that chat are removed. Entries you wrote or asked Besidka to save stay. A branch of such a chat is also excluded. Turning the switch off again does not bring removed entries back.

An explicit "remember this" inside that chat still saves, because you asked for it.

## Does Besidka write memory from my chats on its own?

Not unless you turn it on. **Use memory** is on by default, and it covers the memory you write, the memory tools and chat search. **Generate memory from chats** is off by default. When you switch it on, Besidka reads chats that have been idle for ten minutes and proposes entries, in the background, on your own API key.

- It looks only forward. Chats from before you switched it on are never read, unless you start **Build memory from past chats**, which shows a cost estimate first and reads at most 200 chats per run.
- It uses the model you chose under **Models for memory**. If you chose none, it uses the model of your latest answer in that chat, and failing that the cheapest suitable model on a key you saved. A chat with very little text from you is skipped until it grows.
- Each entry must quote words you wrote, otherwise it is dropped.
- The cost is a short model call per idle chat. The design estimate is about $0.001 to $0.004 per chat on a cheap model, and more on an expensive one. Your provider's console is the final word.
- When you switch it off, Besidka asks whether to keep or delete the entries it generated.

## Does memory cost extra?

Besidka adds no fee and no markup. Memory costs what your provider charges for the tokens it uses. The memory index is capped at about 2,500 tokens per message, and on providers that cache prompts the repeated part is cheaper. Reading an entry or searching chats happens only when the model decides it needs to, with a small budget of calls per message. Writing an entry by hand costs nothing. Asking in a chat is part of that message, and a preview in the **Tell Besidka what to remember or change** box is one short model call on your key. Generating memory in the background is the only part that adds model calls on its own, and it is off until you switch it on.

## What is never stored?

Some things are refused on every path: the edit box, **Add memory**, a chat request, automatic generation and import. Never stored, even if you ask: payment card numbers, IBAN and bank account numbers, government ID numbers, tax identification numbers, passport numbers, API keys and access tokens, JSON Web Tokens, passwords and credentials, private keys, criminal history, immigration or residence-permit status, precise home address and live location.

Special-category data under GDPR Article 9 is refused too: health, religious or philosophical beliefs, political opinions, racial or ethnic origin, sex life or sexual orientation, trade union membership, and genetic and biometric data. Besidka also refuses ongoing legal disputes and drugs. There is no setting to allow these.

The built-in check uses fixed word and pattern rules in English, Ukrainian, Polish and Russian, not an AI model. Treat it as a safety net, not a guarantee, and delete anything you find in memory that should not be there.

## What does TypeSafe AI do in memory?

TypeSafe AI is an optional helper, and it is never a chat model. If you add a TypeSafe AI API key under **Profile**, **API Keys**, **Smart checks**, Besidka asks TypeSafe AI's Jev model short yes/no questions. For memory it does two things.

The first is a second opinion before an entry is saved. Jev looks for sensitive information and, for entries a model wrote, checks that the entry really comes from your text. What is sent is the text of the entry about to be saved, with never-stored items removed, plus a short excerpt of the text it was taken from. Entries the built-in checks already refused are never sent. This check can only add blocks: it can refuse an entry the built-in checks allowed, never allow one they refused.

The second is a pre-filter before memory is generated from a chat. It runs only when memory generation runs: **Generate memory from chats**, **Build memory from past chats**, or a project **Refresh**. It never runs for **Update memory now** or **Import memory**, which always go ahead. Besidka sends the chat text, with never-stored items such as passwords and card numbers removed, to Jev in chunks. If Jev finds nothing worth remembering, the memory model is skipped, which saves cost on your own key; for **Build memory from past chats**, the cost shown beforehand is an upper bound for this reason. If Jev is unsure or cannot be reached, memory is generated as usual. Because this reads whole chat text, you can switch it off on its own.

Besidka has other optional TypeSafe AI checks too, such as deciding whether a web search is needed, screening files and search results for hidden instructions, ordering search results, and a personal-data warning before you share a chat. Each one has its own toggle under **Profile**, **API Keys**, **Smart checks**. They are all on after you save the key, and each one falls back to normal behaviour if TypeSafe AI is unavailable. The web search one is **Auto** in the chat input's web search menu: with a provider picked and Auto on, Jev decides for each message whether to search with that provider, and if TypeSafe AI does not answer, Besidka searches.

TypeSafe AI, Inc. is in the United States and is not certified under the EU–US Data Privacy Framework. Its data processing agreement relies on the Standard Contractual Clauses and the UK Addendum, and its privacy policy says it does not train models on your input. It keeps data as long as necessary, with no fixed period. Each check costs a fraction of a cent on your TypeSafe AI account. Delete the key to stop all the checks, or switch off single checks. The [Privacy Policy](/privacy-policy#typesafe-ai-checks) lists what each check sends. How to get a key: [How to get a TypeSafe AI API key](/guides/typesafe-ai-api-key).

## Where is my memory stored, and who sees it?

Entries are stored in Besidka's database on Cloudflare, tied to your account. When memory is used in a chat, the memory index goes to the provider of the model you are chatting with, as part of the prompt, along with any entry or chat excerpt the model reads. When automatic memory runs, the chat text it reads goes to the model you chose for memory. If you add a TypeSafe AI key, the checks above go to TypeSafe AI. The [Privacy Policy](/privacy-policy#memory) lists every recipient.

## How do I export or delete my memory?

**Export JSON** on the Memory page downloads your entries and memory settings. It does not include the records of past-chat runs or your project knowledge, so it is not a full copy of your data.

To delete: delete single entries, use **Reset memory…** for all of them, or delete a project, which removes its entries. Deleting a chat removes entries that were generated only from that chat and detaches the chat from the others. Entries you wrote or saved on request are kept, because you saved them deliberately. Deleting your account removes your memory with it.

## What do I agree to by using memory?

To use Besidka at all, you give a separate explicit consent, before your first message, to storing the sensitive information you choose to include, sending it to the providers whose keys you add, and automatically checking text before it is saved to memory so that sensitive topics stay out. If you add a TypeSafe AI key, the optional checks you leave on send text to TypeSafe AI, which is an AI provider whose key you add. You can withdraw it in **Profile**, **Security**, **Privacy & consent**, and withdrawing stops all memory work until you consent again.

Writing entries yourself, asking in a chat, and starting a run such as **Update memory now**, **Build memory from past chats** or **Import memory** happen at your request each time. **Generate memory from chats** is its own choice: it is off until you switch it on, and switching it off withdraws it. Memory generated from your chats is profiling under GDPR, and the Privacy Policy explains why it is not an automated decision. See the [Privacy Policy](/privacy-policy#memory) and [Sensitive information in your chats](/privacy-policy#sensitive-information-in-your-chats) for the details.
