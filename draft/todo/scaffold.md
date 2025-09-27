**请仔细阅读agents.md后再开始了解以下的工作内容：**

# 一、先对齐目标

1. 我们需要一个**跨端（Mobile / Tablet / Desktop）的 Scaffold**  
   它必须能一次性解决：
   - AppBar（含沉浸式、滚动响应、折叠）
   - Drawer（左侧/右侧，手势返回）
   - BottomNavigationBar（或 NavigationRail）
   - FloatingActionButton、SnackBar、Modal（如全局设置面板）
   - 响应式布局，在不同屏幕尺寸的时候能自动切换不同的版面
   - SSR水合支持

2. 设计基准  
   - 移动端：iOS Human Interface + Material 3 混合（iOS 侧滑返回、Material 3 动态色、圆角、Elevation）  
   - 桌面端：Material 3 的 NavigationRail + 折叠式 AppBar，窗口拖拽区兼容（Electron/Tauri）  
   - 平板：根据宽度断点自动在 NavigationRail ↔ BottomBar 之间切换


4. 交付物  
   ① Scaffold 核心包（`/src/components/scaffold`）  
   ② 应用到所有页面（首页、二级页、管理员页面）  
   ④ 使用文档（含设计 Token 表）

# 二、shadcn/ui 能帮我们到什么程度？

shadcn/ui 本质是“把 Radix 的低层 Headless 组件再包一层样式”，**没有布局级容器**。  
因此：

- ✅ 可以复用：Sheet、Dialog、DropdownMenu、Switch、Slider 等原子组件  
- ❌ 没有 Scaffold、AppBar、NavigationRail、BottomNavigationBar、Drawer（带手势）  
- ❌ 没有断点、滚动响应、折叠、沉浸式、SafeArea 注入

结论：**必须自己从头做 Scaffold**，但所有“原子控件”直接拿 shadcn/ui 的即可，节省 30% 工作量。

# 三、架构设计

```
┌───────────────┐
│  Page.tsx     │  业务页面零布局代码，只写内容
└──────▲────────┘
       │useScaffold()
┌──────┴────────┐
│  Scaffold     │  提供上下文 & 插槽
│  ├─ AppBar    │  响应式折叠 + 沉浸式
│  ├─ Drawer    │  手势 + 焦点陷阱
│  ├─ BottomBar │  自动隐藏滚动 + 徽章
│  ├─ FAB        │  自动贴边 + 滚动消失
│  └─ Overlay    │  全局 SnackBar / SettingPanel
└───────────────┘
```

## 1. 状态模型（这里以Jotai为例）

```ts
// atoms/scaffold.ts
export const scaffoldAtoms = {
  // 左侧 Drawer 开关
  drawerOpen: atom(false),
  // 右侧设置面板
  settingOpen: atom(false),
  // 底部栏显隐
  bottomBarVisible: atom(true),
  // 滚动偏移（用于折叠 AppBar）
  scrollY: atom(0),
  // 当前路由
  activeRoute: atom<string>('/'),
  // 主题
  theme: atomWithStorage<'light' | 'dark'>('theme', 'light'),
}
```

## 2. 断点策略

```ts
const BREAKPOINTS = {
  mobile: 0,      // ≤ 639
  tablet: 640,    // 640–1023
  desktop: 1024,   // ≥ 1024
}
```

- mobile：BottomBar + 侧滑 Drawer  
- tablet：NavigationRail（折叠 72px）+ 模态 Drawer  
- desktop：永久 NavigationRail（200px 展开）+ 无 Drawer

## 3. 手势与无障碍

- 移动端：左边缘右滑 → 开 Drawer；右边缘左滑 → 开设置面板  
- 桌面：键盘快捷键 ⌘ + , 打开设置（已防止与浏览器冲突）  
- 所有弹窗均带焦点陷阱，ESC 关闭，ARIA 标签完整

# 四、关键实现细节

## 1. 沉浸式 AppBar（滚动折叠）

```tsx
const AppBar = () => {
  const scrollY = useAtomValue(scaffoldAtoms.scrollY)
  const collapsed = scrollY > 40
  return (
    <header
      className={cn(
        'sticky top-0 z-20 h-16 transition-all duration-300',
        'bg-background/80 backdrop-blur-lg supports-backdrop-blur:bg-background/60',
        collapsed && 'shadow-sm'
      )}
    >
      <div className="flex h-full items-center px-4">
        <Hamburger />
        <div className="flex-1" />
        <SettingTrigger />
      </div>
    </header>
  )
}
```

SafeArea 注入：使用 `env(safe-area-inset-top)` + Tailwind 插件 `tailwindcss-safe-area`

## 2. 全局设置面板（Sheet）

```tsx
const SettingPanel = () => {
  const [open, setOpen] = useAtom(scaffoldAtoms.settingOpen)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0">
        <SheetHeader className="px-4 pt-4">
          <SheetTitle>偏好设置</SheetTitle>
        </SheetHeader>
        <div className="px-4 py-4 space-y-6">
          <ThemeSwitch />
          <LanguageSelect />
          <NotificationToggle />
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

## 3. BottomBar 滚动自动隐藏

```tsx
const BottomBar = () => {
  const visible = useAtomValue(scaffoldAtoms.bottomBarVisible)
  return (
    <footer
      className={cn(
        'fixed bottom-0 left-0 right-0 h-16 z-20',
        'bg-background/90 backdrop-blur-lg border-t',
        'transition-transform duration-300',
        !visible && 'translate-y-full'
      )}
    >
      …
    </footer>
  )
}
```

监听 `window.scrollY` 与 `scrollDirection`（借助 `lodash/throttle` 16ms）

