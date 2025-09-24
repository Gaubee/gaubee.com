# ✨ feat: Implement Cross-Platform Scaffold Component

## Description

This PR introduces a comprehensive cross-platform Scaffold component system that provides a consistent layout foundation for mobile, tablet, and desktop experiences. The implementation follows Material 3 design principles with iOS-inspired gestures and interactions.

## Features Implemented

### 🏗️ Core Scaffold Components
- **Scaffold**: Main layout container with responsive behavior
- **AppBar**: Collapsible top app bar with scroll detection and safe area support
- **NavigationRail**: Collapsible side navigation for tablet/desktop
- **BottomBar**: Auto-hiding bottom navigation for mobile
- **Drawer**: Slide-in panels for both left (navigation) and right (settings) sides
- **SettingPanel**: Dedicated settings panel component

### 📱 Responsive Behavior
- **Mobile** (≤ 639px): Bottom navigation + collapsible app bar
- **Tablet** (640px–1023px): Collapsible navigation rail (72px/208px)
- **Desktop** (≥ 1024px): Permanent navigation rail (208px)

### 🎨 Design System Integration
- Built with shadcn/ui components for consistency
- Material 3 design principles with iOS gesture support
- Dynamic theming with light/dark mode persistence
- Safe area insets for mobile devices
- Smooth transitions and animations

### 🧠 State Management
- React Context API for state management
- Scroll position tracking for app bar collapsing
- Breakpoint detection with resize handling
- LocalStorage persistence for user preferences

## Technical Details

### Component Architecture
```
ScaffoldProvider (Context)
└── Scaffold (Layout Container)
    ├── NavigationRail (Tablet/Desktop)
    ├── Main Content Area
    │   ├── AppBar (Top)
    │   ├── Main Content
    │   └── BottomBar (Mobile)
    ├── Drawer (Left - Navigation)
    └── Drawer (Right - Settings)
```

### Breakpoint System
```ts
const BREAKPOINTS = {
  mobile: 0,      // ≤ 639px
  tablet: 640,    // 640px–1023px
  desktop: 1024,  // ≥ 1024px
}
```

### State Management
All scaffold state is managed through React Context:
- Drawer open/close states
- Theme mode (light/dark)
- Scroll position tracking
- Breakpoint detection
- Navigation rail collapsed state

## Usage

### Basic Implementation
```tsx
import { ScaffoldProvider } from "@/components/scaffold/scaffoldAtoms";
import Scaffold from "@/components/scaffold/Scaffold";
import AppBar from "@/components/scaffold/AppBar";

export default function App() {
  return (
    <ScaffoldProvider>
      <Scaffold>
        <NavigationRail>
          {/* Navigation items */}
        </NavigationRail>
        
        <div className="flex flex-col flex-1">
          <AppBar title="My App" />
          <main className="flex-1 p-4">
            {/* Main content */}
          </main>
          <BottomBar>
            {/* Bottom navigation */}
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

### Using the Hook
```tsx
import { useScaffold } from "@/components/scaffold/useScaffold";

const MyComponent = () => {
  const { drawerOpen, setDrawerOpen, theme, setTheme } = useScaffold();
  
  return (
    <button onClick={() => setDrawerOpen(true)}>
      Open Drawer
    </button>
  );
};
```

## Integration with Existing Pages

The Scaffold components have been integrated into all existing pages:
- Homepage (`/`)
- Article pages (`/articles/[id]`)
- Event pages (`/events/[id]`)
- Article list (`/articles`)
- Event list (`/events`)
- Archive pages (`/archive/[year]/[month]`)
- Tag pages (`/tags/[tag]`)

Each page now uses the new `ScaffoldLayout` which provides:
- Responsive layout that adapts to mobile/tablet/desktop
- Consistent navigation across all pages
- Proper SEO title handling
- Integrated sidebars and navigation components

## Files Added

```
src/components/scaffold/
├── AppBar.tsx
├── BottomBar.tsx
├── Drawer.tsx
├── NavigationRail.tsx
├── Scaffold.tsx
├── ScaffoldExample.tsx
├── SettingPanel.tsx
├── index.ts
├── scaffoldAtoms.ts
├── useScaffold.ts
└── README.md
```

## Files Modified

```
src/layouts/
├── ScaffoldLayout.astro (new)
src/pages/
├── index.astro
├── articles.astro
├── events.astro
├── articles/[...id].astro
├── events/[...id].astro
├── archive/[year]/[month].astro
└── tags/[tag].astro
```

## Demo

A demo page is available at `/test/scaffold-demo` to showcase the responsive behavior across different device sizes.

## Testing

The components have been tested for:
- ✅ Responsive layout behavior
- ✅ Scroll-based app bar collapsing
- ✅ Theme persistence
- ✅ Keyboard navigation
- ✅ Safe area insets
- ✅ SSR compatibility
- ✅ Integration with existing pages

### Screenshot Verification
Screenshot tests have been run to verify the responsive behavior across different device sizes:
- Mobile view (375x667): `tests/jules-scratch/scaffold-mobile-view.png`
- Tablet view (768x1024): `tests/jules-scratch/scaffold-tablet-view.png`
- Desktop view (1280x720): `tests/jules-scratch/scaffold-desktop-view.png`

## Documentation

Complete documentation is available in `src/components/scaffold/README.md` with usage examples and API references.