import { Input } from "@/components/ui/input";
import type { MetadataFieldHandler, MetadataFieldType, RenderProps } from "../types";

function DateRenderer({ type, value, ...props }: RenderProps & { type: MetadataFieldType }) {
  // Ensure we handle potential invalid date values gracefully for the input.
  const date = new Date(value);
  let dateValue = '';
  if (!isNaN(+date)) {
    // Format to YYYY-MM-DDTHH:mm for datetime-local
    // and YYYY-MM-DD for date
    dateValue = type === 'datetime'
      ? date.toISOString().slice(0, 16)
      : date.toISOString().slice(0, 10);
  }

  return (
    <Input
      {...props}
      type={type === 'datetime' ? 'datetime-local' : 'date'}
      value={dateValue}
    />
  );
}

function verify(value: any): boolean {
  if (value === null || value === undefined || value === '') return true; // Allow empty values
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  return !isNaN(+new Date(value));
}

function format(value: string): string {
    if (!verify(value) || !value) return value;
    return new Date(value).toISOString();
}

export const dateHandler: MetadataFieldHandler<string> = {
  typeName: "date",
  verify,
  format,
  render: (props) => <DateRenderer {...props} type="date" />,
};

export const datetimeHandler: MetadataFieldHandler<string> = {
    typeName: "datetime",
    verify,
    format,
    render: (props) => <DateRenderer {...props} type="datetime" />,
};