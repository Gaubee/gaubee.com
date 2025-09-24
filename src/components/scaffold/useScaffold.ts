import { createContext, useContext } from "react";
import type { ScaffoldState } from "./scaffoldAtoms";

// Create context with default values
export const ScaffoldContext = createContext<ScaffoldState | undefined>(
  undefined,
);

// Hook to use scaffold context
export const useScaffold = () => {
  const context = useContext(ScaffoldContext);
  if (context === undefined) {
    throw new Error("useScaffold must be used within a ScaffoldProvider");
  }
  return context;
};

// Export breakpoint constants
export { BREAKPOINTS } from "./scaffoldAtoms";

// Export types
export type { ScaffoldState } from "./scaffoldAtoms";
