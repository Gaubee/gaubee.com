import { cn } from "@/lib/utils";
import { ArrowLeft, Menu } from "lucide-react";
import React, { useEffect, useState } from "react";

interface Props {
  title?: string;
  className?: string;
  onMenuClick?: () => void;
  showBackButton?: boolean;
}

const MobileTopbar: React.FC<Props> = ({
  title = "",
  className,
  onMenuClick,
  showBackButton,
}) => {
  const nav = typeof window === "object" ? window.navigation : undefined;
  const [showBack, setShowBack] = useState(showBackButton ?? false);
  useEffect(() => {
    if (showBackButton == null && typeof nav == "object") {
      const binding = () => {
        setShowBack(nav.canGoBack);
      };
      nav.addEventListener("currententrychange", binding);
      binding();
      return () => {
        nav.removeEventListener("currententrychange", binding);
      };
    }
  }, [showBackButton]);
  const handleBackClick = () => {
    try {
      if (typeof nav == "object") {
        const reversedEntries = nav
          .entries()
          .filter(
            (historyEntry) =>
              historyEntry.index < (nav.currentEntry?.index ?? 0),
          )
          .reverse();
        const currentUrl = new URL(nav.currentEntry?.url ?? location.href);
        nav.currentEntry?.index;
        for (const entry of reversedEntries) {
          if (!entry.url) {
            continue;
          }
          const historyUrl = new URL(entry.url);
          if (historyUrl.pathname !== currentUrl.pathname) {
            nav.traverseTo(entry.key, {});
            return;
          }
        }
      }
    } catch {}

    window.history.back();
  };

  return (
    <div
      id="mobile-topbar"
      className={cn(
        "sticky top-0 z-50 flex h-14 items-center justify-between border-b border-zinc-200 bg-white/80 px-4 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/80 lg:hidden",
        className,
      )}
    >
      {showBack ? (
        <button type="button" onClick={handleBackClick} aria-label="Go back">
          <ArrowLeft size={24} />
        </button>
      ) : (
        <div className="w-6" /> // Placeholder for alignment
      )}

      <div className="absolute left-1/2 -translate-x-1/2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {title}
      </div>

      {onMenuClick ? (
        <button type="button" onClick={onMenuClick} aria-label="Open menu">
          <Menu size={24} />
        </button>
      ) : (
        <div className="w-6" /> // Placeholder for alignment
      )}
    </div>
  );
};

export default MobileTopbar;
