import { Input } from "@/components/ui/input";

interface TextRendererProps {
  id: string;
  name: string;
  value: any;
  className: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
}

export function TextRenderer({ id, name, value, className, onChange, onFocus, onBlur }: TextRendererProps) {
  return (
    <Input
      id={id}
      name={name}
      type="text"
      value={String(value ?? '')}
      onChange={onChange}
      onFocus={onFocus}
      onBlur={onBlur}
      className={className}
    />
  );
}