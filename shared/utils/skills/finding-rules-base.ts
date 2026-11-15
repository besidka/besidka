import type { TextRule } from '#shared/utils/skills/finding-rule-types'

function hasRecursiveForceFlags(match: RegExpExecArray): boolean {
  const flags = match[1]!.toLowerCase()

  return flags.includes('r') && flags.includes('f')
}

/**
 * The first rule set: single words and short phrases that are worth a note
 * on their own. Most are low, because the word alone is prose or a common
 * command far more often than an attack.
 */
export const BASE_TEXT_RULES: ReadonlyArray<TextRule> = [
  {
    rule: 'shell-curl',
    type: 'shell',
    severity: 'low',
    detail: 'curl',
    explanation: 'A curl command downloads or sends data. Besidka never runs it.',
    pattern: /\bcurl\b/i,
  },
  {
    rule: 'shell-wget',
    type: 'shell',
    severity: 'low',
    detail: 'wget',
    explanation: 'A wget command downloads files. Besidka never runs it.',
    pattern: /\bwget\b/i,
  },
  {
    rule: 'shell-pipe-to-shell',
    type: 'shell',
    severity: 'low',
    detail: '| sh',
    explanation: 'Text is piped into a shell. Besidka never runs it.',
    pattern: /\| ?(?:sudo )?(?:ba|z|da)?sh\b/i,
  },
  {
    rule: 'shell-shell-c',
    type: 'shell',
    severity: 'medium',
    detail: 'bash -c',
    explanation: 'A shell is asked to run a string as a command. Besidka never runs it.',
    pattern: /\b(?:ba|z|da)?sh -c\b/i,
  },
  {
    rule: 'shell-sudo',
    type: 'shell',
    severity: 'low',
    detail: 'sudo',
    explanation: 'A command that asks for administrator rights. Besidka never runs it.',
    pattern: /\bsudo\b/i,
  },
  {
    rule: 'shell-chmod-x',
    type: 'shell',
    severity: 'low',
    detail: 'chmod +x',
    explanation: 'A command that makes a file runnable. Besidka never runs it.',
    pattern: /\bchmod \+x\b/i,
  },
  {
    rule: 'shell-eval',
    type: 'shell',
    severity: 'low',
    detail: 'eval',
    explanation: 'The word eval, which can run text as code. Often just prose.',
    pattern: /\beval\b/i,
  },
  {
    rule: 'shell-base64-decode',
    type: 'shell',
    severity: 'medium',
    detail: 'base64 -d',
    explanation: 'A command that decodes Base64 text, which can hide another command.',
    pattern: /\bbase64 (?:-d|--decode)\b/i,
    supersededBy: 'decode-call',
  },
  {
    rule: 'shell-pip-install',
    type: 'shell',
    severity: 'low',
    detail: 'pip install',
    explanation: 'A command that installs a Python package. Besidka never runs it.',
    pattern: /\bpip3? install\b/i,
  },
  {
    rule: 'shell-npm-install',
    type: 'shell',
    severity: 'low',
    detail: 'npm i',
    explanation: 'A command that installs a Node package. Besidka never runs it.',
    pattern: /\bnpm (?:i|install)\b/i,
  },
  {
    rule: 'shell-powershell-encoded',
    type: 'shell',
    severity: 'medium',
    detail: 'powershell -enc',
    explanation: 'A PowerShell command that takes an encoded script, which hides what it does.',
    pattern: /\bpowershell(?:\.exe)? (?:[^ ]{1,40} ){0,8}-e(?:nc|ncodedcommand)?\b/i,
  },
  {
    rule: 'shell-rm-recursive-force',
    type: 'shell',
    severity: 'medium',
    detail: 'rm -rf',
    explanation: 'A command that deletes files and folders without asking. Besidka never runs it.',
    pattern: /\brm((?: -[a-z]+)+)/i,
    accept: hasRecursiveForceFlags,
  },
  {
    rule: 'injection-system-prompt',
    type: 'injection',
    severity: 'low',
    detail: 'system prompt',
    explanation: 'The words system prompt. Usually prose about prompts.',
    pattern: /\bsystem prompt\b/i,
    supersededBy: 'system-prompt-extraction',
  },
  {
    rule: 'secret-api-key',
    type: 'secret',
    severity: 'low',
    detail: 'API_KEY',
    explanation: 'A mention of an API key variable. The text does not hold a key.',
    pattern: /API_KEY\b/,
  },
  {
    rule: 'secret-env-file',
    type: 'secret',
    severity: 'low',
    detail: '.env',
    explanation: 'A mention of a .env file, which often holds keys.',
    pattern: /(?:^|[\s"'`(=/])\.env(?:\.[a-z]{1,12})?(?![\w-])/,
  },
  {
    rule: 'secret-ssh-path',
    type: 'secret',
    severity: 'medium',
    detail: '~/.ssh',
    explanation: 'A mention of the folder that holds SSH keys.',
    pattern: /~\/\.ssh\b/,
    quote: 'quotes',
  },
]
