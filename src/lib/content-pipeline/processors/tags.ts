/**
 * 标签频次处理器。
 *
 * 遍历所有 entry 统计 tags 频次，返回 { tag, count }[] 降序。
 *
 * 替代项目内 3 份重复实现：
 * - src/lib/apps/widget/TagsWidget.svelte 的标签云统计
 * - src/lib/views/TagsView.svelte 的 allTags 派生
 * - src/lib/data/content.svelte.ts 的 allTags getter
 */
import type { TagCount } from "../query.svelte";
import type { ContentEntry, ContentProcessor, ProcessResult } from "../types";

const PROCESSOR_ID = "tags";
const RESULT_TYPE = "tags";

/** 从 entries 计算标签频次（降序）。同名字母序兜底，保证稳定排序。 */
export function computeTagCounts(entries: ContentEntry[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of entry.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** tags 处理器单例。 */
export const tagsProcessor: ContentProcessor = {
  id: PROCESSOR_ID,
  type: RESULT_TYPE,
  process(entries: ContentEntry[]): ProcessResult {
    return {
      id: PROCESSOR_ID,
      type: RESULT_TYPE,
      data: computeTagCounts(entries),
    };
  },
};
