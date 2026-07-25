<!--
	ThemeView：主题应用主界面（自定义 primary 色相 + 桌面背景）。

	正交意图：
	1. 主题色：色相滑块 + 预设色板，实时预览全 OS 换色（themeService.setHue 即时注入 --primary-h）。
	2. 桌面背景：4 种类型切换（默认/纯色/渐变/图片/SVG 模板），通过 desktopService 设置。
	   纯色/渐变/SVG 色相受限（L/C 锁定 = 可访问性保证）；纯图片无限制。

	设计：二八法则——色相滑块是高频核心占主视觉；背景类型收纳在下方分区。
-->
<script lang="ts">
  import { themeService } from '$lib/apps/builtin/theme/service.svelte'
  import { desktopService } from '$lib/apps/builtin/desktop/service.svelte'
  import type { DesktopBackground } from '$lib/apps/builtin/desktop/service.svelte'
  import { backgroundToCss } from '$lib/apps/builtin/desktop/background-render'
  import { SVG_TEMPLATES } from '$lib/apps/builtin/theme/svg-templates'
  import { DEFAULT_PRIMARY_HUE, DEFAULT_BASE_HUE } from '$lib/apps/builtin/theme/service.svelte'
  import { extractThemeHues, type ExtractedThemeHues } from '$lib/color/extract'
  import * as Card from '$lib/components/ui/card'
  import * as Tabs from '$lib/components/ui/tabs'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw'
  import InfoIcon from '@lucide/svelte/icons/info'
  import UploadIcon from '@lucide/svelte/icons/upload'
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link'

  // 主题色相（响应式订阅 themeService，双旋钮）
  const hue = $derived(themeService.hue)
  const baseHue = $derived(themeService.baseHue)
  // 桌面背景（响应式订阅 desktopService）
  const background = $derived(desktopService.background)
  // 桌面背景预览 CSS（实时派生，模拟桌面背景效果）
  const backgroundPreviewCss = $derived(backgroundToCss(background))

  // 预设色相快捷（常见品牌色 hue）
  const PRESET_HUES = [
    { name: '橙红', hue: DEFAULT_PRIMARY_HUE },
    { name: '红', hue: 25 },
    { name: '品红', hue: 350 },
    { name: '紫', hue: 300 },
    { name: '蓝', hue: 250 },
    { name: '青', hue: 200 },
    { name: '绿', hue: 150 },
    { name: '黄', hue: 90 },
  ]

  // 色相滑块实时更新（拖动即生效）
  function onHueInput(e: Event) {
    const value = Number((e.target as HTMLInputElement).value)
    themeService.setHue(value)
  }
  function onBaseHueInput(e: Event) {
    const value = Number((e.target as HTMLInputElement).value)
    themeService.setBaseHue(value)
  }

  // ---- 桌面背景类型切换 ----
  type BgType = DesktopBackground['type']
  const bgTypes: { value: BgType; label: string }[] = [
    { value: 'default', label: '默认' },
    { value: 'color', label: '纯色' },
    { value: 'gradient', label: '渐变' },
    { value: 'image', label: '图片' },
    { value: 'svg', label: '动态' },
  ]

  // 当前背景类型（从 background 派生）
  const currentBgType = $derived(background.type)

  // 各类型局部编辑状态（输入过程中不立即写 service，避免抖动；失焦时提交）
  let colorHue = $state(DEFAULT_PRIMARY_HUE)
  let gradientFrom = $state(DEFAULT_PRIMARY_HUE)
  let gradientTo = $state(DEFAULT_PRIMARY_HUE + 40)
  let imageUrl = $state('')

  // 切换类型时初始化局部状态
  $effect(() => {
    const bg = background
    if (bg.type === 'color') colorHue = bg.hue
    else if (bg.type === 'gradient') {
      gradientFrom = bg.from
      gradientTo = bg.to
    } else if (bg.type === 'image') imageUrl = bg.url
  })

  function switchBgType(type: BgType) {
    if (type === 'default') {
      desktopService.setBackground({ type: 'default' })
    } else if (type === 'color') {
      desktopService.setBackground({ type: 'color', hue: colorHue })
    } else if (type === 'gradient') {
      desktopService.setBackground({ type: 'gradient', from: gradientFrom, to: gradientTo })
    } else if (type === 'image') {
      desktopService.setBackground({
        type: 'image',
        url: imageUrl || 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920',
      })
    } else if (type === 'svg') {
      desktopService.setBackground({
        type: 'svg',
        templateId: SVG_TEMPLATES[0].id,
        hue,
      })
    }
  }

  function commitColor() {
    desktopService.setBackground({ type: 'color', hue: colorHue })
  }
  function commitGradient() {
    desktopService.setBackground({ type: 'gradient', from: gradientFrom, to: gradientTo })
  }
  function commitImage() {
    if (imageUrl) desktopService.setBackground({ type: 'image', url: imageUrl })
  }

  // ---- 本地文件上传（input-file → data URL）----
  let uploading = $state(false)
  let uploadError = $state('')

  async function onFileUpload(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      uploadError = '请选择图片文件'
      return
    }
    // data URL 大小限制（约 2MB，避免 localStorage 爆容量）
    if (file.size > 2 * 1024 * 1024) {
      uploadError = '图片过大（限 2MB），建议使用外链或小图'
      return
    }
    uploading = true
    uploadError = ''
    try {
      const dataUrl = await readFileAsDataUrl(file)
      imageUrl = dataUrl
      desktopService.setBackground({ type: 'image', url: dataUrl })
    } catch {
      uploadError = '读取文件失败'
    } finally {
      uploading = false
      // 重置 input 允许重复选同一文件
      input.value = ''
    }
  }

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('read error'))
      reader.readAsDataURL(file)
    })
  }

  // ---- 图片主色提取（双套：primary 鲜艳色 + base 中性色）----
  let extracted = $state<ExtractedThemeHues>({ primary: [], base: [] })
  let extracting = $state(false)
  let extractError = $state('')

  async function extractColors() {
    if (!imageUrl || extracting) return
    extracting = true
    extractError = ''
    extracted = { primary: [], base: [] }
    try {
      extracted = await extractThemeHues(imageUrl, 5)
    } catch (e) {
      extractError = e instanceof Error ? e.message : '提取失败（图片可能跨域）'
    } finally {
      extracting = false
    }
  }
  function selectSvgTemplate(templateId: string) {
    desktopService.setBackground({ type: 'svg', templateId, hue })
  }
