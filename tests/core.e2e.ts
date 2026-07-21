import { expect, test } from "@playwright/test";

/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：当前 GaubeeOS 应用路由必须由桌面端真实导航覆盖。
 * 2. 验证主区、底栏、主题和深链接在 `/app/*` 路由模型下保持一致。
 */

test.describe("桌面端核心流程", () => {
  test("主区应用 tab 切换 + URL 同步", async ({ page }) => {
    await page.goto("/app/articles");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "文章" })).toBeVisible();
    expect(page.url()).toContain("/app/articles");

    await page
      .getByRole("tab", { name: /说说/ })
      .getByRole("button", { name: "说说", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "说说" })).toBeVisible();
    expect(page.url()).toContain("/app/shout");

    await page
      .getByRole("tab", { name: /文章/ })
      .getByRole("button", { name: "文章", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "文章" })).toBeVisible();
    expect(page.url()).toContain("/app/articles");
  });

  test("根路径 / 能正常渲染（非空白）", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "文章" })).toBeVisible();
    const bodyLen = await page.evaluate(() => document.body.innerText.length);
    expect(bodyLen).toBeGreaterThan(50);
  });

  test("搜索应用在主区激活", async ({ page }) => {
    await page.goto("/app/articles");
    await page.waitForLoadState("networkidle");

    await page
      .getByRole("tab", { name: /搜索/ })
      .getByRole("button", { name: "搜索", exact: true })
      .click();
    await expect(
      page.getByRole("searchbox", { name: "搜索内容" }),
    ).toBeVisible();
    expect(page.url()).toContain("/app/search");
  });

  test("bottom 区激活与收起", async ({ page }) => {
    await page.goto("/app/articles");
    await page.waitForLoadState("networkidle");

    await page
      .getByRole("tab", { name: /Github/ })
      .getByRole("button", { name: "Github", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "Github" })).toBeVisible();
    expect(page.url()).toContain("_b=%2Fapp%2Fgithub");

    await page
      .getByRole("tab", { name: /Github/ })
      .getByRole("button", { name: "Github", exact: true })
      .click();
    expect(page.url()).not.toContain("_b=");
  });

  test("深链接：/tags/article 渲染 TagsView", async ({ page }) => {
    await page.goto("/tags/article");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    // 标签页标题"归档"页不在，TagsView 渲染（内容可能"正在加载"）
    await expect(page.getByRole("heading", { name: /标签/ })).toBeVisible({
      timeout: 5000,
    });
  });

  test("深链接刷新恢复：URL 含当前底栏应用时状态保持", async ({ page }) => {
    await page.goto("/app/articles?_b=%2Fapp%2Fgithub");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Github" })).toBeVisible();
    expect(page.url()).toContain("_b=%2Fapp%2Fgithub");
  });

  test("暗色模式切换", async ({ page }) => {
    await page.goto("/app/articles");
    await page.waitForLoadState("networkidle");

    const htmlClassBefore = await page.evaluate(
      () => document.documentElement.className,
    );
    const toggle = page.getByRole("button", { name: /切换到/ });
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      await page.waitForTimeout(500);
      const htmlClassAfter = await page.evaluate(
        () => document.documentElement.className,
      );
      expect(htmlClassAfter).not.toBe(htmlClassBefore);
    }
  });

  test("侧栏折叠", async ({ page }) => {
    await page.goto("/app/articles");
    await page.waitForLoadState("networkidle");

    const collapseBtn = page.getByRole("button", { name: "折叠侧栏" });
    if (await collapseBtn.isVisible().catch(() => false)) {
      await collapseBtn.click();
      await page.waitForTimeout(500);
      // 展开按钮出现
      await expect(page.getByRole("button", { name: "展开侧栏" })).toBeVisible({
        timeout: 2000,
      });
    }
  });
});
