declare module 'evlog' {
  interface BaseWideEvent {
    /**
     * High-variety, low-query-value context (free-form exception messages
     * and stacks, provider/model ids, media types, error-code enums, etc.),
     * namespaced by domain. Declared as an Axiom map field so nesting new
     * attributes here never grows the dataset's schema field count — unlike
     * every other top-level field, which Axiom flattens into its own
     * dotted-path schema entry. See docs/axiom-map-fields.md before adding
     * a new top-level field to a wide event.
     */
    attributes?: Record<string, Record<string, unknown>>
  }
}

export {}
