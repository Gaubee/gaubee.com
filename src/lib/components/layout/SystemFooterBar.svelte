<!--
	SystemFooterBar：系统底部状态栏（跨路由常驻全宽，与顶部 SystemStatusBar 对偶）。

	正交意图：
	1. 原始需求（2026-08-14）：页面底部全宽状态栏，视觉语言对齐顶部 SystemStatusBar
	   （glass-surface 毛玻璃 + text-xs + border-t），但高度减半（h-4.5）。
	   条目右对齐，两两之间用分割线隔开：`GitHub | 备案号`。

	未来演进（设计备忘，均未实现）：
	2. 抽屉化：底栏将升级为抽屉（Drawer），顶部中央带一个小手柄（handle），
	   点击后像 Sheet 一样向上展开；收起态保持现有条目（源码/备案号等）可见。
	3. 展开态 · 方案一「数据中转站」：将全站各种功能的数据统一建模为一种
	   类剪贴板的数据结构（可承载任意类型数据），展开后的抽屉里以卡片化形式
	   存储这些数据，成为跨应用的临时数据中转枢纽。
	4. 展开态 · 方案二「AI 入口」：点击可唤起个人 AI 助理对话，借助 WebMCP
	   协议读取/操作 GaubeeOS 上的内容（应用、VFS、通知等），作为系统级 AI 面板。

	备案号规范（工信部要求，见 $lib/site/site.ts）：
	- 备案号链接到工信部备案管理系统 beian.miit.gov.cn，新窗口打开。
-->
<script lang="ts">
  import { SITE } from '$lib/site/site'
</script>

<footer class="system-footerbar glass-surface border-border/80 z-[var(--z-shell-base)] shrink-0 border-t">
  <!-- 内容行：高度为顶栏一半（h-4.5 = 18px），条目右对齐、分割线隔开；
       未来手柄（handle）与展开内容也挂在这一层 -->
  <div class="text-muted-foreground flex h-4.5 items-center justify-end gap-2 px-2 text-xs leading-none">
    <a
      href={SITE.githubUrl}
      target="_blank"
      rel="noopener noreferrer"
      class="hover:text-foreground rounded px-1 transition-colors hover:bg-accent"
    >
      GitHub
    </a>
    <span class="bg-border h-3 w-px shrink-0" aria-hidden="true"></span>
    <a
      href={SITE.beian.url}
      target="_blank"
      rel="noopener noreferrer"
      class="hover:text-foreground rounded px-1 transition-colors hover:bg-accent"
    >
      {SITE.beian.label}
    </a>
  </div>
  <!-- iOS 安全区让位（viewport-fit=cover 下避开 home indicator，非全面屏为 0 高度） -->
  <div class="h-[env(safe-area-inset-bottom)]" aria-hidden="true"></div>
</footer>
