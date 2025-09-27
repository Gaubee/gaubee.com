import { Input } from "@/components/ui/input";
import type { MetadataFieldHandler, RenderProps } from "../types";

function TextRenderer({ value, onValueChange, ...props }: RenderProps) {
  return (
    <Input
      type="text"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      {...props}
    />
  );
}

export const textHandler: MetadataFieldHandler<string> = {
  typeName: "text",
  verify: (value) => typeof value === "string",
  format: (value) => value, // Text doesn't need special formatting
  render: (props) => <TextRenderer {...props} />,
};
