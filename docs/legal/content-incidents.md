# Content incidents runbook: reports, takedowns, removal orders, abuse

> **Engineer-drafted, 2026-11-08 (A-9, BES-281). Not reviewed by a lawyer.**
> What to do when someone reports published content, when an authority sends a
> removal order, when a report points to a threat to someone's life, and when
> Cloudflare forwards an abuse complaint. Written for public artifact links
> (`/a#<token>`) and the artifacts inside shared chats, and it applies to
> shared chats as well. Most of the tooling it names is planned in A-1, A-4 and
> A-7; until it ships, use the fallbacks marked **Fallback**.
>
> Sources: `docs/legal/prechecks/artifacts.md` (rows 1 to 3, 10, 11, 14),
> `docs/legal/compliance-review-2026-10.md` (sections 3.1 and 3.3),
> `content/legal/terms-of-use.md` ("Reporting illegal content",
> "Statement of reasons", "Copyright complaints").
> A personal-data breach is a different procedure: `docs/legal/breach-runbook.md`.

## 1. Where things arrive

| Channel | What arrives | Who sees it |
|---|---|---|
| Report form on `/a#<token>` and next to artifacts in shared chats (A-7) | Name, email (both required except for `csam`), reason, details, good-faith statement, the URL filled in by the form, the reporter's account if signed in | The admin reports list, and an email to the privacy mailbox. `threat-to-life` and `terrorism` reports carry a priority flag and a subject prefix |
| Privacy mailbox (the address the `:privacy-email-link{}` component renders on every legal page) | Email reports, copyright notices, disputes, TCO removal orders, authority requests, Cloudflare abuse forwards | The controller |
| Cloudflare abuse email to the account address | Complaints Cloudflare received about a URL it hosts | The controller |

**Phone alert (owner item 3 of the pre-check).** The one-hour rule in section 3
cannot be met without a push alert on the controller's phone. Mail to
`privacy@`, `abuse@`, `security@` and `contact@` goes through the `besidka-mail-alerts` Email Worker, which forwards
it to the Gmail inbox as before and pushes "New mail to privacy@" with the
subject to every admin's subscribed devices; removal orders, authority mail
and breach or security reports push as urgent, at most once per mailbox per
minute (`docs/mail-alerts.md`). The owner switches the four Email Routing rules with
the runbook there and turns push on in the installed PWA for the admin
account.
**Not covered:** Cloudflare abuse email to the account address still needs a
phone notification from the mail app (for example a Gmail filter with
notifications on for that sender). Do this before `artifacts.share` is granted
to anyone beyond the controller.

**No cover person (owner decision, 2026-11-09).** The owner works alone, so
nobody covers holidays, travel or nights. The phone push is the only
safeguard for the one-hour rule. It fails when the phone is off, has no
signal, silences Besidka (Focus mode, notification settings), or when the
owner cannot be reached for any other reason. In those cases a TCO removal
order can run past the hour. If that happens, tell the authority as described
in section 3 (Art. 3(7), 3(8)). Revisit this when a second operator exists,
when Besidka starts to earn money or the owner registers a business
(`docs/legal/monetisation-readiness.md`), or when the user base grows enough
to make orders or reports likely.

## 2. Triage, in this order

1. **Removal order under Regulation (EU) 2021/784 (TCO)**: section 3, now.
2. **`threat-to-life`, or anything that suggests a crime threatening someone's
   life or safety**, from any source: section 4, now.
3. **`csam`**: take the content down at once (section 5) and report it to
   the police or to Dyżurnet.pl (NASK), the Polish hotline for such material
   (which route fits best is **[U]**, counsel question). Never forward, copy or
   download the material. Do not set a hold of your own: keep the disabled
   artifact as it is and preserve it only if an authority asks (possession of
   such material is itself an offence, kk art. 202).
4. **`terrorism` report without an order**: take down if it is plainly
   terrorist content, then decide on Art. 18 (section 4). Set a hold only if an
   authority asks for one or issues an order.
5. **`phishing`**: take down the same day if the artifact imitates a sign-in or
   payment form or asks for credentials (Terms, "What you may not do").
6. **Everything else** (`copyright`, `privacy`, `illegal`, `harmful`,
   `other`): a decision without undue delay, normally within a few days.

Every report gets a **receipt** by email if the reporter gave an address
(template T1), sent when it arrives (A-7 sends it automatically).

## 3. TCO removal order: one hour

A removal order comes from a competent authority. In Poland that is the
**Szef ABW** (Dz.U. 2024 poz. 1684, art. 26a); orders from other Member States
can arrive too (TCO Art. 3; cross-border scrutiny under Art. 4). The order must
be acted on **within one hour of receipt** (Art. 3(3)).

