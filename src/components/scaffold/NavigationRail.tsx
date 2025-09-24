import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import React from "react";
import { useScaffold } from "./useScaffold";

interface NavigationRailProps {
  children: React.ReactNode;
  className?: string;
}

const NavigationRail: React.FC<NavigationRailProps> = ({
  children,
  className,
}) => {
  const { breakpoint, railCollapsed, setRailCollapsed } = useScaffold();

  // Only show navigation rail on tablet and desktop
  if (breakpoint === "mobile") {
    return null;
  }

  // Determine width based on breakpoint and collapsed state
  let widthClass = "";
  if (breakpoint === "tablet") {
    widthClass = railCollapsed ? "w-18" : "w-52";
  } else if (breakpoint === "desktop") {
    widthClass = railCollapsed ? "w-18" : "w-52";
  }

  return (
    <aside
      className={cn(
        "sticky top-0 h-screen flex flex-col border-r bg-background",
        widthClass,
        className,
      )}
    >
      {/* Collapse/expand button */}
      <div className="flex justify-end p-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setRailCollapsed(!railCollapsed)}
          aria-label={
            railCollapsed ? "Expand navigation" : "Collapse navigation"
          }
        >
          {railCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Navigation content */}
      <div className="flex-1 overflow-y-auto">
        <div className={cn("px-2", railCollapsed ? "px-1" : "px-2")}>
          {children}
        </div>
      </div>
    </aside>
  );
};

export default NavigationRail;
