/**
 * link.ts 单测（server project：纯逻辑）。
 * 覆盖 classifyLink 边界 + renderLinkTag 输出（含 XSS 转义）。
 */
import { describe, it, expect } from "vitest";

import { classifyLink, renderLinkTag, EXTERNAL_LINK_CLASS, INTERNAL_LINK_ATTR } from "./link";

describe("classifyLink", () => {
  it("识别站内绝对路径为 internal", () => {
    expect(classifyLink("/articles/foo")).toBe("internal");
    expect(classifyLink("/events/bar")).toBe("internal");
    expect(classifyLink("/app/github/owner/repo")).toBe("internal");
    // 根路径：以 / 开头但非 //host，按 internal
    expect(classifyLink("/")).toBe("internal");
  });

  it("识别协议相对 URL 为 external（不是 internal）", () => {
    expect(classifyLink("//host.com/path")).toBe("external");
    expect(classifyLink("//cdn.example.com")).toBe("external");
  });

  it("识别绝对 URL 为 external", () => {
    expect(classifyLink("https://github.com/gaubee")).toBe("external");
    expect(classifyLink("http://example.com")).toBe("external");
    expect(classifyLink("HTTPS://example.com")).toBe("external"); // 大小写不敏感
    expect(classifyLink("mailto:a@b.com")).toBe("external");
    expect(classifyLink("tel:+8613800138000")).toBe("external");
    expect(classifyLink("ftp://files.example.com")).toBe("external");
  });

  it("识别页内锚点为 anchor", () => {
    expect(classifyLink("#section")).toBe("anchor");
    expect(classifyLink("#")).toBe("anchor");
  });

  it("其它（相对路径）归为 other", () => {
    expect(classifyLink("./docs/x.md")).toBe("other");
    expect(classifyLink("x.md")).toBe("other");
    expect(classifyLink("../images/y.png")).toBe("other");
    expect(classifyLink("")).toBe("other");
  });
});

describe("renderLinkTag", () => {
  it("外链：加 target/rel/class", () => {
    const html = renderLinkTag({
      href: "https://github.com/gaubee",
      text: "GitHub",
    });
    expect(html).toContain('href="https://github.com/gaubee"');
    expect(html).toContain(`class="${EXTERNAL_LINK_CLASS}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(">GitHub</a>");
  });

  it("内链：加 data-internal-link，不加 target", () => {
    const html = renderLinkTag({
      href: "/articles/foo",
      text: "文章",
    });
    expect(html).toContain('href="/articles/foo"');
    expect(html).toContain(INTERNAL_LINK_ATTR);
    expect(html).not.toContain("target=");
    expect(html).not.toContain("noopener");
    expect(html).toContain(">文章</a>");
  });

  it("锚点：保持原样", () => {
    const html = renderLinkTag({
      href: "#section",
      text: "跳转",
    });
    expect(html).toBe('<a href="#section">跳转</a>');
  });

  it("title 属性正常附加", () => {
    const html = renderLinkTag({
      href: "https://example.com",
      text: "链接",
      title: "提示",
    });
    expect(html).toContain('title="提示"');
  });

  it("XSS 防护：href 中的双引号被转义", () => {
    const html = renderLinkTag({
      href: 'https://x.com" onmouseover="alert(1)',
      text: "恶意",
    });
    // 注入的双引号必须被转义为 &quot;，避免属性逃逸
    expect(html).not.toContain('onmouseover="alert');
    expect(html).toContain("&quot;");
  });

  it("XSS 防护：title 中的双引号被转义", () => {
    const html = renderLinkTag({
      href: "/safe",
      text: "x",
      title: '" onload="alert(1)',
    });
    expect(html).not.toContain('onload="alert');
    expect(html).toContain("&quot;");
  });

  it("XSS 防护：href 中的尖括号被转义", () => {
    const html = renderLinkTag({
      href: "/x",
      text: "x",
    });
    // 即使 text 含尖括号（外层已 parseInline），href 本身的尖括号要转义
    const malicious = renderLinkTag({
      href: "/x><script>alert(1)</script>",
      text: "x",
    });
    expect(malicious).not.toContain("<script>");
  });
});