1. Note the time of receipt. Open the admin page on the phone.
2. Take the content down with **take down by URL, token, artifact id or user**
   (A-7). It needs no report. It sets `takedownAt` on the artifact, so `/a/`,
   the shared-chat route and the owner view all answer 410 on the next request.
   For a shared chat, revoke the share. **Fallback** (before A-7 ships, or if
   the admin page fails): turn the global `artifacts` rule off in `/admin`,
   which hides every artifact for everyone; revoke chat shares with the SQL in
   `docs/legal/breach-runbook.md`, section 2.6.
3. Set the hold: `legalHoldUntil` = removal time + six months (Art. 6(2)).
   Held rows and R2 objects survive artifact deletion, account deletion and
   the report sweep (A-1). The authority can ask for a longer hold; record it.
4. Check the content really is gone: open the link in a private window.
5. Confirm to the authority without undue delay what was removed and when,
   with the template in Annex II of the regulation (Art. 3(6)).
   **If you cannot act within the hour** (force majeure, a technical
   impossibility, or an order that is manifestly wrong or lacks information),
   tell the authority without undue delay, with the reasons, using the
   template in Annex III (Art. 3(7) and 3(8)), and act as soon as the reason is
   gone. The Terms promise this.
6. Tell the user who published it (template T4). If the authority decided
   that nothing may be disclosed (Art. 11(3)), say nothing until that period
   ends, then send T4.
7. If the order shows an **imminent threat to life**, also inform the
   authorities competent for criminal offences in the Member States concerned
   (TCO Art. 14(5)); if they cannot be identified, the ABW contact point and
   Europol.
8. Record the order privately (section 8).

**Every 1 March** after a year with any TCO action: publish a transparency
report (Art. 7(2)) and send the annual data to the ABW (Polish art. 26e, which
serves the Member State monitoring in TCO Art. 21). If no action was taken,
nothing is due.

## 4. Threat to life or safety (DSA Art. 18)

Applies when anything (a report, an artifact the controller opens, an email)
gives rise to a suspicion that a criminal offence threatening someone's life or
safety has happened, is happening or is likely. It does not depend on a report.
The Terms promise it.

1. If the threat is **imminent**, call **112** first.
2. Inform the authorities of the Member State concerned with everything
   relevant (DSA Art. 18(1)): the content, the URL, when it was published, the
   account's id and email if known. In Poland: the police or the prosecutor's
   office; which body is the right recipient is **[U]**, a counsel question
   (pre-check, Unverified). If the Member State cannot be identified, inform
   the Polish authorities or Europol, or both (Art. 18(2)).
3. Take the content down (section 5). Preserve it only if the authority asks;
   then set `legalHoldUntil` to the period it names.
4. Before sending the statement of reasons, ask the authority whether telling
   the user could warn a suspect. Whether the DSA lets a provider hold back a
   statement of reasons for that reason is **[U]**: Art. 17 has no explicit
   carve-out for it, so this is a counsel question. Note what you did and why.
5. Record the decision privately (section 8).

Do **not** add automated scanning to find such content. The Terms promise
none.

## 5. Takedown and the statement of reasons

A takedown disables; it never deletes. It reaches every public path: the
`/a/` links, the shared-chat route and the owner's view (all 410 with
"This artifact was removed after a report"). Scope is one link or all links of
the artifact (A-7).

For each decision on a report:

1. Write a statement of 20 to 4,000 characters: the facts, the ground (the law
   or the clause of the Terms), the scope and how long it lasts. Send the
   statement of reasons no later than the takedown itself (DSA Art. 17(1)).
2. **Takedown**: the owner gets the statement of reasons (template T3), the
   reporter gets the decision (template T2).
3. **Reject**: the reporter gets the decision (template T2); the owner gets
   nothing.
4. Copyright: a valid notice leads to removal; record the 24-month note for
   the repeat-infringement rule (Terms, "Repeat infringers").
5. If the owner replies and disputes it, a person looks again. If the content
   is restored, tell the reporter, and for copyright do not pass on the
   owner's contact details without their consent.

A user-scope takedown (every artifact of one owner, direct takedown with
scope `user`) also withdraws link sharing: it writes a deny grant for
`artifacts.share` on that account in the same batch, and the T3 email tells
the owner. Restoring the artifacts does not lift it; restore link sharing by
removing the deny grant in Admin → Features → `artifacts.share` once a
person has reviewed the dispute.

Report rows outlive the artifact: they are deleted 12 months after the matter
is closed (24 for a copyright removal) by a sweep (A-1), and never by
`deleteArtifacts` or the account purge.

## 6. Cloudflare abuse complaints

Besidka runs on one Cloudflare account (owner decision 2026-11-08, pre-check
option C). Cloudflare's Self-Serve Subscription Agreement lets it suspend all or
part of the services; its abuse policy says terminating all services is not
normally the response, but repeated hosting of violating content with "no
meaningful steps" can lead to suspension of hosting services (Workers, R2, D1).
A complaint will usually name `besidka.com/a#<token>`. The token is the
part after `#`; the admin takedown form accepts the full link,
`/a#<token>`, `a#<token>` or the bare token. The token never reaches the
server in a request, so it is not in any request log; ask the complainant
for the full link if they quote only `besidka.com/a`.

