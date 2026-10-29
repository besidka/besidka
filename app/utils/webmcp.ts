import { agentDiscoveryRoutes } from '~~/config/agent-discovery-routes'

interface KeyGuideSummary {
  path: string
  title: string
}

interface WebMcpToolDependencies {
  origin: string
  listKeyGuides: () => Promise<KeyGuideSummary[]>
  navigate: (path: string) => Promise<void>
}

const GUIDE_PATH_PATTERN = /^\/guides\/[a-z0-9-]+$/
const AUTH_PATHS: readonly string[] = ['/signin', '/signup']
const MARKDOWN_CONTENT_TYPE = 'text/markdown'
const HOME_MARKDOWN_PATH = '/raw/index.md'

export const WEBMCP_CONTENT_PATHS: readonly string[] = agentDiscoveryRoutes
  .map((route) => {
    return typeof route === 'string' ? route : route.path
  })
  .filter((path) => {
    return !path.includes('*')
  })

export function resolveWebMcpModelContext(): WebMcpModelContext | null {
  const modelContext = document.modelContext ?? navigator.modelContext

  if (typeof modelContext?.registerTool !== 'function') {
    return null
  }

  return modelContext
}

export function resolveWebMcpPath(
  input: unknown,
  origin: string,
  extraPaths: readonly string[] = [],
): string | null {
  if (typeof input !== 'string' || !input) {
    return null
  }

  let url: URL

  try {
    url = new URL(input, origin)
  } catch (exception) {
    void exception

    return null
  }

  if (url.origin !== origin) {
    return null
  }

  const path = url.pathname.length > 1
    ? url.pathname.replace(/\/+$/, '')
    : url.pathname

  if (
    WEBMCP_CONTENT_PATHS.includes(path)
    || extraPaths.includes(path)
    || GUIDE_PATH_PATTERN.test(path)
  ) {
    return path
  }

  return null
}

export function getWebMcpMarkdownPath(path: string): string {
  return path === '/' ? HOME_MARKDOWN_PATH : `${path}.md`
}

function requirePath(
  input: Record<string, unknown>,
  origin: string,
  extraPaths: readonly string[] = [],
): string {
  const path = resolveWebMcpPath(input.path, origin, extraPaths)

  if (!path) {
    throw new Error(
      `Unsupported path. Use one of ${[...WEBMCP_CONTENT_PATHS, ...extraPaths]
        .join(', ')} or /guides/<slug>.`,
    )
  }

  return path
}

async function fetchMarkdown(
  path: string,
  origin: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(
    new URL(getWebMcpMarkdownPath(path), origin),
    { headers: { Accept: MARKDOWN_CONTENT_TYPE }, signal },
  )

  if (!response.ok) {
    throw new Error(`Markdown for ${path} is unavailable (${response.status}).`)
  }

  const contentType = response.headers.get('content-type') ?? ''

  if (!contentType.startsWith(MARKDOWN_CONTENT_TYPE)) {
    throw new Error(`Markdown for ${path} is unavailable.`)
  }

  return response.text()
}

export function createWebMcpTools(
  dependencies: WebMcpToolDependencies,
): WebMcpTool[] {
  const { origin, listKeyGuides, navigate } = dependencies
  let keyGuidesRequest: Promise<KeyGuideSummary[]> | null = null

  function loadKeyGuides(): Promise<KeyGuideSummary[]> {
    if (!keyGuidesRequest) {
      keyGuidesRequest = listKeyGuides().catch((exception: unknown) => {
        keyGuidesRequest = null

        throw exception
      })
    }

    return keyGuidesRequest
  }

  return [
    {
      name: 'list_key_guides',
      title: 'List API key guides',
      description: 'List the public step-by-step guides on besidka.com for '
        + 'getting an API key from each supported AI provider. Returns the '
        + 'slug, title and URL of every guide.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute() {
        const guides = await loadKeyGuides()

        return JSON.stringify(guides.map((guide) => {
          return {
            slug: guide.path.split('/').filter(Boolean).pop() ?? '',
            title: guide.title,
            url: new URL(guide.path, origin).toString(),
          }
        }))
      },
    },
    {
      name: 'get_page_markdown',
      title: 'Get page as Markdown',
      description: 'Read a public Besidka page as Markdown. Allowed paths: '
        + `${WEBMCP_CONTENT_PATHS.join(', ')} and /guides/<slug> `
        + '(see list_key_guides for slugs).',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Site path of the page, for example /byok or '
              + '/guides/claude-api-key.',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute(input, { signal }) {
        return fetchMarkdown(requirePath(input, origin), origin, signal)
      },
    },
    {
      name: 'open_page',
      title: 'Open a page',
      description: 'Navigate the current tab to a public Besidka page. '
        + `Allowed paths: ${[...WEBMCP_CONTENT_PATHS, ...AUTH_PATHS].join(', ')}`
        + ' and /guides/<slug>.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Site path to open, for example /signup.',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, consequentialHint: false },
      async execute(input) {
        const path = requirePath(input, origin, AUTH_PATHS)

        await navigate(path)

        return `Opened ${path}.`
      },
    },
  ]
}

export async function registerWebMcpTools(
  modelContext: WebMcpModelContext,
  tools: readonly WebMcpTool[],
  signal: AbortSignal,
): Promise<void> {
  for (const tool of tools) {
    try {
      await modelContext.registerTool(tool, { signal })
    } catch (exception) {
      void exception
    }
  }
}
