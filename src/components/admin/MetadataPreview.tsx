import * as YAML from 'js-yaml';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface MetadataPreviewProps {
  metadata: Record<string, any>;
}

export default function MetadataPreview({ metadata }: MetadataPreviewProps) {
  const displayData = { ...metadata };
  delete displayData.__editor_metadata;

  let yamlString = '';
  try {
    yamlString = YAML.dump(displayData);
  } catch (e) {
    console.error("Error dumping YAML:", e);
    yamlString = "Error generating YAML preview.";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Metadata (Preview)</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="p-4 bg-muted rounded-md text-sm overflow-auto font-mono">
          <code>{yamlString}</code>
        </pre>
      </CardContent>
    </Card>
  );
}