1. Read the complaint the same day. Open the URL in a private window.
2. If it breaches the Terms or the law, take it down (section 5) and send the
   statement of reasons.
3. Reply to Cloudflare from the account address: the URL, what was done and
   when, that public artifact sharing is an invited beta with a person reading
   reports, and the takedown and kill-switch steps that exist. Keep it short
   and factual.
4. If complaints repeat or Cloudflare warns of action against the account, turn
   the global `artifacts` rule off until the cause is fixed, and revisit the
   separation decision (pre-check owner item 1, option A: a separate
   registrable domain and account for public artifacts).
5. Record it privately (section 8).

## 7. After a D1 restore

A Time Travel restore brings back revoked and taken-down links, closed reports
and deleted artifacts. Follow `docs/d1-restore-reconciliation.md` ("Artifacts")
before reopening `/a/`.

## 8. Private record

Keep it outside this public repository, next to the breach record: date and
time of receipt, channel, the content and URL, the category, the decision and
its time, who was told and when (reporter, owner, authority, Cloudflare), the
hold and its end date, and, for TCO, the order reference. Keep it for as long
as the matching report row, and at least for the hold.

## 9. Email templates

Plain text, sent from the privacy mailbox or by A-7 through `useEmail`. English;
send in Polish when the report was in Polish. Never name the reporter to the
owner, never quote a CSAM report, and never attach the reported material.
Placeholders are in angle brackets.

In the emails A-7 sends, `<URL>` in T1 and T2 is a reference id (the share
id, or the artifact id for a shared chat), never the link and never the
artifact title, because the reporter chooses the address. T1 goes to the
typed address only for signed-out reporters; a signed-in reporter gets it
at their verified account email, and each address gets at most 3 receipts a
day. T3 names the artifact by title and id.

### T1. Receipt to the reporter (DSA Art. 16(4))

Subject: Your report about <URL> was received

> Thank you for your report about <URL>, received on <date, time UTC>, in the
> category "<reason>". A person will review it and decide without undue delay
> whether the content stays up, is removed or is disabled. I will tell you the
> decision and how you can challenge it. This is an automatic confirmation; you
> can reply to this email to add information.
>
> Serhii Chernenko, Besidka

### T2. Decision to the reporter (DSA Art. 16(5))

Subject: Decision on your report about <URL>

> I reviewed your report of <date> about <URL>.
>
> Decision: <the content was removed / access to it was disabled / the link
> was revoked / no action was taken>, on <date>.
> Reason: <short reason: the clause of the Terms of Use or the law, or why the
> content does not breach them>.
> The decision was made by a person. No automated means were used to decide.
>
> If you disagree, reply to this email and a person will look at it again. You
> can also go to a court.
>
> Serhii Chernenko, Besidka

### T3. Statement of reasons to the owner (DSA Art. 17(3))

Subject: Your artifact "<title>" was <removed / restricted>

> I <removed / disabled access to / revoked the public links of> your artifact
> "<title>" (<artifact id>) on <date>. Scope: <all links and the artifact in
> shared chats / the link <share id> only>, everywhere, not only in some
> countries. Duration: <until further notice / until <date>>. The artifact is
> disabled, not deleted, and you can still delete it <unless: it is held until
> <date> because an authority ordered its removal or asked me to preserve
> it>.
>
> <only after a user-scope takedown: Link sharing is also turned off for your
> account: you cannot create new public links to artifacts until a person
> reviews this decision again.>
>
> Facts: <what was found, including whether the decision followed a report
> made under the notice process, without the reporter's name>.
> Ground: <the law: name the provision / the Terms of Use: name the clause and
> link https://besidka.com/terms-of-use#what-you-may-not-do>.
> Automated means: <none were used / Besidka's automatic check noticed that
> the artifact tried to navigate its frame, and a person then reviewed it>.
> The decision was made by a person.
>
> How to challenge it: reply to this email with your reasons and a person will
> look at it again. You can also go to a court.
>
> Serhii Chernenko, Besidka

### T4. Notice to the owner after a TCO removal order (TCO Art. 11)

Subject: Your artifact "<title>" was removed on an authority's order

> On <date, time UTC> I removed your artifact "<title>" (<artifact id>) and its
> links because a competent authority, <authority>, ordered its removal under
> Regulation (EU) 2021/784 on terrorist content online (order <reference>). The
> reasons the authority gave are: <reasons>. The law requires me to keep the
> removed content for six months after the removal.
>
> You can challenge the order before the courts of the Member State whose
> authority issued it. If you ask, I will send you a copy of the order. If the
> order is withdrawn or set aside, I will restore the content.
>
> Serhii Chernenko, Besidka
