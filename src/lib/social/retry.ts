/**
 * Return the calendar slot to store when a post is explicitly published or
 * retried right now.
 *
 * Failed/partial posts have already been approved and attempted. Their
 * `scheduled_at` value is historical intent and must remain immutable; the
 * target timestamps record the retry and actual platform completion times.
 * Draft/scheduled/canceled posts are deliberate "publish now" actions, so
 * their slot becomes the current time.
 */
export function scheduledAtForImmediateAttempt(
  post: { status: string; scheduled_at: string | null },
  nowIso: string
): string {
  if (["failed", "partial"].includes(post.status) && post.scheduled_at) {
    return post.scheduled_at;
  }
  return nowIso;
}
