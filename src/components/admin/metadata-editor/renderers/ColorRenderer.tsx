import { Input } from "@/components/ui/input";
import type { MetadataFieldHandler, RenderProps } from "../types";

function ColorRenderer({ value, ...props }: RenderProps<string>) {
  return <Input type="color" value={String(value ?? '')} {...props} />;
}

export const colorHandler: MetadataFieldHandler<string> = {
  typeName: "color",
  parse: (value) => String(value),
  verify: (value) => typeof value === 'string', // Basic validation, can be improved with regex
  render: (props) => <ColorRenderer {...props} />,
};