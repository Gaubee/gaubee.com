import { Input } from "@/components/ui/input";
import type { MetadataFieldHandler, RenderProps } from "../types";

function UrlRenderer({ value, ...props }: RenderProps<string>) {
  return <Input type="url" value={String(value ?? '')} {...props} />;
}

export const urlHandler: MetadataFieldHandler<string> = {
  typeName: "url",
  parse: (value) => String(value),
  verify: (value) => {
    if (typeof value !== 'string') return false;
    try {
      new URL(value);
      return true;
    } catch (_) {
      return false;
    }
  },
  render: (props) => <UrlRenderer {...props} />,
};