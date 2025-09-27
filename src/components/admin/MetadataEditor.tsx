import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
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

  const renderInput = (key: string, value: any) => {
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

    if (key === "tags" && Array.isArray(value)) {
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
      <CardHeader>
        <CardTitle>Metadata</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {Object.entries(metadata).map(([key, value]) => (
          <div key={key} className="grid gap-2">
            <Label htmlFor={`meta-${key}`} className="capitalize">
              {key}
            </Label>
            {renderInput(key, value)}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
