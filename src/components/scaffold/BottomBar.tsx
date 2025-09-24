import { cn } from "@/lib/utils";
import React from "react";
import { useScaffold } from "./useScaffold";

interface BottomBarProps {
  children: React.ReactNode;
  className?: string;
}

const BottomBar: React.FC<BottomBarProps> = ({ children, className }) => {
  const { bottomBarVisible, breakpoint } = useScaffold();

  // Only show bottom bar on mobile
  if (breakpoint !== "mobile") {
    return null;
  }

  return (
    <footer
      className={cn(
        "fixed bottom-0 left-0 right-0 h-16 z-20",
        "bg-background/90 backdrop-blur-lg border-t",
        "transition-transform duration-300",
        !bottomBarVisible && "translate-y-full",
        className,
      )}
      style={{
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="flex h-full items-center justify-around px-2">
        {children}
      </div>
    </footer>
  );
};

export default BottomBar;
