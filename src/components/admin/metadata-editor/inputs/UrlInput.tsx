import { Input } from "@/components/ui/input";
import type { MetadataFieldHandler, RenderProps } from "../types";

function UrlRenderer({ value, onValueChange, ...props }: RenderProps) {
  return (
    <Input
      type="url"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      {...props}
    />
  );
}

export const urlHandler: MetadataFieldHandler<string> = {
  typeName: "url",
  verify: (value) => {
    if (value === null || value === undefined || value === "") return true; // Allow empty
    if (typeof value !== "string") return false;
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  },
  format: (value) => value,
  render: (props) => <UrlRenderer {...props} />,
};
