import { useState, useEffect, useRef, type ReactNode } from "react";

interface PreviewCardProps {
  header: ReactNode;
  children: ReactNode;
}

export default function PreviewCard({ header, children }: PreviewCardProps) {
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
    <div className="flex flex-col gap-4 p-4">
      {header}
      <div
        ref={contentRef}
        className={`relative overflow-hidden max-h-[13rem]`}
      >
        {children}
        {isOverflowing && (
          <div className="absolute inset-0 mask-fade-bottom pointer-events-none"></div>
        )}
      </div>
    </div>
  );
}
