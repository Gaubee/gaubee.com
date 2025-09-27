import { Input } from "@/components/ui/input";
import type { MetadataFieldType } from "../types";

interface DateRendererProps {
  id: string;
  name: string;
  value: any;
  type: MetadataFieldType;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function DateRenderer({ id, name, value, type, onChange }: DateRendererProps) {
  const dateValue = value ? new Date(value).toISOString().slice(0, 16) : "";
  return (
    <Input
      id={id}
      name={name}
      type={type === 'datetime' ? 'datetime-local' : 'date'}
      value={dateValue}
      onChange={onChange}
    />
  );
}