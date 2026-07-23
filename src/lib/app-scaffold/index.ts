/**
 * GaubeeApp 应用脚手架（iPadOS 模型）。
 *
 * 统一暴露：
 * - AppShell：应用隔离容器（isolation:isolate + portal root 锚定）
 * - defineApp：类型安全应用声明工厂（含 entry activity 校验）
 * - useApp：消费应用上下文
 * - portal context：bits-ui Portal 锚定到应用容器
 */
export { default as AppShell } from "./AppShell.svelte";
export { defineApp } from "./define-app";
export { useApp, type AppContextValue } from "./portal-context.svelte";
