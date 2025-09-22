import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowUp, File, Folder, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getRepoContents } from "../../lib/github";

type RepoContent = {
  name: string;
  path: string;
  type: "file" | "dir";
};

interface Props {
  onFileSelect: (path: string) => void;
  onFileDelete: (path: string) => void;
}

export default function FileBrowser({ onFileSelect, onFileDelete }: Props) {
  const [contents, setContents] = useState<RepoContent[]>([]);
  const [currentPath, setCurrentPath] = useState("src/content");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchContents() {
      try {
        setLoading(true);
        setError(null);
        const items = await getRepoContents(currentPath);
        const simplifiedItems = items
          .map((item) => ({
            name: item.name,
            path: item.path,
            type: item.type as "file" | "dir",
          }))
          .sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === "dir" ? -1 : 1;
          });
        setContents(simplifiedItems);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }

    fetchContents();
  }, [currentPath]);

  const handleItemClick = (item: RepoContent) => {
    if (item.type === "dir") {
      setCurrentPath(item.path);
    } else {
      onFileSelect(item.path);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, item: RepoContent) => {
    e.stopPropagation(); // Prevent triggering the item click
    if (window.confirm(`Are you sure you want to delete "${item.name}"?`)) {
      onFileDelete(item.path);
    }
  };

  const handleGoUp = () => {
    if (currentPath === "src/content") return; // Don't go above the content root
    const pathParts = currentPath.split("/").filter((p) => p);
    pathParts.pop();
    setCurrentPath(pathParts.join("/"));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>File Browser</CardTitle>
        {currentPath !== "src/content" && (
          <Button variant="outline" size="sm" onClick={handleGoUp}>
            <ArrowUp className="mr-2 h-4 w-4" /> Up
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="mb-2 text-sm text-muted-foreground">/{currentPath}</div>
        {loading && <div className="text-center p-4">Loading...</div>}
        {error && <div className="text-red-500 p-4">Error: {error}</div>}
        {!loading && !error && (
          <ul className="space-y-1">
            {contents.map((item) => (
              <li
                key={item.path}
                className="flex items-center justify-between cursor-pointer hover:bg-accent p-2 rounded-md"
                onClick={() => handleItemClick(item)}
              >
                <div className="flex-grow flex items-center truncate">
                  {item.type === "dir" ? (
                    <Folder className="mr-2 h-4 w-4" />
                  ) : (
                    <File className="mr-2 h-4 w-4" />
                  )}
                  <span className="truncate">{item.name}</span>
                </div>
                {item.type === "file" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => handleDeleteClick(e, item)}
                    title={`Delete ${item.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
