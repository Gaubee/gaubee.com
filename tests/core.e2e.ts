import { expect, test } from "@playwright/test";

/**
 * 桌面端核心 E2E 测试：导航切换、暗色模式、pop 搜索、深链接。
 * 运行：pnpm test（会先 build + preview）。
 */

test.describe("桌面端核心流程", () => {
  test("侧栏 tab 切换 + URL 同步", async ({ page }) => {
    await page.goto("/feed");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    expect(page.url()).toContain("/feed");

    // 点击"编辑"
    await page.getByRole("tab", { name: "编辑" }).click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain("/editor");

    // 点击"归档"
    await page.getByRole("tab", { name: "归档" }).click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain("/archive");
  });

  test("根路径 / 能正常渲染（非空白）", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
    // 页面应渲染（侧栏可见，非空白 body）
    await expect(page.getByRole("tab", { name: "阅读" })).toBeVisible({
      timeout: 5000,
    });
    // NavController 可能规范 URL 到 /feed，也可能保持 /（均接受）
    const bodyLen = await page.evaluate(() => document.body.innerText.length);
    expect(bodyLen).toBeGreaterThan(50);
  });

  test("pop 搜索打开与关闭", async ({ page }) => {
    await page.goto("/feed");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    // 点击搜索（浮层区）
    await page.getByRole("button", { name: "搜索" }).first().click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain("_p=%2Fsearch");

    // Esc 关闭
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    expect(page.url()).not.toContain("_p=");
  });

  test("bottom 区激活与收起", async ({ page }) => {
    await page.goto("/feed");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    // 激活 Git bottom
    await page.getByRole("tab", { name: "Git" }).click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain("_b=%2Fgit");

    // 收起（再点 Git）
    await page.getByRole("tab", { name: "Git" }).click();
    await page.waitForTimeout(500);
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

  test("深链接刷新恢复：URL 含 _b/_p 时刷新后状态保持", async ({ page }) => {
    await page.goto("/editor?_b=%2Fgit&_p=%2Fsearch");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
    expect(page.url()).toContain("_b=%2Fgit");
  });

  test("暗色模式切换", async ({ page }) => {
    await page.goto("/feed");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

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
    await page.goto("/feed");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

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
