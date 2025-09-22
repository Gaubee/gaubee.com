import { cn } from "@/lib/utils";
import { ArrowLeft, Menu } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useScaffold } from "./Scaffold";

interface Props {
  title?: string;
  className?: string;
  showBackButton?: boolean;
  showMenuButton?: boolean;
  actions?: React.ReactNode;
}

const AppBar: React.FC<Props> = ({
  title = "",
  className,
  showBackButton,
  showMenuButton,
  actions,
}) => {
  const { toggleDrawer } = useScaffold();
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
    // This back-navigation logic is quite sophisticated, attempting to find
    // the previous different page in history. We'll keep it.
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
      id="app-bar"
      className={cn(
        "flex h-14 items-center justify-between border-b border-zinc-200 bg-white/80 px-4 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/80",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {showBack ? (
          <button type="button" onClick={handleBackClick} aria-label="Go back">
            <ArrowLeft size={24} />
          </button>
        ) : showMenuButton ? (
          <button type="button" onClick={toggleDrawer} aria-label="Open menu">
            <Menu size={24} />
          </button>
        ) : (
          <div className="w-6" /> // Placeholder for alignment
        )}
      </div>

      <div className="absolute left-1/2 -translate-x-1/2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {title}
      </div>

      <div className="flex items-center gap-2">
        {actions}
      </div>
    </div>
  );
};

export default AppBar;
