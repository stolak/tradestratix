/** Session helpers reserved for offline POS sync queues (Phase 4+). */
export function createIdempotencyKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
