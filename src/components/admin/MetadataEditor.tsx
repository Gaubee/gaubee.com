import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { X, PlusCircle, Pencil } from "lucide-react";
import { useState } from "react";
import * as YAML from "js-yaml";
import { type EditorMetadata, type MetadataFieldSchema } from "./EditorView";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface MetadataEditorProps {
  metadata: EditorMetadata;
  onChange: (newMetadata: EditorMetadata) => void;
}

export default function MetadataEditor({
  metadata,
  onChange,
}: MetadataEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [currentField, setCurrentField] = useState<{
    key: string;
    value: any;
  } | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newType, setNewType] = useState("");
  const [isArr, setIsArr] = useState(false);
  const [validationState, setValidationState] = useState<
    Record<string, { isValid: boolean; isFocused: boolean }>
  >({});

  const handleEditField = (key: string, value: any) => {
    setCurrentField({ key, value });
    setNewKey(key);
    const schema = metadata.__editor_metadata?.[key];
    if (schema) {
      setIsArr(schema.isArray);
      setNewType(schema.type);
    } else {
      // Fallback for safety, this case should be rare after EditorView changes
      setIsArr(Array.isArray(value));
      setNewType("text");
    }
    setIsEditing(true);
  };

  const validateField = (key: string, value: any): boolean => {
    if (typeof value === "object" && value !== null) {
      return true; // Already a valid object/array
    }
    // For string values, try to parse as JSON or YAML
    if (typeof value === "string") {
      try {
        JSON.parse(value);
        return true;
      } catch (jsonError) {
        try {
          YAML.load(value);
          return true;
        } catch (yamlError) {
          return false;
        }
      }
    }
    // For other primitive types, consider them valid
    return true;
  };

  const handleFocus = (key: string) => {
    setValidationState(prev => ({
      ...prev,
      [key]: { ...prev[key], isFocused: true },
    }));
  };

  const handleBlur = (key: string, value: any) => {
    const isValid = validateField(key, value);
    setValidationState(prev => ({
      ...prev,
      [key]: { isValid, isFocused: false },
    }));
  };

  const handleUpdateField = () => {
    if (!currentField) return;

    const { key: oldKey } = currentField;
    const newMetadata = { ...metadata };
    let valueToConvert = newMetadata[oldKey];

    // This is the source of truth for the schema, even for a new key
    const newSchema = newMetadata.__editor_metadata?.[oldKey] ?? {
        order: 99,
        description: ""
    };

    // 1. Convert value based on the selected type
    if (typeof valueToConvert === 'string') {
        switch (newType) {
            case "number":
                const num = parseFloat(valueToConvert);
                valueToConvert = isNaN(num) ? 0 : num;
                break;
            case "date":
            case "datetime":
                const date = new Date(valueToConvert);
                if (isNaN(+date)) {
                    alert("Invalid date format. Cannot save.");
                    return;
                }
                valueToConvert = date.toISOString();
                break;
            case "object":
                try {
                    valueToConvert = YAML.load(valueToConvert);
                } catch (e) {
                    alert("Invalid YAML/JSON format. Cannot save.");
                    return;
                }
                break;
        }
    }

    // 2. Handle the "Is Array" toggle
    if (isArr && !Array.isArray(valueToConvert)) {
      valueToConvert = valueToConvert ? [valueToConvert] : [];
    } else if (!isArr && Array.isArray(valueToConvert)) {
      valueToConvert = valueToConvert[0] ?? "";
    }

    // 3. Update the schema
    newSchema.type = newType as MetadataFieldSchema['type'];
    newSchema.isArray = isArr;

    // 4. Handle key change
    if (oldKey !== newKey) {
      delete newMetadata[oldKey];
      if(newMetadata.__editor_metadata) {
        delete newMetadata.__editor_metadata[oldKey];
      }
    }

    // 5. Save the new value and schema
    newMetadata[newKey] = valueToConvert;
    if(newMetadata.__editor_metadata){
        newMetadata.__editor_metadata[newKey] = newSchema;
    }

    onChange(newMetadata);
    setIsEditing(false);
    setCurrentField(null);
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    onChange({ ...metadata, [name]: value });
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    onChange({ ...metadata, [name]: new Date(value).toISOString() });
  };

  const [newItem, setNewItem] = useState("");
  const handleItemChange = (key: string, index: number, value: string) => {
    const newArray = [...(metadata[key] || [])];
    newArray[index] = value;
    onChange({ ...metadata, [key]: newArray });
  };

  const handleAddItem = (key: string) => {
    if (newItem.trim() === "") return;
    const newArray = [...(metadata[key] || []), newItem];
    onChange({ ...metadata, [key]: newArray });
    setNewItem("");
  };

  const handleRemoveItem = (key: string, index: number) => {
    const newArray = [...(metadata[key] || [])];
    newArray.splice(index, 1);
    onChange({ ...metadata, [key]: newArray });
  };

  const handleAddField = () => {
    const newField = prompt("Enter the new field name:");
    if (newField && !metadata.hasOwnProperty(newField)) {
      onChange({ ...metadata, [newField]: "" });
    } else if (newField) {
      alert(`Field "${newField}" already exists.`);
    }
  };

  const renderInput = (key: string, value: any) => {
    const schema = metadata.__editor_metadata?.[key];
    const { isValid = true, isFocused } = validationState[key] || {};
    const validationClass = !isValid
      ? isFocused
        ? "border-yellow-400"
        : "border-red-500"
      : "";

    if (schema?.isArray) {
      return (
        <div className="space-y-2">
          {(value || []).map((item: any, index: number) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                type="text"
                value={item}
                onChange={(e) => handleItemChange(key, index, e.target.value)}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleRemoveItem(key, index)}
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
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddItem(key))}
            />
            <Button variant="ghost" size="icon" onClick={() => handleAddItem(key)}>
              <PlusCircle className="h-5 w-5" />
            </Button>
          </div>
        </div>
      );
    }

    switch (schema?.type) {
      case "object":
        return (
          <Textarea
            id={`meta-${key}`}
            name={key}
            value={typeof value === 'string' ? value : YAML.dump(value)}
            onFocus={() => handleFocus(key)}
            onBlur={(e) => handleBlur(key, e.target.value)}
            onChange={(e) => {
              const { name, value } = e.target;
              onChange({ ...metadata, [name]: value });
              const isValid = validateField(key, value);
              setValidationState(prev => ({ ...prev, [key]: { ...prev[key], isValid } }));
            }}
            className={`h-24 font-mono ${validationClass}`}
          />
        );
      case "date":
      case "datetime":
        const dateValue = value ? new Date(value).toISOString().split("T")[0] : "";
        return (
          <Input
            id={`meta-${key}`}
            name={key}
            type={schema.type === 'datetime' ? 'datetime-local' : 'date'}
            value={dateValue}
            onChange={handleDateChange}
          />
        );
      default:
        return (
          <Input
            id={`meta-${key}`}
            name={key}
            type="text"
            value={String(value ?? '')}
            onChange={handleInputChange}
          />
        );
    }
  };

  const sortedKeys = Object.keys(metadata)
    .filter((key) => key !== "__editor_metadata")
    .sort((a, b) => {
      const orderA = metadata.__editor_metadata?.[a]?.order ?? 99;
      const orderB = metadata.__editor_metadata?.[b]?.order ?? 99;
      return orderA - orderB;
    });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Metadata</CardTitle>
        <Button variant="outline" size="sm" onClick={handleAddField}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Field
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <TooltipProvider>
          {sortedKeys.map((key) => (
            <div key={key} className="grid gap-2">
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Label htmlFor={`meta-${key}`} className="capitalize">
                      {key}
                    </Label>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{metadata.__editor_metadata?.[key]?.description}</p>
                  </TooltipContent>
                </Tooltip>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => handleEditField(key, metadata[key])}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </div>
              {renderInput(key, metadata[key])}
            </div>
          ))}
        </TooltipProvider>
      </CardContent>
      {isEditing && currentField && (
        <Dialog open={isEditing} onOpenChange={setIsEditing}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Field: {currentField.key}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right">
                  Key
                </Label>
                <Input
                  id="name"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="type" className="text-right">
                  Type
                </Label>
                <Select
                  value={newType}
                  onValueChange={(value) => setNewType(value)}
                >
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Select a type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="datetime">DateTime</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="url">URL</SelectItem>
                    <SelectItem value="tel">Telephone</SelectItem>
                    <SelectItem value="color">Color</SelectItem>
                    <SelectItem value="object">Object (JSON)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-4 flex items-center justify-end gap-2">
                <Label htmlFor="is-array" className="">
                  Is Array
                </Label>
                <Checkbox
                  id="is-array"
                  checked={isArr}
                  onCheckedChange={(checked) => setIsArr(Boolean(checked))}
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" onClick={handleUpdateField}>
                Save changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
