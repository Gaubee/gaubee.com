import { Input } from "@/components/ui/input";
import type { MetadataFieldType } from "../types";

interface DateRendererProps {
  id: string;
  name: string;
  value: any;
  type: MetadataFieldType;
  className: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
}

export function DateRenderer({ id, name, value, type, className, onChange, onFocus, onBlur }: DateRendererProps) {
  const dateValue = value ? new Date(value).toISOString().slice(0, 16) : "";
  return (
    <Input
      id={id}
      name={name}
      type={type === 'datetime' ? 'datetime-local' : 'date'}
      value={dateValue}
      onChange={onChange}
      onFocus={onFocus}
      onBlur={onBlur}
      className={className}
    />
  );
}

/**
 * Validates if a given value can be parsed into a valid Date.
 * @param value The value to validate.
 * @returns True if the value is a valid date, false otherwise.
 */
export function validateDate(value: any): boolean {
  // An empty value is considered valid until the user interacts with it.
  if (!value) return true;
  const date = new Date(value);
  return !isNaN(+date);
}