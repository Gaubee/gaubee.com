import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PlusCircle, Pencil, X } from "lucide-react";
import { useState } from "react";
import * as YAML from "js-yaml";
import { type EditorMetadata, type MetadataFieldSchema, type MetadataFieldType } from "./types";
import { FieldMetadataEditDialog } from "./FieldMetadataEditDialog";
import { ArrayRenderer } from "./renderers/ArrayRenderer";
import { DateRenderer, validateDate } from "./renderers/DateRenderer";
import { ObjectRenderer, validateObject } from "./renderers/ObjectRenderer";
import { TextRenderer } from "./renderers/TextRenderer";

const getValidator = (type: MetadataFieldType) => {
  switch (type) {
    case "date":
    case "datetime":
      return validateDate;
    case "object":
      return validateObject;
    default:
      return (value: any) => true; // Default validator for simple types
  }
};

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

    const { key: oldKey, schema: oldSchema } = currentField;
    const newMetadata = { ...metadata };
    const newEditorMeta = { ...newMetadata.__editor_metadata };
    let value = newMetadata[oldKey];

    const typeChanged = newSchema.type !== oldSchema.type;
    const arrayStatusChanged = newSchema.isArray !== oldSchema.isArray;

    // If type or array status has changed, reset the value to a safe default.
    if (typeChanged || arrayStatusChanged) {
      if (newSchema.isArray) {
        value = [];
      } else {
        switch (newSchema.type) {
          case 'number':
            value = 0;
            break;
          case 'object':
            value = {};
            break;
          case 'date':
          case 'datetime':
            value = new Date().toISOString();
            break;
          default:
            value = '';
            break;
        }
      }
    }

    // Handle key change by removing old key and its schema
    if (oldKey !== newKey) {
      delete newMetadata[oldKey];
      if (newEditorMeta) delete newEditorMeta[oldKey];
    }

    // Save the new value and the new schema
    newMetadata[newKey] = value;
    if (newEditorMeta) {
      newEditorMeta[newKey] = newSchema;
      newMetadata.__editor_metadata = newEditorMeta;
    }

    onChange(newMetadata);
    setIsEditing(false);
    setCurrentField(null);
  };

  const handleAddField = () => {
    const newFieldKey = prompt("Enter the new field name:");
    if (newFieldKey && !metadata.hasOwnProperty(newFieldKey)) {
      const newMetadata = { ...metadata };
      const newEditorMeta = { ...newMetadata.__editor_metadata } as Record<string, MetadataFieldSchema>;

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

  const handleBlur = (key: string) => {
    const schema = metadata.__editor_metadata?.[key];
    if (!schema) return;
    const validator = getValidator(schema.type);
    const isValid = validator(metadata[key]);
    setValidationState(prev => ({ ...prev, [key]: { isValid, isFocused: false } }));
  };

  const handleValueChange = (key: string, value: any) => {
    const newMetadata = { ...metadata, [key]: value };
    const schema = newMetadata.__editor_metadata?.[key];
    if (schema && schema.type === 'object') {
        const isValid = getValidator(schema.type)(value);
        setValidationState(prev => ({ ...prev, [key]: { ...prev[key], isValid } }));
    }
    onChange(newMetadata);
  };

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
                    onBlur={() => handleBlur(key)}
                    onChange={(e) => handleValueChange(key, e.target.value)}
                  />
                ) : schema.type === 'date' || schema.type === 'datetime' ? (
                  <DateRenderer
                    id={`meta-${key}`}
                    name={key}
                    value={value}
                    type={schema.type}
                    onChange={(e) => handleValueChange(key, e.target.value)}
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