import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Props {
  tags: string[];
}

export default function TagsCard({ tags }: Props) {
  if (!tags || tags.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tags</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <a
              key={tag}
              href={`/tags/${tag}`}
              className="bg-gray-200 dark:bg-gray-700 rounded-full px-3 py-1 text-sm font-semibold"
            >
              {tag}
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
