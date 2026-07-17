import { expect, test } from "@playwright/test";

/**
 * 移动端 E2E 测试。
 * 通过 playwright.config.ts 的 projects 配置 iPhone 14 Pro viewport（如未配，这里用 page.setViewportSize）。
 */

test.describe("移动端布局", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
  });

  test("竖排布局 + 顶栏 + 底栏", async ({ page }) => {
    await page.goto("/feed");
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
    await page.goto("/feed");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    await page.getByRole("button", { name: "打开菜单" }).click();
    await page.waitForTimeout(500);
    // 抽屉标题"导航"可见
    await expect(page.getByText("导航", { exact: true })).toBeVisible({
      timeout: 3000,
    });

    // 点抽屉里的"编辑"（在抽屉 sheet 内）
    const drawer = page.locator('[data-slot="sheet-content"]');
    await drawer.getByRole("button", { name: "编辑" }).click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain("/editor");
  });
});
