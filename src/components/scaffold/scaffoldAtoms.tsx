import { useEffect, useState, type ReactNode } from "react";
import { ScaffoldContext } from "./useScaffold";

// Define the scaffold state type
export interface ScaffoldState {
  // Left drawer open state
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;

  // Right setting panel open state
  settingOpen: boolean;
  setSettingOpen: (open: boolean) => void;

  // Bottom bar visibility
  bottomBarVisible: boolean;
  setBottomBarVisible: (visible: boolean) => void;

  // Scroll Y position for app bar collapsing
  scrollY: number;
  setScrollY: (y: number) => void;

  // Current active route
  activeRoute: string;
  setActiveRoute: (route: string) => void;

  // Theme mode
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;

  // Breakpoint detection
  breakpoint: "mobile" | "tablet" | "desktop";
  setBreakpoint: (breakpoint: "mobile" | "tablet" | "desktop") => void;

  // Navigation rail collapsed state (for tablet)
  railCollapsed: boolean;
  setRailCollapsed: (collapsed: boolean) => void;
}

// Provider component
export const ScaffoldProvider = ({
  children,
  initialTheme = "light",
}: {
  children: ReactNode;
  initialTheme?: "light" | "dark";
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingOpen, setSettingOpen] = useState(false);
  const [bottomBarVisible, setBottomBarVisible] = useState(true);
  const [scrollY, setScrollY] = useState(0);
  const [activeRoute, setActiveRoute] = useState(
    typeof window !== "undefined" ? window.location.pathname : "/",
  );
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  const [breakpoint, setBreakpoint] = useState<"mobile" | "tablet" | "desktop">(
    "desktop",
  );
  const [railCollapsed, setRailCollapsed] = useState(false);

  // Load theme from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("theme") as
        | "light"
        | "dark"
        | null;
      if (savedTheme) {
        setTheme(savedTheme);
      }
    }
  }, []);

  // Save theme to localStorage when it changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("theme", theme);
    }
  }, [theme]);

  return (
    <ScaffoldContext.Provider
      value={{
        drawerOpen,
        setDrawerOpen,
        settingOpen,
        setSettingOpen,
        bottomBarVisible,
        setBottomBarVisible,
        scrollY,
        setScrollY,
        activeRoute,
        setActiveRoute,
        theme,
        setTheme,
        breakpoint,
        setBreakpoint,
        railCollapsed,
        setRailCollapsed,
      }}
    >
      {children}
    </ScaffoldContext.Provider>
  );
};

// Breakpoint constants
export const BREAKPOINTS = {
  mobile: 0, // ≤ 639px
  tablet: 640, // 640px–1023px
  desktop: 1024, // ≥ 1024px
};
