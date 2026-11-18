import { z } from 'zod'
import { createError } from 'evlog'
import { deleteAllConnectorImages } from '~~/server/utils/files/connector-images'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const inputSchema = {
  confirm: z
    .literal(true)
    .describe('Must be true. Only set it after the user agreed to delete '
      + 'every connector image'),
}

type DeleteConnectorImagesInput = z.infer<z.ZodObject<typeof inputSchema>>

export const deleteConnectorImagesBesidkaTool = defineBesidkaTool({
  name: 'delete_connector_images',
  title: 'Delete connector images',
  description: 'Permanently delete every image your connectors returned in '
    + 'chats (for example screenshots) that Besidka kept with those chats. '
    + 'They are not in your file library and count toward your storage. '
    + 'The chats stay; their steps show the images as deleted. Up to 270 '
    + 'images are deleted per call: when hasMore is true, call again. '
    + 'Requires signing in (data:delete).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'delete',
  chat: {
    excluded: 'Deleting every connector image is a Storage page action, '
      + 'not something a chat model should start.',
  },
  handler: async (input: DeleteConnectorImagesInput, context) => {
    if (input.confirm !== true) {
      throw createError({
        status: 400,
        message: 'Set confirm to true to delete connector images.',
      })
    }

    const result = await deleteAllConnectorImages(
      context.db,
      context.userId,
      context.logger,
    )

    context.log({
      deleted_count: result.deleted,
      failed_count: result.failed,
    })

    return result
  },
})
