import { Input } from "@/components/ui/input";
import type { MetadataFieldHandler, RenderProps } from "../types";

function NumberRenderer({ value, onValueChange, ...props }: RenderProps) {
  return (
    <Input
      type="number"
      value={value}
      {...props}
      onChange={(e) => onValueChange(e.target.valueAsNumber)}
    />
  );
}

function verify(value: any): boolean {
  if (value === null || value === undefined || value === "") return true; // Allow empty
  const num = Number(value);
  return !isNaN(num) && isFinite(num);
}

function format(value: number): number {
  // Numbers don't need special formatting, just return the value.
  return value;
}

export const numberHandler: MetadataFieldHandler<number> = {
  typeName: "number",
  verify,
  format,
  render: (props) => <NumberRenderer {...props} />,
};
