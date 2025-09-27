import { Input } from "@/components/ui/input";
import type { MetadataFieldHandler, RenderProps } from "../types";

function TextRenderer({ value, className, ...props }: RenderProps<string>) {
  return <Input type="text" value={String(value ?? '')} className={className} {...props} />;
}

export const textHandler: MetadataFieldHandler<string> = {
  typeName: "text",
  parse: (value) => String(value),
  verify: (value) => typeof value === 'string',
  render: (props) => <TextRenderer {...props} />,
};