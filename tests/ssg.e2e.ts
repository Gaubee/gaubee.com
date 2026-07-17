import { expect, test } from "@playwright/test";

/**
 * SSG 阅读站 E2E 测试。
 * 验证 /pages/* 路由的 SEO、内容渲染、互链。
 * 关键：禁用 JS 后内容仍可见（no-JS 友好）。
 */

test.describe("SSG 阅读站", () => {
  test("首页 feed 渲染文章列表", async ({ page }) => {
    await page.goto("/pages", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "阅读" })).toBeVisible();
    // 应有多篇文章标题（h2）
    const articles = page.locator("article h2 a");
    expect(await articles.count()).toBeGreaterThan(10);
  });

  test("文章详情页含完整正文（SEO）", async ({ page }) => {
    await page.goto("/pages/article/articles/0060.ai-lifeform", {
      waitUntil: "networkidle",
    });
    // title 与 h1
    await expect(page).toHaveTitle(/AI 生命体/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "AI 生命体",
    );
    // SEO meta
    const desc = await page
      .locator('meta[name="description"]')
      .getAttribute("content");
    expect(desc?.length).toBeGreaterThan(50);
    // 正文段落（prose 区域）
    const prose = page.locator(".prose");
    const proseText = await prose.textContent();
    expect(proseText?.length).toBeGreaterThan(500);
  });

  test("互链：SSG 文章页有'在编辑器打开'链接", async ({ page }) => {
    await page.goto("/pages/article/articles/0060.ai-lifeform", {
      waitUntil: "networkidle",
    });
    // 文章 header 与页脚各有一个"在编辑器打开"链接，用 first 取 header 的
    const links = page.locator('a:has-text("在编辑器打开")');
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(1);
    const href = await links.first().getAttribute("href");
    expect(href).toContain("/editor/articles/0060.ai-lifeform");
  });

  test("raw markdown 端点返回 text/markdown", async ({ request }) => {
    const resp = await request.get("/pages/raw/articles/0060.ai-lifeform.md");
    expect(resp.status()).toBe(200);
    const contentType = resp.headers()["content-type"] ?? "";
    expect(contentType).toContain("text/markdown");
    const body = await resp.text();
    expect(body).toContain("title:");
    expect(body).toContain("AI 生命体");
  });

  test("标签页列出带该标签的文章", async ({ page }) => {
    await page.goto("/pages/tags/article", { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: /标签：article/ }),
    ).toBeVisible();
    // 应有文章链接
    const links = page.locator('a[href*="/pages/article/"]');
    expect(await links.count()).toBeGreaterThan(0);
  });

  test("归档页按年月分组", async ({ page }) => {
    await page.goto("/pages/archive", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "归档" })).toBeVisible();
    // 应有月份分组标题（h2）
    const months = page.locator("section h2");
    expect(await months.count()).toBeGreaterThan(0);
  });
});

test.describe("SSG no-JS 友好（禁用 JS）", () => {
  test.use({ javaScriptEnabled: false });

  test("禁用 JS 后文章页仍显示正文", async ({ page }) => {
    await page.goto("/pages/article/articles/0060.ai-lifeform");
    await page.waitForLoadState("domcontentloaded");
    // SSG 预渲染的 HTML 应直接包含内容，无需 JS
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toContainText("AI 生命体", { timeout: 5000 });
    const proseText = await page.locator(".prose").textContent();
    expect(proseText?.length).toBeGreaterThan(500);
  });

  test("禁用 JS 后首页仍有文章列表", async ({ page }) => {
    await page.goto("/pages");
    await page.waitForLoadState("domcontentloaded");
    const articles = page.locator("article");
    expect(await articles.count()).toBeGreaterThan(5);
  });
});
