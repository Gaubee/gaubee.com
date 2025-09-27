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
  const [newTag, setNewTag] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [currentField, setCurrentField] = useState<{
    key: string;
    value: any;
  } | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newType, setNewType] = useState("");

  const handleEditField = (key: string, value: any) => {
    setCurrentField({ key, value });
    setNewKey(key);
    // Infer type from value for the select default
    let detectedType = "text";
    if (key === "date" || key === "updated") detectedType = "date";
    else if (typeof value === "number") detectedType = "number";
    else if (Array.isArray(value)) detectedType = "tags";
    setNewType(detectedType);
    setIsEditing(true);
  };

  const handleUpdateField = () => {
    if (!currentField) return;

    const { key: oldKey, value: oldValue } = currentField;
    const newMetadata = { ...metadata };

    let newValue = oldValue;
    // Handle type conversion
    if (newType === "tags" && !Array.isArray(oldValue)) {
      newValue = String(oldValue).split(",").map(s => s.trim());
    } else if (newType === "number" && isNaN(Number(oldValue))) {
      newValue = 0;
    } else if (newType === "date" && isNaN(new Date(oldValue).getTime())) {
      newValue = new Date().toISOString();
    }

    // If key has changed, remove old key
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

  const handleAddTag = () => {
    if (newTag && !metadata.tags.includes(newTag)) {
      onChange({ ...metadata, tags: [...metadata.tags, newTag] });
      setNewTag("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    onChange({
      ...metadata,
      tags: metadata.tags.filter((tag: string) => tag !== tagToRemove),
    });
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
    const type = newType || "text"; // Fallback to text if type is not set
    if (type === "date" || type === "datetime") {
      const dateValue = value
        ? new Date(value).toISOString().slice(0, 16)
        : "";
      return (
        <Input
          id={`meta-${key}`}
          name={key}
          type={type === "date" ? "date" : "datetime-local"}
          value={dateValue}
          onChange={handleDateChange}
        />
      );
    }

    if (type === "number") {
      return (
        <Input
          id={`meta-${key}`}
          name={key}
          type="number"
          value={value}
          onChange={handleInputChange}
        />
      );
    }

    if (type === "url" || type === "tel" || type === "color") {
       return (
        <Input
          id={`meta-${key}`}
          name={key}
          type={type}
          value={value}
          onChange={handleInputChange}
        />
      );
    }

    if (type === "tags" && Array.isArray(value)) {
      return (
        <div>
          <div className="flex flex-wrap gap-2">
            {value.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-1 h-4 w-4"
                  onClick={() => handleRemoveTag(tag)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Add a tag"
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddTag())}
            />
            <Button onClick={handleAddTag}>Add</Button>
          </div>
        </div>
      );
    }

    if (typeof value === "string" && value.length > 100) {
      return (
        <Textarea
          id={`meta-${key}`}
          name={key}
          value={value}
          onChange={handleInputChange}
          className="h-24"
        />
      );
    }

    return (
      <Input
        id={`meta-${key}`}
        name={key}
        type="text"
        value={value}
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
                    <SelectItem value="tags">Tags (Array)</SelectItem>
                    <SelectItem value="url">URL</SelectItem>
                    <SelectItem value="tel">Telephone</SelectItem>
                    <SelectItem value="color">Color</SelectItem>
                  </SelectContent>
                </Select>
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
