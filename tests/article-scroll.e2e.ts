/**
 * E2E：文章详情页滚动测试。
 * 复现 + 验证修复：文章详情（深链接 view）内容溢出但无滚动容器。
 *
 * 场景：桌面 → 点文章图标 → 列表 → 点第一篇 → 详情页 → 验证可滚动。
 */
import { test, expect } from "@playwright/test";

test.describe("文章详情页滚动", () => {
  test("详情页内容可垂直滚动", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    // 桌面点「文章」图标
    await page.getByRole("main").getByRole("button", { name: "文章" }).click();
    await page.waitForTimeout(1000);

    // 点第一篇文章进详情
    const firstArticle = page
      .locator('[data-article-list-content] a, [data-article-list-content] button')
      .first();
    await firstArticle.click();
    await page.waitForTimeout(1500);

    // 确认进入详情页
    expect(page.url()).toContain("/article/");

    // 找到可滚动的容器（深链接 view 的包裹层或 AppShell）
    // 验证：页面中有 scrollHeight > clientHeight 且 overflow 允许滚动的元素
    const scrollInfo = await page.evaluate(() => {
      const results: Array<{ cls: string; scrollH: number; clientH: number; canScroll: boolean }> = [];
      for (const el of document.querySelectorAll<HTMLElement>("*")) {
        if (el.offsetWidth === 0 && el.offsetHeight === 0) continue;
        const s = getComputedStyle(el);
        if (s.visibility === "hidden") continue;
        const canY = (s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight;
        if (canY) {
          results.push({
            cls: (el.className || "").toString().slice(0, 50),
            scrollH: el.scrollHeight,
            clientH: el.clientHeight,
            canScroll: true,
          });
        }
      }
      return results;
    });

    // 至少有一个可滚动的容器承载文章内容
    expect(
      scrollInfo.length,
      `文章详情页应有可滚动容器，但找到: ${JSON.stringify(scrollInfo)}`,
    ).toBeGreaterThan(0);

    // 验证实际可滚动（scrollTop 能变化）
    const scrollable = scrollInfo[0];
    const contentHeight = scrollable.scrollH;
    const viewportHeight = scrollable.clientH;
    expect(contentHeight, "文章内容应高于视口").toBeGreaterThan(viewportHeight);
  });

  test("滚动后文章内容跟随移动", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    await page.getByRole("main").getByRole("button", { name: "文章" }).click();
    await page.waitForTimeout(1000);

    const firstArticle = page
      .locator('[data-article-list-content] a, [data-article-list-content] button')
      .first();
    await firstArticle.click();
    await page.waitForTimeout(1500);

    // 找可滚动容器并滚动
    const scrolled = await page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>("*")) {
        if (el.offsetWidth === 0 && el.offsetHeight === 0) continue;
        const s = getComputedStyle(el);
        if (s.visibility === "hidden") continue;
        const canY = (s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight;
        if (canY && el.scrollHeight > el.clientHeight + 100) {
          el.scrollTop = 500;
          return { before: 0, after: el.scrollTop, scrollH: el.scrollHeight };
        }
      }
      return null;
    });

    expect(scrolled, "应找到可滚动容器并成功滚动").not.toBeNull();
    expect(scrolled!.after, "scrollTop 应从 0 变为 500").toBe(500);
  });
});
