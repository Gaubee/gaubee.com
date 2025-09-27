import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, PlusCircle } from "lucide-react";
import { useState } from "react";

interface ArrayRendererProps {
  value: any[];
  onItemChange: (index: number, value: string) => void;
  onAddItem: (newItem: string) => void;
  onRemoveItem: (index: number) => void;
}

export function ArrayRenderer({
  value,
  onItemChange,
  onAddItem,
  onRemoveItem,
}: ArrayRendererProps) {
  const [newItem, setNewItem] = useState("");

  const handleAddItem = () => {
    if (newItem.trim() === "") return;
    onAddItem(newItem);
    setNewItem("");
  };

  return (
    <div className="space-y-2">
      {(value || []).map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            type="text"
            value={item}
            onChange={(e) => onItemChange(index, e.target.value)}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onRemoveItem(index)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          type="text"
          placeholder="Add new item"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddItem())}
        />
        <Button variant="ghost" size="icon" onClick={handleAddItem}>
          <PlusCircle className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}