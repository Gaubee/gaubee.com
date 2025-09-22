import React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface SettingsPanelProps {
  children: React.ReactNode; // The trigger component
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ children }) => {
  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="right" className="w-80 p-4">
        <SheetHeader>
          <SheetTitle>设置</SheetTitle>
        </SheetHeader>
        <div className="py-4">
          <p className="text-zinc-500 dark:text-zinc-400">
            这里是一些全局设置选项。
          </p>
          {/* Settings content will go here */}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default SettingsPanel;
