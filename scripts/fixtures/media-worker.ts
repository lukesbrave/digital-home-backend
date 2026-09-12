// Isolated integration fixture. Never part of the production worker entrypoint.
import { savePublicImage, servePublicMedia, type MediaEnvironment } from "../../src/lib/media/public-media";
export default {
  async fetch(request: Request, env: MediaEnvironment & { TEST_TOKEN: string }) {
    const served = await servePublicMedia(request, env);
    if (served) return served;
    if (!env.TEST_TOKEN || request.method !== "POST" || request.headers.get("Authorization") !== `Bearer ${env.TEST_TOKEN}`) return new Response(null, { status: 401 });
    try {
      const saved = await savePublicImage(env, await request.arrayBuffer(), "sandbox", new URL(request.url).origin, "website");
      return Response.json(saved);
    } catch (e) { return Response.json({ error: String(e) }, { status: 422 }); }
  },
};
