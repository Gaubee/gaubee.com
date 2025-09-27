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
interface MetadataEditorProps {
  metadata: Record<string, any>;
  onChange: (newMetadata: Record<string, any>) => void;
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
    setIsArr(Array.isArray(value));

    const val = Array.isArray(value) ? value[0] : value;
    let detectedType = "text";
    if (key === "date" || key === "updated") {
      detectedType = "date";
    } else if (typeof val === "number") {
      detectedType = "number";
    } else if (val && typeof val === "object") {
      // TODO: Future enhancement to allow selecting different object notations (e.g. JSON, YAML)
      detectedType = "object";
    }
    setNewType(detectedType);
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

    // Convert value based on the selected type
    switch (newType) {
      case "number":
        valueToConvert = Number(valueToConvert);
        break;
      case "date":
      case "datetime":
        const date = new Date(valueToConvert);
        if (!isNaN(+date)) {
          valueToConvert = date.toISOString();
        } else {
          alert("Invalid date format.");
          return;
        }
        break;
      case "object":
        if (typeof valueToConvert === 'string') {
          try {
            valueToConvert = YAML.load(valueToConvert);
          } catch (e) {
            alert("Invalid YAML/JSON format.");
            return;
          }
        }
        break;
    }

    // Handle the "Is Array" toggle
    if (isArr && !Array.isArray(valueToConvert)) {
      valueToConvert = valueToConvert ? [valueToConvert] : [];
    } else if (!isArr && Array.isArray(valueToConvert)) {
      valueToConvert = valueToConvert[0] ?? "";
    }

    // Handle key change
    if (oldKey !== newKey) {
      delete newMetadata[oldKey];
    }

    newMetadata[newKey] = valueToConvert;

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
    const { isValid = true, isFocused } = validationState[key] || {};
    const validationClass = !isValid
      ? isFocused
        ? "border-yellow-400"
        : "border-red-500"
      : "";

    if (Array.isArray(value)) {
      return (
        <div className="space-y-2">
          {value.map((item, index) => (
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

    if (typeof value === "object" && value !== null) {
      return (
        <Textarea
          id={`meta-${key}`}
          name={key}
          value={typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
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
    }

    if (key === "date" || key === "updated") {
      const dateValue = value ? new Date(value).toISOString().split("T")[0] : "";
      return (
        <Input
          id={`meta-${key}`}
          name={key}
          type="date"
          value={dateValue}
          onChange={handleDateChange}
        />
      );
    }

    return (
      <Input
        id={`meta-${key}`}
        name={key}
        type="text"
        value={String(value)}
        onChange={handleInputChange}
      />
    );
  };

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
        {Object.entries(metadata).map(([key, value]) => (
          <div key={key} className="grid gap-2">
            <div className="flex items-center gap-2">
              <Label htmlFor={`meta-${key}`} className="capitalize">
                {key}
              </Label>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => handleEditField(key, value)}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </div>
            {renderInput(key, value)}
          </div>
        ))}
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
