/**
 * 内容管道插件注册表（单例）。
 *
 * 仿 widgetRegistry / settingsSectionsRegistry 模式：
 * AppManager 在 install/init 时把 manifest.contentPipeline 投影进来，
 * pipelineExecutor 遍历所有已注册 source + processor 执行。
 *
 * 注意：source 按 collection 去重（一个集合只能有一个 source）；
 * processor 按 id 去重。
 */
import type { ContentProcessor, ContentSource } from "./types";

class ContentPipelineRegistry {
  private readonly sources = new Map<string, ContentSource>();
  private readonly processors = new Map<string, ContentProcessor>();

  registerSource(source: ContentSource): void {
    this.sources.set(source.collection, source);
  }

  unregisterSource(collection: string): void {
    this.sources.delete(collection);
  }

  registerProcessor(processor: ContentProcessor): void {
    this.processors.set(processor.id, processor);
  }

  unregisterProcessor(id: string): void {
    this.processors.delete(id);
  }

  /** 全部已注册的内容源（注册顺序稳定）。 */
  getSources(): ContentSource[] {
    return [...this.sources.values()];
  }

  /** 全部已注册的处理器（注册顺序稳定）。 */
  getProcessors(): ContentProcessor[] {
    return [...this.processors.values()];
  }
}

/** 全局单例。 */
export const contentPipelineRegistry = new ContentPipelineRegistry();
