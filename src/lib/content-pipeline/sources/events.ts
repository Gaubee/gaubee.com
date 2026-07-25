import type { ContentSource } from "../types";
/**
 * events 内容源：读 src/content/events/*.md，解析为 ContentEntry[]。
 *
 * 替代 readonlyVfs.getPostsByCollection('events') 的读取职责。
 */
import { readCollection } from "./_collection";

export const COLLECTION = "events";
export const PATH_PREFIX = "src/content/events/";

/** events 内容源单例。 */
export const eventsSource: ContentSource = {
  collection: COLLECTION,
  pathPrefix: PATH_PREFIX,
  read(vfs) {
    return readCollection(vfs, { collection: COLLECTION, pathPrefix: PATH_PREFIX });
  },
};
