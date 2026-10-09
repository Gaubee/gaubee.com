/**
 * authorHoverCard — 内容容器上的 @作者 hover 浮卡代理（应用层方案，2026-10-09 裁决 4）。
 *
 * 数据边界（重要）：
 * - 作者数据来自生成器注入的 data-* 属性（data-name / data-avatar，可选 data-handle），
 *   生成器侧注入属于 x-arch-render 渲染器改动（并行任务），本 action 不改渲染器。
 * - 读不到 data-name 且读不到 data-avatar 时优雅降级为不浮卡（接口留给数据任务落地）。
 * - @handle 无 data-handle 时从容器的 href（https://x.com/<handle>，既有标记）反推。
 *
 * 交互：对 .x-arch-author 做事件委托（pointerover/out + focusin/out），
 * 浮卡挂在与滚动容器同层的宿主元素内（absolute 定位，随内容滚动锚定），
 * 滚动即收卡；指针移入浮卡保持显示（可点「在 X 查看」外链）。
 *
 * 样式：x-archive.css 同族（var(--card)/var(--border) 令牌），见 author-hover-card.css，
 * 由消费方组件导入（样式自治：谁渲染谁导入）。
 */

/** 浮卡数据（全部为已净化的展示字符串）。 */
interface AuthorCardInfo {
  /** 显示名（data-name；缺省回退 handle）。 */
  name: string;
  /** @handle（data-handle > href 反推 > name）。 */
  handle: string;
  /** 头像 URL（data-avatar；可为空 → 渲染首字母占位）。 */
  avatar: string;
  /** 「在 X 查看」外链（作者链接自身 href）。 */
  href: string;
}

const HIDE_DELAY_MS = 150;

/** 从 x.com/twitter.com 链接反推 handle（既有标记，无需渲染器改动）。 */
function handleFromHref(href: string): string {
  try {
    const url = new URL(href, window.location.href);
    const host = url.hostname.replace(/^www\./, "");
    if (host !== "x.com" && host !== "twitter.com") return "";
    const seg = decodeURIComponent(url.pathname.split("/")[0] ?? "");
    return /^[\w.]{1,20}$/.test(seg) ? seg : "";
  } catch {
    return "";
  }
}

/** 读取作者信息；data-name 与 data-avatar 均缺失 → null（不浮卡，优雅降级）。 */
function readAuthor(el: HTMLElement): AuthorCardInfo | null {
  const name = (el.getAttribute("data-name") ?? "").trim();
  const avatar = (el.getAttribute("data-avatar") ?? "").trim();
  if (!name && !avatar) return null;
  const href = el.getAttribute("href") ?? "";
  const handle =
    (el.getAttribute("data-handle") ?? "").trim() || handleFromHref(href) || name.replace(/^@/, "");
  return {
    name: name || handle,
    handle: handle ? `@${handle.replace(/^@/, "")}` : "",
    avatar,
    href,
  };
}

/** 用 DOM API 组浮卡（textContent 赋值，天然免注入）。 */
function buildCard(info: AuthorCardInfo): HTMLElement {
  const card = document.createElement("div");
  card.className = "author-hover-card";
  card.setAttribute("role", "tooltip");

  if (info.avatar) {
    const img = document.createElement("img");
    img.className = "author-hover-card-avatar";
    img.src = info.avatar;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    card.appendChild(img);
  } else {
    const dot = document.createElement("span");
    dot.className = "author-hover-card-avatar author-hover-card-avatar-fallback";
    dot.textContent = (info.name || "@").slice(0, 1).toUpperCase();
    card.appendChild(dot);
  }

  const meta = document.createElement("span");
  meta.className = "author-hover-card-meta";
  const nameEl = document.createElement("span");
  nameEl.className = "author-hover-card-name";
  nameEl.textContent = info.name;
  meta.appendChild(nameEl);
  if (info.handle) {
    const handleEl = document.createElement("span");
    handleEl.className = "author-hover-card-handle";
    handleEl.textContent = info.handle;
    meta.appendChild(handleEl);
  }
  card.appendChild(meta);

  if (info.href) {
    const link = document.createElement("a");
    link.className = "author-hover-card-link";
    link.href = info.href;
    link.target = "_blank";
    link.rel = "noopener nofollow noreferrer";
    link.textContent = "在 X 查看 ↗";
    card.appendChild(link);
  }
  return card;
}

