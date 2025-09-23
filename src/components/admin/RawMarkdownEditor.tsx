import { Textarea } from "@/components/ui/textarea";

interface RawMarkdownEditorProps {
  content: string;
  onChange: (newContent: string) => void;
}

export default function RawMarkdownEditor({
  content,
  onChange,
}: RawMarkdownEditorProps) {
  return (
    <Textarea
      value={content}
      onChange={(e) => onChange(e.target.value)}
      className="font-mono min-h-[300px] border rounded-b-lg"
      aria-label="Raw Markdown Editor"
    />
  );
}
