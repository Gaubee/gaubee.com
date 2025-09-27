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
      detectedType = "json";
    }
    setNewType(detectedType);
    setIsEditing(true);
  };

  const handleUpdateField = () => {
    if (!currentField) return;

    const { key: oldKey } = currentField;
    const newMetadata = { ...metadata };
    let newValue = newMetadata[oldKey];

    // If the value is a string from a textarea, it might need parsing
    if (typeof newValue === 'string' && (isArr || newType === 'json')) {
      try {
        newValue = JSON.parse(newValue);
      } catch (e) {
        alert(`Invalid JSON format for field '${newKey}'. Please fix it before saving.`);
        return;
      }
    }

    // Handle array conversion
    if (isArr && !Array.isArray(newValue)) {
      newValue = [newValue];
    } else if (!isArr && Array.isArray(newValue)) {
      newValue = newValue[0] ?? ''; // Use first element or empty string
    }

    // Handle key change
    if (oldKey !== newKey) {
      delete newMetadata[oldKey];
    }

    newMetadata[newKey] = newValue;
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

  const handleAddField = () => {
    const newField = prompt("Enter the new field name:");
    if (newField && !metadata.hasOwnProperty(newField)) {
      onChange({ ...metadata, [newField]: "" });
    } else if (newField) {
      alert(`Field "${newField}" already exists.`);
    }
  };

  const renderInput = (key: string, value: any) => {
    if (typeof value === "object" && value !== null) {
      return (
        <Textarea
          id={`meta-${key}`}
          name={key}
          value={typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
          onChange={(e) => {
            const { name, value } = e.target;
            try {
              const parsed = JSON.parse(value);
              onChange({ ...metadata, [name]: parsed });
            } catch (err) {
              onChange({ ...metadata, [name]: value });
            }
          }}
          className="h-24 font-mono"
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
                    <SelectItem value="json">JSON</SelectItem>
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
