import { Textarea } from "@/components/ui/textarea";
import * as YAML from "js-yaml";

interface ObjectRendererProps {
  id: string;
  name: string;
  value: any;
  className: string;
  onFocus: () => void;
  onBlur: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}

export function ObjectRenderer({
  id,
  name,
  value,
  className,
  onFocus,
  onBlur,
  onChange,
}: ObjectRendererProps) {
  const displayValue = typeof value === 'string' ? value : YAML.dump(value);
  return (
    <Textarea
      id={id}
      name={name}
      value={displayValue}
      onFocus={onFocus}
      onBlur={onBlur}
      onChange={onChange}
      className={`h-24 font-mono ${className}`}
    />
  );
}