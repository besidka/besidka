/**
 * Provider key formats shared by the memory never-store check and the skill
 * highlights. The list has no whitespace-run quantifier, so it is safe on an
 * untrusted line. Every alternative needs a prefix that is not part of a
 * longer word, which the callers add as a lookbehind.
 */
export const API_KEY_PREFIX_ALTERNATIVES: readonly string[] = [
  'sk-[A-Za-z0-9_-]{20,}',
  'AIza[A-Za-z0-9_-]{35}',
  'AQ\\.[A-Za-z0-9_-]{30,}',
  'gh[pousr]_[A-Za-z0-9]{30,}',
  'github_pat_[A-Za-z0-9_]{40,}',
  'xox[abprs]-[A-Za-z0-9-]{10,}',
  '(?:AKIA|ASIA)[A-Z0-9]{16}',
  '(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}',
  'xai-[A-Za-z0-9]{30,}',
  'gsk_[A-Za-z0-9]{30,}',
  'hf_[A-Za-z0-9]{30,}',
  'npm_[A-Za-z0-9]{36}',
  'glpat-[A-Za-z0-9_-]{20,}',
  'vck_[A-Za-z0-9]{20,}',
  'BSA[A-Za-z0-9_-]{20,}',
  'SG\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}',
]

export const BEARER_TOKEN_ALTERNATIVE = '[Bb]earer\\s+[A-Za-z0-9._~+/=-]{20,}'
