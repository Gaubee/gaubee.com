/**
 * Agent 测试：用假 LanguageModel/session 驱动 JSON 决策循环。
 *
 * 覆盖：先 search_site 再 final、工具结果回灌、4 轮强制收敛、解析失败重试、AbortSignal。
 * 不依赖真实浏览器 AI。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSearchAgent, FALLBACK_ANSWER, type AgentSource, type AgentStatus } from "./agent";

interface FakeSession {
  prompt: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

function installFakeLanguageModel(responses: string[]): FakeSession {
  const queue = [...responses];
  const prompt = vi.fn(async () => {
    if (queue.length > 1) return queue.shift() ?? "";
    return queue[0] ?? "{}";
  });
  const destroy = vi.fn();
  const session: FakeSession = { prompt, destroy };
  vi.stubGlobal("LanguageModel", {
    availability: vi.fn(async () => "available"),
    create: vi.fn(async () => session),
  });
  return session;
}

function installSearchFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      results: [
        {
          id: "src/content/articles/0001.rust.md",
          appId: "articles",
          appName: "文章",
          title: "Rust 文章",
          excerpt: "一篇关于 Rust 的文章",
          href: "/article/articles/0001.rust",
          date: 1_700_000_000_000,
          score: 1,
        },
      ],
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSearchAgent", () => {
  it("无 LanguageModel 时拒绝创建", async () => {
    vi.stubGlobal("LanguageModel", undefined);
    await expect(createSearchAgent()).rejects.toThrow("当前浏览器不支持内置 AI");
  });

  it("先 search_site 再 final，并把 TOOL_RESULT 追加回会话", async () => {
    const session = installFakeLanguageModel([
      '{"action":"search_site","args":{"query":"rust"}}',
      '```json\n{"action":"final","answer":"有一篇 Rust 文章"}\n```',
    ]);
    const fetchMock = installSearchFetch();
    const statuses: AgentStatus[] = [];
    const sourceSnapshots: AgentSource[][] = [];

    const agent = await createSearchAgent({
      onStatus: (status) => statuses.push(status),
      onSources: (sources) => sourceSnapshots.push([...sources]),
    });
    const answer = await agent.runTurn("找 rust 文章");

    expect(answer).toBe("有一篇 Rust 文章");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(session.prompt).toHaveBeenCalledTimes(2);
    expect(statuses).toContain("searching");

    const secondInput = String(session.prompt.mock.calls[1]?.[0]);
    expect(secondInput).toContain("TOOL_RESULT");
    expect(secondInput).toContain("Rust 文章");
    expect(sourceSnapshots.at(-1)?.[0]?.href).toBe("/article/articles/0001.rust");

    agent.destroy();
    expect(session.destroy).toHaveBeenCalledTimes(1);
    agent.destroy();
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it("超过 4 轮会强制收敛，不再执行工具", async () => {
    const searchDecision = '{"action":"search_site","args":{"query":"rust"}}';
    const session = installFakeLanguageModel(Array.from({ length: 10 }, () => searchDecision));
    const fetchMock = installSearchFetch();

    const agent = await createSearchAgent();
    const answer = await agent.runTurn("一直搜索");

    expect(answer).toBe(FALLBACK_ANSWER);
    expect(session.prompt).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const lastOptions = session.prompt.mock.calls[3]?.[1] as
      | { responseConstraint?: unknown }
      | undefined;
    expect(lastOptions?.responseConstraint).toBeDefined();
  });

  it("解析失败时重试一次，仍失败返回兜底文案", async () => {
    const retrySession = installFakeLanguageModel([
      "这不是 JSON",
      '{"action":"final","answer":"ok"}',
    ]);
    const retryAgent = await createSearchAgent();
    await expect(retryAgent.runTurn("你好")).resolves.toBe("ok");
    expect(retrySession.prompt).toHaveBeenCalledTimes(2);
    expect(String(retrySession.prompt.mock.calls[1]?.[0])).toContain("无法解析");

    const failedSession = installFakeLanguageModel(["坏输出 A", "坏输出 B"]);
    const failedAgent = await createSearchAgent();
    await expect(failedAgent.runTurn("你好")).resolves.toBe(FALLBACK_ANSWER);
    expect(failedSession.prompt).toHaveBeenCalledTimes(2);
  });

  it("已取消的 AbortSignal 不调用模型", async () => {
    const session = installFakeLanguageModel(['{"action":"final","answer":"ok"}']);
    const agent = await createSearchAgent();
    const controller = new AbortController();
    controller.abort();

    await expect(agent.runTurn("你好", controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(session.prompt).not.toHaveBeenCalled();
  });
});
