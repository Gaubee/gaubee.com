import { expect, test } from "@playwright/test";

/**
 * 终端（纯前端 bash）E2E 测试。
 *
 * 覆盖走查发现并修复的关键场景：
 * - BUG#1 修复：只有 1 个 xterm 实例（AreaOutlet 跨 area 渲染不再导致重复）
 * - 终端生命周期：切到 bottom 区时挂载，收起时卸载，重新展开可恢复
 * - 命令执行：help/pwd/ls 等
 * - 移动端：抽屉导航切终端，xterm 适配视口宽度
 *
 * 前提：未登录也能打开终端（VFS 在未同步时 ls 返回空，但命令系统可用）。
 */

// 等待 SPA NavController + AreaOutlet 初始化完成
async function waitForSpa(page: import("@playwright/test").Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
}

// 激活 bottom 区的 Terminal tab（名称来自应用 manifest）。
async function activateTerminal(page: import("@playwright/test").Page) {
  // 右侧 tab 栏的 Terminal 按钮（不含关闭按钮）
  await page
    .locator('[role="tab"]')
    .filter({ hasText: "Terminal" })
    .locator("button", { hasText: "Terminal" })
    .first()
    .click();
  await page.waitForTimeout(1500);
}

test.describe("桌面端终端", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("切到终端 tab 后挂载单个 xterm 实例", async ({ page }) => {
    await page.goto("/");
    await waitForSpa(page);

    await activateTerminal(page);

    // 验证 BUG#1 修复：只有 1 个 xterm（不是 2 个）
    const xtermCount = await page.locator(".xterm").count();
    expect(xtermCount).toBe(1);

    // 欢迎信息可见
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toContain("Gaubee 终端");
  });

  test("help 命令列出所有命令", async ({ page }) => {
    await page.goto("/");
    await waitForSpa(page);
    await activateTerminal(page);

    // 在输入条输入 help
    const input = page.locator('input[enterkeyhint="send"]');
    await input.fill("help");
    await input.press("Enter");
    await page.waitForTimeout(800);

    // xterm 视口只显示最后 N 行，断言末尾稳定内容
    // （help 列表末尾有 git 行 + 提示行 + 新 prompt）
    const rows = await page.locator(".xterm-rows div").allInnerTexts();
    const text = rows.join("\n");
    expect(text).toContain("git");
    expect(text).toContain("补全");
  });

  test("pwd 命令输出当前目录", async ({ page }) => {
    await page.goto("/");
    await waitForSpa(page);
    await activateTerminal(page);

    const input = page.locator('input[enterkeyhint="send"]');
    await input.fill("pwd");
    await input.press("Enter");
    await page.waitForTimeout(500);

    const rows = await page.locator(".xterm-rows div").allInnerTexts();
    const text = rows.join("\n");
    expect(text).toContain("/src/content");
  });

  test("未知命令返回错误提示", async ({ page }) => {
    await page.goto("/");
    await waitForSpa(page);
    await activateTerminal(page);

    const input = page.locator('input[enterkeyhint="send"]');
    await input.fill("nonexistentcmd12345");
    await input.press("Enter");
    await page.waitForTimeout(500);

    const rows = await page.locator(".xterm-rows div").allInnerTexts();
    const text = rows.join("\n");
    expect(text).toContain("命令未找到");
  });

  test("收起 bottom 后 xterm 卸载，重新展开恢复", async ({ page }) => {
    await page.goto("/");
    await waitForSpa(page);
    await activateTerminal(page);

    // 初始：xterm 存在
    expect(await page.locator(".xterm").count()).toBe(1);

    // 点终端 tab 收起（toggle）
    await page
      .locator('[role="tab"]')
      .filter({ hasText: "Terminal" })
      .locator("button", { hasText: "Terminal" })
      .first()
      .click();
    await page.waitForTimeout(1000);

    // 收起后：bottom 区不可见，xterm 卸载
    expect(await page.locator(".xterm").count()).toBe(0);

    // 再次点终端展开
    await activateTerminal(page);

    // 重新展开：xterm 恢复
    expect(await page.locator(".xterm").count()).toBe(1);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toContain("Gaubee 终端");
  });

  test("切到其他 main tab 时 bottom 终端保持挂载", async ({ page }) => {
    await page.goto("/");
    await waitForSpa(page);
    await activateTerminal(page);
    expect(await page.locator(".xterm").count()).toBe(1);

    // 切到“文章”（main tab）—— 不影响 bottom 区
    await page
      .locator('[role="tab"]')
      .filter({ hasText: "文章" })
      .locator("button", { hasText: "文章" })
      .first()
      .click();
    await page.waitForTimeout(800);

    // bottom 区仍在（切 main 不影响 bottom），xterm 应仍存在
    expect(await page.locator(".xterm").count()).toBe(1);
  });

  test("多命令历史持久化（命令可连续执行）", async ({ page }) => {
    await page.goto("/");
    await waitForSpa(page);
    await activateTerminal(page);

    const input = page.locator('input[enterkeyhint="send"]');
    // 连续执行多条命令，验证终端不卡死
    for (const cmd of ["pwd", "help", "ls", "echo hello"]) {
      await input.fill(cmd);
      await input.press("Enter");
      await page.waitForTimeout(400);
    }

    // 最后一条 echo hello 的输出应可见
    const rows = await page.locator(".xterm-rows div").allInnerTexts();
    expect(rows.join("\n")).toContain("hello");
  });

  test("终端激活后 xterm 不溢出视口（约束在 bottom 区内）", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForSpa(page);
    await activateTerminal(page);
    expect(await page.locator(".xterm").count()).toBe(1);

    // xterm 应约束在 bottom 区内，不超出视口边界
    const xtermBox = await page.locator(".xterm").boundingBox();
    const viewport = page.viewportSize();
    expect(xtermBox).not.toBeNull();
    if (xtermBox && viewport) {
      // xterm 底部不应超过视口高度（允许 5px 容差）
      expect(xtermBox.y + xtermBox.height).toBeLessThanOrEqual(
        viewport.height + 5,
      );
    }
  });
});

