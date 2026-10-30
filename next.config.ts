import { buildManifest } from './src/lib/home/build';
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

initOpenNextCloudflareForDev();

const nextConfig: NextConfig = { env: { HOME_BUILD_MANIFEST: JSON.stringify(buildManifest(process.cwd())) } };

export default nextConfig;
