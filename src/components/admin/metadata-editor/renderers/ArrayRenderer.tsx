import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, PlusCircle, GripVertical } from "lucide-react";
import { useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableArrayItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} className="flex items-center gap-2">
      <div {...listeners} className="cursor-grab"><GripVertical /></div>
      <div className="flex-grow">{children}</div>
    </div>
  );
}

interface ArrayRendererProps {
  value: any[];
  renderItem: (item: any, index: number) => React.ReactNode;
  onAddItem: () => void;
  onRemoveItem: (index: number) => void;
  onReorder: (oldIndex: number, newIndex: number) => void;
}

export function ArrayRenderer({
  value,
  renderItem,
  onAddItem,
  onRemoveItem,
  onReorder,
}: ArrayRendererProps) {
  const [newItem, setNewItem] = useState("");
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const handleAddItem = () => {
    // The parent component will handle creating the default value.
    onAddItem();
    setNewItem("");
  };

  function handleDragEnd(event: DragEndEvent) {
    const {active, over} = event;
    if (over && active.id !== over.id) {
      const oldIndex = value.findIndex((_, index) => `${index}` === active.id);
      const newIndex = value.findIndex((_, index) => `${index}` === over.id);
      onReorder(oldIndex, newIndex);
    }
  }

  const itemsWithIds = value.map((_, index) => ({ id: `${index}` }));

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={itemsWithIds.map(i => i.id)} strategy={verticalListSortingStrategy}>
          {value.map((item, index) => (
            <SortableArrayItem key={index} id={`${index}`}>
                {renderItem(item, index)}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemoveItem(index)}
                >
                  <X className="h-4 w-4" />
                </Button>
            </SortableArrayItem>
          ))}
        </SortableContext>
      </DndContext>
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