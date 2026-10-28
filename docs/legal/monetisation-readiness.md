# Monetisation readiness: what must happen before Besidka earns anything

> **Engineer-drafted. Not reviewed by a lawyer or an accountant. Research date
> 2026-10-28.** Every point below was checked against a primary source on that
> date unless it is marked **(unverified)**. Amounts change every January;
> re-check them before acting.

| Field | Value |
|---|---|
| Date | 2026-10-28 |
| Status | Planning only. Owner decision 2026-10-28: no monetisation, donations or earning intentions are published |
| Scope | Donations and sponsorship (GitHub Sponsors, Ko-fi, Buy Me a Coffee, Patronite), ads, affiliate links, a paid tier or subscription, credits or resale of model usage, paid self-hosting support. Selling user data is **excluded** and never planned |
| Sibling documents | `docs/legal.md` ("Why no postal address is published", "2026-10-28 compliance review: decisions"), `docs/legal/compliance-review-2026-10.md`, `docs/legal/dpia.md`, `docs/legal/art30-record.md` |

## 1. Summary

Today Besidka is run by one private person in Poland, with no revenue, no
company and no JDG. Three conclusions in `docs/legal.md` rest on that "no gain"
premise: no postal address is published (UŚUDE art. 2 pkt 6 and art. 5), the
Polish DSA act's fines very likely cannot reach the operator, and the operator
is not a `przedsiębiorca` facing consumers. **Any** earning channel, even an
unused "Buy me a coffee" link, removes the premise for all three at once,
because the test is gain *orientation*, not money received.

So monetising is a project with a fixed order: business form and address,
then tax and consumer-law plumbing, then legal text, then the button. The
cheapest compliant path (section 5) is a JDG with a virtual office address and
a merchant of record (MoR) that sells to the consumer: roughly 40 to 240 zł a
month for the office, about 430 to 500 zł a month in health contributions for
the first six months, and the MoR's fee.

## 2. Decision triggers

Any one of these starts the checklist in section 3. Each is "gain-oriented"
under UŚUDE art. 2 pkt 6 by itself:

| Trigger | Notes |
|---|---|
| A donation, tip or sponsorship link anywhere under the Besidka name (site, README, `.github/FUNDING.yml`, social profile) | `FUNDING.yml` was removed for this reason (`docs/legal.md`) |
| Ads, sponsored placements, paid listings | Ad-funded services are remunerated: CJEU C-291/13 *Papasavvas*, para 30 |
| Affiliate or referral links that pay the operator (for example provider sign-up links) | Same; plus advertising-labelling rules (section 4.9) |
| A paid tier, subscription, credits, or reselling model usage | Reselling makes Besidka a party to the billing chain the Terms say it stays out of |
| Paid support, consulting or hosting for self-hosters under the Besidka name | Also reopens the "no paid self-employed activity" condition in `docs/legal.md` |
| Selling or licensing user data | **Excluded.** Never do this; it would also break the Art. 9 consent design |

## 3. Ordered checklist

### 3.1 Before launch (weeks to months ahead)

1. **Decide the business form** (4.1). Check eligibility first if the operator
   is not a Polish or EU citizen.
2. **Get a business address that is not the home address** (4.2): a virtual
   office with a written contract that gives legal title to use the address.
3. **Register the JDG in CEIDG** with that address as the delivery address, an
   e-delivery (`e-Doręczenia`) address, PKD codes and the tax form chosen
   (4.1, 4.4). Registration is free.
4. **Pick the tax form and ZUS relief** with an accountant (4.4). Ask for a
   binding individual tax ruling on the ryczałt rate if ryczałt is chosen.
5. **Choose the payment route**: merchant of record (recommended) or own
   merchant account (4.5). Read the MoR's terms on who the seller is.
6. **Draft the legal text** (4.10): Terms (seller, price, withdrawal, renewal,
   cancellation), Privacy Policy (billing purpose, payment recipient, 5-year
   retention), Cookie Policy if any new cookie or script, and the imprint.
