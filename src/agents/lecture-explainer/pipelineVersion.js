// ===========================================
// Enrichment pipeline version (single source of truth)
// Bump this whenever the explainer/enhancer logic changes so
// previously-cached EnrichedSegment rows auto-invalidate and
// re-enrich. Kept in its own tiny module so the realtime voice
// worker can import the constant WITHOUT pulling in the heavy
// orchestrator (LLM / explainer deps).
// ===========================================

export const PIPELINE_VERSION = 3;

export default { PIPELINE_VERSION };
