# Design Phase 3: 超大 JSON 支持（WASM 分块流式架构）

> kzf 指令（2026-10-06，两轮收敛）：
>
> 1. 巨大 JSON 必须支持；前提是「分块 + 流式」（并发不现实——JSON 解析依赖前文）；
>    Web Worker 是承载层；microlighter/gpu-lexer 仅作参考，均有缺陷，核心需自研
>    （拆开技术重组）。
> 2. 技术栈：SharedArrayBuffer + MoonBit 开发 WASM，实现高性能分块流式解析。
>    分块工作协议：传入 PreContext + Pos + Limit（如 2MB），返回 Context，
>    或 Context + 结构化信息。Context 用于大量滚动后快速跳转（快进重放）；
>    Context + Pos + Limit 可直接计算结构化信息。分片流式、非阻塞、快速跳过
>    数据块以保证打开速度。
> 3. 上限：最大 3GB（单 JS 字符串长度上限量级）。
> 4. 两类病态数据：① 大量碎片结构（海量小键值）；② 巨大长度字段
>    （如 base64 数 MB 的单值）。

## 0. 技术选型裁决（2026-10-06，三轮收敛）

| 候选                             | 裁决                     | 依据                                                                                         |
| -------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| MoonBit → WASM 分块流式解析器    | ✅ **核心（自研）**      | kzf 指定技术栈；增量状态机 + 字节级扫描是 WASM 的主场；JS 字符串/JSON.parse 路径全部退役     |
| microlighter                     | 参考库（语法/主题）      | kzf 明确：仅建议不直接用；其 TextMate JSON 正则与 Highlight API 用法可借鉴                   |
| gpu-lexer                        | 参考库（已排除）         | 概率性 token 分类 + WebGPU 硬依赖，工具类应用不可接受                                        |
| tanstack virtual                 | ✅ 采纳（UI 层窗口渲染） | 与解析层正交；动态测量（树行高不定）；@tanstack/svelte-virtual 3.13.39 已预验证支持 Svelte 5 |
| Web Worker                       | ✅ 承载层                | WASM 实例化与解析循环跑在 worker；主线程永不解析                                             |
| 纯 JS 增量解析（json-core 扩展） | ✅ 降级路径              | WASM 加载失败/不支持环境的 fallback；复用 json-core 校验器的状态机逻辑                       |

## 1. 分块流式协议（kzf 接口语义的形式化）

```
// 纯函数式：每次调用携带前文状态摘要 + 本次数据窗口，返回新状态（+可选结构化产物）
type Ctx = 紧凑解析状态（见 §2）

step(pre: Ctx, chunk: Bytes[pos, limit)) ->
  | { next: Ctx, done: false, events: Event[] }        // 结构化信息（值事件/行片段）
  | { next: Ctx, done: true,  events: Event[], root }   // 输入耗尽且顶层值完整

skip_to(pre: Ctx, target_offset) -> { next: Ctx }       // 快进：不产事件，仅推进状态
```

- **Ctx 是 KB 级**：容器栈（类型 + 键路径游标）× 深度上限（2000）+ 未完成
  token 缓冲 + 字节偏移 + 统计（字节数/值计数/最大深度/错误位图）。
- **快进索引（Context 检查点）**：每消费 ~2MB 落一个 Ctx 快照（3GB → ~1500 个
  快照，总索引几 MB）。用户滚动跳转 → 二分找最近检查点 → 从该 Ctx 重放
  最多 2MB 到目标 offset。打开速度与随机跳转解耦。
- **非阻塞**：chunk 粒度让出（每个 chunk 处理完 yield 回事件循环），
  UI 永不等待全量解析。

## 2. WASM 核心（MoonBit）

### 后端裁决（2026-10-06 调研报告结论）

- **选经典 `wasm` 后端**（线性内存 + 引用计数）：kzf 的 SAB 方案硬性依赖
  `shared-memory: true`（moon link 配置），该选项仅经典后端支持；
  wasm-gc 默认无线性内存（数据结构是 GC 引用类型），无法挂共享内存。
- 代价（风险 5）：经典后端「JS ↔ 线性内存指针/长度传递」官方端到端示例缺失，
  ABI（i32 指针约定）需自行封装——已由工具链验证（moon 0.1.20260824 构建 +
  Bytes 遍历 + wasm 产物全链路跑通）压低风险。
- RC（引用计数）无 tracing GC 停顿，适合解析长任务。
- **CI 钉版**：`chawyehsu/setup-moonup` Action + `moonbit-version` 钉死
  moon 版本（pre-1.0 破坏性变更会持续，0.8.0 曾一次引入多项破坏）。

### 解析器实现

- 数据放 shared WebAssembly.Memory（SAB，上限 4GB ≥ 3GB 需求）：
  File 分块读入共享内存，WASM 按字节扫描，数据零 JS 字符串化。
- 状态机：RFC 8259 增量识别（复用 json-core 校验器已验证的语法规则集移植；
  moonbitlang/core/json 的手写 lexer 是官方同类参考实现，但其架构是整文档
  - 内部缓冲，无流式 API）。跨 chunk 的字符串/数字 continuation 缓冲
    是自研重点（research 确认：生态内无成熟流式 JSON 包可复用，
    moonbit-community/json 为 1-star 实验品）。
