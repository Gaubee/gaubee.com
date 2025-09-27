import { Input } from "@/components/ui/input";
import type { MetadataFieldHandler, RenderProps } from "../types";

function TelRenderer({ value, onValueChange, ...props }: RenderProps) {
  return (
    <Input
      type="tel"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      {...props}
    />
  );
}

export const telHandler: MetadataFieldHandler<string> = {
  typeName: "tel",
  verify: (value) => /^\+?[\d\s\-()]{7,}$/.test(value),
  format: (value) => value,
  render: (props) => <TelRenderer {...props} />,
};
