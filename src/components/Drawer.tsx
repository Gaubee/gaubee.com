import React from "react";

interface DrawerProps {
  children: React.ReactNode;
}

const Drawer: React.FC<DrawerProps> = ({ children }) => {
  return (
    <div className="flex h-full flex-col">
      {/* You can add a header or other fixed elements here if needed in the future */}
      <nav className="flex-1 space-y-4">{children}</nav>
    </div>
  );
};

export default Drawer;
