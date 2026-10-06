import { expect, test } from "@playwright/test";

/**
 * 正交意图：
 * 1. 原始需求（2026-10-07）：Owner vision 验收发现 >1MB 流式树断链。
 * 2. 通过真实 CodeMirror 输入触发流式路径，并验证虚拟行和展开状态。
 * 3. 保存正常展开态截图，作为 Owner 复核证据。
 */

test("1.3MB 流式 JSON 挂载虚拟树并支持展开收起", async ({ page }) => {
  await page.goto("/app/json-viewer");
  await page.waitForLoadState("networkidle");

  await page.locator(".cm-content").evaluate((editor) => {
    const text = JSON.stringify({
      payload: "x".repeat(1_250_000),
      items: Array.from({ length: 120 }, (_, index) => ({
        key: `fragment-${index}`,
        value: index,
      })),
    });
    if (!(editor instanceof HTMLElement)) throw new Error("CodeMirror editor missing");
    editor.focus();
    if (!document.execCommand("insertText", false, text)) {
      throw new Error("CodeMirror insertText failed");
    }
  });

  await expect(page.getByText(/流式解析/).first()).toBeVisible({ timeout: 10_000 });
  const virtualRows = page.locator(".jv-virtual-row");
  await expect.poll(() => virtualRows.count(), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(virtualRows.filter({ hasText: "payload" }).first()).toBeVisible();
  await expect(virtualRows.filter({ hasText: "items" }).first()).toBeVisible();

  const payloadRowText = await virtualRows.filter({ hasText: "payload" }).first().innerText();
  expect(payloadRowText.length).toBeLessThan(200);

  const expandedCount = await virtualRows.count();
  await page.locator('button[title="收起到第一层"]').click();
  await expect.poll(() => virtualRows.count()).toBeLessThan(expandedCount);

  await page.locator('button[title="展开所有层级"]').click();
  await expect.poll(() => virtualRows.count()).toBeGreaterThan(expandedCount);

  await page.screenshot({
    path: "tests/jules-scratch/json-viewer/shots/p3-streaming-expanded-fixed.png",
  });
});
