# Scaffold Component

A cross-platform scaffold component for building responsive applications with consistent layout patterns across mobile, tablet, and desktop.

## Features

- **Responsive Layout**: Automatically adapts to different screen sizes
- **AppBar**: Collapsible app bar with scroll detection
- **NavigationRail**: Collapsible navigation rail for tablet/desktop
- **BottomBar**: Auto-hiding bottom navigation for mobile
- **Drawer**: Slide-in panels for both left (navigation) and right (settings) sides
- **SafeArea Support**: Proper handling of device safe areas
- **SSR Compatible**: Works with server-side rendering
- **Theming**: Supports light/dark theme persistence

## Breakpoint System

```ts
const BREAKPOINTS = {
  mobile: 0,      // ≤ 639px
  tablet: 640,    // 640px–1023px
  desktop: 1024,  // ≥ 1024px
}
```

## Layout Behavior

### Mobile (≤ 639px)
- Bottom navigation bar
- Collapsible top app bar
- Left drawer for navigation
- Right drawer for settings

### Tablet (640px–1023px)
- Collapsible navigation rail (72px collapsed, 208px expanded)
- Collapsible top app bar
- Right drawer for settings

### Desktop (≥ 1024px)
- Permanent navigation rail (208px expanded)
- Collapsible top app bar
- Right drawer for settings

## Installation

```bash
# The scaffold components are part of this project and don't require additional installation
```

## Usage

### Basic Setup

```tsx
import { ScaffoldProvider } from "@/components/scaffold/scaffoldAtoms";
import Scaffold from "@/components/scaffold/Scaffold";
import AppBar from "@/components/scaffold/AppBar";
import NavigationRail from "@/components/scaffold/NavigationRail";
import BottomBar from "@/components/scaffold/BottomBar";
import Drawer from "@/components/scaffold/Drawer";
import SettingPanel from "@/components/scaffold/SettingPanel";

export default function App() {
  return (
    <ScaffoldProvider>
      <Scaffold>
        <NavigationRail>
          {/* Navigation content */}
        </NavigationRail>
        
        <div className="flex flex-col flex-1">
          <AppBar title="My App" />
          
          <main className="flex-1 p-4">
            {/* Main content */}
          </main>
          
          <BottomBar>
            {/* Bottom navigation items */}
          </BottomBar>
        </div>
        
        <Drawer side="left">
          {/* Left drawer content */}
        </Drawer>
        
        <Drawer side="right">
          <SettingPanel title="Settings">
            {/* Settings content */}
          </SettingPanel>
        </Drawer>
      </Scaffold>
    </ScaffoldProvider>
  );
}
```

### Using the useScaffold Hook

```tsx
import { useScaffold } from "@/components/scaffold/useScaffold";

const MyComponent = () => {
  const {
    drawerOpen,
    setDrawerOpen,
    settingOpen,
    setSettingOpen,
    theme,
    setTheme,
    breakpoint
  } = useScaffold();

  return (
    <div>
      <p>Current breakpoint: {breakpoint}</p>
      <p>Current theme: {theme}</p>
      <button onClick={() => setDrawerOpen(true)}>
        Open Drawer
      </button>
    </div>
  );
};
```

## Components

### ScaffoldProvider
Wraps your app to provide scaffold state to all components.

**Props:**
- `children`: React.ReactNode
- `initialTheme`: "light" | "dark" (default: "light")

### Scaffold
The main layout container that handles responsive behavior.

**Props:**
- `children`: React.ReactNode
- `className`: string (optional)

### AppBar
Top app bar with scroll collapsing behavior.

**Props:**
- `title`: string (optional)
- `className`: string (optional)
- `children`: React.ReactNode (optional - replaces default content)

### NavigationRail
Side navigation rail for tablet/desktop.

**Props:**
- `children`: React.ReactNode
- `className`: string (optional)

### BottomBar
Bottom navigation bar for mobile.

**Props:**
- `children`: React.ReactNode
- `className`: string (optional)

### Drawer
Slide-in panel that can be positioned on left or right.

**Props:**
- `side`: "left" | "right" (default: "left")
- `children`: React.ReactNode
- `className`: string (optional)

### SettingPanel
Content container for the settings drawer.

**Props:**
- `title`: string (default: "Settings")
- `children`: React.ReactNode
- `className`: string (optional)

## State Management

The scaffold uses React Context for state management. The following state properties are available:

- `drawerOpen` / `setDrawerOpen`: Left drawer open state
- `settingOpen` / `setSettingOpen`: Right settings drawer open state
- `bottomBarVisible` / `setBottomBarVisible`: Bottom bar visibility
- `scrollY` / `setScrollY`: Scroll position for app bar collapsing
- `activeRoute` / `setActiveRoute`: Current route
- `theme` / `setTheme`: Theme mode ("light" | "dark")
- `breakpoint` / `setBreakpoint`: Current breakpoint ("mobile" | "tablet" | "desktop")
- `railCollapsed` / `setRailCollapsed`: Navigation rail collapsed state

## Customization

### CSS Classes
All components accept a `className` prop for custom styling.

### Theme Customization
The theme is persisted in localStorage and can be controlled via the `theme` state.

### Breakpoint Customization
Breakpoints are defined in `scaffoldAtoms.ts` and can be modified as needed.

## Accessibility

- All interactive elements have proper ARIA labels
- Keyboard navigation support (Escape key to close drawers)
- Focus trapping within drawers
- Proper semantic HTML structure

## Safe Area Support

The AppBar and BottomBar automatically handle device safe areas using CSS environment variables:
- `env(safe-area-inset-top)` for AppBar
- `env(safe-area-inset-bottom)` for BottomBar