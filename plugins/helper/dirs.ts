import { createResolverByRootFile } from "@gaubee/nodekit";

// --- 配置 ---
export const rootResolver = createResolverByRootFile(import.meta.url);
export const PUBLIC_NAME = "public";
export const PUBLIC_DIR = rootResolver(PUBLIC_NAME);
