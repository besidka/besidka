import type { MemorySensitiveCategory } from '#shared/types/memory.d'

export type SensitiveTextLanguage = 'en' | 'uk' | 'pl' | 'ru' | 'uk-ru' | 'any'

export interface SensitiveTextPattern {
  language: SensitiveTextLanguage
  source: string
}

export interface SensitiveTextRule {
  category: MemorySensitiveCategory
  patterns: readonly SensitiveTextPattern[]
}

interface CompiledSensitiveTextRule {
  category: MemorySensitiveCategory
  expression: RegExp
}

const WORD_START = String.raw`(?<![\p{L}\p{N}])`
const WORD_END = String.raw`(?![\p{L}\p{N}])`
const SPACE_PLACEHOLDER = ' '
const SPACE_EXPRESSION = String.raw`\s+`

const I_AM = String.raw`i(?:'?m| am)`

const STREET_WORDS_EN = 'street|st|road|rd|avenue|ave|lane|ln|square|sq|hill'
  + '|way|drive|dr|park|end|boulevard|blvd'
const STREET_WORDS_PL = 'ulic\\p{L}*|ul|alej\\p{L}*|al|plac\\p{L}*|pl'
  + '|osiedl\\p{L}*|rondo'

const NOT_STREET_EN = String.raw`(?![-\s]+(?:${STREET_WORDS_EN})${WORD_END})`
const NOT_STREET_PL = String.raw`(?![-\s]+(?:${STREET_WORDS_PL})${WORD_END})`

function createPattern(language: SensitiveTextLanguage) {
  return (
    strings: TemplateStringsArray,
    ...values: string[]
  ): SensitiveTextPattern => {
    return { language, source: String.raw(strings, ...values) }
  }
}

const en = createPattern('en')
const uk = createPattern('uk')
const pl = createPattern('pl')
const ru = createPattern('ru')
const ukRu = createPattern('uk-ru')
const any = createPattern('any')

/**
 * Deterministic GDPR Art. 9 vocabulary, one rule per category in the order of
 * `memorySensitiveCategories`. Sources are matched against NFKC-lowercased
 * text with straight apostrophes and `ё` folded to `е`; a space in a source
 * means "one or more whitespace", every source is wrapped in Unicode-aware
 * word boundaries (`\b` does not work for Cyrillic or Polish), and a trailing
 * `\p{L}*` is an inflection stem. Ambiguous words (diet, church, party, weed,
 * race, union, court, DNA, Face ID, rak) are deliberately absent: they only
 * match inside an unambiguous phrase.
 */
