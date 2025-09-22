import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  postsByMonth: Record<string, number>;
}

export default function ArchiveCard({ postsByMonth }: Props) {
  if (!postsByMonth || Object.keys(postsByMonth).length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Archive</CardTitle>
      </CardHeader>
      <CardContent>
        <ul>
          {Object.entries(postsByMonth).map(([month, count]) => (
            <li key={month}>
              <a href={`/archive/${month.replace("-", "/")}`}>
                {month} ({count})
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
