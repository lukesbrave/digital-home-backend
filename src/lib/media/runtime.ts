import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { MediaEnvironment } from "./public-media";
export function mediaEnvironment(): MediaEnvironment {
  return getCloudflareContext().env as MediaEnvironment;
}
