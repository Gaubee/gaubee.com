import * as React from "react";
import inputCss from "./input.module.css";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    const baseClassName =
      "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors md:text-sm";
    const fileClassName =
      "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground";
    const inputClassName =
      "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
    const wrapInputClassName =
      "focus-within:outline-none focus-within:ring-1 focus-within:ring-ring";

    if (type === "color") {
      const { style, ...rest } = props;
      return (
        <div
          className={cn(
            baseClassName,
            inputClassName,
            wrapInputClassName,
            className,
          )}
          style={style}
        >
          <input type="text" className={"h-full w-full"} ref={ref} {...rest} />
          <span
            className={cn(
              "flex-grow-0 aspect-square rounded-2xl -mr-2",
              inputCss.bgChessboard,
            )}
            style={{ "--bg-color": String(rest.value) } as any}
          >
            <input type="color" className="opacity-0" ref={ref} {...rest} />
          </span>
        </div>
      );
    }
    return (
      <input
        type={type}
        className={cn(baseClassName, inputClassName, className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
