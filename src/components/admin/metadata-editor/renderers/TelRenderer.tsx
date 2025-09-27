import { Input } from "@/components/ui/input";
import type { MetadataFieldHandler, RenderProps } from "../types";

function TelRenderer({ value, ...props }: RenderProps<string>) {
  return <Input type="tel" value={String(value ?? '')} {...props} />;
}

export const telHandler: MetadataFieldHandler<string> = {
  typeName: "tel",
  parse: (value) => String(value),
  verify: (value) => typeof value === 'string', // Basic validation, can be improved with regex
  render: (props) => <TelRenderer {...props} />,
};