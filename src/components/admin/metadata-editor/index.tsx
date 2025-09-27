import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PlusCircle, Pencil } from "lucide-react";
import { useState } from "react";
import * as YAML from "js-yaml";
import { type EditorMetadata, type MetadataFieldSchema } from "./types";
import { validateField } from "./utils";
import { FieldMetadataEditDialog } from "./FieldMetadataEditDialog";
import { ArrayRenderer } from "./renderers/ArrayRenderer";
import { DateRenderer } from "./renderers/DateRenderer";
import { ObjectRenderer } from "./renderers/ObjectRenderer";
import { TextRenderer } from "./renderers/TextRenderer";

interface MetadataEditorProps {
  metadata: EditorMetadata;
  onChange: (newMetadata: EditorMetadata) => void;
}

export default function MetadataEditor({ metadata, onChange }: MetadataEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [currentField, setCurrentField] = useState<{ key: string; schema: MetadataFieldSchema } | null>(null);
  const [validationState, setValidationState] = useState<Record<string, { isValid: boolean; isFocused: boolean }>>({});

  const handleEditField = (key: string) => {
    const schema = metadata.__editor_metadata?.[key];
    if (schema) {
      setCurrentField({ key, schema });
      setIsEditing(true);
    }
  };

  const handleUpdateField = (newKey: string, newSchema: MetadataFieldSchema) => {
    if (!currentField) return;
    const { key: oldKey } = currentField;
    const newMetadata = { ...metadata };
    const newEditorMeta = { ...newMetadata.__editor_metadata };

    let value = newMetadata[oldKey];

    if (newSchema.isArray && !Array.isArray(value)) {
      value = value ? [value] : [];
    } else if (!newSchema.isArray && Array.isArray(value)) {
      value = value[0] ?? "";
    }

    if (oldKey !== newKey) {
      delete newMetadata[oldKey];
      delete newEditorMeta[oldKey];
    }

    newMetadata[newKey] = value;
    newEditorMeta[newKey] = newSchema;
    newMetadata.__editor_metadata = newEditorMeta;

    onChange(newMetadata);
    setIsEditing(false);
    setCurrentField(null);
  };

  const handleAddField = () => {
    const newFieldKey = prompt("Enter the new field name:");
    if (newFieldKey && !metadata.hasOwnProperty(newFieldKey)) {
      const newMetadata = { ...metadata };
      const newEditorMeta = { ...newMetadata.__editor_metadata };

      newMetadata[newFieldKey] = "";
      newEditorMeta[newFieldKey] = {
        type: "text",
        isArray: false,
        order: Object.keys(newEditorMeta).length,
        description: `Description for ${newFieldKey}`,
      };
      newMetadata.__editor_metadata = newEditorMeta;
      onChange(newMetadata);
    } else if (newFieldKey) {
      alert(`Field "${newFieldKey}" already exists.`);
    }
  };

  const handleFocus = (key: string) => setValidationState(prev => ({ ...prev, [key]: { ...prev[key], isFocused: true } }));
  const handleBlur = (key: string, value: any) => setValidationState(prev => ({ ...prev, [key]: { isValid: validateField(value), isFocused: false } }));
  const handleValueChange = (key: string, value: any) => onChange({ ...metadata, [key]: value });

  const sortedKeys = Object.keys(metadata)
    .filter((key) => key !== "__editor_metadata")
    .sort((a, b) => (metadata.__editor_metadata?.[a]?.order ?? 99) - (metadata.__editor_metadata?.[b]?.order ?? 99));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Metadata</CardTitle>
        <Button variant="outline" size="sm" onClick={handleAddField}>
          <PlusCircle className="mr-2 h-4 w-4" /> Add Field
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <TooltipProvider>
          {sortedKeys.map((key) => {
            const value = metadata[key];
            const schema = metadata.__editor_metadata?.[key];
            const { isValid = true, isFocused } = validationState[key] || {};
            const validationClass = !isValid ? (isFocused ? "border-yellow-400" : "border-red-500") : "";

            if (!schema) return null;

            return (
              <div key={key} className="grid gap-2">
                <div className="flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label htmlFor={`meta-${key}`} className="capitalize">{key}</Label>
                    </TooltipTrigger>
                    <TooltipContent><p>{schema.description}</p></TooltipContent>
                  </Tooltip>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleEditField(key)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                </div>
                {schema.isArray ? (
                  <ArrayRenderer
                    value={value || []}
                    onItemChange={(index, itemValue) => {
                      const newArr = [...(value || [])];
                      newArr[index] = itemValue;
                      handleValueChange(key, newArr);
                    }}
                    onAddItem={(newItem) => handleValueChange(key, [...(value || []), newItem])}
                    onRemoveItem={(index) => {
                      const newArr = [...(value || [])];
                      newArr.splice(index, 1);
                      handleValueChange(key, newArr);
                    }}
                  />
                ) : schema.type === 'object' ? (
                  <ObjectRenderer
                    id={`meta-${key}`}
                    name={key}
                    value={value}
                    className={validationClass}
                    onFocus={() => handleFocus(key)}
                    onBlur={(e) => handleBlur(key, e.target.value)}
                    onChange={(e) => handleValueChange(key, e.target.value)}
                  />
                ) : schema.type === 'date' || schema.type === 'datetime' ? (
                  <DateRenderer
                    id={`meta-${key}`}
                    name={key}
                    value={value}
                    type={schema.type}
                    onChange={(e) => handleValueChange(key, new Date(e.target.value).toISOString())}
                  />
                ) : (
                  <TextRenderer
                    id={`meta-${key}`}
                    name={key}
                    value={value}
                    onChange={(e) => handleValueChange(key, e.target.value)}
                  />
                )}
              </div>
            );
          })}
        </TooltipProvider>
      </CardContent>
      {isEditing && currentField && (
        <FieldMetadataEditDialog
          isOpen={isEditing}
          onOpenChange={setIsEditing}
          fieldKey={currentField.key}
          fieldSchema={currentField.schema}
          onSave={handleUpdateField}
        />
      )}
    </Card>
  );
}