7. **Register the DMCA designated agent** with the business address (4.7) and
   add the agent block to the Terms "Copyright complaints" section.
8. **Build the consumer flows** (4.6): pre-contract information, an order
   button labelled as an obligation to pay, express request plus acknowledgement
   before service starts in the withdrawal period, confirmation on a durable
   medium, online cancellation, renewal notices.
9. **Update the DPIA and the Art. 30 record**, then bump
   `CURRENT_CONSENT_VERSION` if what users agree to changes (4.10).
10. **Give advance notice** of the new Terms (Terms "Changes to these terms").

### 3.2 At launch

1. Publish the imprint (full name, business address, email, NIP, CEIDG entry)
   and the new legal pages in the same deploy as the payment UI.
2. Turn on the payment UI only after the imprint is live.
3. Start the sales record (KPiR, ryczałt register, or the simplified sales
   record for unregistered activity) from the first sale.
4. Check the cash-register exemption conditions are met (4.4).

### 3.3 Ongoing

1. Watch the VAT thresholds: 240,000 zł domestic exemption, EUR 10,000 EU B2C
   e-services, 20,000 zł cash-register limit (4.4). With an MoR only the
   domestic limit stays relevant, for the B2B sales to the MoR.
2. Send California renewal reminders and price-change notices (4.8).
3. Keep consent and order records (3 years for California ARL; 5 years from
   the end of the tax year for tax documents).
4. Re-check micro-enterprise status each year (DSA art. 19, EAA).
5. Renew the DMCA designation every 3 years.

## 4. Topics

### 4.1 Business form

