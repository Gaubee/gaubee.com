import type { ContentSource } from "../types";
/**
 * articles 内容源：读 src/content/articles/*.md，解析为 ContentEntry[]。
 *
 * 替代 readonlyVfs.getPostsByCollection('articles') 的读取职责。
 */
import { readCollection } from "./_collection";

export const COLLECTION = "articles";
export const PATH_PREFIX = "src/content/articles/";

/** articles 内容源单例。 */
export const articlesSource: ContentSource = {
  collection: COLLECTION,
  pathPrefix: PATH_PREFIX,
  read(vfs) {
    return readCollection(vfs, { collection: COLLECTION, pathPrefix: PATH_PREFIX });
  },
};
