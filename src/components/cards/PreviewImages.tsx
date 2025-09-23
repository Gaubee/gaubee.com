import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface PreviewImagesProps {
  images: Array<{ src: string; alt?: string }>;
  className?: string;
}
export const PreviewImages = ({ images, className }: PreviewImagesProps) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScrollability = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) {
      const isScrollable = el.scrollWidth > el.clientWidth;
      // 增加一个小的容差值（比如1或2），防止因为四舍五入导致判断不准
      const atStart = el.scrollLeft <= 1;
      const atEnd = el.scrollLeft >= el.scrollWidth - el.clientWidth - 1;

      setCanScrollLeft(isScrollable && !atStart);
      setCanScrollRight(isScrollable && !atEnd);
    }
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    checkScrollability(); // 初始检查

    const resizeObserver = new ResizeObserver(checkScrollability);
    resizeObserver.observe(el);

    el.addEventListener("scroll", checkScrollability, { passive: true });

    return () => {
      resizeObserver.disconnect();
      el.removeEventListener("scroll", checkScrollability);
    };
  }, [images.length, checkScrollability]);

  const handleScroll = (direction: "left" | "right") => {
    const el = scrollContainerRef.current;
    if (el) {
      // 每次滚动大约容器宽度的80%，CSS Scroll Snap 会自动吸附到最近的图片
      const scrollAmount = el.clientWidth * 0.8;
      el.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  if (!images || images.length === 0) {
    return null;
  }

  return (
    <div className={cn("relative group", className)}>
      {/* --- 左滚动按钮 --- */}
      <button
        onClick={(e) => {
          e.preventDefault();
          handleScroll("left");
        }}
        disabled={!canScrollLeft}
        className={cn(
          "absolute top-1/2 left-2 z-10 -translate-y-1/2 bg-white/60 backdrop-blur-sm rounded-full p-1 text-gray-800 shadow-md transition hover:bg-white/90 focus:outline-none",
          "opacity-0 group-hover:opacity-100 disabled:opacity-0 disabled:cursor-not-allowed",
        )}
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      {/* --- 图片滚动容器 (核心改动) --- */}
      <div
        ref={scrollContainerRef}
        className={cn(
          "flex h-44 space-x-2 overflow-x-auto rounded-md",
          "scrollbar-none", // 隐藏滚动条
          // --- CSS Scroll Snap ---
          "scroll-smooth", // 确保 JS 触发的滚动也是平滑的
          "snap-x snap-mandatory", // 强制在 x 轴上进行滚动快照
        )}
      >
        {images.slice(0, 9).map(({ src, alt }, index) => (
          <div key={index} className="flex-shrink-0 scroll-snap-align-start">
            <img
              src={src}
              alt={alt || `preview image ${index + 1}`}
              className="h-full w-auto rounded-md bg-gray-200 object-cover"
            />
          </div>
        ))}
      </div>

      {/* --- 右滚动按钮 --- */}
      <button
        onClick={(e) => {
          e.preventDefault();
          handleScroll("right");
        }}
        disabled={!canScrollRight}
        className={cn(
          "absolute top-1/2 right-2 z-10 -translate-y-1/2 bg-white/60 backdrop-blur-sm rounded-full p-1 text-gray-800 shadow-md transition hover:bg-white/90 focus:outline-none",
          "opacity-0 group-hover:opacity-100 disabled:opacity-0 disabled:cursor-not-allowed",
        )}
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
};