| Option | Facts (2026) | Fit |
|---|---|---|
| **Unregistered activity** (`działalność nierejestrowana`, Prawo przedsiębiorców art. 5) | Since 1.1.2026 the limit is **225% of the minimum wage per quarter**, 10,813.50 zł (minimum wage 4,806 zł). Not for anyone who ran a JDG in the last 60 months. When exceeded, it becomes a business that day and a CEIDG filing is due within 7 days. Simplified sales record kept daily. No ZUS | Possible for a tip jar, too small for a subscription business. **It is still gainful**: it does not avoid the UŚUDE art. 5 address duty (inference from PP art. 3 "zorganizowana działalność zarobkowa" and biznes.gov.pl's "drobna działalność zarobkowa"; not tested). Consumer-law duties still apply per biznes.gov.pl. Not available to non-EU foreigners outside art. 4 ust. 1-2 of the foreign-entrepreneurs act |
| **JDG** (CEIDG) | Free registration. Delivery address and business address are public; the home address is not a CEIDG data item and stays private if not used as the delivery address. Legal title to every address reported is required. e-Doręczenia address mandatory for new registrations | **Recommended** default |
| **sp. z o.o.** (S24) | 5,000 zł minimum capital, 250 zł court fee + 100 zł announcement, double taxation, full accounting | Only if liability shielding matters or the operator cannot open a JDG |

**Who can open a JDG.** Polish and EU citizens on equal terms. Non-EU persons
only on the bases in art. 4 ust. 2 of the foreign-entrepreneurs act (permanent
residence, EU long-term resident, listed temporary-residence bases, refugee
status, temporary protection, Karta Polaka, family of EU citizens). **An
ordinary work-based temporary-residence permit is not on the list**; such
persons can only use a company. **Ukrainian citizens:** the 2022 special act's
business provisions are repealed; the right now rests on temporary protection
(art. 4 ust. 2 pkt 2). biznes.gov.pl says PESEL UKR is the basis for a JDG from
5.3.2026, valid to 4.3.2027, and the CUKR card holder may run a business like
a Pole (special act art. 42w). One voivodeship page mentions an extension to
4.3.2028 **(unverified)**.

Sources: [PP consolidated, Dz.U. 2025 poz. 1480](https://api.sejm.gov.pl/eli/acts/DU/2025/1480/text.pdf);
[minimum wage 2026, Dz.U. 2025 poz. 1242](https://api.sejm.gov.pl/eli/acts/DU/2025/1242/text.pdf);
[biznes.gov.pl unregistered activity](https://www.biznes.gov.pl/pl/portal/00115);
[CEIDG act, Dz.U. 2026 poz. 30](https://api.sejm.gov.pl/eli/acts/DU/2026/30/text.pdf);
[foreign entrepreneurs act, Dz.U. 2026 poz. 1313](https://api.sejm.gov.pl/eli/acts/DU/2026/1313/text.pdf);
[special act, Dz.U. 2026 poz. 1293](https://api.sejm.gov.pl/eli/acts/DU/2026/1293/text.pdf);
[biznes.gov.pl Ukrainians](https://www.biznes.gov.pl/pl/portal/001466);
[biznes.gov.pl addresses](https://www.biznes.gov.pl/pl/portal/00118);
[e-delivery act, Dz.U. 2026 poz. 3](https://api.sejm.gov.pl/eli/acts/DU/2026/3/text.pdf);
[sp. z o.o.](https://www.biznes.gov.pl/pl/portal/00166).

### 4.2 Address, imprint and the DSA

- **UŚUDE art. 5** then applies: name, business address, email, and register
  entry plus NIP for a registered business. Fines under art. 23. The virtual
  office address is what gets published.
- **Virtual office.** No primary source rules on it; the gate is the legal
  title CEIDG requires, which a lease-type virtual office contract normally
  gives **(unverified; ask the provider and the tax office)**. Price roughly
  40 to 240 zł a month **(secondary sources)**.
- **DSA.** With remuneration (ads certainly, per *Papasavvas*; subscriptions
  obviously; donations and sponsorship probably, no case law) Besidka becomes
  an information society service, so the DSA applies by law instead of
  voluntarily. Arts. 11 and 12 (points of contact, email is enough) apply to
  everyone. As a micro enterprise the operator stays exempt from arts. 19 to
  28 (including art. 25 dark patterns and art. 26 ad transparency) except
  art. 24(3), and keeps it for 12 months after outgrowing micro status.
- **Polish DSA act** (Dz.U. 2026 poz. 1296, **in force 6.11.2026**, after the
  research date; UKE is the coordinator). Fines in art. 22zzn reach 6% of
  worldwide turnover. The EUR 6,000 cap in art. 22zzo ust. 4 only applies when
  there was **no turnover for three years**, so it disappears with the first
  revenue.

Sources: [DSA](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32022R2065);
[C-291/13 Papasavvas](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62013CJ0291);
[Dz.U. 2026 poz. 1296](https://api.sejm.gov.pl/eli/acts/DU/2026/1296/text.pdf);
[UŚUDE, Dz.U. 2024 poz. 1513](https://api.sejm.gov.pl/eli/acts/DU/2024/1513/text.pdf).

### 4.3 Donations specifically

- **Tax for the recipient.** Gifts from strangers (tax group III) are tax-free
  up to **5,733 zł per donor, summed over 5 years**; above that the donee files
  SD-3 within one month and pays inheritance and gift tax. Amounts from
  different donors are not summed (Sejm answer, **search-only**).
- **But platform "donations" may not be gifts at all.** A KIS ruling
  (527756, search-only) says a payment given as a reward for a creator's
  activity is not a donation, which points to income from a source (and then
  PIT, and possibly unregistered or registered activity). No ruling on
  Patronite, Ko-fi or Buy Me a Coffee was found **(unverified)**.
- **Why a link alone changes the analysis.** `docs/legal.md`: gain orientation,
  not receipt, is the UŚUDE test, so an open channel makes the activity
  `zarobkowa` at zero income. Tip jars therefore need the same address and
  business-form decisions as a paid tier. There is no "donations-only" shortcut.
- GitHub Sponsors and similar platforms pay out to the person; they do not act
  as a merchant of record for a service, so they do not shift VAT or consumer
  law **(platform terms not re-read)**.

Sources: [SD rates](https://podatki.gov.pl/podatki-osobiste/sd/stawki-i-limity);
[SD-3](https://www.gov.pl/web/gov/zloz-zeznanie-podatkowe-o-nabyciu-rzeczy-lub-praw-majatkowych-formularz-podatkowy-sd-3);
[KIS 527756](https://eureka.mf.gov.pl/informacje/podglad/527756).

### 4.4 Tax and social security

| Item | 2026 facts | Source |
|---|---|---|
| PIT scale | 12% to 120,000 zł, then 32%; 30,000 zł free amount | [podatki.gov.pl](https://podatki.gov.pl/podatki-firmowe/pit/stawki-i-limity) |
| Flat | 19% | same |
| Ryczałt | 12% for software-related IT services, 8.5% residual services, 15% advertising. **Which rate a web-app subscription gets is unsettled** (KIS rulings 2026 split PKWiU 62 between 12% and 8.5%, search-only). Get a binding ruling | same |
| Health contribution | Scale and flat: minimum 432.54 zł/month. Ryczałt: 498.35 / 830.58 / 1,495.04 zł by revenue band | [biznes.gov.pl 00286](https://www.biznes.gov.pl/pl/portal/00286) |
| ZUS reliefs | *Ulga na start* 6 months, health only; *preferencyjny ZUS* 24 months, about 421 to 456 zł/month social; *mały ZUS plus* up to 36 of 60 months, revenue under 120,000 zł, not in year one | [00285](https://www.biznes.gov.pl/pl/portal/00285), [00286](https://www.biznes.gov.pl/pl/portal/00286), [00284](https://www.biznes.gov.pl/pl/portal/00284) |
| VAT exemption | **240,000 zł** from 1.1.2026 (art. 113), prorated in year one | [podatki.gov.pl](https://www.podatki.gov.pl/podatki-firmowe/vat/poradniki-i-informatory/zwolnienie-podmiotowe-od-podatku-vat) |
| EU B2C e-services | Below **EUR 10,000** EU-wide (Directive art. 59c; Poland: 42,000 zł) Polish VAT rules apply; above it, VAT of the consumer's country via **OSS** | [Directive 2006/112](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02006L0112-20250101), [biznes.gov.pl 00270](https://www.biznes.gov.pl/pl/portal/00270) |
| EU SME scheme | Available to Polish businesses under EUR 100,000 EU turnover, with prior notification and quarterly reports; host states set their own limits. Interaction with OSS for e-services **(unverified)** | [podatki.gov.pl SME](https://www.podatki.gov.pl/pozostale/sme-special-scheme-for-small-enterprises/information-for-polish-taxable-persons) |
| Non-EU consumers | Outside Polish VAT, but the UK, Norway and others may require local registration **(not researched)**. An MoR removes this | - |
| KSeF | Mandatory issuing from 1.4.2026 for most, from 1.1.2027 for those under 10,000 zł/month. **B2C invoices and art. 113-exempt taxpayers are outside it.** Invoices to an MoR are B2B and may fall in | [KSeF scope](https://ksef.podatki.gov.pl/informacje-ogolne-ksef-20/zakres-obowiazkowego-ksef/) |
| Cash register | Exempt where consumers pay fully by bank or payment transfer and the record shows what was paid for (annex item 42), up to **20,000 zł** prior-year B2C sales (application to item 42 unclear), until 31.12.2027. Irrelevant with an MoR | [Dz.U. 2024 poz. 1902](https://api.sejm.gov.pl/eli/acts/DU/2024/1902/text.html) |
| Record retention | 5 years from the end of the year the tax fell due (Ordynacja art. 70 § 1 with art. 86 § 1) | [Dz.U. 2026 poz. 622](https://api.sejm.gov.pl/eli/acts/DU/2026/622/text.pdf) |

### 4.5 Merchant of record vs own merchant account

Under Implementing Regulation 282/2011 art. 9a, a platform taking part in an
electronically supplied service is presumed to act in its own name, so an MoR
(Paddle, Lemon Squeezy, FastSpring) is the supplier to the consumer and
collects consumer VAT and OSS worldwide. Besidka then makes one B2B supply to
the MoR. A pure payment processor (Stripe alone) does **not** shift anything
(art. 9a(3)).

- **What an MoR fixes:** consumer VAT, OSS, foreign registrations, cash
  register, B2C invoicing, much of the checkout's pre-contract information.
- **What it does not fix:** the operator still earns, so the business form,
  address, PIT, ZUS, DSA and the Terms for the service itself still apply. The
  B2B supply to a foreign MoR has its own VAT treatment (place of supply where
  the customer is; possible VAT-UE registration for an EU MoR even while
  exempt) **(ask the accountant)**.
- Paddle describes itself as merchant of record and controller for payment
  data; Stripe acts as processor for some purposes and controller for others
  (fraud, compliance). Both quotes came through a summarising tool **(re-read
  before relying on them)**.

Sources: [Reg. 282/2011](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02011R0282-20250414);
[Paddle privacy](https://www.paddle.com/legal/privacy);
[Stripe DPA](https://stripe.com/legal/dpa).

### 4.6 Consumer law (Poland and EU)

From the consolidated *ustawa o prawach konsumenta* (Dz.U. 2026 poz. 1244):

- **Pre-contract information** (art. 12): total price, price per billing period
  for subscriptions, duration, renewal and termination, functionality and
  interoperability, withdrawal right, personalised pricing if used.
- **Order button** (art. 17): must say "zamówienie z obowiązkiem zapłaty" or
  equivalent ("Order with obligation to pay"); otherwise no contract.
- **Withdrawal, 14 days** (art. 27). An AI chat subscription is a *digital
  service*, not *digital content*, so the content exception (art. 38 ust. 1
  pkt 13) does not apply and the right survives while the subscription runs.
  To start the service during the 14 days, get an **express request plus
  acknowledgement** (art. 21 ust. 2); the consumer who withdraws then pays
  proportionally (art. 35). Without the request, they pay nothing (art. 36).
- **EU withdrawal button.** Directive 2023/2673 added CRD art. 11a: a
  "withdraw from contract here" function for all distance contracts concluded
  online, **applicable from 19.6.2026**. **Poland has not transposed it**
  (government project UC169, adoption planned Q1 2027). Build it anyway; it
  is cheap and other Member States may already require it.
- **Digital content and services conformity** (arts. 43h to 43q): supply
  without delay, conformity, remedies; changes to the service only if the
  contract allows them, at no cost, with notice and a 30-day exit for
  materially negative changes.
- **Price reductions** (ustawa o informowaniu o cenach, art. 4 ust. 2): show
  the lowest price of the previous 30 days next to any reduced price.
- **Unfair terms**: KC art. 385¹; UOKiK can ban a clause by decision and fine
  up to 10% of turnover (UOKiK act arts. 23a to 23d, 106).
- **Coming:** Dz.U. 2026 poz. 1353 (Directive 2024/825) adds a minimum
  software-update period to art. 12 from **27.9.2027**. Digital Fairness Act:
  announced, no proposal yet.
- **Accessibility** (EAA, Dz.U. 2024 poz. 731, from 28.6.2025): e-commerce
  services are in scope, but **micro-enterprises providing services are
  exempt** (art. 4 pkt 1; under 10 staff and EUR 2m). Re-check yearly.

Sources: [UPK](https://api.sejm.gov.pl/eli/acts/DU/2026/1244/text.pdf);
[Directive 2023/2673](https://eur-lex.europa.eu/eli/dir/2023/2673/oj);
[UC169](https://www.gov.pl/web/premier/projekt-ustawy-o-zmianie-ustawy-o-prawach-konsumenta-oraz-ustawy-o-konsumenckiej-pozyczce-lombardowej);
[prices act](https://api.sejm.gov.pl/eli/acts/DU/2023/168/text.pdf);
[KC](https://api.sejm.gov.pl/eli/acts/DU/2026/795/text.pdf);
[UOKiK act](https://api.sejm.gov.pl/eli/acts/DU/2025/1714/text.pdf);
[Dz.U. 2026 poz. 1353](https://api.sejm.gov.pl/eli/acts/DU/2026/1353/text.pdf);
[EAA act](https://api.sejm.gov.pl/eli/acts/DU/2024/731/text.html).

### 4.7 DMCA designated agent

Register at [dmca.copyright.gov](https://dmca.copyright.gov/dmca/login.html)
with a Login.gov account; **$6** per designation, amendment or resubmission;
expires after **3 years** (37 CFR 201.38(c)(4)). The provider's full legal name
and **physical street address** are public (201.38(b)(1)(i)); a P.O. box only
with a personal-safety waiver (poboxwaiver@copyright.gov). The agent's own
address may be a P.O. box. With a business address the 2026-10-28 objection
falls away (that a virtual-office street address satisfies (b)(1)(i) is
plausible but **unverified**): register, then add the agent's name, address, phone and email to
the Terms "Copyright complaints" section.

Sources: [37 CFR 201.38](https://www.law.cornell.edu/cfr/text/37/201.38);
[201.3 fees](https://www.law.cornell.edu/cfr/text/37/201.3);
[FAQ](https://www.copyright.gov/dmca-directory/faq.html).

### 4.8 Subscriptions (United States)

- **California ARL** (Bus. & Prof. Code §17602, AB 2863, for contracts from
  1.7.2025): terms clear and conspicuous **in visual proximity to the consent
  request**; affirmative consent to the renewal terms; a retainable
  acknowledgment; keep consent proof **3 years or 1 year after termination,
  whichever is longer**; **online cancellation** via a prominent link in the
  account; a save offer only next to a continuous "click to cancel"; price
  change notice 7 to 30 days ahead; **annual reminder for annual plans**;
  trial or promo notice 3 to 21 days before it ends (over 31 days).
- **FTC "click-to-cancel"** was vacated by the 8th Circuit (*Custom
  Communications v. FTC*, 8.7.2025). The FTC restored the old Part 425 text
  (91 FR 6507, 12.2.2026) and opened a new ANPRM (13.3.2026). No new rule yet.
- **ROSCA** (15 U.S.C. 8403) applies regardless: disclose material terms before
  taking billing details, express informed consent, simple cancellation.
- Designing to the California rule satisfies ROSCA and most of the EU rules.

Sources: [§17602](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=17602);
[8th Cir. opinion](https://ecf.ca8.uscourts.gov/opndir/25/07/243137P.pdf);
[91 FR 6507](https://www.federalregister.gov/documents/2026/02/12/2026-02866/revision-of-the-negative-option-rule-withdrawal-of-the-cars-rule-removal-of-the-non-compete-rule-to);
[ANPRM](https://www.federalregister.gov/documents/2026/03/13/2026-04952/rule-concerning-the-use-of-prenotification-negative-option-plans);
[15 U.S.C. 8403](https://www.law.cornell.edu/uscode/text/15/8403).

### 4.9 Marketing email, ads, analytics, affiliate links

- **Poland:** commercial information by email needs **prior consent** (PKE
  art. 398; UŚUDE art. 10 was **repealed** on 10.11.2024). Use double opt-in
  and keep the consent record.
- **CAN-SPAM** (15 U.S.C. 7704): identify as an ad, working opt-out honoured
  within 10 business days, and a **valid physical postal address**: a street
  address, a USPS-registered P.O. box, or a CMRA private mailbox (16 CFR
  316.2(p)). The business address works.
- **Gmail and Yahoo bulk senders** (over 5,000 a day at Gmail): SPF, DKIM,
  DMARC, one-click unsubscribe per **RFC 8058** (`List-Unsubscribe-Post:
  List-Unsubscribe=One-Click` plus an HTTPS `List-Unsubscribe`), spam rate
  under 0.3%. Cloudflare Email Sending is for transactional mail
  (`docs/email.md`), so marketing mail needs a separate sender.
- **Cookies and ad tech:** PKE art. 399 consent for anything not strictly
  necessary. TCF strings are personal data (C-604/22). Ad tags would add a
  third-party script category and break the Cookie Policy's "two third-party
  scripts, both from Cloudflare" statement; they also reopen the CIPA risk in
  the compliance review.
- **Ad labelling and affiliate links:** UOKiK's 2022 influencer
  recommendations treat affiliate-link earnings as advertising that must be
  labelled, even without advertiser influence; legal hook UPNPR art. 6 ust. 3
  pkt 2. FTC Endorsement Guides 16 CFR 255.5: disclose clearly next to the
  link ("Paid link", "I earn a commission"); 16 CFR 465 bans fake reviews.

Sources: [PKE](https://api.sejm.gov.pl/eli/acts/DU/2024/1221/text.html);
[15 U.S.C. 7704](https://www.law.cornell.edu/uscode/text/15/7704);
[16 CFR 316.2](https://www.law.cornell.edu/cfr/text/16/316.2);
[Google sender rules](https://support.google.com/a/answer/81126);
[Yahoo](https://senders.yahooinc.com/best-practices/);
[RFC 8058](https://www.rfc-editor.org/rfc/rfc8058.txt);
[C-604/22](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62022CJ0604);
[UOKiK recommendations](https://uokik.gov.pl/download/26685);
[UPNPR](https://api.sejm.gov.pl/eli/acts/DU/2023/845/text.pdf);
[16 CFR 255.5](https://www.law.cornell.edu/cfr/text/16/255.5);
[FTC FAQ](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking).

### 4.10 AI Act, GDPR and Besidka's own documents

- **AI Act art. 50(2)** (machine-readable marking of synthetic output) applies
  from **2.8.2026**. The Digital Omnibus on AI (**Regulation (EU) 2026/1744,
  adopted**) gives systems placed on the market before that date until
  **2.12.2026**. The provider definition covers free services too, so this is
  **not** a monetisation-only issue; monetising only removes any remaining
  "non-commercial" argument. Whether a BYOK app that relays third-party model
  output is the art. 50(2) provider is **unsettled**. The visible AI-generated
  badge is not the art. 50(2) marking; Besidka serves generated images without
  re-encoding, so provider-embedded markings (C2PA, SynthID) pass through. This
  stays an open item with the 2.12.2026 date.
- **GDPR:** billing is a new purpose (contract, art. 6(1)(b)); keeping invoices
  is a legal obligation (art. 6(1)(c)) for 5 years from the end of the tax
  year; the payment provider is a new recipient (MoR: independent controller;
  Stripe: mixed roles) with possible transfers; marketing email is consent.
  Update the Privacy Policy, the Art. 30 record and the DPIA together.
- **Consent version:** a new purpose or recipient category changes what users
  agree to, so bump `CURRENT_CONSENT_VERSION` per `docs/legal.md`, and
  everyone is re-prompted.
- **Notice:** the Terms promise advance notice of material changes and say a
  postal address will be published before monetisation starts.

Sources: [AI Act](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689);
[Reg. 2026/1744](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32026R1744).

## 5. Minimum viable compliant monetisation

The smallest setup that does not break anything above, for a subscription or a
tip jar:

| Step | What | Rough cost |
|---|---|---|
| 1 | Virtual office with a lease-type contract | 40 to 240 zł/month (secondary) |
| 2 | JDG in CEIDG, virtual office as delivery and business address, e-Doręczenia | free |
| 3 | Accountant; tax form chosen; ryczałt ruling if ryczałt | accountant price **(unverified)**; ruling fee |
| 4 | *Ulga na start*, then *preferencyjny ZUS* | about 430 to 500 zł/month health for 6 months, then about 420 to 460 zł social plus health |
| 5 | MoR account (Paddle, Lemon Squeezy or similar) as seller to consumers | percentage fee per sale **(check current pricing)** |
| 6 | DMCA agent with the business address | $6 per 3 years |
| 7 | Legal text, consent bump, imprint, cancellation and withdrawal UI | build time |
| 8 | Advance notice, then launch | - |

Unregistered activity can replace step 2 only for a small tip jar under
10,813.50 zł a quarter, and it still needs steps 1 and 7, because the activity
is gainful anyway.

## 6. Open questions for a lawyer or accountant

1. Does a donation link at zero income make the operator a `usługodawca`
   (UŚUDE art. 2 pkt 6)? `docs/legal.md` assumes yes.
2. Is a person in unregistered activity a `przedsiębiorca` under KC art. 43¹
   towards consumers? Sources conflict.
3. Is a virtual office contract accepted as legal title for CEIDG and by the
   tax office?
4. Ryczałt rate for a web-app subscription: 12% or 8.5%?
5. VAT on the B2B supply to an MoR: place of supply, VAT-UE registration while
   exempt, KSeF, and whether it counts toward the 240,000 zł limit.
6. Are platform tips (Ko-fi, Buy Me a Coffee, GitHub Sponsors) gifts or income?
7. Is the BYOK app the AI Act art. 50(2) provider for relayed output?
8. Does the MoR take over the Polish consumer-law duties for the sale, and who
   handles a withdrawal?
9. Is the EAA micro exemption measured on the operator alone?

## 7. Files in this repo to change when monetising

| File | Change |
|---|---|
| `content/legal/terms-of-use.md` | Replace "There is no payment" and "If that ever changes" with seller, price, withdrawal, renewal and cancellation sections; imprint in "Who I am"; DMCA agent block in "Copyright complaints"; MoR as seller if used |
| `content/legal/privacy-policy.md` | Billing purpose and legal basis rows, payment recipient, transfers, 5-year tax retention, marketing consent, postal address in the identity block |
| `content/legal/cookie-policy.md` | Any new cookie, script or the marketing category; the "two third-party scripts" sentence |
| `docs/legal.md` | Rewrite "Why no postal address is published" and the 2026-10-28 DSA, address and DMCA decisions |
| `docs/legal/art30-record.md`, `docs/legal/dpia.md` | Billing and payment rows, payment processor or MoR, retention, transfers; marketing email row |
| `docs/legal/compliance-review-2026-10.md` | Items 4 (CAN-SPAM), 5 (ARL), 6 (DMCA) and 7 (DSA) change status |
| `server/utils/legal/consent.ts`, `app/components/Legal/ConsentModal.client.vue` | Bump `CURRENT_CONSENT_VERSION` and, if wording changes, `CURRENT_CONSENT_TEXT_SHA256` |
| `nuxt.config.ts` | `cookieConsent` categories (the commented-out `marketing` category), any analytics or ad config next to `cloudflareWebAnalyticsToken` |
| `app/emails/components/EmailFooter.vue` | Postal address and unsubscribe for any commercial email; transactional mail stays separate |
| `server/utils/landing/client-events.ts` | `SURFACE_BY_PATH` if a new legal or pricing page should send client analytics events |
| `content/index.md`, `content/guides/` | Copy that says the service is free and never paid |
| `.github/FUNDING.yml` | Only re-add after everything above is live |
