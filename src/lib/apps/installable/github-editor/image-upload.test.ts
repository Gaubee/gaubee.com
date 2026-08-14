/**
 * GithubEditor image-upload 纯函数单元测试（server project）。
 *
 * 重点验证：fileToBase64（剥离 data: 前缀）、generateImageFilename、joinPath、
 * buildImageMarkdown、pickFirstImage / hasImageFiles 事件提取。
 * 不测 uploadImageAsAsset / uploadImageToVfs（依赖网络 + VFS runes，属集成测试范畴）。
 */
import { describe, expect, it, vi } from "vitest";

const {
  fileToBase64,
  generateImageFilename,
  joinPath,
  buildImageMarkdown,
  pickFirstImage,
  hasImageFiles,
} = await import("./image-upload");

/** 安装一个假的 FileReader，readAsDataURL 同步触发 onload，result 为预设值。 */
function installFakeFileReader(result: unknown) {
  const orig = globalThis.FileReader;
  class FakeFileReader {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    result: unknown = result;
    readAsDataURL() {
      // 异步触发 onload（模拟真实行为）
      queueMicrotask(() => this.onload?.());
    }
    readAsArrayBuffer() {
      queueMicrotask(() => this.onload?.());
    }
  }
  globalThis.FileReader = FakeFileReader as unknown as typeof FileReader;
  return () => {
    globalThis.FileReader = orig;
  };
}

describe("fileToBase64 — 剥离 data: 前缀", () => {
  it("从 readAsDataURL 结果中提取纯 base64", async () => {
    const restore = installFakeFileReader("data:image/png;base64,aGVsbG8=");
    try {
      const b64 = await fileToBase64(new File([], "x.png"));
      expect(b64).toBe("aGVsbG8=");
    } finally {
      restore();
    }
  });

  it("无逗号时返回原结果（降级处理）", async () => {
    const restore = installFakeFileReader("noPrefixHere");
    try {
      const b64 = await fileToBase64(new File([], "x.png"));
      expect(b64).toBe("noPrefixHere");
    } finally {
      restore();
    }
  });

  it("非字符串结果 → 抛错", async () => {
    const restore = installFakeFileReader(new ArrayBuffer(0));
    try {
      await expect(fileToBase64(new File([], "x.png"))).rejects.toThrow(/非字符串结果/);
    } finally {
      restore();
    }
  });
});

describe("generateImageFilename — 文件名生成", () => {
  it("保留原扩展名", () => {
    const name = generateImageFilename(new File([], "photo.jpg"));
    expect(name).toMatch(/^\d+-[a-z0-9]+\.jpg$/);
  });

  it("无扩展名默认 png", () => {
    const name = generateImageFilename(new File([], "screenshot"));
    expect(name.endsWith(".png")).toBe(true);
  });

  it("仅点号无扩展名默认 png", () => {
    const name = generateImageFilename(new File([], "."));
    expect(name.endsWith(".png")).toBe(true);
  });
});

describe("joinPath — 路径拼接", () => {
  it("dir + filename", () => {
    expect(joinPath("assets", "img.png")).toBe("assets/img.png");
  });

  it("空 dir → 根目录", () => {
    expect(joinPath("", "img.png")).toBe("img.png");
  });

  it("去首尾斜杠", () => {
    expect(joinPath("/assets/images/", "img.png")).toBe("assets/images/img.png");
  });
});

describe("buildImageMarkdown", () => {
  it("有描述", () => {
    expect(buildImageMarkdown("https://x.com/i.png", "my photo")).toBe(
      "![my photo](https://x.com/i.png)",
    );
  });

  it("空描述默认 'image'", () => {
    expect(buildImageMarkdown("https://x.com/i.png", "")).toBe("![image](https://x.com/i.png)");
  });
});

describe("pickFirstImage / hasImageFiles", () => {
  // File 构造：第 3 参数 options.type 设置 MIME（Node 20+ 的 undici File 支持）
  function makeFile(name: string, type: string): File {
    return new File([new Uint8Array([1])], name, { type });
  }

  function makeDragEvent(files: File[]): DragEvent {
    return {
      dataTransfer: { files },
    } as unknown as DragEvent;
  }

  it("hasImageFiles：含图片 → true", () => {
    const e = makeDragEvent([makeFile("a.png", "image/png")]);
    expect(hasImageFiles(e)).toBe(true);
  });

  it("hasImageFiles：仅文本文件 → false", () => {
    const e = makeDragEvent([makeFile("a.md", "text/markdown")]);
    expect(hasImageFiles(e)).toBe(false);
  });

  it("hasImageFiles：无 dataTransfer → false", () => {
    expect(hasImageFiles({} as DragEvent)).toBe(false);
  });

  it("pickFirstImage：返回首个图片", () => {
    const img = makeFile("a.png", "image/png");
    const e = makeDragEvent([makeFile("b.md", "text/markdown"), img]);
    expect(pickFirstImage(e)).toBe(img);
  });

  it("pickFirstImage：无图片 → null", () => {
    const e = makeDragEvent([makeFile("a.md", "text/markdown")]);
    expect(pickFirstImage(e)).toBeNull();
  });
});
