import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PlusCircle, Pencil, GripVertical } from "lucide-react";
import { useState } from "react";
import { type EditorMetadata, type MetadataFieldSchema } from "./types";
import { FieldMetadataEditDialog } from "./FieldMetadataEditDialog";
import { ArrayRenderer } from "./renderers/ArrayRenderer";
import { getFieldHandler } from "./field-handler";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableField({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-2">
      <div {...attributes} {...listeners} className="cursor-grab pt-2"><GripVertical /></div>
      <div className="flex-grow">{children}</div>
    </div>
  );
}

interface MetadataEditorProps {
  metadata: EditorMetadata;
  onChange: (newMetadata: EditorMetadata) => void;
}

export default function MetadataEditor({ metadata, onChange }: MetadataEditorProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentField, setCurrentField] = useState<{ key: string; schema: MetadataFieldSchema; isNew: boolean } | null>(null);
  const [validationState, setValidationState] = useState<Record<string, { isValid: boolean; isFocused: boolean }>>({});

  const handleEditField = (key: string) => {
    const schema = metadata.__editor_metadata?.[key];
    if (schema) {
      setCurrentField({ key, schema, isNew: false });
      setIsDialogOpen(true);
    }
  };

  const handleAddField = () => {
    setCurrentField({
      key: "",
      schema: { type: "text", isArray: false, order: Object.keys(metadata.__editor_metadata || {}).length, description: "" },
      isNew: true,
    });
    setIsDialogOpen(true);
  };

  const handleSaveField = (newKey: string, newSchema: MetadataFieldSchema) => {
    if (!currentField) return;
    const { key: oldKey, isNew } = currentField;
    const newMetadata = { ...metadata };
    const newEditorMeta = { ...newMetadata.__editor_metadata } as Record<string, MetadataFieldSchema>;

    if (!newKey) { alert("Field key cannot be empty."); return; }
    if ((isNew || oldKey !== newKey) && metadata.hasOwnProperty(newKey)) { alert(`Field "${newKey}" already exists.`); return; }

    let value = isNew ? undefined : newMetadata[oldKey];
    const typeChanged = isNew || newSchema.type !== currentField.schema.type;
    const arrayStatusChanged = isNew || newSchema.isArray !== currentField.schema.isArray;

    if (typeChanged || arrayStatusChanged) {
      const handler = getFieldHandler(newSchema.type);
      if (newSchema.isArray) {
        value = [];
      } else {
        value = handler.parse(''); // Get a default value for the new type
      }
    }

    if (!isNew && oldKey !== newKey) {
      delete newMetadata[oldKey];
      delete newEditorMeta[oldKey];
    }

    newMetadata[newKey] = value;
    newEditorMeta[newKey] = newSchema;
    newMetadata.__editor_metadata = newEditorMeta;

    onChange(newMetadata);
    setIsDialogOpen(false);
    setCurrentField(null);
  };

  const handleFocus = (key: string) => setValidationState(prev => ({ ...prev, [key]: { ...prev[key], isFocused: true } }));
  const handleBlur = (key: string) => {
    const schema = metadata.__editor_metadata?.[key];
    if (!schema) return;
    const { verify } = getFieldHandler(schema.type);
    const isValid = verify(metadata[key]);
    setValidationState(prev => ({ ...prev, [key]: { isValid, isFocused: false } }));
  };
  const handleValueChange = (key: string, value: any) => {
    const newMetadata = { ...metadata, [key]: value };
    const schema = newMetadata.__editor_metadata?.[key];
    if (schema) {
      const { verify } = getFieldHandler(schema.type);
      const isValid = verify(value);
      setValidationState(prev => ({ ...prev, [key]: { ...prev[key], isValid } }));
    }
    onChange(newMetadata);
  };

  const sortedKeys = Object.keys(metadata).filter((key) => key !== "__editor_metadata").sort((a, b) => (metadata.__editor_metadata?.[a]?.order ?? 99) - (metadata.__editor_metadata?.[b]?.order ?? 99));
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function handleDragEnd(event: DragEndEvent) {
    const {active, over} = event;
    if (over && active.id !== over.id) {
      const oldIndex = sortedKeys.indexOf(active.id as string);
      const newIndex = sortedKeys.indexOf(over.id as string);
      const newSortedKeys = arrayMove(sortedKeys, oldIndex, newIndex);

      const newEditorMeta = { ...metadata.__editor_metadata } as Record<string, MetadataFieldSchema>;
      newSortedKeys.forEach((key, index) => {
        if (newEditorMeta[key]) {
          newEditorMeta[key].order = index;
        }
      });
      onChange({ ...metadata, __editor_metadata: newEditorMeta });
    }
  }

  const renderSingleInput = (key: string, value: any, schema: MetadataFieldSchema, index?: number) => {
    const id = `meta-${key}` + (index !== undefined ? `-${index}` : '');
    const { isValid = true, isFocused } = validationState[key] || {};
    const validationClass = !isValid ? (isFocused ? "border-yellow-400" : "border-red-500") : "";

    const itemChangeHandler = (itemValue: any) => {
      const newArr = [...(metadata[key] || [])];
      const handler = getFieldHandler(schema.type);
      newArr[index!] = handler.parse(itemValue);
      handleValueChange(key, newArr);
    };

    const { render } = getFieldHandler(schema.type);

    const commonProps = {
      id,
      name: key,
      value,
      className: validationClass,
      onFocus: () => handleFocus(key),
      onBlur: () => handleBlur(key),
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const handler = getFieldHandler(schema.type);
        const parsedValue = handler.parse(e.target.value);
        if (index !== undefined) {
          itemChangeHandler(parsedValue);
        } else {
          handleValueChange(key, parsedValue);
        }
      }
    };

    return render(commonProps);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Metadata</CardTitle>
        <Button variant="outline" size="sm" onClick={handleAddField}>
          <PlusCircle className="mr-2 h-4 w-4" /> Add Field
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortedKeys} strategy={verticalListSortingStrategy}>
            <TooltipProvider>
              {sortedKeys.map((key) => {
                const value = metadata[key];
                const schema = metadata.__editor_metadata?.[key];
                if (!schema) return null;
                return (
                  <SortableField key={key} id={key}>
                    <div className="grid w-full gap-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`meta-${key}`} className="capitalize">{key}</Label>
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleEditField(key)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                      {schema.isArray ? (
                        <ArrayRenderer
                          value={value || []}
                          renderItem={(item, index) => renderSingleInput(key, item, { ...schema, isArray: false }, index)}
                          onItemChange={(index, itemValue) => {
                            const newArr = [...(value || [])];
                            newArr[index] = itemValue;
                            handleValueChange(key, newArr);
                          }}
                          onReorder={(oldIndex, newIndex) => {
                            const newArr = arrayMove((value || []), oldIndex, newIndex);
                            handleValueChange(key, newArr);
                          }}
                          onAddItem={(newItem) => handleValueChange(key, [...(value || []), newItem])}
                          onRemoveItem={(index) => {
                            const newArr = [...(value || [])];
                            newArr.splice(index, 1);
                            handleValueChange(key, newArr);
                          }}
                        />
                      ) : (
                        renderSingleInput(key, value, schema)
                      )}
                      {schema.description && <p className="text-sm text-muted-foreground pt-1">{schema.description}</p>}
                    </div>
                  </SortableField>
                );
              })}
            </TooltipProvider>
          </SortableContext>
        </DndContext>
      </CardContent>
      {isDialogOpen && currentField && (
        <FieldMetadataEditDialog
          isOpen={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          fieldKey={currentField.key}
          fieldSchema={currentField.schema}
          isNew={currentField.isNew}
          onSave={handleSaveField}
        />
      )}
    </Card>
  );
}