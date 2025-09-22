import { Sheet, SheetContent } from "@/components/ui/sheet";
import React, { useState } from "react";
import MobileTopbar from "./MobileTopbar";

interface Props {
  title: string;
  children: React.ReactNode; // This will be the content of the sheet
}

export default function MobileNav({ title, children }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <MobileTopbar
        title={title}
        onMenuClick={() => {
          setIsOpen(true);
        }}
      />
      <SheetContent>{children}</SheetContent>
    </Sheet>
  );
}
