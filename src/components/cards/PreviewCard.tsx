import { cn } from "@/lib/utils";
import { iter_map_not_null } from "@gaubee/util";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { MagicCard } from "../ui/magic-card";
import { ProgressiveBlur } from "../ui/progressive-blur";

interface PreviewCardProps {
  header?: ReactNode;
  datetime?: string | number | Date;
  images?: string[];
  href?: string;
  title?: string;
  collection?: string;
  children: ReactNode;
}
function getGridColsClass(count: number): string {
  if (count === 1) return "grid-cols-1";
  if (count === 2 || count === 4) return "grid-cols-2";
  return "grid-cols-3";
}
function getImgAspectRatio(count: number): string {
  if (count === 1) return "aspect-16/9";
  if (count === 2) return "aspect-3/3";
  if (count === 3) return "aspect-3/2";
  if (count === 4) return "aspect-4/2";
  return "aspect-3/2";
}

export default function PreviewCard({
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

  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    const checkOverflow = () => {
      // Check if the scroll height is greater than the client height
      if (contentElement.scrollHeight > contentElement.clientHeight) {
        setIsOverflowing(true);
      } else {
        setIsOverflowing(false);
      }
    };

    // Initial check
    checkOverflow();

    // Use ResizeObserver to check for overflow when the content changes size
    const resizeObserver = new ResizeObserver(checkOverflow);
    resizeObserver.observe(contentElement);

    // Cleanup observer on component unmount
    return () => resizeObserver.disconnect();
  }, [children]); // Rerun effect if children change

  return (
    <MagicCard gradientOpacity={0.1}>
      <a
        href={href}
        className={cn("flex flex-col gap-4 p-4", isOverflowing ? "pb-1" : "")}
      >
        {header ?? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              {iter_map_not_null([
                collection && <span className="capitalize">{collection}</span>,
                datetime && (
                  <time dateTime={new Date(datetime).toISOString()}>
                    {new Date(datetime).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </time>
                ),
              ])
                .map((item, i, arr) => {
                  if (i !== arr.length - 1) {
                    return [item, <span>·</span>];
                  }
                  return item;
                })
                .flat()}
            </div>
            <h2 className="text-xl font-bold text-zinc-800 dark:text-zinc-100">
              {title}
            </h2>
            {images && images.length > 0 && (
              <div
                className={cn([
                  "grid",
                  "gap-2",
                  getGridColsClass(images.length),
                ])}
              >
                {images.slice(0, 9).map((src) => (
                  <img
                    src={src}
                    alt={`preview image for ${title}`}
                    className={cn(
                      "h-auto w-full rounded-md object-cover",
                      getImgAspectRatio(images.length),
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        <div
          ref={contentRef}
          className={`relative max-h-[13rem] overflow-hidden`}
          style={{
            scrollbarWidth: "none",
          }}
        >
          {children}
        </div>
        {isOverflowing && (
          // <div className="to-background pointer-events-none absolute inset-[0_1px_1px] bg-gradient-to-b from-transparent from-50%"></div>
          <ProgressiveBlur
            height="180px"
            position="bottom"
            className="right-[1px] !bottom-[1px] left-[1px]"
            blurLevels={[0.5, 0.6, 0.8, 1.2, 2, 4, 6, 8]}
          />
        )}
      </a>
    </MagicCard>
  );
}
