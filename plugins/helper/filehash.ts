import { map_get_or_put_async } from "@gaubee/util";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

const fileHashCache = new Map<string, string>();
/**
 * 根据文件路径和修改时间生成一个稳定的哈希值
 */
export const getFileHash = (filePath: string) => {
  return map_get_or_put_async(fileHashCache, filePath, async () => {
    const hash = createReadStream(filePath).pipe(createHash("sha256"));
    const job = Promise.withResolvers<void>();
    hash.on("finish", job.resolve);
    hash.on("error", job.reject);
    await job.promise;
    return hash.digest("hex").slice(0, 16);
  });
};
