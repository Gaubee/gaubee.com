import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import React, { useEffect } from "react";
import { useScaffold } from "./useScaffold";

interface DrawerProps {
  side?: "left" | "right";
  children: React.ReactNode;
  className?: string;
}

const Drawer: React.FC<DrawerProps> = ({
  side = "left",
  children,
  className,
}) => {
  const { drawerOpen, settingOpen, setDrawerOpen, setSettingOpen } =
    useScaffold();

  // Determine which state to use based on side
  const isOpen = side === "left" ? drawerOpen : settingOpen;
  const setIsOpen = side === "left" ? setDrawerOpen : setSettingOpen;

  // Close drawer when escape key is pressed
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEsc);
    }

    return () => {
      document.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen, setIsOpen]);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetContent
        side={side}
        className={cn(
          "w-full sm:max-w-sm p-0 flex flex-col",
          side === "left" && "border-r",
          side === "right" && "border-l",
          className,
        )}
      >
        {children}
      </SheetContent>
    </Sheet>
  );
};

export default Drawer;
