import React from "react";
import Scaffold from "./Scaffold";
import AppBar from "./AppBar";
import Drawer from "./Drawer";
import BottomBar from "./BottomBar";
import NavigationRail from "./NavigationRail";
import SettingPanel from "./SettingPanel";
import { ScaffoldProvider } from "./scaffoldAtoms";
import { Button } from "@/components/ui/button";
import { Home, Search, Settings, User, Bell, Bookmark } from "lucide-react";

// Example navigation items
const navItems = [
  { icon: Home, label: "Home" },
  { icon: Search, label: "Search" },
  { icon: Bookmark, label: "Bookmarks" },
  { icon: Bell, label: "Notifications" },
  { icon: User, label: "Profile" },
];

// Example bottom bar items
const bottomItems = [
  { icon: Home, label: "Home" },
  { icon: Search, label: "Search" },
  { icon: Bell, label: "Notifications" },
  { icon: User, label: "Profile" },
];

const ScaffoldExample: React.FC = () => {
  return (
    <ScaffoldProvider>
      <Scaffold>
        {/* Navigation Rail (Tablet/Desktop) */}
        <NavigationRail>
          <div className="space-y-2">
            {navItems.map((item, index) => {
              const Icon = item.icon;
              return (
                <Button key={index} variant="ghost" className="w-full justify-start">
                  <Icon className="h-5 w-5 mr-2" />
                  <span>{item.label}</span>
                </Button>
              );
            })}
          </div>
        </NavigationRail>

        {/* Main Content Area */}
        <div className="flex flex-col flex-1">
          <AppBar title="My App" />
          
          <main className="flex-1 p-4 overflow-y-auto">
            <div className="max-w-4xl mx-auto">
              <h1 className="text-2xl font-bold mb-4">Welcome to Scaffold Example</h1>
              <p className="mb-4">
                This is an example of how to use the Scaffold components. The layout will 
                automatically adapt to different screen sizes:
              </p>
              <ul className="list-disc pl-5 mb-4">
                <li>Mobile: Bottom bar + collapsible app bar</li>
                <li>Tablet: Collapsible navigation rail</li>
                <li>Desktop: Permanent navigation rail</li>
              </ul>
              <p>
                Try resizing your browser window to see the responsive behavior in action.
              </p>
            </div>
          </main>
          
          <BottomBar>
            {bottomItems.map((item, index) => {
              const Icon = item.icon;
              return (
                <Button key={index} variant="ghost" size="icon" className="flex-1">
                  <Icon className="h-5 w-5" />
                </Button>
              );
            })}
          </BottomBar>
        </div>

        {/* Left Drawer */}
        <Drawer side="left">
          <div className="p-4">
            <h2 className="text-lg font-semibold mb-4">Menu</h2>
            <nav className="space-y-2">
              {navItems.map((item, index) => {
                const Icon = item.icon;
                return (
                  <Button key={index} variant="ghost" className="w-full justify-start">
                    <Icon className="h-5 w-5 mr-2" />
                    <span>{item.label}</span>
                  </Button>
                );
              })}
            </nav>
          </div>
        </Drawer>

        {/* Right Drawer (Settings) */}
        <Drawer side="right">
          <SettingPanel title="Settings">
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium mb-2">Appearance</h3>
                <p className="text-sm text-muted-foreground">
                  Customize the appearance of the app.
                </p>
              </div>
              
              <div>
                <h3 className="text-lg font-medium mb-2">Notifications</h3>
                <p className="text-sm text-muted-foreground">
                  Configure notification preferences.
                </p>
              </div>
              
              <div>
                <h3 className="text-lg font-medium mb-2">Account</h3>
                <p className="text-sm text-muted-foreground">
                  Manage your account settings.
                </p>
              </div>
            </div>
          </SettingPanel>
        </Drawer>
      </Scaffold>
    </ScaffoldProvider>
  );
};

export default ScaffoldExample;