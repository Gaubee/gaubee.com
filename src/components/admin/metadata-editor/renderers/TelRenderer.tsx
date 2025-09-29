import { Input } from "@/components/ui/input";
import type { MetadataFieldHandler, RenderProps } from "../types";

function TelRenderer({ value, ...props }: RenderProps) {
  return <Input type="tel" value={value} {...props} />;
}

export const telHandler: MetadataFieldHandler<string> = {
  typeName: "tel",
  verify: (value) => typeof value === 'string', // Basic validation, can be improved with regex
  format: (value) => value,
  render: (props) => <TelRenderer {...props} />,
};