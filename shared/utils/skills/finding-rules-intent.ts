import { API_KEY_PREFIX_ALTERNATIVES } from '#shared/utils/secret-patterns'
import type {
  RuleRefinement,
  TextRule,
} from '#shared/utils/skills/finding-rule-types'
import type { SkillFindingSeverity } from '#shared/utils/skills/findings'

const LINK_URL_PATTERN = /https?:\/\/[^)\s>]{1,500}/i
const LINK_OPENING_PATTERN = /\] ?\( ?<?$/
const PLACEHOLDER_NAME_PATTERN
  = /\{\{? ?([A-Za-z_][\w.-]{0,40})|\$\{([A-Za-z_]\w{0,40})|\$([A-Z_]{2,40})|<([a-z_]{1,40})>/g
const SENSITIVE_PLACEHOLDER_PATTERN
  = /key|token|secret|password|conversation|history|memory|summary/i
const LINK_LOOKBEHIND_CHARACTERS = 8
const PLACEHOLDER_LOOKAHEAD_CHARACTERS = 60

const HARDCODED_SECRET_PATTERN = new RegExp(
  [
    '\\bAKIA[0-9A-Z]{16}\\b',
    '\\bgh[pousr]_[A-Za-z0-9]{36}\\b',
    '\\bgithub_pat_[A-Za-z0-9_]{40,}\\b',
    '\\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\\b',
    '\\bxox[abprs]-[A-Za-z0-9-]{10,}\\b',
    '\\bAIza[0-9A-Za-z_-]{35}\\b',
    '-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----',
    `(?<![A-Za-z0-9])(?:${API_KEY_PREFIX_ALTERNATIVES.join('|')})`,
  ].join('|'),
  'u',
)

function readHostname(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname
  } catch {
    return null
  }
}

function refineImageHost(
  match: RegExpExecArray,
  prefix: string,
): RuleRefinement {
  const rawUrl = LINK_URL_PATTERN.exec(match[0])?.[0]
  const hostname = rawUrl ? readHostname(rawUrl) : null

  return { detail: hostname ? `${prefix}${hostname}` : null }
}

function refineTemplatedUrl(
  match: RegExpExecArray,
  text: string,
): RuleRefinement {
  const before = text.slice(
    Math.max(0, match.index - LINK_LOOKBEHIND_CHARACTERS),
    match.index,
  )
  const urlText = text.slice(
    match.index,
    match.index + match[0].length + PLACEHOLDER_LOOKAHEAD_CHARACTERS,
  )
  const hasSensitiveName = [...urlText.matchAll(PLACEHOLDER_NAME_PATTERN)]
    .some((placeholder) => {
      return SENSITIVE_PLACEHOLDER_PATTERN.test(
        placeholder[1] ?? placeholder[2] ?? placeholder[3] ?? placeholder[4]
        ?? '',
      )
    })
  const isInsideLink = LINK_OPENING_PATTERN.test(before)
  const severity: SkillFindingSeverity = hasSensitiveName || isInsideLink
    ? 'high'
    : 'low'

  return {
    severity,
    detail: isInsideLink
      ? 'variable in a link address'
      : hasSensitiveName
        ? 'variable named like private data'
        : 'variable in a web address',
  }
}

/**
 * Text that asks the assistant to send data out, take over its role, keep
 * something from the user or collect secrets, and links that lead somewhere
 * risky. They are highlights to read, not a verdict. Cisco's concealment,
 * unrestricted-mode, reveal-system and environment-dump signatures inspired
 * several rows (Apache-2.0).
 */
export const INTENT_TEXT_RULES: ReadonlyArray<TextRule> = [
  {
    rule: 'markdown-image-query',
    type: 'exfiltration',
    severity: 'high',
    detail: 'image address carries data',
    explanation: 'An image link with data in its address. A client that loads the image sends that data to the host in the link.',
    pattern: /!\[[^\]]{0,200}\] ?\( ?<?https?:\/\/[^)\s]{1,500}[?&][^)\s=&]{1,100}=[^)\s]{0,500}\)/i,
    refine: (match) => {
      return refineImageHost(match, 'sends text to ')
    },
  },
  {
    rule: 'markdown-image-external',
    type: 'exfiltration',
    severity: 'medium',
    detail: 'image from another site',
    explanation: 'An image loaded from another site. Whoever runs that site sees when the image is loaded.',
    pattern: /!\[[^\]]{0,200}\] ?\( ?<?https?:\/\//i,
    supersededBy: 'markdown-image-query',
    refine: (match, text) => {
      const rest = text.slice(match.index + match[0].length - 8)
      const rawUrl = /https?:\/\/[^)\s>]{1,500}/i.exec(rest)?.[0]
      const hostname = rawUrl ? readHostname(rawUrl) : null

      return { detail: hostname ?? null }
    },
  },
  {
    rule: 'templated-url',
    type: 'exfiltration',
    severity: 'low',
    detail: 'variable in a web address',
    explanation: 'A web address with a placeholder in it. When a placeholder names private data, or the address is a link, the filled-in address can send that data out.',
    pattern: /https?:\/\/[^\s)"'`]{1,300}?(?:\{\{?|\$\{|\$[A-Z_]{2,40}|<[a-z_]{1,40}>|%s)/i,
    refine: refineTemplatedUrl,
  },
  {
    rule: 'injection-override',
    type: 'injection',
    severity: 'high',
    detail: 'override of earlier instructions',
    explanation: 'Asks the assistant to ignore or override its earlier instructions or rules.',
    pattern: /\b(?:ignore|disregard|forget|override|bypass) (?:all |any |the |your |of )?(?:previous|prior|above|earlier|preceding|system|safety|original|existing)(?: [a-z]{1,20})? (?:instructions?|rules|guidelines|prompts?|context|directives|messages?|constraints|policies|restrictions)\b/i,
    quote: 'quotes',
    catalogRaise: true,
  },
  {
    rule: 'role-hijack',
    type: 'role',
    severity: 'high',
    detail: 'changes the assistant role',
    explanation: 'Tells the assistant it is now in another mode or has new rules, which is how its role gets taken over.',
    pattern: /\byou are now (?:in |an? |the )?(?:unrestricted|jailbroken|developer|debug|admin|god|dan)\b|\b(?:developer|dan|god|jailbreak|unrestricted) mode\b|\bfrom now on,? you (?:are|will|must)\b|\bnew (?:system )?instructions ?:/i,
    quote: 'quotes',
    catalogRaise: true,
  },
  {
    rule: 'fake-role-tag',
    type: 'role',
    severity: 'high',
    detail: 'looks like a system tag',
    explanation: 'Text that looks like a system or assistant message tag, to make it read as an instruction from above.',
    pattern: /<\/? ?(?:system|assistant|im_start|im_end|important|admin|developer|system[-_]?prompt)(?![\w-])[^>]{0,40}>|<\|im_(?:start|end)\|>|\[\/?(?:system|inst)\]/i,
    quote: 'quotes',
    catalogRaise: true,
  },
  {
    rule: 'authority-claim',
    type: 'role',
    severity: 'high',
    detail: 'claims to come from above',
    explanation: 'Claims to speak for a vendor, the system or the developers, or to outrank what the user says.',
    pattern: /\b(?:this|these) (?:message|instructions?|rules?) (?:comes?|is|are) from (?:anthropic|openai|google|the system|the developers?|besidka|your (?:administrator|developer|creator))\b|\btakes? precedence over (?:all |any )?(?:other|previous|prior|user|system)\b/i,
    quote: 'quotes',
    catalogRaise: true,
  },
  {
    rule: 'concealment',
    type: 'concealment',
    severity: 'high',
    detail: 'keeps something from the user',
    explanation: 'Asks the assistant to keep something from you.',
    pattern: /\b(?:do not|don't|never) (?:tell|inform|mention|notify|alert|show|reveal|disclose) (?:the )?user (?:about|that you|what you|you (?:ran|used|sent|read))\b|\b(?:do not|don't|never) (?:tell|inform|mention|notify|alert|show|reveal|disclose) (?:it|this|that|these) to (?:the )?user\b|\bwithout (?:telling|informing|asking|notifying|alerting) (?:the )?user\b|\bhide (?:this|that|it|these|them) from (?:the )?user\b|\b(?:secretly|covertly)\b/i,
    quote: 'quotes',
    catalogRaise: true,
  },
  {
    rule: 'concealment-soft',
    type: 'concealment',
    severity: 'medium',
    detail: 'tells the assistant not to tell the user',
    explanation: 'Tells the assistant not to tell you something. This is often prompt-writing advice, so check the context.',
    pattern: /\b(?:do not|don't|never) (?:tell|inform|mention|notify|alert|show|reveal|disclose) (?:the )?user\b/i,
    quote: 'quotes',
    catalogRaise: true,
    supersededBy: 'concealment',
  },
  {
    rule: 'no-confirm',
    type: 'concealment',
    severity: 'medium',
    detail: 'skips asking you',
    explanation: 'Tells the assistant not to ask you before it acts, or to carry on whatever you say.',
    pattern: /\b(?:do not|don't|never) ask (?:the user )?(?:for )?(?:permission|confirmation|approval)\b|\bregardless of (?:what )?the user (?:says|asks|wants)\b/i,
    quote: 'quotes',
    catalogRaise: true,
  },
  {
    rule: 'system-prompt-extraction',
    type: 'injection',
    severity: 'medium',
    detail: 'asks for the system prompt',
    explanation: 'Asks the assistant to print its hidden instructions.',
    pattern: /\b(?:reveal|print|repeat|output|show|dump|leak) (?:me )?(?:your|the) (?:full |entire |hidden |initial )?(?:system prompt|system message|initial instructions|hidden instructions)\b/i,
    quote: 'quotes',
    catalogRaise: true,
  },
  {
    rule: 'secret-harvest',
    type: 'credential',
    severity: 'high',
    detail: 'asks for keys or credentials',
    explanation: 'Asks the assistant to print, send or collect your keys, tokens, passwords or credentials.',
    pattern: /\b(?:print|echo|show|display|output|reveal|dump|send|paste|tell me|give me|upload|exfiltrate)\b(?: [^ ]{1,30}){0,3} (?:your|all|every|the user'?s) (?:[a-z]{1,20} )?(?:api[ _-]?keys?|secret keys?|access tokens?|bearer tokens?|tokens|passwords?|credentials|private keys?|session cookies?|cookies|environment variables|env vars)\b/i,
    quote: 'quotes',
    catalogRaise: true,
  },
  {
    rule: 'secret-mention',
    type: 'credential',
    severity: 'medium',
    detail: 'mentions keys or credentials',
    explanation: 'Mentions handling keys, tokens, passwords or credentials. Often API documentation.',
    pattern: /\b(?:print|echo|show|display|output|reveal|list|dump|cat|send|include|paste|collect|upload)\b(?: [^ ]{1,30}){0,4} (?:the |my )?(?:api[ _-]?keys?|secret keys?|access tokens?|bearer tokens?|passwords?|credentials?|private keys?|session cookies?|environment variables|env vars)\b/i,
    catalogRaise: true,
    supersededBy: 'secret-harvest',
  },
  {
    rule: 'env-dump',
    type: 'credential',
    severity: 'medium',
    detail: 'prints all environment variables',
    explanation: 'Prints every environment variable, which often holds keys.',
    pattern: /(?:^|[;&|] ?|\$\( ?)(?:printenv|env|export -p|declare -x)(?: ?$| ?[|>;)])|\bos\.environ(?:\.copy ?\(|\.items ?\()|\bJSON\.stringify ?\( ?process\.env\b|\b(?:gci|get-childitem|ls|dir) env:/i,
  },
  {
    rule: 'credential-path',
    type: 'credential',
    severity: 'high',
    detail: 'file that holds credentials',
    explanation: 'Names a file or store that holds credentials, such as cloud keys, SSH keys, saved passwords or wallets.',
    pattern: /(?:~|\$HOME|%USERPROFILE%)?\/?\.(?:aws\/credentials|kube\/config|docker\/config\.json|netrc|npmrc|pypirc|git-credentials|gnupg|config\/gcloud)\b|\bid_(?:rsa|ed25519|ecdsa|dsa)\b|\/etc\/shadow\b|\bsecurity find-(?:generic|internet)-password\b|\bLogin Data\b|\bwallet\.dat\b/i,
  },
  {
    rule: 'hardcoded-secret',
    type: 'credential',
    severity: 'medium',
    detail: 'looks like a real key',
    explanation: 'Text in the format of a real key or private key. It is shown with most of it hidden.',
    pattern: HARDCODED_SECRET_PATTERN,
    maskMatch: true,
  },
]

export const EXFILTRATION_SEND_RULE = {
  rule: 'exfiltration-send',
  type: 'exfiltration',
  explanation: 'A line that sends something sensitive, such as messages, files or keys, to an address.',
} as const

export const SEND_VERB_PATTERN
  = /\b(?:send|post|upload|forward|transmit|exfiltrate|leak|submit|sync|beacon)\b/i
export const SENSITIVE_OBJECT_PATTERN
  = /\b(?:conversation|chat history|transcript|messages|memory|files?|documents?|credentials?|api keys?|tokens?|secrets?|passwords?|environment variables|cookies|personal data)\b/i
export const EMAIL_PATTERN
  = /\b[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}\b/i

export const HARDCODED_SECRET_MASK_PATTERN = new RegExp(
  HARDCODED_SECRET_PATTERN.source,
  'gu',
)