/** Svelte action：在容器上代理 .x-arch-author 的 hover/focus 浮卡。 */
export function authorHoverCard(container: HTMLElement): { destroy(): void } {
  // 浮卡以宿主为定位上下文（content 容器多为静态块，这里补 relative，副作用局部）
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }

  let card: HTMLElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  /** 当前锚定的作者链接（判断 pointer 是否仍在 链接+浮卡 组合内）。 */
  let anchor: HTMLAnchorElement | null = null;

  function clearHideTimer(): void {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function hide(): void {
    clearHideTimer();
    card?.remove();
    card = null;
    anchor = null;
  }

  function scheduleHide(): void {
    clearHideTimer();
    hideTimer = setTimeout(hide, HIDE_DELAY_MS);
  }

  function show(el: HTMLElement): void {
    const next = el as HTMLAnchorElement;
    if (anchor === next && card) return;
    hide();
    const info = readAuthor(next);
    if (!info) return;
    anchor = next;
    card = buildCard(info);
    container.appendChild(card);
    // 定位：锚元素下方左对齐，横向夹在容器内（先挂载再量宽）
    const contRect = container.getBoundingClientRect();
    const elRect = next.getBoundingClientRect();
    const width = card.offsetWidth;
    let left = elRect.left - contRect.left;
    left = Math.max(4, Math.min(left, contRect.width - width - 4));
    const top = elRect.bottom - contRect.top + container.scrollTop + 6;
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  }

  function isInsideGroup(target: EventTarget | null): boolean {
    const node = target as Node | null;
    if (!node) return false;
    if (anchor && (node === anchor || anchor.contains(node))) return true;
    if (card && (node === card || card.contains(node))) return true;
    return false;
  }

  function onPointerOver(event: PointerEvent): void {
    // 链接/浮卡组合内的任何进入都取消收卡计时（浮卡内移动不闪断）
    if (isInsideGroup(event.target)) clearHideTimer();
    const el = (event.target as HTMLElement | null)?.closest<HTMLElement>(".x-arch-author");
    if (el) show(el);
  }

  function onPointerOut(event: PointerEvent): void {
    if (!card) return;
    // 进入目标仍在链接/浮卡组合内则保持；移出组合才安排收卡（重进由 pointerover 取消）
    if (isInsideGroup(event.relatedTarget)) return;
    scheduleHide();
  }

  function onFocusIn(event: FocusEvent): void {
    const el = (event.target as HTMLElement | null)?.closest<HTMLElement>(".x-arch-author");
    if (el) show(el);
  }

  function onFocusOut(event: FocusEvent): void {
    if (!card) return;
    if (isInsideGroup(event.relatedTarget)) return;
    scheduleHide();
  }

  function onScroll(): void {
    // 滚动即收卡：absolute 锚定语义下避免浮卡滞留错位
    if (card) hide();
  }

  container.addEventListener("pointerover", onPointerOver);
  container.addEventListener("pointerout", onPointerOut);
  container.addEventListener("focusin", onFocusIn);
  container.addEventListener("focusout", onFocusOut);
  container.addEventListener("scroll", onScroll, true);

  return {
    destroy(): void {
      clearHideTimer();
      container.removeEventListener("pointerover", onPointerOver);
      container.removeEventListener("pointerout", onPointerOut);
      container.removeEventListener("focusin", onFocusIn);
      container.removeEventListener("focusout", onFocusOut);
      container.removeEventListener("scroll", onScroll, true);
      card?.remove();
      card = null;
      anchor = null;
    },
  };
}
