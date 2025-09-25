import { cn } from "@/lib/utils";
import { iter_map_not_null } from "@gaubee/util";
import React, {
  useEffect,
  useMemo,
  useRef,
  useState, // 引入 useMemo
  type ReactNode,
} from "react";
import { MagicCard } from "../ui/magic-card";
import { ProgressiveBlur } from "../ui/progressive-blur";
import { PreviewImages } from "./PreviewImages";

interface PreviewCardProps {
  key?: React.Key | null;
  header?: ReactNode;
  datetime?: string | number | Date;
  images?: string[];
  href?: string;
  title?: string;
  collection?: string;
  children?: ReactNode;
}
export default function PreviewCard({
  key,
  header,
  children,
  images,
  datetime,
  title,
  collection,
  href,
}: PreviewCardProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  // 新增 state，用于控制内容的“淡入”动画效果
  const [isContentVisible, setIsContentVisible] = useState(false);

  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    const checkOverflow = () => {
      if (contentElement.scrollHeight > contentElement.clientHeight) {
        setIsOverflowing(true);
      } else {
        setIsOverflowing(false);
      }
      // 检查完成后，设置内容为可见，触发动画
      setIsContentVisible(true);
    };

    // 初始检查
    checkOverflow();

    const resizeObserver = new ResizeObserver(checkOverflow);
    resizeObserver.observe(contentElement);

    return () => resizeObserver.disconnect();
  }, [children]); // 依赖项保持不变

  // [性能优化] 使用 useMemo 缓存头部元数据的 JSX 结构
  const headerMeta = useMemo(() => {
    if (!collection && !datetime) return null;

    const date = datetime ? new Date(datetime) : null;

    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        {iter_map_not_null([
          collection && <span className="capitalize">{collection}</span>,
          date && (
            <time dateTime={date.toISOString()}>
              {date.toLocaleDateString("zh-cn", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </time>
          ),
        ])
          .map((item, i, arr) =>
            i !== arr.length - 1
              ? [item, <span key={`dot-${i}`}>·</span>]
              : item,
          )
          .flat()}
      </div>
    );
  }, [collection, datetime]);

  // [性能优化] 使用 useMemo 缓存图片数组的 props
  const previewImagesProps = useMemo(() => {
    if (!images || images.length === 0) return null;
    return {
      className: "drop-shadow-md",
      images: images.map((src) => ({
        src,
        alt: `preview image for ${title}`,
      })),
    };
  }, [images, title]);

  return (
    <MagicCard key={key} gradientOpacity={0.1}>
      <article className={cn("flex flex-col gap-4 p-4 pb-2")}>
        {header ?? (
          <div className="flex flex-col gap-2">
            {headerMeta}
            <a href={href}>
              <h2 className="text-xl font-bold text-zinc-800 dark:text-zinc-100">
                {title}
              </h2>
            </a>
            {previewImagesProps && <PreviewImages {...previewImagesProps} />}
          </div>
        )}
        {/*
          [动画实现]
          - 添加 transition-opacity 和 duration-500 来定义动画效果
          - 根据 isContentVisible 的状态切换 opacity-10 (初始) 和 opacity-100 (动画后)
        */}
        <div
          ref={contentRef}
          className={cn(
            "relative max-h-[13rem] overflow-hidden transition-opacity duration-500",
            isContentVisible ? "opacity-100" : "opacity-0",
          )}
          style={{
            scrollbarWidth: "none",
          }}
        >
          {children}
        </div>
        {isOverflowing && (
          <ProgressiveBlur
            height="180px"
            position="bottom"
            className="right-[1px] !bottom-[1px] left-[1px]"
            blurLevels={[0.5, 0.6, 0.8, 1.2, 2, 4, 6, 8]}
          />
        )}
      </article>
    </MagicCard>
  );
}
