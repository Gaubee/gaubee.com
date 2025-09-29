import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, PlusCircle, GripVertical } from "lucide-react";
import * as React from "react";
import { useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableArrayItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = {
    transform: CSS.Translate.toString(transform), // Use Translate to avoid scaling issues
    transition,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} className="flex items-center gap-2">
      <div {...listeners} className="cursor-grab"><GripVertical /></div>
      {children}
    </div>
  );
}

interface ArrayRendererProps {
  value: any[];
  renderItem: (item: any, index: number) => React.ReactNode;
  onAddItem: (newItem: string) => void;
  onRemoveItem: (index: number) => void;
  onReorder: (oldIndex: number, newIndex: number) => void;
  verify: (value: any) => boolean;
}

export function ArrayRenderer({
  value,
  renderItem,
  onAddItem,
  onRemoveItem,
  onReorder,
  verify,
}: ArrayRendererProps) {
  const [newItem, setNewItem] = useState("");
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const handleAddItem = () => {
    if (!verify(newItem)) {
        alert("Invalid value for new item.");
        return;
    }
    onAddItem(newItem);
    setNewItem("");
  };

  const itemsWithIds = React.useMemo(() => value.map((_, index) => ({ id: `${index}-${value[index]}` })), [value]);

  function handleDragEnd(event: DragEndEvent) {
    const {active, over} = event;
    if (over && active.id !== over.id) {
      const oldIndex = itemsWithIds.findIndex(item => item.id === active.id);
      const newIndex = itemsWithIds.findIndex(item => item.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        onReorder(oldIndex, newIndex);
      }
    }
  }

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={itemsWithIds.map(i => i.id)} strategy={verticalListSortingStrategy}>
          {value.map((item, index) => (
            <SortableArrayItem key={itemsWithIds[index].id} id={itemsWithIds[index].id}>
                <div className="flex-grow">{renderItem(item, index)}</div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="flex-shrink-0"
                  onClick={() => onRemoveItem(index)}
                >
                  <X className="h-4 w-4" />
                </Button>
            </SortableArrayItem>
          ))}
        </SortableContext>
      </DndContext>
      <div className="flex items-center gap-2 pt-2">
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