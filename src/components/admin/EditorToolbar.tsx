import { Bold, Italic, List, Link } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export interface EditorToolbarProps {
  onBold: () => void;
  onItalic: () => void;
  onList: () => void;
  onLink: () => void;
}

export default function EditorToolbar({
  onBold,
  onItalic,
  onList,
  onLink,
}: EditorToolbarProps) {
  return (
    <div className="rounded-lg border bg-background p-2">
      <ToggleGroup type="multiple" className="flex-wrap justify-start">
        <ToggleGroupItem value="bold" aria-label="Toggle bold" onClick={onBold}>
          <Bold className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem
          value="italic"
          aria-label="Toggle italic"
          onClick={onItalic}
        >
          <Italic className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem value="list" aria-label="Toggle list" onClick={onList}>
          <List className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem value="link" aria-label="Toggle link" onClick={onLink}>
          <Link className="h-4 w-4" />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}