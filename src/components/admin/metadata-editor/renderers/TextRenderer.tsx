import { Input } from "@/components/ui/input";

interface TextRendererProps {
  id: string;
  name: string;
  value: any;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function TextRenderer({ id, name, value, onChange }: TextRendererProps) {
  return (
    <Input
      id={id}
      name={name}
      type="text"
      value={String(value ?? '')}
      onChange={onChange}
    />
  );
}