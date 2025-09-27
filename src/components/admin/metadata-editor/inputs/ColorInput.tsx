import { Input } from "@/components/ui/input";
import type { MetadataFieldHandler, RenderProps } from "../types";

function ColorRenderer({
  value,
  onValueChange,
  slotsClassNames,
  ...props
}: RenderProps) {
  return (
    <Input
      {...props}
      type="color"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    />
    // <>
    //   <Button
    //     popoverTarget={`color-picker-${props.id}`}
    //     popoverTargetAction="toggle"
    //     {...props}
    //   >
    //     {value}
    //   </Button>
    //   <div
    //     id={`color-picker-${props.id}`}
    //     popover="auto"
    //     className={slotsClassNames?.popover}
    //   >
    //     <ColorPicker
    //       className={cn(
    //         "max-w-sm rounded-md border bg-background p-4 shadow-sm",
    //         slotsClassNames?.colorPicker,
    //       )}
    //       value={value}
    //       onChange={(v) => onValueChange(`rgba(${v})`)}
    //     >
    //       <ColorPickerSelection />
    //       <div className="flex items-center gap-4">
    //         <ColorPickerEyeDropper />
    //         <div className="grid w-full gap-1">
    //           <ColorPickerHue />
    //           <ColorPickerAlpha />
    //         </div>
    //       </div>
    //       <div className="flex items-center gap-2">
    //         <ColorPickerOutput />
    //         <ColorPickerFormat />
    //       </div>
    //     </ColorPicker>
    //   </div>
    // </>
  );
}

export const colorHandler: MetadataFieldHandler<string> = {
  typeName: "color",
  verify: (value) => typeof value === "string", // Basic validation, can be improved with regex
  format: (value) => value,
  render: (props) => <ColorRenderer {...props} />,
};
