/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：文章目录、短评 Markdown 与应用搜索必须可在真实浏览器使用。
 * 2. 锁定桌面/移动断点下的目录 Sheet、短评展开和 app: 筛选搜索契约。
 */
import { expect, test } from "@playwright/test";

const ARTICLE_PATH = "/article/articles/0054.css-view-transitions-1";

test.describe("内容阅读体验", () => {
  test("桌面文章页显示唯一且完整的标题目录", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(ARTICLE_PATH);

    const toc = page.locator('nav[aria-label="文章目录"]:visible');
    await expect(toc).toHaveCount(1);
    await expect(toc.getByRole("button")).toHaveCount(8);
    await expect(
      toc.getByRole("button", { name: /一、告别刀耕火种/ }),
    ).toBeVisible();
  });

  test("移动端文章目录 Sheet 可定位到正文标题", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto(ARTICLE_PATH);

    await page.getByRole("button", { name: "打开文章目录" }).click();
    const sheet = page.locator('[data-slot="sheet-content"]');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button")).toHaveCount(8);

    await sheet.getByRole("button", { name: /五、定制你的专属转场/ }).click();
    await expect(sheet).toBeHidden();
    await expect
      .poll(() =>
        page.locator(".main-content").evaluate((element) => element.scrollTop),
      )
      .toBeGreaterThan(500);
  });

  test("移动端年份 Sheet 提供全部年份并跳转到历史文章", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/app/articles");
    await expect(page.getByRole("heading", { name: "文章" })).toBeVisible();

    await page.getByRole("button", { name: "按年份浏览文章" }).click();
    const sheet = page.locator('[data-slot="sheet-content"]');
    const years = sheet.getByRole("button");
    await expect(sheet).toBeVisible();
    expect(await years.count()).toBeGreaterThan(1);

    await years.last().click();
    await expect(sheet).toBeHidden();
    await expect
      .poll(() =>
        page.locator(".main-content").evaluate((element) => element.scrollTop),
      )
      .toBeGreaterThan(100);
  });

  test("短评展开后保持 Markdown 表格和详情链接", async ({ page }) => {
    await page.goto("/app/shout");
    await expect(page.getByRole("heading", { name: "说说" })).toBeVisible();

    const expand = page.getByRole("button", { name: "展开全文" }).first();
    await expand.click();

    const shout = page
      .locator("article")
      .filter({ has: page.getByRole("button", { name: "收起" }).first() });
    await expect(shout.getByRole("button", { name: "收起" })).toBeVisible();
    await expect(shout.locator("table").first()).toBeVisible();
    await expect(shout.getByRole("link", { name: "查看详情" })).toHaveAttribute(
      "href",
      /\/article\/events\//,
    );
  });

  test("app:shout 只返回短评应用的搜索结果", async ({ page }) => {
    await page.goto("/app/search");
    const search = page.getByRole("searchbox", { name: "搜索内容" });
    await search.fill("app:shout chrome");

    const results = page.locator('section[aria-label="搜索"] article');
    await expect(results.first()).toBeVisible();
    await expect(results.first()).toContainText("说说");
    await expect(results.first()).toContainText("Chrome");
  });
});
