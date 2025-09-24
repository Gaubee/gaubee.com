import { Button } from "@/components/ui/button";
import { SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import React from "react";
import { useScaffold } from "./useScaffold";

interface SettingPanelProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

const SettingPanel: React.FC<SettingPanelProps> = ({
  title = "Settings",
  children,
  className,
}) => {
  const { settingOpen, setSettingOpen } = useScaffold();

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <SheetHeader className="px-4 pt-4 flex flex-row items-center justify-between">
        <SheetTitle>{title}</SheetTitle>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSettingOpen(false)}
          aria-label="Close settings"
        >
          <X className="h-4 w-4" />
        </Button>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
    </div>
  );
};

export default SettingPanel;
