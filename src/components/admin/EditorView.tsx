import { Button } from "@/components/ui/button";
import { upsertChange } from "@/lib/db";
import { getFileContent } from "@/lib/github";
import { matter } from "@gaubee/nodekit/front-matter";
import { ArrowLeft, GitCommit } from "lucide-react";
import { useEffect, useState } from "react";
import MarkdownEditor from "./MarkdownEditor";
import MetadataEditor from "./MetadataEditor";

export default function EditorView() {
  const [path, setPath] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState<string>("");
  const [metadata, setMetadata] = useState<Record<string, any>>({});
  const [markdownContent, setMarkdownContent] = useState("");
  const [isLoadingContent, setIsLoadingContent] = useState(true);
  const [isNewFile, setIsNewFile] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const filePath = urlParams.get("path");
    const newFileType = urlParams.get("new");

    if (filePath) {
      setPath(filePath);
      fetchContent(filePath);
    } else if (newFileType) {
      const type = newFileType === "article" ? "article" : "event";
      const filename = prompt(
        `Enter the filename for the new ${type} (e.g., my-new-post.md):`,
      );
      if (!filename || !filename.endsWith(".md")) {
        alert("Invalid filename. Must end with .md");
        window.location.href = "/admin"; // Go back if invalid
        return;
      }
      const newPath = `src/content/${type}s/${filename}`;
      const newContent = `---
title: "New ${type}"
date: "${new Date().toISOString()}"
tags: []
---

# New ${type}: ${filename}

Start writing...
`;
      setPath(newPath);
      setOriginalContent(newContent);
      const { body: content, attributes: data } = matter<any>(newContent);
      setMetadata(data);
      setMarkdownContent(content);
      setIsNewFile(true);
      setIsLoadingContent(false);
    } else {
      // No path or new file type, redirect to file browser
      window.location.href = "/admin";
    }
  }, []);

  async function fetchContent(filePath: string) {
    setIsLoadingContent(true);
    try {
      const fileContent = await getFileContent(filePath);
      setOriginalContent(fileContent);
      const { body: content, attributes: data } = matter<any>(fileContent);
      setMetadata(data);
      setMarkdownContent(content);
    } catch (error) {
      console.error("Failed to fetch file content:", error);
      setMarkdownContent("Failed to load file.");
    } finally {
      setIsLoadingContent(false);
    }
  }

  const handleStageChanges = async () => {
    if (!path) return;

    try {
      const newContent = matter.stringify(markdownContent, metadata);
      const status = isNewFile ? "created" : "updated";
      await upsertChange({
        path: path,
        content: newContent,
        originalContent: originalContent,
        status: status,
      });
      alert(`Changes for ${path} have been staged.`);
      window.location.href = "/admin";
    } catch (error) {
      console.error("Failed to stage changes:", error);
      alert("Error staging changes. See console for details.");
    }
  };

  const hasChanges =
    originalContent !== matter.stringify(markdownContent, metadata);

  if (isLoadingContent) {
    return (
      <div className="p-4 border rounded-lg h-full flex items-center justify-center bg-muted">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-4">
      <header className="flex flex-wrap gap-4 justify-between items-center">
        <Button
          variant="outline"
          onClick={() => (window.location.href = "/admin")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          <span className="hidden sm:inline">Back to Files</span>
        </Button>
        <div className="font-mono text-sm truncate order-last sm:order-none w-full sm:w-auto text-center">
          {path}
        </div>
        <Button onClick={handleStageChanges} disabled={!hasChanges}>
          <GitCommit className="mr-2 h-4 w-4" />
          Stage Changes
        </Button>
      </header>
      <MetadataEditor metadata={metadata} onChange={setMetadata} />
      <MarkdownEditor content={markdownContent} onChange={setMarkdownContent} />
    </div>
  );
}
