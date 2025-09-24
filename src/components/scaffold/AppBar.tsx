import React from "react";
import { useScaffold } from "./useScaffold";
import { cn } from "@/lib/utils";
import { Menu, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AppBarProps {
  title?: string;
  className?: string;
  children?: React.ReactNode;
}

const AppBar: React.FC<AppBarProps> = ({ title, className, children }) => {
  const { scrollY, breakpoint, setDrawerOpen, setSettingOpen } = useScaffold();
  const collapsed = scrollY > 40;

  // Determine app bar height based on breakpoint
  const appBarHeight = breakpoint === "mobile" ? "h-14" : "h-16";

  return (
    <header
      className={cn(
        "sticky top-0 z-20 transition-all duration-300",
        "bg-background/80 backdrop-blur-lg supports-backdrop-blur:bg-background/60",
        collapsed && "shadow-sm",
        appBarHeight,
        className
      )}
      style={{
        // Add safe area inset for mobile devices
        paddingTop: breakpoint === "mobile" ? "env(safe-area-inset-top)" : undefined
      }}
    >
      <div className="flex h-full items-center px-4">
        {children ? (
          children
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="md:hidden"
            >
              <Menu className="h-5 w-5" />
            </Button>
            
            <div className="flex-1 min-w-0">
              {title && (
                <h1 className="text-lg font-semibold truncate">
                  {title}
                </h1>
              )}
            </div>
            
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSettingOpen(true)}
              aria-label="Open settings"
            >
              <Settings className="h-5 w-5" />
            </Button>
          </>
        )}
      </div>
    </header>
  );
};

export default AppBar;