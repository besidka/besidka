import { z } from 'zod'
import { ARTIFACT_KINDS, ARTIFACT_TITLE_MAX } from '#shared/utils/artifacts'
import { buildMcpArtifactContext } from '~~/server/utils/mcp/private/artifact-context'
import {
  MCP_ARTIFACT_CONTENT_MAX_CHARS,
  createMcpArtifact,
} from '~~/server/utils/mcp/private/artifacts'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  kind: z
    .enum(ARTIFACT_KINDS)
    .describe('html: one self-contained HTML document with inline CSS and '
      + 'JS; react: one JSX module whose default export is a component; '
      + 'svg: one SVG image; mermaid: one Mermaid diagram; markdown: a '
      + 'Markdown document'),
  title: z
    .string()
    .trim()
    .min(1)
    .max(ARTIFACT_TITLE_MAX)
    .describe(`A short title, up to ${ARTIFACT_TITLE_MAX} characters`),
  content: z
    .string()
    .min(1)
    .max(MCP_ARTIFACT_CONTENT_MAX_CHARS)
    .describe('The full content, up to '
      + `${MCP_ARTIFACT_CONTENT_MAX_CHARS} characters`),
}

type CreateArtifactInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'create_artifact',
  title: 'Create an artifact',
  description: 'Save content you wrote as a new Besidka artifact (version 1) '
    + 'in your library and return its id and a link to open it in Besidka. '
    + 'Artifacts run in a sandbox without network access, so the content '
    + 'must be self-contained. It counts against your artifact storage and '
    + 'uses none of your API keys. React artifacts need the React artifacts '
    + 'feature. Requires signing in (artifacts:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'create_artifact',
    async (input: CreateArtifactInput, context) => {
      const result = await createMcpArtifact(
        buildMcpArtifactContext(context),
        input,
      )

      context.log({
        artifact_id: result.id,
        artifact_kind: input.kind,
        text_bytes: new TextEncoder().encode(input.content).byteLength,
      })

      return result
    },
  ),
})
