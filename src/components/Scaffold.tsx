import { createContext, useContext, useState, type ReactNode } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";

// 1. 定义 Context 类型
interface ScaffoldContextType {
  isDrawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;
}

// 2. 创建 Context
const ScaffoldContext = createContext<ScaffoldContextType | undefined>(
  undefined,
);

// 3. 创建一个自定义 Hook 以方便使用 Context
export const useScaffold = () => {
  const context = useContext(ScaffoldContext);
  if (!context) {
    throw new Error("useScaffold must be used within a ScaffoldProvider");
  }
  return context;
};

// 4. 定义 Scaffold 组件的 Props
interface ScaffoldProps {
  appBar: ReactNode;
  drawer: ReactNode;
  children: ReactNode; // 'body' content
}

export default function Scaffold({ appBar, drawer, children }: ScaffoldProps) {
  const [isDrawerOpen, setDrawerOpen] = useState(false);

  const toggleDrawer = () => {
    setDrawerOpen((prev) => !prev);
  };

  const contextValue = {
    isDrawerOpen,
    setDrawerOpen,
    toggleDrawer,
  };

  return (
    <ScaffoldContext.Provider value={contextValue}>
      <div className="relative flex min-h-screen w-full flex-col">
        {/* Drawer (抽屉) */}
        <Sheet open={isDrawerOpen} onOpenChange={setDrawerOpen}>
          {/* SheetTrigger is not needed here as we will control it programmatically */}
          <SheetContent side="left" className="w-64 p-4">
            {drawer}
          </SheetContent>
        </Sheet>

        {/* AppBar (顶栏) */}
        <header className="sticky top-0 z-40 w-full">
          {appBar}
        </header>

        {/* Body (主要内容) */}
        <main className="flex-1">
          {children}
        </main>
      </div>
    </ScaffoldContext.Provider>
  );
}
