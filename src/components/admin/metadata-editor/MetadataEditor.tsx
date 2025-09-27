import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, PlusCircle, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { getFieldHandler } from "./field-handler";
import { FieldMetadataEditDialog } from "./FieldMetadataEditDialog";
import { ArrayRenderer } from "./inputs/ArrayGroup";
import { MetadataInput } from "./MetadataInput";
import { type EditorMetadata, type MetadataFieldSchema } from "./types";

function SortableField({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-2">
      <div {...attributes} {...listeners} className="cursor-grab pt-2">
        <GripVertical />
      </div>
      <div className="flex-grow">{children}</div>
    </div>
  );
}

export interface MetadataEditorProps {
  metadata: EditorMetadata;
  setMetadata: React.Dispatch<React.SetStateAction<EditorMetadata>>;
}

export default function MetadataEditor({
  metadata,
  setMetadata,
}: MetadataEditorProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentField, setCurrentField] = useState<{
    key: string;
    schema: MetadataFieldSchema;
    isNew: boolean;
  } | null>(null);
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
      schema: {
        type: "text",
        isArray: false,
        order: Object.keys(metadata.__editor_metadata || {}).length,
        description: "",
      },
      isNew: true,
    });
    setIsDialogOpen(true);
  };

  const handleSaveField = (newKey: string, newSchema: MetadataFieldSchema) => {
    if (!currentField) return;
    const { key: oldKey, isNew } = currentField;
    const newMetadata = { ...metadata };
    const newEditorMeta = { ...newMetadata.__editor_metadata } as Record<
      string,
      MetadataFieldSchema
    >;

    if (!newKey) {
      alert("Field key cannot be empty.");
      return;
    }
    if ((isNew || oldKey !== newKey) && newMetadata.hasOwnProperty(newKey)) {
      alert(`Field "${newKey}" already exists.`);
      return;
    }

    let value = isNew ? undefined : newMetadata[oldKey];
    const oldSchema = currentField.schema;

    if (!isNew && newSchema.isArray !== oldSchema.isArray) {
      if (newSchema.isArray && !oldSchema.isArray) {
        value = value === undefined || value === null ? [] : [String(value)];
      } else if (!newSchema.isArray && oldSchema.isArray) {
        value = value?.[0] ?? "";
      }
    } else if (isNew) {
      value = newSchema.isArray ? [] : "";
    }

    if (!isNew && oldKey !== newKey) {
      delete newMetadata[oldKey];
      delete newEditorMeta[oldKey];
    }

    newMetadata[newKey] = value;
    newEditorMeta[newKey] = newSchema;
    newMetadata.__editor_metadata = newEditorMeta;

    setMetadata(newMetadata);
    setIsDialogOpen(false);
    setCurrentField(null);
  };

  const handleDeleteField = (keyToDelete: string) => {
    if (
      !window.confirm(
        `Are you sure you want to delete the field "${keyToDelete}"?`,
      )
    ) {
      return;
    }
    const newMetadata = { ...metadata };
    const newEditorMeta = { ...newMetadata.__editor_metadata } as Record<
      string,
      MetadataFieldSchema
    >;
    delete newMetadata[keyToDelete];
    delete newEditorMeta[keyToDelete];
    setMetadata({ ...newMetadata, __editor_metadata: newEditorMeta });
  };

  const sortedKeys = useMemo(() => {
    return Object.keys(metadata)
      .filter((key) => key !== "__editor_metadata")
      .sort(
        (a, b) =>
          (metadata.__editor_metadata?.[a]?.order ?? 99) -
          (metadata.__editor_metadata?.[b]?.order ?? 99),
      );
  }, [metadata]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = sortedKeys.indexOf(active.id as string);
      const newIndex = sortedKeys.indexOf(over.id as string);
      const newSortedKeys = arrayMove(sortedKeys, oldIndex, newIndex);

      const newEditorMeta = { ...metadata.__editor_metadata } as Record<
        string,
        MetadataFieldSchema
      >;
      newSortedKeys.forEach((key, index) => {
        if (newEditorMeta[key]) {
          newEditorMeta[key].order = index;
        }
      });
      setMetadata({ ...metadata, __editor_metadata: newEditorMeta });
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Metadata</CardTitle>
        <Button variant="outline" size="sm" onClick={handleAddField}>
          <PlusCircle className="mr-2 h-4 w-4" /> Add Field
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sortedKeys}
            strategy={verticalListSortingStrategy}
          >
            <TooltipProvider>
              {sortedKeys.map((key) => {
                const schema = metadata.__editor_metadata?.[key];
                if (!schema) return null;
                return (
                  <SortableField key={key} id={key}>
                    <div className="grid w-full gap-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`meta-${key}`} className="capitalize">
                          {key}
                        </Label>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => handleEditField(key)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-destructive"
                          onClick={() => handleDeleteField(key)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      {schema.isArray ? (
                        <ArrayRenderer
                          value={metadata[key] || []}
                          renderItem={(_, index) => (
                            <MetadataInput
                              paths={[key, `${index}`]}
                              schema={{
                                ...schema,
                                isArray: false,
                              }}
                              metadata={metadata}
                              setMetadata={setMetadata}
                            />
                          )}
                          verify={getFieldHandler(schema.type).verify}
                          onReorder={(oldIndex, newIndex) => {
                            const newArr = arrayMove(
                              metadata[key] || [],
                              oldIndex,
                              newIndex,
                            );
                            setMetadata({ ...metadata, [key]: newArr });
                          }}
                          onAddItem={(newItem) => {
                            setMetadata({
                              ...metadata,
                              [key]: [...(metadata[key] || []), newItem],
                            });
                          }}
                          onRemoveItem={(index) => {
                            const newArr = [...(metadata[key] || [])];
                            newArr.splice(index, 1);
                            setMetadata({ ...metadata, [key]: newArr });
                          }}
                        />
                      ) : (
                        <MetadataInput
                          paths={[key]}
                          schema={schema}
                          metadata={metadata}
                          setMetadata={setMetadata}
                        />
                      )}
                      {schema.description && (
                        <p className="text-sm text-muted-foreground pt-1">
                          {schema.description}
                        </p>
                      )}
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
