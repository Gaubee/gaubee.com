import { Input } from "@/components/ui/input";
import type { MetadataFieldHandler, RenderProps } from "../types";

function NumberRenderer({ value, ...props }: RenderProps<number>) {
  return <Input type="number" value={value} {...props} />;
}

function verify(value: any): boolean {
  return !isNaN(parseFloat(value)) && isFinite(value);
}

function parse(value: string): number | null {
  const num = parseFloat(value);
  return verify(num) ? num : null;
}

export const numberHandler: MetadataFieldHandler<number> = {
  typeName: "number",
  parse,
  verify,
  render: (props) => <NumberRenderer {...props} />,
};