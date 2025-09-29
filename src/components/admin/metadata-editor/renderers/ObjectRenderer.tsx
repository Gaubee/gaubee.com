import { Textarea } from "@/components/ui/textarea";
import * as YAML from "js-yaml";
import type { MetadataFieldHandler, RenderProps } from "../types";

function ObjectRenderer({ value, ...props }: RenderProps) {
  return (
    <Textarea
      {...props}
      value={value}
      className={`h-24 font-mono ${props.className}`}
    />
  );
}

function verify(value: any): boolean {
    if (value === null || value === undefined || value === '') return true; // Allow empty
    if (typeof value !== 'string') return false;
    try {
        YAML.load(value);
        return true;
    } catch (e) {
        return false;
    }
}

function format(value: string): string {
    if (!verify(value) || !value) return value;
    try {
        const parsed = YAML.load(value);
        return YAML.dump(parsed);
    } catch (e) {
        return value; // Return original value if formatting fails
    }
}

export const objectHandler: MetadataFieldHandler<string> = {
  typeName: "object",
  verify,
  format,
  render: (props) => <ObjectRenderer {...props} />,
};