</script>

<div class="mx-auto max-w-2xl space-y-6 p-6">
  <header class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-semibold">主题</h1>
      <p class="text-muted-foreground mt-1 text-sm">调整主题色相与桌面背景</p>
    </div>
    <Button variant="outline" size="sm" onclick={() => themeService.reset()}>
      <RotateCcwIcon class="size-4" />
      重置色相
    </Button>
  </header>

  <!-- 主题色相（双旋钮：primary 品牌色 + base 中性色） -->
  <Card.Root>
    <Card.Header>
      <Card.Title>主题色</Card.Title>
      <Card.Description>
        双旋钮独立调整。亮度锁定（保证可访问性），仅旋转色相。
      </Card.Description>
    </Card.Header>
    <Card.Content class="space-y-5">
      <!-- Primary 色相（品牌强调色） -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <Label class="font-medium">Primary（品牌色）</Label>
          <span class="text-muted-foreground font-mono text-xs">{hue.toFixed(1)}°</span>
        </div>
        <input
          type="range"
          min="0"
          max="360"
          step="0.5"
          value={hue}
          oninput={onHueInput}
          class="hue-slider h-3 w-full cursor-pointer appearance-none rounded-full"
          aria-label="Primary 色相"
        />
        <!-- 预设色板 -->
        <div class="flex flex-wrap gap-2 pt-1">
          {#each PRESET_HUES as preset (preset.name)}
            <button
              class="flex flex-col items-center gap-1"
              onclick={() => themeService.setHue(preset.hue)}
              aria-label={preset.name}
            >
              <span
                class="size-8 rounded-full transition-all hover:scale-110 {Math.abs(hue - preset.hue) < 2 ? 'ring-primary ring-2 ring-offset-2 ring-offset-background' : ''}"
                style="background: oklch(0.514 0.222 {preset.hue})"
              ></span>
              <span class="text-muted-foreground text-xs">{preset.name}</span>
            </button>
          {/each}
        </div>
      </div>

      <!-- Base 色相（中性表面色） -->
      <div class="space-y-2 border-t pt-4">
        <div class="flex items-center justify-between">
          <Label class="font-medium">Base（中性色）</Label>
          <span class="text-muted-foreground font-mono text-xs">{baseHue.toFixed(1)}°</span>
        </div>
        <input
          type="range"
          min="0"
          max="360"
          step="0.5"
          value={baseHue}
          oninput={onBaseHueInput}
          class="hue-slider-muted h-3 w-full cursor-pointer appearance-none rounded-full"
          aria-label="Base 色相"
        />
        <!-- 预设色板（低彩度，模拟中性表面色） -->
        <div class="flex flex-wrap gap-2 pt-1">
          {#each PRESET_HUES as preset (preset.name)}
            <button
              class="flex flex-col items-center gap-1"
              onclick={() => themeService.setBaseHue(preset.hue)}
              aria-label="Base {preset.name}"
            >
              <span
                class="size-8 rounded-full transition-all hover:scale-110 {Math.abs(baseHue - preset.hue) < 2 ? 'ring-primary ring-2 ring-offset-2 ring-offset-background' : ''}"
                style="background: oklch(0.5 0.02 {preset.hue})"
              ></span>
              <span class="text-muted-foreground text-xs">{preset.name}</span>
            </button>
          {/each}
        </div>
      </div>

      <!-- 实时预览样本 -->
      <div class="flex items-center gap-3 rounded-lg border p-3">
        <span
          class="size-12 rounded-lg shadow-sm"
          style="background: oklch(0.514 0.222 {hue})"
          aria-label="primary 色预览"
        ></span>
        <span
          class="border-border size-12 rounded-lg border shadow-sm"
          style="background: oklch(0.96 0.003 {baseHue})"
          aria-label="base 色预览"
        ></span>
        <div class="text-sm">
          <p class="font-medium">实时预览</p>
          <p class="text-muted-foreground font-mono text-xs">
            primary {hue.toFixed(0)}° · base {baseHue.toFixed(0)}°
          </p>
        </div>
      </div>
    </Card.Content>
  </Card.Root>

  <!-- 桌面背景 -->
  <Card.Root>
    <Card.Header>
      <Card.Title class="flex items-center gap-2">桌面背景</Card.Title>
      <Card.Description>
        纯色/渐变/动态壁纸的色相受主题色约束（锁定亮度）；图片无限制。
      </Card.Description>
    </Card.Header>
    <Card.Content class="space-y-4">
      <!-- 桌面背景预览：16:9 缩略图，左右并排亮/暗模式，叠加模拟桌面图标。
           Tooltip 说明占位图标仅为展示主题色效果，非真实桌面。 -->
      <Tooltip.Provider>
        <Tooltip.Root>
          <Tooltip.Trigger class="block w-full cursor-help">
            <div
              class="grid aspect-video w-full grid-cols-2 overflow-hidden rounded-lg border"
              style={backgroundPreviewCss || 'background: var(--background)'}
              aria-label="桌面背景预览"
            >
              <!-- 亮模式预览（左半，.force-light 强制亮色变量，不受全局 .dark 影响） -->
              <div class="preview-pane force-light relative flex flex-col gap-2 p-2.5">
                <div class="flex gap-1.5">
                  <span class="preview-icon"><span class="preview-icon-dot"></span></span>
                  <span class="preview-icon"></span>
                </div>
                <span class="preview-widget mt-auto">
                  <span class="preview-widget-bar"></span>
                  <span class="preview-widget-bar short"></span>
                  <span class="preview-widget-bar"></span>
                </span>
                <span class="text-muted-foreground absolute bottom-1 right-2 text-[10px]">亮色</span>
              </div>
              <!-- 暗模式预览（右半，.dark 隔离） -->
              <div class="preview-pane dark relative flex flex-col gap-2 p-2.5">
                <div class="flex gap-1.5">
                  <span class="preview-icon"><span class="preview-icon-dot"></span></span>
                  <span class="preview-icon"></span>
                </div>
                <span class="preview-widget mt-auto">
                  <span class="preview-widget-bar"></span>
                  <span class="preview-widget-bar short"></span>
                  <span class="preview-widget-bar"></span>
                </span>
                <span class="text-muted-foreground absolute bottom-1 right-2 text-[10px]">暗色</span>
              </div>
            </div>
          </Tooltip.Trigger>
          <Tooltip.Content>
            <p class="flex items-center gap-1.5 text-xs">
              <InfoIcon class="size-3" />
              模拟桌面图标仅展示主题色效果，非真实桌面
            </p>
          </Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>
      <!-- 背景类型切换 + 配置 -->
      <Tabs.Root value={currentBgType} onValueChange={(v) => switchBgType(v as BgType)}>
        <Tabs.List class="grid w-full grid-cols-5">
          {#each bgTypes as t (t.value)}
            <Tabs.Trigger value={t.value}>{t.label}</Tabs.Trigger>
          {/each}
        </Tabs.List>

        <!-- 默认 -->
        <Tabs.Content value="default" class="pt-4">
          <p class="text-muted-foreground text-sm">
            使用系统默认背景（透明，露出应用底层背景色）。
          </p>
        </Tabs.Content>

        <!-- 纯色 -->
        <Tabs.Content value="color" class="space-y-3 pt-4">
          <div class="flex items-center justify-between">
            <Label>纯色色相</Label>
            <span class="text-muted-foreground font-mono text-xs">{colorHue.toFixed(1)}°</span>
          </div>
          <input
            type="range"
            min="0"
            max="360"
            step="0.5"
            value={colorHue}
            oninput={(e) => (colorHue = Number((e.target as HTMLInputElement).value))}
            onchange={commitColor}
            class="hue-slider h-3 w-full cursor-pointer appearance-none rounded-full"
          />
        </Tabs.Content>

        <!-- 渐变 -->
        <Tabs.Content value="gradient" class="space-y-3 pt-4">
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label>起始色相</Label>
              <input
                type="range"
                min="0"
                max="360"
                step="0.5"
                value={gradientFrom}
                oninput={(e) => (gradientFrom = Number((e.target as HTMLInputElement).value))}
                onchange={commitGradient}
                class="hue-slider h-3 w-full cursor-pointer appearance-none rounded-full"
              />
            </div>
            <div class="space-y-2">
              <Label>结束色相</Label>
              <input
                type="range"
                min="0"
                max="360"
                step="0.5"
                value={gradientTo}
                oninput={(e) => (gradientTo = Number((e.target as HTMLInputElement).value))}
                onchange={commitGradient}
                class="hue-slider h-3 w-full cursor-pointer appearance-none rounded-full"
              />
            </div>
          </div>
        </Tabs.Content>

        <!-- 图片 -->
        <Tabs.Content value="image" class="space-y-3 pt-4">
          <!-- 本地上传 + 外链 URL 双通道 -->
          <div class="space-y-2">
            <Label>本地上传</Label>
            <div class="flex gap-2">
              <Button variant="outline" size="sm" disabled={uploading} class="relative">
                <UploadIcon class="size-4" />
                {uploading ? '上传中…' : '选择图片文件'}
                <input
                  type="file"
                  accept="image/*"
                  class="absolute inset-0 cursor-pointer opacity-0"
                  onchange={onFileUpload}
                  aria-label="上传图片文件"
                />
              </Button>
            </div>
            {#if uploadError}
              <p class="text-destructive text-xs">{uploadError}</p>
            {/if}
            <p class="text-muted-foreground text-xs">
              限 2MB 以内（data URL 存储）。大图建议用下方外链。
            </p>
          </div>

          <div class="space-y-2 border-t pt-3">
            <Label>外链 URL</Label>
            <div class="flex gap-2">
              <Input
                type="url"
                placeholder="https://..."
                bind:value={imageUrl}
                onchange={commitImage}
              />
              <Button onclick={commitImage} disabled={!imageUrl}>应用</Button>
            </div>
            <!-- 外链推荐（新窗口打开） -->
            <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <a
                href="https://unsplash.com/s/photos/free"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary inline-flex items-center gap-1 hover:underline"
              >
                <ExternalLinkIcon class="size-3" />
                Unsplash（免费高清照片）
              </a>
              <a
                href="https://www.svgbackgrounds.com/set/free-svg-backgrounds-and-patterns/"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary inline-flex items-center gap-1 hover:underline"
              >
                <ExternalLinkIcon class="size-3" />
                SVG Backgrounds（免费 SVG 背景）
              </a>
            </div>
          </div>

          <!-- 提取主色：从图片提取候选主题色相 -->
          <div class="space-y-2 border-t pt-3">
            <Button
              variant="outline"
              size="sm"
              onclick={extractColors}
              disabled={!imageUrl || extracting}
            >
              {extracting ? '提取中…' : '从图片提取主题色'}
            </Button>

            {#if extractError}
              <p class="text-destructive text-xs">{extractError}</p>
            {/if}

            {#if extracted.primary.length > 0 || extracted.base.length > 0}
              <div class="space-y-3">
                {#if extracted.primary.length > 0}
                  <div class="space-y-1.5">
                    <p class="text-muted-foreground text-xs">Primary 候选（鲜艳色 → 品牌色）：</p>
                    <div class="flex flex-wrap gap-2">
                      {#each extracted.primary as h (h)}
                        <button
                          class="size-8 rounded-full transition-all hover:scale-110 {Math.abs(hue - h) < 2 ? 'ring-primary ring-2 ring-offset-2 ring-offset-background' : ''}"
                          style="background: oklch(0.514 0.222 {h})"
                          onclick={() => themeService.setHue(h)}
                          aria-label={`Primary 色相 ${h.toFixed(0)}°`}
                          title={`${h.toFixed(1)}°`}
                        ></button>
                      {/each}
                    </div>
                  </div>
                {/if}
                {#if extracted.base.length > 0}
                  <div class="space-y-1.5">
                    <p class="text-muted-foreground text-xs">Base 候选（中性色 → 背景色）：</p>
                    <div class="flex flex-wrap gap-2">
                      {#each extracted.base as h (h)}
                        <button
                          class="border-border size-8 rounded-full border transition-all hover:scale-110 {Math.abs(baseHue - h) < 2 ? 'ring-primary ring-2 ring-offset-2 ring-offset-background' : ''}"
                          style="background: oklch(0.5 0.02 {h})"
                          onclick={() => themeService.setBaseHue(h)}
                          aria-label={`Base 色相 ${h.toFixed(0)}°`}
                          title={`${h.toFixed(1)}°`}
                        ></button>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </Tabs.Content>

        <!-- SVG 动态壁纸 -->
        <Tabs.Content value="svg" class="space-y-3 pt-4">
          <Label>动态壁纸模板</Label>
          <div class="grid grid-cols-3 gap-3">
            {#each SVG_TEMPLATES as tpl (tpl.id)}
              <button
                class="flex flex-col items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-accent"
                class:border-primary={background.type === 'svg' && background.templateId === tpl.id}
                onclick={() => selectSvgTemplate(tpl.id)}
              >
                <span
                  class="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-md text-xs"
                >
                  {tpl.name}
                </span>
              </button>
            {/each}
          </div>
          <p class="text-muted-foreground text-xs">
            动态壁纸使用主题色相，支持 SVG 动画与滤镜。
          </p>
          <a
            href="https://www.svgbackgrounds.com/set/free-svg-backgrounds-and-patterns/"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary inline-flex items-center gap-1 text-xs hover:underline"
          >
            <ExternalLinkIcon class="size-3" />
            更多 SVG 背景：SVG Backgrounds（免费下载）
          </a>
        </Tabs.Content>
      </Tabs.Root>
    </Card.Content>
  </Card.Root>
</div>

<style>
  /*
   * 桌面背景预览：模拟桌面图标（毛玻璃风格，遵循毛玻璃标准搭配）。
   * preview-pane 是隔离容器（亮/暗各一），内部 CSS 变量随 .dark class 切换。
   * preview-icon 模拟桌面图标方块（半透明 card + backdrop-blur），preview-icon-dot 模拟应用运行指示点（primary 色）。
   * 占位图标仅为展示主题色效果，非真实桌面（Tooltip 已说明）。
   */
  .preview-pane {
    /* 半透明叠加，让背景透出 */
    background: transparent;
  }
  .preview-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.5rem;
    background: color-mix(in oklch, var(--card) 70%, transparent);
    border: 1px solid color-mix(in oklch, var(--border) 70%, transparent);
    backdrop-filter: blur(8px) contrast(2) brightness(0.8);
  }
  .dark .preview-icon,
  .preview-pane.dark .preview-icon {
    backdrop-filter: blur(8px) contrast(0.8) brightness(1.2);
  }
  .preview-icon-dot {
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 9999px;
    background: var(--primary);
    border: 1.5px solid var(--background);
  }
  /* 模拟 widget 卡片（毛玻璃，同图标标准搭配），内含纯色条模拟列表内容（无文字）。 */
  .preview-widget {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem;
    border-radius: 0.625rem;
    background: color-mix(in oklch, var(--card) 70%, transparent);
    border: 1px solid color-mix(in oklch, var(--border) 70%, transparent);
    backdrop-filter: blur(8px) contrast(2) brightness(0.8);
  }
  .dark .preview-widget,
  .preview-pane.dark .preview-widget {
    backdrop-filter: blur(8px) contrast(0.8) brightness(1.2);
  }
  /* 内容条：用 muted-foreground 模拟文字行（不含实际文字，纯视觉占位）。 */
  .preview-widget-bar {
    height: 0.25rem;
    border-radius: 9999px;
    background: var(--muted-foreground);
    opacity: 0.5;
  }
  .preview-widget-bar.short {
    width: 50%;
  }

  /* 色相滑块：彩虹渐变背景，直观呈现色相空间。 */
  .hue-slider {
    background: linear-gradient(
      to right,
      oklch(0.514 0.222 0),
      oklch(0.514 0.222 60),
      oklch(0.514 0.222 120),
      oklch(0.514 0.222 180),
      oklch(0.514 0.222 240),
      oklch(0.514 0.222 300),
      oklch(0.514 0.222 360)
    );
  }
  .hue-slider::-webkit-slider-thumb {
    appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: white;
    border: 2px solid var(--primary);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.3);
    cursor: pointer;
  }
  .hue-slider::-moz-range-thumb {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: white;
    border: 2px solid var(--primary);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.3);
    cursor: pointer;
  }
  /* base 色相滑块：低彩度渐变（对应中性表面色语义，C=0.02）。 */
  .hue-slider-muted {
    background: linear-gradient(
      to right,
      oklch(0.5 0.02 0),
      oklch(0.5 0.02 60),
      oklch(0.5 0.02 120),
      oklch(0.5 0.02 180),
      oklch(0.5 0.02 240),
      oklch(0.5 0.02 300),
      oklch(0.5 0.02 360)
    );
  }
  .hue-slider-muted::-webkit-slider-thumb {
    appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: white;
    border: 2px solid var(--ring);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.3);
    cursor: pointer;
  }
  .hue-slider-muted::-moz-range-thumb {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: white;
    border: 2px solid var(--ring);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.3);
    cursor: pointer;
  }
</style>
