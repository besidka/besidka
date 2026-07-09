import type { ResearchTraceEntry } from '#shared/types/research.d'
import { ulid } from 'ulid'
import { clampResearchTrace } from '~~/server/utils/research/trace'
import type {
  ResearchAdapter,
  ResearchFinalResult,
  ResearchSource,
  ResearchStartResult,
  ResearchStatusResult,
} from '~~/server/utils/research/types.d'

const MOCK_JOB_ID_PATTERN = /^mock_(\d+)_[0-9A-Za-z]+$/
const MOCK_COMPLETION_DELAY_MS = 45_000

const MOCK_SOURCES: ResearchSource[] = [
  {
    sourceId: 'src-0',
    url: 'https://example.com/research/crdt-maturity',
    title: 'Example Labs — CRDT maturity survey',
  },
  {
    sourceId: 'src-1',
    url: 'https://example.com/products/sync-engine',
    title: 'Example Sync — managed sync engines',
  },
  {
    sourceId: 'src-2',
    url: 'https://example.com/reports/offline-retention',
    title: 'Example Metrics — offline retention report',
  },
  {
    sourceId: 'src-3',
    url: 'https://example.com/docs/storage-quotas',
    title: 'Example Docs — browser storage quotas',
  },
]

const MOCK_CURRENT_STEPS: ResearchTraceEntry[] = [
  {
    kind: 'thought',
    text: '**Planning the research** Outlining the key questions before'
      + ' searching.',
  },
  { kind: 'search', text: 'local-first web app 2026 CRDT adoption' },
  { kind: 'read', text: 'https://example.com/research/crdt-maturity' },
  {
    kind: 'thought',
    text: '**Assessing sync backends** Comparing managed sync engines for'
      + ' offline-first apps.',
  },
  { kind: 'search', text: 'offline-first mobile retention data' },
  {
    kind: 'thought',
    text: '**Synthesizing findings** Drafting the trade-offs and'
      + ' recommendations.',
  },
]

const MOCK_TRACE: ResearchTraceEntry[] = [
  {
    kind: 'thought',
    text: 'Clarify the scope: focus on production patterns from'
      + ' 2025-2026, not experimental research.',
  },
  { kind: 'search', text: 'local-first web app 2026 CRDT adoption' },
  { kind: 'read', text: 'https://example.com/research/crdt-maturity' },
  {
    kind: 'thought',
    text: 'CRDT tooling looks mature enough to summarize; check for'
      + ' managed sync backends next.',
  },
  { kind: 'search', text: 'managed sync engine offline-first startups' },
  { kind: 'read', text: 'https://example.com/products/sync-engine' },
  { kind: 'search', text: 'offline-first mobile retention data' },
  { kind: 'read', text: 'https://example.com/reports/offline-retention' },
]

const MOCK_REPORT_TEXT = `> **Mock research report** — generated locally on preview, no provider spend.

# The State of Local-First Web Apps in 2026

## Summary

Local-first architectures continue to gain traction as teams look for
resilience against flaky networks and a snappier editing experience. This
report summarizes publicly discussed patterns, tooling, and trade-offs.

## Key findings

- **CRDTs are maturing.** Libraries such as Automerge and Yjs now ship
  production-ready bindings for popular frameworks, reducing the custom
  conflict-resolution code teams had to write in 2023-2024
  ([Example Labs](https://example.com/research/crdt-maturity)).
- **Sync engines are consolidating.** A handful of hosted sync backends
  (see [Example Sync](https://example.com/products/sync-engine)) now
  offer managed conflict resolution, cutting weeks off greenfield builds.
- **Offline support is a retention lever**, not just a resilience feature —
  teams report meaningfully longer sessions on mobile when writes are
  optimistic and queued locally
  ([Example Metrics](https://example.com/reports/offline-retention)).
- **Storage limits remain the main constraint** on mobile Safari and older
  Android WebViews, pushing teams toward aggressive garbage collection of
  local caches ([Example Docs](https://example.com/docs/storage-quotas)).

## Trade-offs to weigh

1. Local-first shines for single-user or small-team documents; it adds
   real complexity for large shared documents with many concurrent editors.
2. Debugging sync conflicts in production is still harder than debugging a
   traditional request/response API.
3. Bundle size grows: most CRDT libraries add 30-80kB gzipped.

## Suggested next steps

- Prototype a small feature behind a sync engine before committing to a
  full migration.
- Budget extra QA time for conflict scenarios (simultaneous edits, long
  offline periods, clock skew).

## Sources consulted

- [Example Labs — CRDT maturity survey](https://example.com/research/crdt-maturity)
- [Example Sync — managed sync engines](https://example.com/products/sync-engine)
- [Example Metrics — offline retention report](https://example.com/reports/offline-retention)
- [Example Docs — browser storage quotas](https://example.com/docs/storage-quotas)
`

function parseMockStartMs(providerJobId: string): number {
  const match = MOCK_JOB_ID_PATTERN.exec(providerJobId)

  if (!match) {
    throw new Error(`Invalid mock research job id: ${providerJobId}`)
  }

  return Number(match[1])
}

async function start(): Promise<ResearchStartResult> {
  return {
    providerJobId: `mock_${Date.now()}_${ulid()}`,
    status: 'running',
  }
}

async function status(providerJobId: string): Promise<ResearchStatusResult> {
  const startMs = parseMockStartMs(providerJobId)
  const elapsedMs = Date.now() - startMs

  if (elapsedMs >= MOCK_COMPLETION_DELAY_MS) {
    return { status: 'completed' }
  }

  const bucketMs = MOCK_COMPLETION_DELAY_MS / MOCK_CURRENT_STEPS.length
  const stepIndex = Math.min(
    MOCK_CURRENT_STEPS.length - 1,
    Math.floor(elapsedMs / bucketMs),
  )

  return {
    status: 'running',
    currentStep: MOCK_CURRENT_STEPS[stepIndex],
  }
}

async function result(): Promise<ResearchFinalResult> {
  return {
    reportText: MOCK_REPORT_TEXT,
    sources: MOCK_SOURCES,
    usage: {
      inputTokens: 8600,
      outputTokens: 2200,
      totalTokens: 10800,
      toolCalls: 6,
    },
    trace: clampResearchTrace(MOCK_TRACE),
  }
}

async function cancel(): Promise<void> {
  return
}

export const mockResearchAdapter: ResearchAdapter = {
  start,
  status,
  result,
  cancel,
}
