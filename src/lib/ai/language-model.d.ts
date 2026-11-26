/**
 * Chrome 内置 Prompt API（全局 LanguageModel）最小类型声明。
 *
 * 只声明本项目用到的能力，避免引入未安装的第三方类型包。
 * 参考：Chrome 148+ 桌面稳定版的 LanguageModel.availability / create / prompt。
 */

export interface LanguageModelExpected {
  type: "text";
  languages: string[];
}

export interface LanguageModelPromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LanguageModelCreateOptions {
  initialPrompts?: LanguageModelPromptMessage[];
  expectedInputs?: LanguageModelExpected[];
  expectedOutputs?: LanguageModelExpected[];
  temperature?: number;
  topK?: number;
}

export interface LanguageModelPromptOptions {
  /** JSON Schema：约束本轮输出必须是可解析的结构化决策。 */
  responseConstraint?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface LanguageModelSession {
  prompt(input: string, options?: LanguageModelPromptOptions): Promise<string>;
  destroy(): void;
}

export interface LanguageModelStatic {
  availability(options?: {
    expectedInputs?: LanguageModelExpected[];
    expectedOutputs?: LanguageModelExpected[];
  }): Promise<string>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
}

declare global {
  // Chrome 未注入该 API 时，属性缺失；用 typeof 判断可安全探测。
  var LanguageModel: LanguageModelStatic | undefined;
}
