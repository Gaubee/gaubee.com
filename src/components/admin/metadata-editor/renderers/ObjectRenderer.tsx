import { Textarea } from "@/components/ui/textarea";
import * as YAML from "js-yaml";
import type { MetadataFieldHandler, RenderProps } from "../types";

function ObjectRenderer({ value, ...props }: RenderProps<object | string>) {
  const displayValue = typeof value === 'string' ? value : YAML.dump(value);
  return (
    <Textarea
      {...props}
      value={displayValue}
      className={`h-24 font-mono ${props.className}`}
    />
  );
}

function verify(value: any): boolean {
  if (typeof value === 'object' && value !== null) return true;
  if (typeof value !== 'string') return false;
  try {
    YAML.load(value);
    return true;
  } catch (e) {
    return false;
  }
}

function parse(value: string): object | null {
    if (!verify(value)) return null;
    if(typeof value === 'object') return value;
    try {
        return YAML.load(value) as object;
    } catch (e) {
        return null;
    }
}

export const objectHandler: MetadataFieldHandler<object | string> = {
  typeName: "object",
  parse,
  verify,
  render: (props) => <ObjectRenderer {...props} />,
};