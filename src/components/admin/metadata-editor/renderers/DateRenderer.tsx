import { Input } from "@/components/ui/input";
import type { MetadataFieldHandler, MetadataFieldType, RenderProps } from "../types";

function DateRenderer({ type, value, ...props }: RenderProps<string> & { type: MetadataFieldType }) {
  // Ensure we handle potential invalid date values gracefully for the input.
  const date = new Date(value);
  const dateValue = !isNaN(+date) ? date.toISOString().slice(0, 16) : '';

  return (
    <Input
      {...props}
      type={type === 'datetime' ? 'datetime-local' : 'date'}
      value={dateValue}
    />
  );
}

function verify(value: any): boolean {
  if (!value || typeof value !== 'string') return true; // Allow empty values
  return !isNaN(+new Date(value));
}

function parse(value: string): string | null {
    if (!verify(value)) return null;
    return new Date(value).toISOString();
}

export const dateHandler: MetadataFieldHandler<string> = {
  typeName: "date",
  parse,
  verify,
  render: (props) => <DateRenderer {...props} type="date" />,
};

export const datetimeHandler: MetadataFieldHandler<string> = {
    typeName: "datetime",
    parse,
    verify,
    render: (props) => <DateRenderer {...props} type="datetime" />,
};