/**
 * Chrome WebMCP（document.modelContext）最小类型声明。
 *
 * Chrome 149+ Origin Trial；只声明本项目注册工具所需字段，
 * 不依赖未安装的 webmcp-types 包。
 */

export interface WebMcpToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface WebMcpExecuteOptions {
  signal?: AbortSignal;
}

export interface WebMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: WebMcpToolAnnotations;
  execute(input: unknown, options?: WebMcpExecuteOptions): Promise<unknown> | unknown;
}

export interface WebMcpModelContext {
  registerTool(tool: WebMcpToolDefinition, options?: { signal?: AbortSignal }): void | (() => void);
}

declare global {
  interface Document {
    /** Chrome 149+ Origin Trial 注入；不可用时为 undefined。 */
    modelContext?: WebMcpModelContext;
  }
}
