import { Bold, Italic, List, Link, Strikethrough, Quote, Code, CodeSquare, ListOrdered, ListTodo } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export interface EditorToolbarProps {
  onBold: () => void;
  onItalic: () => void;
  onList: () => void;
  onOrderedList: () => void;
  onTaskList: () => void;
  onLink: () => void;
  onStrikethrough: () => void;
  onQuote: () => void;
  onCode: () => void;
  onCodeBlock: () => void;
  activeFormats: Record<string, boolean>;
}

export default function EditorToolbar({
  onBold,
  onItalic,
  onList,
  onOrderedList,
  onTaskList,
  onLink,
  onStrikethrough,
  onQuote,
  onCode,
  onCodeBlock,
  activeFormats,
}: EditorToolbarProps) {
  const activeValues = Object.entries(activeFormats)
    .filter(([, isActive]) => isActive)
    .map(([key]) => key);

  return (
    <div className="rounded-lg border bg-background p-2">
      <ToggleGroup type="multiple" className="flex-wrap justify-start" value={activeValues}>
        <ToggleGroupItem value="bold" aria-label="Toggle bold" onClick={onBold}>
          <Bold className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem value="italic" aria-label="Toggle italic" onClick={onItalic}>
          <Italic className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem value="strikethrough" aria-label="Toggle strikethrough" onClick={onStrikethrough}>
          <Strikethrough className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem value="list" aria-label="Toggle unordered list" onClick={onList}>
          <List className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem value="ordered-list" aria-label="Toggle ordered list" onClick={onOrderedList}>
          <ListOrdered className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem value="task-list" aria-label="Toggle task list" onClick={onTaskList}>
          <ListTodo className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem value="quote" aria-label="Toggle quote" onClick={onQuote}>
          <Quote className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem value="link" aria-label="Toggle link" onClick={onLink}>
          <Link className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem value="code" aria-label="Toggle code" onClick={onCode}>
          <Code className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem value="code-block" aria-label="Toggle code block" onClick={onCodeBlock}>
          <CodeSquare className="h-4 w-4" />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}