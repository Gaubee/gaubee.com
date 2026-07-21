import { expect, test } from "@playwright/test";

/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：移动端应用导航须覆盖当前 `/app/*` 路由。
 * 2. 验证顶栏、底栏和抽屉中的应用切换可用。
 */

test.describe("移动端布局", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
  });

  test("竖排布局 + 顶栏 + 底栏", async ({ page }) => {
    await page.goto("/app/articles");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    // 移动端顶栏（汉堡菜单）可见
    await expect(page.getByRole("button", { name: "打开菜单" })).toBeVisible({
      timeout: 5000,
    });

    // 底部 tab bar 可见
    await expect(page.locator('nav[aria-label="主导航"]')).toBeVisible({
      timeout: 5000,
    });
  });

  test("抽屉导航打开与切换", async ({ page }) => {
    await page.goto("/app/articles");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    await page.getByRole("button", { name: "打开菜单" }).click();
    await page.waitForTimeout(500);
    // 抽屉标题"导航"可见
    await expect(page.getByText("导航", { exact: true })).toBeVisible({
      timeout: 3000,
    });

    // 点抽屉里的"说说"（在抽屉 sheet 内）
    const drawer = page.locator('[data-slot="sheet-content"]');
    await drawer.getByRole("button", { name: "说说" }).click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain("/app/shout");
  });
});
