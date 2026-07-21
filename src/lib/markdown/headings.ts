/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：长文章目录必须在桌面和移动端可靠定位。
 * 2. 以与 Markdown 渲染器完全相同的 GFM 规则产出标题 ID。
 */
import { marked } from "marked";
import {
  getHeadingList,
  gfmHeadingId,
  type HeadingData,
} from "marked-gfm-heading-id";

let headingIdsConfigured = false;

/** 为全站 Markdown 渲染器安装一次 GitHub 风格的标题 ID 规则。 */
export function configureMarkdownHeadingIds(): void {
  if (headingIdsConfigured) return;
  marked.use(gfmHeadingId());
  headingIdsConfigured = true;
}

/** 可用作阅读目录的 Markdown 标题。 */
export interface MarkdownHeading {
  level: number;
  text: string;
  id: string;
}

/**
 * 从 Markdown 提取渲染后标题。
 *
 * `marked-gfm-heading-id` 在解析时重置 slugger，因此此结果与同一 Markdown
 * 实际生成的 `id` 保持一致，包含重复标题的 `-1` 后缀规则。
 */
export function extractMarkdownHeadings(markdown: string): MarkdownHeading[] {
  configureMarkdownHeadingIds();
  marked.parse(markdown, { async: false });

  return getHeadingList()
    .filter((heading: HeadingData) => heading.level >= 2 && heading.level <= 3)
    .map((heading: HeadingData) => ({
      level: heading.level,
      text: heading.raw,
      id: heading.id,
    }));
}
