import { integer } from 'drizzle-orm/sqlite-core'
import { publicId } from './public-id'

export const defaultSchemaIdOnly = {
  // @TODO: Custom type doesn't work with auto-increment
  // https://github.com/drizzle-team/drizzle-orm/issues/818#issuecomment-2960199129
  // id: publicId().primaryKey({ autoIncrement: true }),
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
}

export const defaultSchemaPublicIdOnly = {
  id: publicId().primaryKey(),
}

export const defaultSchemaCreatedAtOnly = {
  createdAt: integer({ mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
}

export const defaultSchemaTimestamps = {
  ...defaultSchemaCreatedAtOnly,
  updatedAt: integer({ mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
}

export const defaultSchema = {
  ...defaultSchemaIdOnly,
  ...defaultSchemaTimestamps,
}
export const defaultSchemaWithPublicId = {
  ...defaultSchemaPublicIdOnly,
  ...defaultSchemaTimestamps,
}