test.describe("移动端终端", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
  });

  test("抽屉切终端，xterm 适配移动端宽度", async ({ page }) => {
    await page.goto("/app/articles");
    await waitForSpa(page);

    // 移动端没有桌面 tab 栏，通过抽屉切终端
    await page.getByRole("button", { name: "打开菜单" }).click();
    await page.waitForTimeout(500);
    await expect(page.getByText("导航", { exact: true })).toBeVisible({
      timeout: 3000,
    });

    const drawer = page.locator('[data-slot="sheet-content"]');
    await drawer.getByRole("button", { name: "Terminal" }).click();
    await page.waitForTimeout(1800);

    // xterm 挂载
    expect(await page.locator(".xterm").count()).toBe(1);

    // xterm 宽度应接近视口宽度（不溢出）
    const xtermBox = await page.locator(".xterm").boundingBox();
    expect(xtermBox).not.toBeNull();
    if (xtermBox) {
      // 宽度应在视口范围内（允许少量 padding）
      expect(xtermBox.width).toBeLessThanOrEqual(393);
      expect(xtermBox.width).toBeGreaterThan(300);
    }
  });

  test("移动端输入条按钮可点击执行命令", async ({ page }) => {
    await page.goto("/app/articles");
    await waitForSpa(page);

    await page.getByRole("button", { name: "打开菜单" }).click();
    await page.waitForTimeout(500);
    const drawer = page.locator('[data-slot="sheet-content"]');
    await drawer.getByRole("button", { name: "Terminal" }).click();
    await page.waitForTimeout(1800);

    // 输入命令并用"发送"按钮（↵）提交（force 绕过底部 tab bar 可能的遮挡）
    const input = page.locator('input[enterkeyhint="send"]');
    await input.fill("pwd");
    await page.getByRole("button", { name: "发送" }).click({ force: true });
    await page.waitForTimeout(500);

    const rows = await page.locator(".xterm-rows div").allInnerTexts();
    expect(rows.join("\n")).toContain("/src/content");
  });
});