export const sensitiveTextRules: readonly SensitiveTextRule[] = [
  {
    category: 'health',
    patterns: [
      en`diabet\p{L}*`,
      any`hiv`,
      en`(?<!great )depress(?:ion|ed|ive)`,
      en`(?:i have|i've got|i suffer from|my|social|generalized|generalised) anxiety`,
      en`anxiety disorders?`,
      en`panic attacks?`,
      en`bipolar (?:disorder|depression|i|ii)`,
      en`${I_AM} bipolar`,
      en`schizophreni\p{L}*`,
      any`ptsd`,
      en`post[-\s]traumatic stress`,
      any`ocd`,
      any`adhd`,
      en`autis(?:m|tic)`,
      en`asthma\p{L}*`,
      en`epilep\p{L}*`,
      en`(?:breast|lung|prostate|skin|colon|bowel|liver|blood|bone|brain|ovarian|cervical|pancreatic|thyroid|stomach|kidney) cancer`,
      en`(?:have|has|had|having|fighting|beat|beating|survived|battling|battle with|living with) cancer(?![-\s]+(?:zodiac|sign|horoscope|season))`,
      en`cancer (?:diagnosis|patient|survivor|treatment|screening)`,
      en`(?:brain|benign|malignant) tumou?rs?`,
      en`chemotherapy`,
      en`oncolog\p{L}*`,
      en`diagnosed with`,
      en`medical diagnos\p{L}*`,
      en`my diagnosis`,
      en`chronic (?:illness|illnesses|disease|diseases|pain|condition|conditions|fatigue|migraines?|health)`,
      en`therap(?:y|ies|ist|ists)`,
      en`psychiatr\p{L}*`,
      en`psychotherap\p{L}*`,
      en`mental health`,
      en`eating disorders?`,
      en`anorexia nervosa|bulimia`,
      en`pregnan\p{L}*`,
      en`allerg\p{L}*`,
      en`medications?`,
      en`antidepressants?`,
      en`insulin`,
      en`migraines?`,
      en`(?:i have|i've got|i am living with|my|he has|she has) (?:a |an )?(?:\p{L}+ )?disabilit(?:y|ies)`,
      en`disability (?:benefits?|pension|status|certificate|allowance|card)`,
      en`wheelchair`,
      en`celiac|coeliac`,
      en`(?:lactose|gluten) intoleran\p{L}*`,
      en`crohn'?s`,
      en`dyslexi\p{L}*`,
      en`tourette\p{L}*`,
      en`multiple sclerosis`,
      en`alzheimer\p{L}*`,
      en`dementia`,
      en`hypertension`,
      en`high blood pressure`,
      en`heart (?:disease|condition|attack)`,
      en`miscarriage`,
      en`infertility`,
      en`(?:had|have|having|undergo|undergoing|upcoming|knee|heart|eye|back) surgery`,
      en`sick leave`,
      en`sexually transmitted`,
      uk`діабет\p{L}*`,
      uk`депресі\p{L}*`,
      uk`депресивн\p{L}*`,
      uk`тривожн\p{L}* розлад\p{L}*`,
      uk`біполярн\p{L}* розлад\p{L}*`,
      uk`шизофрені\p{L}*`,
      ukRu`аутизм\p{L}*|аутист\p{L}*`,
      ukRu`сдвг|адгд`,
      uk`вагітн\p{L}*`,
      uk`алерг\p{L}*`,
      uk`діагноз\p{L}*`,
      uk`хронічн\p{L}* (?:хвороб|захворюван|біль)\p{L}*`,
      uk`психіатр\p{L}*`,
      uk`психотерап\p{L}*`,
      uk`терапі\p{L}*`,
      ukRu`онколог\p{L}*`,
      uk`рак (?:легень|легенів|грудей|молочної залози|простати|шкіри|шлунка|крові|мозку|печінки|товстої кишки|підшлункової)`,
      uk`хіміотерапі\p{L}*`,
      uk`пухлин\p{L}*`,
      uk`віл`,
      uk`інсулін\p{L}*`,
      uk`антидепресант\p{L}*`,
      uk`інвалід\p{L}*`,
      uk`епілеп\p{L}*`,
      uk`астм\p{L}*`,
      uk`мігрен\p{L}*`,
      uk`панічн\p{L}* атак\p{L}*`,
      uk`психічн\p{L}* (?:здоров|розлад|захворюван)\p{L}*`,
      uk`хвор\p{L}* на`,
      uk`прийма\p{L}* (?:ліки|таблетк\p{L}*|препарат\p{L}*)`,
      uk`розлад\p{L}* харчової поведінки`,
      pl`cukrzyc\p{L}*`,
      pl`depresj\p{L}*|depresyjn\p{L}*`,
      pl`zaburzen\p{L}* (?:lęk|afekt|odżywi|psychicz|osobow)\p{L}*`,
      pl`chorob\p{L}* (?:serc|nerek|wątrob|tarczyc|psychiczn|autoimmunolog|przewlekł|genetyczn)\p{L}*`,
      pl`przewlekle chor\p{L}*`,
      pl`nowotw\p{L}*`,
      pl`chemioterapi\p{L}*`,
      pl`onkolog\p{L}*`,
      pl`rak (?:płuc|piersi|prostaty|skóry|żołądka|jelita|krwi|mózgu|wątroby|trzustki|jajnika|tarczycy)`,
      pl`padaczk\p{L}*`,
      pl`astm\p{L}*`,
      pl`autyzm\p{L}*|autystycz\p{L}*`,
      pl`w ciąży|ciąża|ciążow\p{L}*|ciężarn\p{L}*`,
      pl`alerg\p{L}*|uczulen\p{L}*`,
      pl`psychiatr\p{L}*`,
      pl`psychoterap\p{L}*`,
      pl`terapi\p{L}*|terapeut\p{L}*`,
      pl`zdiagnozowa\p{L}*`,
      pl`diagnoz\p{L}* (?:lekarsk|medyczn)\p{L}*`,
      pl`(?:bior\p{L}*|przyjmuj\p{L}*) leki`,
      pl`antydepresant\p{L}*`,
      pl`insulin\p{L}*`,
      pl`niepełnosprawn\p{L}*`,
      pl`migren\p{L}*`,
      pl`ataki paniki|atak paniki`,
      pl`stwardnienie rozsiane`,
      pl`nadciśnien\p{L}*`,
      pl`celiaki\p{L}*`,
      pl`nietolerancj\p{L}* (?:laktoz|glutenu)\p{L}*`,
      pl`wózek inwalidzki|wózku inwalidzkim`,
      pl`poronieni\p{L}*`,
      pl`niepłodn\p{L}*`,
      pl`zwolnieni\p{L}* lekarsk\p{L}*`,
      pl`chor\p{L}* na`,
      ru`диабет\p{L}*`,
      ru`депресс\p{L}*`,
      ru`тревожн\p{L}* расстройств\p{L}*`,
      ru`биполярн\p{L}* расстройств\p{L}*`,
      ru`шизофрени\p{L}*`,
      ru`беременн\p{L}*`,
      ru`аллерг\p{L}*`,
      ru`диагноз\p{L}*`,
      ru`хроническ\p{L}* (?:болезн|заболеван|боль)\p{L}*`,
      ru`психиатр\p{L}*`,
      ru`психотерап\p{L}*`,
      ru`терапи\p{L}*`,
      ru`рак (?:легких|груди|простаты|кожи|желудка|крови|мозга|печени|кишечника|молочной железы|поджелудочной)`,
      ru`химиотерапи\p{L}*`,
      ru`опухол\p{L}*`,
      ru`вич`,
      ru`инсулин\p{L}*`,
      ru`антидепрессант\p{L}*`,
      ru`инвалид\p{L}*`,
      ru`эпилепс\p{L}*`,
      ru`астм\p{L}*`,
      ru`мигрен\p{L}*`,
      ru`панически\p{L}* атак\p{L}*`,
      ru`психическ\p{L}* (?:здоровь|расстройств|заболеван)\p{L}*`,
      ru`принима\p{L}* (?:лекарств|таблетк|препарат)\p{L}*`,
      ru`расстройств\p{L}* пищевого поведения`,
    ],
  },
  {
    category: 'religion-or-belief',
    patterns: [
      en`christianity|christians`,
      en`${I_AM} (?:an? )?(?:devout |practicing |born[-\s]again |orthodox )?christian`,
      en`(?:is|was|are|were|as) an? christian|raised (?:as )?(?:an? )?christian`,
      en`christian (?:faith|beliefs?|church|values|family|upbringing|denomination|community)`,
      en`born[-\s]again`,
      en`catholic\p{L}*`,
      en`protestant\p{L}*`,
      en`muslims?|moslems?`,
      en`islam(?!abad)\p{L}*`,
      en`jewish|judaism`,
      en`buddhis\p{L}*`,
      en`hindu(?:s|ism|ists?)?`,
      en`sikh(?:s|ism)?`,
      en`mormon\p{L}*`,
      en`jehovah's witness\p{L}*`,
      en`atheis\p{L}*`,
      en`${I_AM} (?:an? )?agnostic(?![-\s]+(?:about|to|of|in|towards?|regarding))`,
      en`agnostic about (?:religion|god)`,
      en`orthodox (?:church|christian\p{L}*|jew\p{L}*)`,
      en`${I_AM} (?:very |deeply |quite )?religious`,
      en`religious (?:beliefs?|views?|affiliation|practices?|background|upbringing)`,
      en`my religion`,
      en`baptized|baptised`,
      en`(?:go|goes|went|going) to (?:the |a )?(?:church|mosque|synagogue)${NOT_STREET_EN}`,
      en`attend\p{L}* (?:the |a )?(?:church|mosque|synagogue)${NOT_STREET_EN}`,
      en`sunday mass`,
      en`i believe in (?:god|allah|jesus)`,
      en`(?:i|we) pray (?:daily|every|five|regularly|to (?:god|allah))`,
      en`(?:daily|five daily) prayers?`,
      en`ramadan|shabbat|yom kippur|hanukkah|eid al-?fitr`,
      en`keep(?:s|ing)? kosher`,
      en`(?:eat|eats|only) halal`,
      en`my (?:pastor|priest|imam|rabbi)`,
      uk`християн\p{L}*`,
      uk`католик\p{L}*|католицьк\p{L}*`,
      ukRu`протестант\p{L}*`,
      ukRu`мусульман\p{L}*`,
      uk`іслам(?!абад)\p{L}*`,
      uk`іудей\p{L}*|іудаїзм\p{L}*|юдей\p{L}*`,
      uk`буддист\p{L}*|буддизм\p{L}*|буддійськ\p{L}*`,
      uk`індуїз\p{L}*|індуїст\p{L}*`,
      uk`атеїст\p{L}*|атеїзм\p{L}*`,
      ukRu`агностик\p{L}*`,
      uk`віруюч\p{L}*`,
      uk`релігійн\p{L}*`,
      uk`мо(?:я|єї|ю) (?:релігі\p{L}*|віра|віри|віру)`,
      uk`молитв\p{L}*`,
      uk`молю(?:сь|ся)`,
      uk`православ\p{L}*`,
      uk`хрещен\p{L}*`,
      uk`(?:ходжу|ходимо|ходить|ходив|ходила) до (?:церкви|мечеті|синагоги|храму)`,
      uk`рамадан|шабат|хануку`,
      uk`свідк\p{L}* єгов\p{L}*`,
      pl`chrześcijan\p{L}*`,
      pl`katolik\p{L}*|katolick\p{L}*`,
      pl`protestant\p{L}*`,
      pl`muzułman\p{L}*`,
      pl`islam(?!abad)\p{L}*`,
      pl`żyd(?:a|em|owi|zi|ów|ami)?|żydowsk\p{L}*`,
      pl`buddy(?:st|zm|js)\p{L}*`,
      pl`hindu(?:iz|is|s)\p{L}*`,
      pl`ateist\p{L}*|ateizm\p{L}*`,
      pl`agnostyk\p{L}*`,
      pl`wierząc(?:y|a|ą|ym|ej)`,
      pl`religijn\p{L}*`,
      pl`moj\p{L}* (?:wiar|religi)\p{L}*`,
      pl`modlitw\p{L}*`,
      pl`modlę się`,
      pl`prawosławn\p{L}*`,
      pl`ochrzczon\p{L}*`,
      pl`chodzę do (?:kościoła|meczetu|synagogi|cerkwi)`,
      pl`ramadan|szabat`,
      pl`świadk\p{L}* jehow\p{L}*`,
      ru`христиан\p{L}*`,
      ru`католик\p{L}*|католическ\p{L}*`,
      ru`ислам(?!абад)\p{L}*`,
      ru`иудей\p{L}*|иудаизм\p{L}*`,
      ru`буддист\p{L}*|буддизм\p{L}*|буддийск\p{L}*`,
      ru`индуизм\p{L}*|индуист\p{L}*`,
      ru`атеист\p{L}*|атеизм\p{L}*`,
      ru`верующ\p{L}*`,
      ru`религиозн\p{L}*`,
      ru`мо(?:я|ей|ю) (?:религи\p{L}*|вера|веры|веру)`,
      ru`молитв\p{L}*`,
      ru`молюсь|молимся`,
      ru`православн\p{L}*`,
      ru`крещен\p{L}*|крестил\p{L}*`,
      ru`хожу в (?:церковь|мечеть|синагогу|храм)`,
      ru`рамадан|шаббат`,
      ru`свидетел\p{L}* иегов\p{L}*`,
    ],
  },
  {
    category: 'political-opinion',
    patterns: [
      en`political (?:party|views?|opinions?|beliefs?|affiliation|leanings?|orientation)`,
      en`(?:${I_AM}|we are) (?:an? )?(?:registered )?(?:republican|democrat|conservative|liberal(?![-\s]+arts)|socialist|communist|libertarian|marxist|nationalist|fascist|anarchist)`,
      en`i (?:voted|vote|will vote|plan to vote) for`,
      en`(?:member of|belong to|belongs to|joined|supporter of|support|supports|voting for) (?:the |a )?(?:labou?r|conservative|democratic|republican|green|socialist|communist|liberal|nationalist|libertarian|social democratic|tory|political|far[-\s]right|far[-\s]left) party`,
      en`${I_AM} (?:an? |very )?(?:left|right)[-\s]wing`,
      en`(?:left|right)[-\s]wing (?:views?|politics|voter|supporter|beliefs?|party)`,
      en`${I_AM} pro[-\s](?:life|choice)`,
      uk`політичн\p{L}* (?:погляд|переконан|партi|партій|уподобан|орієнтац)\p{L}*`,
      uk`(?:про)?голосува\p{L}* за`,
      uk`член\p{L}* партії|належ\p{L}* до партії`,
      uk`(?:лівих|правих) (?:поглядів|переконань)`,
      uk`(?:ліво|право)радикал\p{L}*`,
      uk`я (?:консерватор|лібертаріан|соціаліст|комуніст|націоналіст|монархіст|анархіст)\p{L}*`,
      uk`я ліберал\p{L}*`,
      uk`підтримую партію`,
      pl`pogląd\p{L}* polityczn\p{L}*`,
      pl`preferencj\p{L}* polityczn\p{L}*`,
      pl`głosowa\p{L}* na`,
      pl`członk\p{L}* partii|należ\p{L}* do partii`,
      pl`(?:lewicow|prawicow)\p{L}* (?:pogląd|przekonan|orientacj)\p{L}*`,
      pl`jestem (?:lewicowcem|prawicowcem|konserwatyst\p{L}*|liberał\p{L}*|socjalist\p{L}*|komunist\p{L}*|nacjonalist\p{L}*|libertarian\p{L}*)`,
      pl`popieram partię`,
      ru`политическ\p{L}* (?:взгляд|убежден|предпочтен|позици|партии|ориентац)\p{L}*`,
      ru`(?:про)?голосова\p{L}* за`,
      ru`член\p{L}* партии|состою в партии`,
      ru`(?:левых|правых) (?:взглядов|убеждений)`,
      ru`я (?:консерватор|либерал|социалист|коммунист|националист|монархист|либертариан|анархист)\p{L}*`,
      ru`поддерживаю партию`,
    ],
  },
  {
    category: 'racial-or-ethnic-origin',
    patterns: [
      en`ethnic origin|ethnicity|ethnicities`,
      en`ethnic (?:minorit\p{L}*|group|background|identity)`,
      en`racial (?:origin|background|identity|group)`,
      en`(?:african|asian|hispanic|latino|arab|native american|mexican|irish|italian|polish|chinese|korean|indian) (?:descent|heritage|ancestry)`,
      en`african[-\s]american|afro[-\s](?:american|caribbean|latino|brazilian)`,
      en`${I_AM} (?:an? )?(?:black|white|asian|hispanic|latino|latina|arab) (?:man|woman|person|guy|girl|male|female)`,
      en`people? of colou?r`,
      en`romani|romany|roma people`,
      uk`етнічн\p{L}* (?:походж|приналежн|меншин|груп|ідентичн)\p{L}*`,
      uk`за національністю|за походженням я`,
      uk`расов\p{L}* (?:походж|приналежн|ідентичн)\p{L}*`,
      uk`ромськ\p{L}* (?:національн|походж|громад)\p{L}*`,
      ukRu`афроамерикан\p{L}*`,
      uk`чорношкір\p{L}*|темношкір\p{L}*`,
      pl`pochodzeni\p{L}* etniczn\p{L}*`,
      pl`etniczn\p{L}* (?:pochodz|przynależn|mniejszoś|grup)\p{L}*`,
      pl`narodowości romskiej|jestem narodowości \p{L}+`,
      pl`pochodzeni\p{L}* (?:romsk|żydowsk|afrykańsk|azjatyck)\p{L}*`,
      pl`rasow\p{L}* (?:pochodz|przynależn|tożsam)\p{L}*`,
      pl`czarnoskór\p{L}*|ciemnoskór\p{L}*`,
      pl`afroamerykan\p{L}*`,
      ru`этническ\p{L}* (?:происхожден|принадлежн|меньшинств|групп|идентичн)\p{L}*`,
      ru`по национальности`,
      ru`расов\p{L}* (?:происхожден|принадлежн|идентичн)\p{L}*`,
      ru`цыганск\p{L}* (?:национальн|происхожден)\p{L}*`,
      ru`чернокож\p{L}*|темнокож\p{L}*`,
    ],
  },
  {
    category: 'sex-life-or-orientation',
    patterns: [
      en`gay(?![-\s]+(?:lussac|${STREET_WORDS_EN})${WORD_END})`,
      en`lesbians?|bisexual\p{L}*|homosexual\p{L}*|asexual\p{L}*|pansexual\p{L}*`,
      en`transgender|trans (?:man|woman|person|people|girl|guy)`,
      en`${I_AM} non[-\s]?binary|non[-\s]?binary (?:person|people|gender|identity)`,
      en`${I_AM} (?:part of )?(?:the )?lgbt\p{L}*|lgbt\p{L}* community`,
      en`sexual orientation|gender identity`,
      en`(?:coming out|came out|come out) (?:as|to (?:my|his|her|our) (?:parents|family|friends))`,
      en`(?:coming|came) out of the closet`,
      en`sex life|sexual (?:preferences?|partners?|practices|dysfunction)`,
      en`erectile dysfunction|libido`,
      any`bdsm`,
      en`kinky|fetish\p{L}*`,
      en`polyamor\p{L}*|open relationship`,
      uk`(?:я|ми|він|вона|мій|моя) (?:є )?гей`,
      uk`геї|геїв|геєм|гей-пар\p{L}*`,
      uk`лесбі\p{L}*|бісексуал\p{L}*|гомосексуал\p{L}*`,
      uk`трансгендер\p{L}*|транс(?:жінк|чолов)\p{L}*|небінарн\p{L}*`,
      uk`сексуальн\p{L}* орієнтац\p{L}*`,
      uk`камінг-?аут\p{L}*`,
      uk`гендерн\p{L}* ідентичн\p{L}*`,
      uk`сексуальн\p{L}* (?:життя|партнер|уподобан|практик)\p{L}*`,
      uk`інтимн\p{L}* життя`,
      ukRu`бдсм`,
      uk`еректильн\p{L}*|лібідо|фетиш\p{L}*|поліамор\p{L}*`,
      pl`gej(?:a|em|owi|u|ów|ami|ach|e)?${NOT_STREET_PL}`,
      pl`lesbij\p{L}*|biseksual\p{L}*|homoseksual\p{L}*`,
      pl`transpłciow\p{L}*|transseksual\p{L}*|niebinarn\p{L}*`,
      pl`orientacj\p{L}* seksualn\p{L}*`,
      pl`coming[-\s]out`,
      pl`tożsamoś\p{L}* płciow\p{L}*`,
      pl`życi\p{L}* seksualn\p{L}*|partner\p{L}* seksualn\p{L}*|preferencj\p{L}* seksualn\p{L}*`,
      pl`zaburzeni\p{L}* erekcji|libido|fetysz\p{L}*|poliamor\p{L}*`,
      ru`(?:я|мы|он|она|мой|моя|мои|как|стал|является|быть) гей(?:ем|я)?`,
      ru`геи|геев|геям|геями|гей-(?:пар|сообществ|парад)\p{L}*`,
      ru`лесби\p{L}*|бисексуал\p{L}*|гомосексуал\p{L}*`,
      ru`трансгендер\p{L}*|транс(?:жен|мужч)\p{L}*|небинарн\p{L}*`,
      ru`сексуальн\p{L}* ориентац\p{L}*`,
      ru`каминг-?аут\p{L}*`,
      ru`гендерн\p{L}* идентичн\p{L}*`,
      ru`сексуальн\p{L}* (?:жизн|партнер|предпочтен|практик)\p{L}*`,
      ru`интимн\p{L}* жизн\p{L}*`,
      ru`эректильн\p{L}*|либидо|фетиш\p{L}*|полиамор\p{L}*`,
    ],
  },
  {
    category: 'trade-union',
    patterns: [
      en`trade[-\s]unions?|labou?r unions?`,
      en`union (?:member|members|membership|dues|rep|representative|steward|organi[sz]er)`,
      en`unioni[sz]ed|shop steward|collective bargaining`,
      en`(?:teachers?|workers?|nurses?|miners?|drivers?|farmers?|dockers?|pilots?|journalists?)'?s?'? union`,
      en`afl-cio|teamsters`,
      uk`профспілк\p{L}*|профспілков\p{L}*|профком\p{L}*`,
      pl`związk\p{L}* zawodow\p{L}*`,
      pl`związkow(?:iec|c\p{L}*)`,
      pl`nszz|opzz`,
      ru`профсоюз\p{L}*|профком\p{L}*`,
    ],
  },
  {
    category: 'genetic',
    patterns: [
      en`dna[-\s](?:test(?:ing)?|results?|analysis|profile|sample)`,
      en`genetic (?:test(?:ing)?|condition|disorder|disease|mutation|predisposition|screening|marker|history|counsell?ing)`,
      any`brca\d?`,
      en`23andme|ancestry dna`,
      en`hereditary (?:disease|condition|disorder)`,
      en`gene mutation`,
      en`down(?:'s)? syndrome|cystic fibrosis|sickle[-\s]cell|huntington'?s? disease`,
      uk`генетичн\p{L}* (?:тест|аналіз|захворюван|мутац|схильн|розлад|дослідж)\p{L}*`,
      uk`(?:тест\p{L}*|аналіз\p{L}*|результат\p{L}*) днк|днк[-\s]тест\p{L}*`,
      uk`синдром дауна|муковісцидоз\p{L}*|серпоподібноклітинн\p{L}*`,
      pl`genetyczn\p{L}* (?:badan|test|choro|wad|mutac|predyspozyc|obciążen)\p{L}*`,
      pl`(?:test\p{L}*|badani\p{L}*) (?:dna|genetyczn\p{L}*)`,
      pl`zespół downa|mukowiscydoz\p{L}*|anemi\p{L}* sierpowat\p{L}*`,
      ru`генетическ\p{L}* (?:тест|анализ|заболеван|мутаци|предрасположен|расстройств|исследован)\p{L}*`,
      ru`(?:тест\p{L}*|анализ\p{L}*|результат\p{L}*) днк|днк[-\s]тест\p{L}*`,
      ru`синдром дауна|муковисцидоз\p{L}*|серповидноклеточн\p{L}*`,
    ],
  },
  {
    category: 'biometric',
    patterns: [
      en`biometric (?:data|templates?|identifiers?|identification|information|profiles?|scans?|records?)`,
      en`fingerprint (?:data|templates?|records?|databases?|images?)`,
      en`fingerprints? (?:taken|stored|collected|on file)`,
      en`my (?:fingerprints?|face scan|retina scan|iris scan|voiceprint)`,
      en`(?:retina|iris) scans?|voice ?print|palm vein`,
      en`facial (?:geometry|templates?|recognition (?:data|templates?|profiles?))`,
      uk`біометричн\p{L}* (?:дан|ідентифік|шаблон|інформац|відбит|профіл)\p{L}*`,
      uk`дан\p{L}* біометричн\p{L}*`,
      uk`(?:мої|мій|взяли|база) відбитк\p{L}* пальц\p{L}*`,
      uk`скан\p{L}* (?:сітківки|райдужки|обличчя|долоні)`,
      uk`голосов\p{L}* відбитк\p{L}*`,
      pl`biometry\p{L}* (?:dan|identyfik|wzor|szablon)\p{L}*`,
      pl`dan\p{L}* biometryczn\p{L}*`,
      pl`(?:moje|mój|pobrano|pobrali|zapisan\p{L}*|baza) odcisk\p{L}* palc\p{L}*`,
      pl`skan\p{L}* (?:siatkówki|tęczówki|twarzy)`,
      pl`odcisk\p{L}* głosu`,
      ru`биометрическ\p{L}* (?:данн|идентификатор|шаблон|информац|профил)\p{L}*`,
      ru`данн\p{L}* биометрическ\p{L}*`,
      ru`(?:мои|мой|взяли|база) отпечатк\p{L}* пальц\p{L}*`,
      ru`скан\p{L}* (?:сетчатки|радужки|лица|ладони)`,
      ru`голосов\p{L}* отпечат\p{L}*`,
    ],
  },
  {
    category: 'legal-dispute',
    patterns: [
      en`lawsuits?`,
      en`(?:i|we|they|he|she|been|being|got|get|was|am|is) sued|sue (?:my|the|him|her|them|over)|suing`,
      en`court (?:case|hearing|date|order|ruling|summons)`,
      en`custody (?:battle|dispute|case|hearing)`,
      en`divorce (?:proceedings?|case|papers|hearing|lawyer|settlement)`,
      en`legal (?:dispute|battle|proceedings?|action)`,
      en`small claims|subpoena|restraining order`,
      en`(?:charged with|convicted of|criminal case)`,
      uk`судов\p{L}* (?:справ|розгляд|позов|процес|засідан|спір)\p{L}*`,
      uk`позов\p{L}*`,
      uk`су(?:джуся|димося|дяться|диться|дилися|дилася|дився)`,
      uk`кримінальн\p{L}* (?:справ|провадж)\p{L}*`,
      uk`мій адвокат|повістк\p{L}* до суду`,
      pl`pozew|pozw(?:u|em|y|ów|ali|ał|ała|ano|ę)`,
      pl`spraw\p{L}* (?:sądow|karn|rozwodow|cywiln|spadkow|o (?:rozwód|alimenty|opiekę))\p{L}*`,
      pl`rozpraw\p{L}* (?:sądow|karn|rozwodow|cywiln)\p{L}*`,
      pl`(?:mam|moja) rozpraw(?:ę|a|y)(?![-\s]+(?:doktors|naukow|habilit))`,
      pl`postępowani\p{L}* (?:sądow|karn|rozwodow|spadkow)\p{L}*`,
      pl`sąd (?:rodzinny|karny|cywilny|okręgowy|rejonowy)`,
      pl`moj\p{L}* (?:adwokat|prawnik|mecenas)\p{L}*`,
      pl`sądz(?:ę|imy|ymy|i|ą) się z`,
      ru`судебн\p{L}* (?:дел|разбирательств|иск|процесс|заседани|спор)\p{L}*`,
      ru`иск(?:а|у|ом|е|и|ов)?|исков\p{L}* заявлен\p{L}*`,
      ru`подал\p{L}* в суд`,
      ru`су(?:дусь|димся|дятся|дится|дились|дилась|дился)`,
      ru`бракоразводн\p{L}* (?:процесс|дел)\p{L}*|дел\p{L}* о разводе`,
      ru`уголовн\p{L}* дел\p{L}*`,
      ru`мо(?:й|его|я|ей) (?:адвокат|юрист)\p{L}*`,
      ru`повестк\p{L}* в суд`,
    ],
  },
  {
    category: 'drugs',
    patterns: [
      any`mdma`,
      en`cocaine|heroin|marijuana|fentanyl|ketamine|narcotics?`,
      en`cannabis (?:use|user|addiction|smoker|oil)`,
      en`smok\p{L}* (?:weed|pot)`,
      en`methamphetamine|crystal meth|meth (?:addict|use)`,
      en`amphetamine\p{L}*`,
      en`opioid (?:addiction|use|dependence)`,
      en`drug (?:addiction|addict|use|abuse|user|dependence|rehab)`,
      en`recreational drugs?|substance (?:abuse|use disorder)`,
      en`alcoholism|alcohol (?:addiction|abuse|dependence)|recovering alcoholic`,
      en`${I_AM} an alcoholic`,
      en`psilocybin|magic mushrooms|hallucinogens?`,
      ukRu`мдма`,
      uk`кокаїн\p{L}*|героїн\p{L}*|марихуан\p{L}*|канабіс\p{L}*`,
      uk`амфетамін\p{L}*|метамфетамін\p{L}*|фентаніл\p{L}*`,
      uk`наркотик\p{L}*|наркоман\p{L}*|наркозалежн\p{L}*`,
      uk`алкоголізм\p{L}*|алкозалежн\p{L}*|алкоголік\p{L}*`,
      uk`куря\p{L}* (?:траву|марихуан\p{L}*)`,
      pl`kokain\p{L}*|heroin(?:a|y|ę|ie|ą)|marihuan\p{L}*`,
      pl`amfetamin\p{L}*|metamfetamin\p{L}*|fentanyl\p{L}*`,
      pl`narkotyk\p{L}*|narkoman\p{L}*|dopalacz\p{L}*`,
      pl`pal(?:ę|imy|i|ą) (?:trawk\p{L}*|zioło|marihuan\p{L}*|skręt\p{L}*)`,
      pl`uzależnien\p{L}* od (?:narkotyk|alkohol|leków|heroin|kokain)\p{L}*`,
      pl`alkoholizm\p{L}*|alkoholik\p{L}*`,
      ru`кокаин\p{L}*|героин\p{L}*|марихуан\p{L}*|каннабис\p{L}*`,
      ru`амфетамин\p{L}*|метамфетамин\p{L}*|фентанил\p{L}*`,
      ru`наркотик\p{L}*|наркоман\p{L}*|наркозависим\p{L}*`,
      ru`алкоголизм\p{L}*|алкоголик\p{L}*|алкозависим\p{L}*`,
      ru`кур\p{L}* (?:травк|марихуан|косяк)\p{L}*`,
    ],
  },
]

const compiledRules: readonly CompiledSensitiveTextRule[] = sensitiveTextRules
  .map((rule) => {
    const alternatives = rule.patterns
      .map((pattern) => {
        return pattern.source.replaceAll(
          SPACE_PLACEHOLDER,
          SPACE_EXPRESSION,
        )
      })
      .join('|')

    return {
      category: rule.category,
      expression: new RegExp(
        `${WORD_START}(?:${alternatives})${WORD_END}`,
        'u',
      ),
    }
  })

function normalizeSensitiveText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ʼ’‘`´]/g, '\'')
    .replace(/ё/g, 'е')
}

export function classifySensitiveCategories(
  text: string,
): MemorySensitiveCategory[] {
  if (!text) {
    return []
  }

  const normalizedText = normalizeSensitiveText(text)

  return compiledRules
    .filter((rule) => {
      return rule.expression.test(normalizedText)
    })
    .map((rule) => {
      return rule.category
    })
}

export function classifySensitiveText(
  text: string,
): MemorySensitiveCategory | null {
  if (!text) {
    return null
  }

  const normalizedText = normalizeSensitiveText(text)
  const matchedRule = compiledRules.find((rule) => {
    return rule.expression.test(normalizedText)
  })

  return matchedRule?.category ?? null
}
