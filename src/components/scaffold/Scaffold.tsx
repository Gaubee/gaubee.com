import { cn } from "@/lib/utils";
import React, { useEffect } from "react";
import { BREAKPOINTS } from "./scaffoldAtoms";
import { useScaffold } from "./useScaffold";

interface ScaffoldProps {
  children: React.ReactNode;
  className?: string;
}

const Scaffold: React.FC<ScaffoldProps> = ({ children, className }) => {
  const {
    setBreakpoint,
    setScrollY,
    bottomBarVisible,
    railCollapsed,
    breakpoint,
  } = useScaffold();

  // Handle breakpoint detection
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < BREAKPOINTS.tablet) {
        setBreakpoint("mobile");
      } else if (width < BREAKPOINTS.desktop) {
        setBreakpoint("tablet");
      } else {
        setBreakpoint("desktop");
      }
    };

    handleResize(); // Set initial breakpoint
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setBreakpoint]);

  // Handle scroll detection
  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [setScrollY]);

  // Determine layout classes based on breakpoint
  const containerClasses = cn("flex min-h-screen w-full", className);

  const mainClasses = cn(
    "flex-1",
    // Add top padding for mobile to account for top app bar
    breakpoint === "mobile" && "pt-14",
    // Add bottom padding for mobile to account for bottom bar
    breakpoint === "mobile" && bottomBarVisible && "pb-16",
    // Add left padding for desktop when rail is expanded
    breakpoint === "desktop" && !railCollapsed && "pl-52",
    // Add left padding for desktop when rail is collapsed
    breakpoint === "desktop" && railCollapsed && "pl-18",
    // Add left padding for tablet
    breakpoint === "tablet" && "pl-18",
  );

  return <div className={containerClasses}>{children}</div>;
};

export default Scaffold;
