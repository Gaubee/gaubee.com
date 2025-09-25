import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface MetadataEditorProps {
  metadata: Record<string, any>;
  onChange: (newMetadata: Record<string, any>) => void;
}

export default function MetadataEditor({
  metadata,
  onChange,
}: MetadataEditorProps) {
  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    let newValue: any = value;

    // Attempt to parse arrays for keys like 'tags'
    if (name === "tags" && typeof value === "string") {
      newValue = value.split(",").map((tag) => tag.trim());
    }

    onChange({ ...metadata, [name]: newValue });
  };

  const renderValue = (key: string, value: any) => {
    if (Array.isArray(value)) {
      return value.join(", ");
    }
    return value;
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
            {typeof value === "string" && value.length > 100 ? (
              <Textarea
                id={`meta-${key}`}
                name={key}
                value={renderValue(key, value)}
                onChange={handleInputChange}
                className="h-24"
              />
            ) : (
              <Input
                id={`meta-${key}`}
                name={key}
                type="text"
                value={renderValue(key, value)}
                onChange={handleInputChange}
              />
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
