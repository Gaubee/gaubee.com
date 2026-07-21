/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：搜索必须同时向已注册应用发起异步任务。
 * 2. 将服务的 AsyncIterable 合并为一个可消费的进度流。
 */
import { searchServiceRegistry } from "./registry";
import type {
  SearchBatch,
  SearchProgress,
  SearchQuery,
  SearchService,
  SearchTask,
} from "./types";

interface PendingNext {
  service: SearchService;
  iterator: AsyncIterator<SearchBatch>;
  next: Promise<NextOutcome>;
}

type NextOutcome =
  | {
      type: "result";
      service: SearchService;
      result: IteratorResult<SearchBatch>;
    }
  | { type: "error"; service: SearchService; error: unknown };

function readNext(
  service: SearchService,
  iterator: AsyncIterator<SearchBatch>,
): PendingNext {
  return {
    service,
    iterator,
    next: iterator.next().then(
      (result): NextOutcome => ({ type: "result", service, result }),
      (error: unknown): NextOutcome => ({ type: "error", service, error }),
    ),
  };
}

/** 同时消费符合筛选条件的应用服务。 */
export async function* searchRegisteredServices(
  query: SearchQuery,
  signal: AbortSignal,
): AsyncIterable<SearchProgress> {
  const services = searchServiceRegistry.servicesFor(query);
  const iterators = services.map((service) => ({
    service,
    iterator: service
      .search({ query, signal } satisfies SearchTask)
      [Symbol.asyncIterator](),
  }));

  const pending = iterators.map(({ service, iterator }) =>
    readNext(service, iterator),
  );

  while (pending.length > 0 && !signal.aborted) {
    const settled = await Promise.race(pending.map((entry) => entry.next));
    const index = pending.findIndex(
      (entry) => entry.service === settled.service,
    );
    if (index === -1) continue;
    const [entry] = pending.splice(index, 1);

    if (settled.type === "error") {
      yield {
        type: "service-error",
        appId: entry.service.appId,
        message:
          settled.error instanceof Error
            ? settled.error.message
            : "搜索服务失败",
      };
      continue;
    }

    if (settled.result.done) {
      yield { type: "service-complete", appId: settled.service.appId };
      continue;
    }

    yield { type: "batch", batch: settled.result.value };
    pending.push(readNext(entry.service, entry.iterator));
  }

  yield { type: "complete" };
}
