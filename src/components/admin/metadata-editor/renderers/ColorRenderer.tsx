import { Input } from "@/components/ui/input";
import type { MetadataFieldHandler, RenderProps } from "../types";

function ColorRenderer({ value, ...props }: RenderProps) {
  return <Input type="color" value={value} {...props} />;
}

export const colorHandler: MetadataFieldHandler<string> = {
  typeName: "color",
  verify: (value) => typeof value === 'string', // Basic validation, can be improved with regex
  format: (value) => value,
  render: (props) => <ColorRenderer {...props} />,
};