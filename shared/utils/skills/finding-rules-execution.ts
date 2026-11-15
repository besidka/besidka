import type { TextRule } from '#shared/utils/skills/finding-rule-types'

/**
 * Text that would run code, fetch something and run it, change what the
 * machine keeps, or hide code in an encoding. Besidka never runs any of it;
 * the explanations name what Claude Code would do. The patterns have no `\s`
 * and every quantifier on a mixed class is bounded.
 */
export const EXECUTION_TEXT_RULES: ReadonlyArray<TextRule> = [
  {
    rule: 'dynamic-context-inline',
    type: 'execution',
    severity: 'high',
    detail: '!`command`',
    explanation: 'In Claude Code, this line runs a shell command before the skill loads. Besidka never runs it.',
    pattern: /(?:^| )!`[^`]{1,500}`/,
  },
  {
    rule: 'fetch-pipe-run',
    type: 'execution',
    severity: 'high',
    detail: 'download piped into an interpreter',
    explanation: 'Downloads something and hands it straight to a shell or interpreter to run. Besidka never runs it.',
    pattern: /\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^|]{0,300}\| ?(?:sudo )?(?:(?:ba|z|da|k|fi)?sh|python[23]?|node|perl|ruby|php|pwsh|powershell|iex|invoke-expression|source)\b/i,
    quote: 'inline-code',
  },
  {
    rule: 'process-substitution',
    type: 'execution',
    severity: 'high',
    detail: 'shell runs a download',
    explanation: 'A shell reads a script straight from a download and runs it. Besidka never runs it.',
    pattern: /(?:\b(?:ba|z|da)?sh|\bsource|(?:^| )\.) <\( ?(?:curl|wget)\b/i,
    quote: 'inline-code',
  },
  {
    rule: 'command-substitution',
    type: 'execution',
    severity: 'high',
    detail: 'command built from a download',
    explanation: 'Runs the output of a download as code. Besidka never runs it.',
    pattern: /\b(?:eval|(?:ba|z|da)?sh -c|python[23]? -c|node -e|perl -e) ?["']?\$\( ?(?:curl|wget)\b/i,
    quote: 'inline-code',
  },
  {
    rule: 'powershell-cradle',
    type: 'execution',
    severity: 'high',
    detail: 'PowerShell download and run',
    explanation: 'A PowerShell line that downloads or decodes a script and runs it. Besidka never runs it.',
    pattern: /\b(?:iex|invoke-expression)\b ?\(? ?(?:\(? ?new-object [a-z.]{0,40}webclient ?\)? ?\.downloadstring|iwr|irm|invoke-webrequest|invoke-restmethod)\b|\.downloadstring ?\(|\bfrombase64string\b/i,
  },
  {
    rule: 'lolbin',
    type: 'execution',
    severity: 'high',
    detail: 'Windows tool used to download or run code',
    explanation: 'A built-in Windows tool used to fetch or run code from the internet. Besidka never runs it.',
    pattern: /\bcertutil(?:\.exe)? -urlcache\b|\bbitsadmin(?:\.exe)? \/transfer\b|\bmshta(?:\.exe)? https?:|\bregsvr32(?:\.exe)? \/s \/n \/u \/i:https?:/i,
  },
  {
    rule: 'download-chmod',
    type: 'execution',
    severity: 'high',
    detail: 'download, then make it runnable',
    explanation: 'Downloads a file and makes it runnable in the same command. Besidka never runs it.',
    pattern: /\b(?:curl|wget)\b[^;&|]{0,300}(?:&&|;) ?chmod \+x\b/i,
  },
  {
    rule: 'password-archive',
    type: 'execution',
    severity: 'high',
    detail: 'archive with a password',
    explanation: 'Unpacks an archive with a password, which keeps its content from scanners.',
    pattern: /\bunzip (?:[^ ]{1,60} ){0,6}-P ?[^ ]|\b7za? x (?:[^ ]{1,60} ){0,6}-p[^ ]/,
  },
  {
    rule: 'persistence',
    type: 'execution',
    severity: 'high',
    detail: 'keeps something running or logged in',
    explanation: 'Sets up a scheduled task, startup entry or login key so something keeps running or can come back. Besidka never runs it.',
    pattern: /\bcrontab -|\bsystemctl (?:--user )?enable\b|\blaunchctl (?:load|bootstrap)\b|\bschtasks(?:\.exe)? \/create\b|>> ?(?:~|\$HOME)?\/?\.(?:bashrc|zshrc|profile|bash_profile)\b|\bauthorized_keys\b/i,
  },
  {
    rule: 'registry-redirect',
    type: 'execution',
    severity: 'medium',
    detail: 'package source changed',
    explanation: 'Changes where packages are downloaded from, so later installs can come from another server.',
    pattern: /\b(?:npm|yarn|pnpm) config set (?:@[a-z0-9-]{1,40}:)?registry\b|\bnpm_config_registry=|\bpip3? config set global\.(?:extra-)?index-url\b|--(?:extra-)?index-url https?:/i,
  },
  {
    rule: 'decode-call',
    type: 'encoded',
    severity: 'medium',
    detail: 'decodes text',
    explanation: 'Decodes Base64 text, which can hide another command or message.',
    pattern: /\batob ?\(|\bb64decode\b|\bbase64 (?:-d|-D|--decode)\b|\bBuffer\.from\([^)]{0,200}["']base64["']/i,
  },
]
