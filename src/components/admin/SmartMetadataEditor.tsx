"use client";

import type { FC } from "react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface SmartMetadataEditorProps {
  metadata: Record<string, any>;
  onChange: (metadata: Record<string, any>) => void;
}

const SmartMetadataEditor: FC<SmartMetadataEditorProps> = ({
  metadata,
  onChange,
}) => {
  const [newKey, setNewKey] = useState("");
  const [newTag, setNewTag] = useState("");

  const handleAdd = () => {
    if (newKey && !metadata.hasOwnProperty(newKey)) {
      onChange({ ...metadata, [newKey]: "" });
      setNewKey("");
    }
  };

  const handleRemove = (key: string) => {
    const newMetadata = { ...metadata };
    delete newMetadata[key];
    onChange(newMetadata);
  };

  const handleChange = (key: string, value: any) => {
    onChange({ ...metadata, [key]: value });
  };

  const handleAddTag = () => {
    if (newTag && !metadata.tags.includes(newTag)) {
      handleChange("tags", [...metadata.tags, newTag]);
      setNewTag("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    handleChange(
      "tags",
      metadata.tags.filter((t: string) => t !== tag)
    );
  };

  const renderField = (key: string, value: any) => {
    switch (key) {
      case "date":
      case "updated":
        return (
          <Input
            id={key}
            type="date"
            value={value ? new Date(value).toISOString().split("T")[0] : ""}
            onChange={(e) => handleChange(key, new Date(e.target.value).toISOString())}
          />
        );
      case "tags":
        return (
          <div>
            <div className="flex flex-wrap gap-2">
              {value.map((tag: string) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="ml-2 rounded-full hover:bg-destructive/80"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="mt-2 flex space-x-2">
              <Input
                placeholder="New Tag"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
              />
              <Button onClick={handleAddTag} size="icon">
                <Tag className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      default:
        return (
          <Input
            id={key}
            type="text"
            value={value}
            onChange={(e) => handleChange(key, e.target.value)}
          />
        );
    }
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h3 className="text-lg font-semibold">Metadata</h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Object.entries(metadata).map(([key, value]) => (
          <div key={key} className="flex items-start space-x-2">
            <div className="flex-grow">
              <Label htmlFor={key}>{key}</Label>
              {renderField(key, value)}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleRemove(key)}
              className="mt-6"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex space-x-2">
        <Input
          placeholder="New Key"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <Button onClick={handleAdd}>Add</Button>
      </div>
    </div>
  );
};

export default SmartMetadataEditor;