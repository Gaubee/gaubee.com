import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import { type MetadataFieldSchema } from "./types";

interface FieldMetadataEditDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  fieldKey?: string;
  fieldSchema: MetadataFieldSchema;
  isNew: boolean;
  onSave: (newKey: string, newSchema: MetadataFieldSchema) => void;
}

export function FieldMetadataEditDialog({
  isOpen,
  onOpenChange,
  fieldKey = "",
  fieldSchema,
  isNew,
  onSave,
}: FieldMetadataEditDialogProps) {
  const [newKey, setNewKey] = useState(fieldKey);
  const [newType, setNewType] = useState<MetadataFieldSchema["type"]>(fieldSchema.type);
  const [isArr, setIsArr] = useState(fieldSchema.isArray);
  const [description, setDescription] = useState(fieldSchema.description);

  useEffect(() => {
    setNewKey(fieldKey);
    setNewType(fieldSchema.type);
    setIsArr(fieldSchema.isArray);
    setDescription(fieldSchema.description);
  }, [fieldKey, fieldSchema, isOpen]);

  const handleSaveChanges = () => {
    onSave(newKey, {
      ...fieldSchema,
      type: newType,
      isArray: isArr,
      description,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isNew ? "Create New Field" : `Edit Field: ${fieldKey}`}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-4 md:gap-4">
            <Label htmlFor="key" className="md:text-right">
              Key
            </Label>
            <Input
              id="key"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="col-span-3"
              readOnly={!isNew && newKey === 'updated'}
            />
          </div>
          <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-4 md:gap-4">
            <Label htmlFor="type" className="md:text-right">
              Type
            </Label>
            <Select value={newType} onValueChange={(value: string) => setNewType(value as MetadataFieldSchema["type"])}>
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
                <SelectItem value="object">Object (YAML/JSON)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-4 md:gap-4">
            <Label htmlFor="description" className="md:text-right">
              Description
            </Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="flex items-center justify-end gap-2 md:col-start-2 md:col-span-3">
            <Label htmlFor="is-array">
              Is Array
            </Label>
            <Checkbox
              id="is-array"
              checked={isArr}
              onCheckedChange={(checked: boolean) => setIsArr(checked)}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" onClick={handleSaveChanges}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}