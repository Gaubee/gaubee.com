/**
 * handleFromHref 单测（2026-10-10 回归：pathname 前导斜杠使 split("/")[0] 恒为空串，
 * 浮卡 handle 恒回退显示名——实证 @divyanshub024 显示「@Divyanshu Bhargava」）。
 */
import { describe, expect, it } from "vitest";

import { handleFromHref } from "./author-hover-card";

describe("handleFromHref", () => {
  it("x.com / twitter.com 链接取路径首段 handle", () => {
    expect(handleFromHref("https://x.com/divyanshub024")).toBe("divyanshub024");
    expect(handleFromHref("https://x.com/dylayed/status/123")).toBe("dylayed");
    expect(handleFromHref("https://twitter.com/jhey")).toBe("jhey");
  });

  it("非法形态回退空串（浮卡再回退显示名）", () => {
    expect(handleFromHref("https://example.com/foo")).toBe("");
    expect(handleFromHref("https://x.com/")).toBe("");
    expect(handleFromHref("not a url")).toBe("");
  });
});
