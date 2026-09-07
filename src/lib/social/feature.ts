/** Missing configuration preserves existing installations. New Homes opt in explicitly. */
export function socialPublishingEnabled(value: string | undefined): boolean {
  return value === undefined || value.trim().toLowerCase() === "true";
}

export function socialUnavailable(pathname: string, enabled: boolean): Response | null {
  // Match the API namespace, including encoded paths, without blocking /api/socialize.
  let path = pathname;
  try { path = decodeURIComponent(path); } catch { /* Invalid paths are left to the router. */ }
  if (enabled || (path !== "/api/social" && !path.startsWith("/api/social/"))) return null;
  return Response.json({
    error: "Your social media calendar is off. Ask Simon, your Digital Home Manager, to activate it.",
    code: "SOCIAL_PUBLISHING_DISABLED",
  }, { status: 403, headers: { "Cache-Control": "no-store" } });
}
