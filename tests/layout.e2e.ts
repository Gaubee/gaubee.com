import { expect, test } from "@playwright/test";

/**
 * 响应式布局 E2E 测试。
 *
 * 覆盖历史严重 bug：容器查询无法改变容器自身的 flex-direction（浏览器为
 * 避免循环依赖会忽略），加上组件内联 style="display:flex" 覆盖了容器查询的
 * display 切换，导致桌面视口下 sidebar 与 mobile-header 同时显示、app-layout
 * 保持 column 布局。修复：flex-direction 用 @media，display 切换移除内联样式。
 *
 * 本测试确保该 bug 不回归：
 * - 桌面（>=768）：app-layout flex-direction:row、sidebar 显示、mobile 组件隐藏
 * - 移动（<768）：app-layout flex-direction:column、sidebar 隐藏、mobile 组件显示
 */

test.describe("响应式布局切换", () => {
  test("桌面视口（1280）：侧栏显示 + 移动组件隐藏 + 横排", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const layout = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector(".app-layout")!);
      return {
        flexDirection: cs.flexDirection,
        sidebarDisplay: getComputedStyle(
          document.querySelector(".desktop-sidebar")!,
        ).display,
        mobileHeaderDisplay: getComputedStyle(
          document.querySelector(".mobile-header")!,
        ).display,
        mobileTabbarDisplay: getComputedStyle(
          document.querySelector(".mobile-tabbar")!,
        ).display,
        statusDisplay: getComputedStyle(
          document.querySelector(".desktop-status")!,
        ).display,
      };
    });

    // 桌面：横排
    expect(layout.flexDirection).toBe("row");
    // sidebar 与 status 显示
    expect(layout.sidebarDisplay).toBe("flex");
    expect(layout.statusDisplay).toBe("flex");
    // mobile-header / mobile-tabbar 必须隐藏（历史 bug：曾同时显示）
    expect(layout.mobileHeaderDisplay).toBe("none");
    expect(layout.mobileTabbarDisplay).toBe("none");
  });

  test("移动视口（393）：侧栏隐藏 + 移动组件显示 + 竖排", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const layout = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector(".app-layout")!);
      return {
        flexDirection: cs.flexDirection,
        sidebarDisplay: getComputedStyle(
          document.querySelector(".desktop-sidebar")!,
        ).display,
        mobileHeaderDisplay: getComputedStyle(
          document.querySelector(".mobile-header")!,
        ).display,
        mobileTabbarDisplay: getComputedStyle(
          document.querySelector(".mobile-tabbar")!,
        ).display,
        statusDisplay: getComputedStyle(
          document.querySelector(".desktop-status")!,
        ).display,
      };
    });

    // 移动：竖排
    expect(layout.flexDirection).toBe("column");
    // sidebar 与 status 必须隐藏
    expect(layout.sidebarDisplay).toBe("none");
    expect(layout.statusDisplay).toBe("none");
    // mobile-header / mobile-tabbar 显示
    expect(layout.mobileHeaderDisplay).toBe("flex");
    expect(layout.mobileTabbarDisplay).toBe("flex");
  });

  test("桌面视口下组件不重叠（sidebar 在左、主区在右）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const boxes = await page.evaluate(() => {
      const sidebar = document.querySelector(".desktop-sidebar");
      const main = document.querySelector(".main-content");
      if (!sidebar || !main) return null;
      const s = sidebar.getBoundingClientRect();
      const m = main.getBoundingClientRect();
      return {
        sidebar: {
          x: Math.round(s.x),
          y: Math.round(s.y),
          w: Math.round(s.width),
        },
        main: {
          x: Math.round(m.x),
          y: Math.round(m.y),
          w: Math.round(m.width),
        },
      };
    });

    expect(boxes).not.toBeNull();
    if (boxes) {
      // 横排：main 的 x 应在 sidebar 右侧（x >= sidebar.x + sidebar.w）
      expect(boxes.main.x).toBeGreaterThanOrEqual(
        boxes.sidebar.x + boxes.sidebar.w - 1,
      );
      // sidebar 应在视口左侧（x 起点接近 0）
      expect(boxes.sidebar.x).toBeLessThan(50);
    }
  });

  test("桌面视口：bottom 区展开后暗色按钮可点击（历史 bug 回归保护）", async ({
    page,
  }) => {
    // 历史 bug：bottom 区展开后 xterm 溢出覆盖 StatusBar，暗色按钮无法点击
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    // 激活终端 tab
    await page
      .locator('[role="tab"]')
      .filter({ hasText: "终端" })
      .locator("button", { hasText: "终端" })
      .first()
      .click();
    await page.waitForTimeout(1500);

    // xterm 应挂载
    expect(await page.locator(".xterm").count()).toBe(1);

    // 暗色按钮应可点击（不被 xterm 遮挡）
    const toggle = page.getByRole("button", { name: /切换到/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeEnabled();

    // 点击应成功切换主题（验证没有被遮挡）
    const classBefore = await page.evaluate(
      () => document.documentElement.className,
    );
    await toggle.click();
    await page.waitForTimeout(500);
    const classAfter = await page.evaluate(
      () => document.documentElement.className,
    );
    expect(classAfter).not.toBe(classBefore);
  });
});