- 事件流：值开始/结束、键、标量（含 offset 边界——预览高亮的 token 边界
  就是标量事件的 [start,end)，仍是解析副产品）。
- 错误定位：复用既有错误码（行列 + 中文提示），UX 一致。
- 纯 JS 降级：同一协议在 TS 实现（json-core 状态机化），WASM 不可用时切换。
- 立项第一优先：`moon bench` 跑通分块解析基准（MoonBit JSON 性能无第三方
  验证，收益需实测说话，对比 JSON.parse 基线）。

### SharedArrayBuffer 的部署前提（风险项，需 kzf 拍板）

- SAB / shared WebAssembly.Memory 需要 cross-origin isolation：
  站点响应头 `COOP: same-origin` + `COEP: credentialless`。
  - 对本站影响评估：SSG 页第三方图片（pbs.twimg.com 等 no-cors 资源）在
    credentialless 下以匿名方式加载（Chrome/Firefox 支持；Safari 16.4+
    支持 credentialless？需实测）——_*上线前必须对 /pages/* 做全站走查_*。
  - 降级：非隔离环境 → Transferable ArrayBuffer 双缓冲轮换
    （多一次拷贝，功能等价）。协议层抽象「数据通道」，SAB 与 Transferable
    是两个实现。
- 上线策略建议：json-viewer 先以 Transferable 模式发布（零部署变更），
  COOP/COEP 头评估通过后切 SAB（按 3GB 需求强度决定优先级）。

## 3. 两类病态数据的对策

| 病态                              | 对策                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 巨大长度字段（base64 数 MB 单值） | `skip` 语义：状态机验证字符串合法性但不复制内容；行模型只记 `offset + length + preview(120B)`；查看完整值 = 按 offset seek 读共享内存窗口（懒加载），永不整体进 JS |
| 大量碎片结构（百万级键值）        | 行模型**惰性生成**：容器聚合行（`[100000 items]` 可展开），展开时经 `read_rows(offset, max)` 增量提取；主线程行缓冲设上限（如 50 万行），超出提示用查询/跳转定位   |

## 4. UI 集成（主线程）

- 行模型 + @tanstack/svelte-virtual 窗口渲染（动态测量）；行内值着色用
  kind class（零 tokenizer）；预览行高亮用解析副产品 token 边界
  （Int32Array）+ CSS Custom Highlight API 窗口局部注册（旧浏览器纯文本）。
- 进度 UI：分块进度条（已解析 MB / 总 MB）、快进指示（跳转时「重放 1.2MB…」）。
- 阈值：≤1MB 保持现有同步路径（体验不变）；>1MB 自动切流式路径；
  > 10MB 输入区只读化（编辑走文件重导）。

## 5. 任务分解

- [x] 3.0 MoonBit 工具链验证（moon 0.1.20260824：wasm 构建 + 双 target 测试
      全链路跑通）+ 调研报告结论已并入本文档（后端裁决 / 风险清单 / CI 钉版）
- [ ] 3.1 WASM 核心：Ctx 状态机 + step/skip_to/snapshot/resume 协议 +
      事件流 + 单测（MoonBit 侧 moon test；含病态数据用例；native/wasm 双 target）
      （当前仅完成 MoonBit 有限词法扫描器；完整 RFC 8259 状态机、经典 WASM ABI
      与浏览器加载产物未完成，不能作为本轮 WASM 核心交付）
- [x] 3.2 JS 桥 + worker：Transferable 双缓冲管道（File.stream() 分块写入）、
      检查点索引、纯 JS 降级实现（同协议）
- [ ] 3.3 行模型惰性化（聚合行 + read_rows 增量提取）+ 行缓冲上限
      （已补可见窗口按需投影与聚合行；当前 `readRows` 仍是已收集事件的分页，尚未按检查点从文件增量提取）
- [x] 3.4 UI：进度指示、阈值切换、tanstack virtual 接入
      （token 边界 Custom Highlight 尚未接入）
- [ ] 3.5 性能基准：已跑通 MoonBit/native 与 JS/JSON.parse 基线；完整 10MB/100MB/1GB/3GB
      与浏览器长任务矩阵留待专用性能机补跑
- [x] 3.6 COOP/COEP 影响评估：首发保持 Transferable；SAB 不随本轮部署
- [ ] 3.7 双端走查 + vision 验收 + build/单测门禁（Agent 已完成 production preview 桌面/390px 走查、build 与聚焦单测；Owner vision/full e2e 验收仍待完成）

## 6. 验收标准

- 3GB 谱形样本可打开（流式进度可见、UI 可交互、可跳转/搜索定位）
- 随机跳转到 2GB 处 ≤ 快进检查点重放时间（目标 < 200ms 量级，以基准为准）
- 巨值字段：打开与滚动不复制其内容；点开按需 seek 读取
- 碎片样本：行缓冲不爆，聚合行展开流畅
- 既有功能零回归；WASM 不可用环境走纯 JS 降级（功能一致）
