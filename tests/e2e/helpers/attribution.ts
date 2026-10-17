import { execFileSync } from 'node:child_process'

const LOCAL_D1_BINDING = 'DB'
const WRANGLER_TIMEOUT_MS = 30_000

export interface UserAttributionRow {
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
}

interface WranglerD1Result {
  results: UserAttributionRow[]
}

function parseWranglerJson(output: string): WranglerD1Result[] {
  const lines = output.split('\n')

  for (let start = 0; start < lines.length; start++) {
    if (!lines[start].startsWith('[')) {
      continue
    }

    for (let end = lines.length; end > start; end--) {
      if (!lines[end - 1].trimEnd().endsWith(']')) {
        continue
      }

      try {
        return JSON.parse(
          lines.slice(start, end).join('\n'),
        ) as WranglerD1Result[]
      } catch {
        continue
      }
    }
  }

  throw new Error(`No JSON array found in wrangler output: ${output}`)
}

export function readUserAttributionByEmail(
  email: string,
): UserAttributionRow | null {
  const query = [
    'SELECT a.utm_source, a.utm_medium, a.utm_campaign, a.utm_content',
    'FROM user_attribution a',
    'JOIN users u ON u.id = a.user_id',
    `WHERE u.email = '${email.replaceAll('\'', '\'\'')}'`,
  ].join(' ')
  const output = execFileSync('pnpm', [
    'exec',
    'wrangler',
    'd1',
    'execute',
    LOCAL_D1_BINDING,
    '--local',
    '--json',
    '--command',
    query,
  ], {
    encoding: 'utf8',
    timeout: WRANGLER_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const [result] = parseWranglerJson(output)

  return result?.results[0] ?? null
}
