import * as schema from '~~/server/db/schema'

// Returns the inserted { id, publicId } row, OR `undefined` when
// `ignoreConflict` is set and the public_id already existed (ON CONFLICT DO
// NOTHING inserts no row, so `.get()` yields undefined). Callers that pass
// `ignoreConflict: true` must not assume a row came back.
export async function insertMessageWithPublicId(input: {
  db: ReturnType<typeof useDb>
  values: typeof schema.messages.$inferInsert
  publicId: string
  ignoreConflict?: boolean
}) {
  const insert = input.db
    .insert(schema.messages)
    .values({
      ...input.values,
      publicId: input.publicId,
    })

  // Belt-and-suspenders idempotency for issue #263. The in-memory duplicate
  // scan reads a single chat snapshot, so two near-simultaneous retries of the
  // same user message (before either commits, and before any assistant reply
  // exists to replay) could both pass it. ON CONFLICT DO NOTHING keeps this a
  // single atomic statement (preserving the #205/#207 fix — no insert-then-
  // update) and guarantees a duplicate public_id can never again surface as a
  // message-persist-failed 500. It does NOT serialize the racing requests: the
  // losing one no-ops here and still streams its own assistant, so that rare
  // window can leave a second assistant row (no error, no data loss) rather
  // than a 500. Closing that fully would need a lock/transaction, which is not
  // worth it for D1 at this probability. Scoped to the public_id target so an
  // unrelated constraint still throws. Only the user-message insert opts in;
  // the assistant insert keeps strict behavior so a genuine DB failure still
  // surfaces loudly.
  const statement = input.ignoreConflict
    ? insert.onConflictDoNothing({ target: schema.messages.publicId })
    : insert

  return await statement
    .returning({
      id: schema.messages.id,
      publicId: schema.messages.publicId,
    })
    .get()
}
