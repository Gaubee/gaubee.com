import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { upsertChange } from "@/lib/db";
import { getFileContent, getNextPostId } from "@/lib/files";
import { matter } from "@gaubee/nodekit/front-matter";
import { ArrowLeft, GitCommit, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import MarkdownEditor from "./MarkdownEditor";
import SmartMetadataEditor from "./SmartMetadataEditor";
import prettier from "prettier/standalone";
import prettierPluginMarkdown from "prettier/plugins/markdown";

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
      initializeNewFile(type);
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
      const { content, data } = matter<any>(fileContent);
      setMetadata(data);
      setMarkdownContent(content);
    } catch (error) {
      console.error("Failed to fetch file content:", error);
      setMarkdownContent("Failed to load file.");
    } finally {
      setIsLoadingContent(false);
    }
  }

  const [slug, setSlug] = useState("");
  const [nextId, setNextId] = useState<number | null>(null);

  const initializeNewFile = async (type: "article" | "event") => {
    const id = await getNextPostId(type);
    setNextId(id);
    setIsNewFile(true);
    setIsLoadingContent(false);
  };

  const handleCreateFile = () => {
    if (!slug || !nextId) return;
    const type = new URLSearchParams(window.location.search).get("new") as "article" | "event";
    const paddedId = nextId.toString().padStart(4, "0");
    const filename = `${paddedId}.${slug}.md`;
    const newPath = `src/content/${type}s/${filename}`;
    const newContent = `---
title: "New ${type}"
date: "${new Date().toISOString()}"
updated: "${new Date().toISOString()}"
tags: []
---

# New ${type}: ${slug}

Start writing...
`;
    setPath(newPath);
    setOriginalContent(newContent);
    const { content, data } = matter<any>(newContent);
    setMetadata(data);
    setMarkdownContent(content);
  };

  const handleStageChanges = async () => {
    if (!path) return;

    try {
      const updatedMetadata = {
        ...metadata,
        updated: new Date().toISOString(),
      };
      const newContent = matter.stringify(markdownContent, updatedMetadata);
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
      <div className="bg-muted flex h-full items-center justify-center rounded-lg border p-4">
        <p>Loading...</p>
      </div>
    );
  }

  if (isNewFile && !path) {
    return (
      <div className="space-y-4 p-4 md:p-8">
        <h3 className="text-lg font-semibold">Create New File</h3>
        <div className="flex items-end space-x-2">
          <div className="flex-grow">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </div>
          <Button onClick={handleCreateFile}>Create</Button>
        </div>
        {nextId && slug && (
          <p className="text-sm text-muted-foreground">
            Filename: {`${nextId.toString().padStart(4, "0")}.${slug}.md`}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Button
          variant="outline"
          onClick={() => (window.location.href = "/admin")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          <span className="hidden sm:inline">Back to Files</span>
        </Button>
        <div className="order-last w-full truncate text-center font-mono text-sm sm:order-none sm:w-auto">
          {path}
        </div>
        <div>
          <Button onClick={handleFormat} variant="outline" className="mr-2">
            <Sparkles className="mr-2 h-4 w-4" />
            Format
          </Button>
          <Button onClick={handleStageChanges} disabled={!hasChanges}>
            <GitCommit className="mr-2 h-4 w-4" />
            Stage Changes
          </Button>
        </div>
      </header>
      <SmartMetadataEditor metadata={metadata} onChange={setMetadata} />
      <MarkdownEditor
        content={markdownContent}
        onChange={setMarkdownContent}
        path={path}
      />
    </div>
  );

  async function handleFormat() {
    try {
      const formatted = await prettier.format(markdownContent, {
        parser: "markdown",
        plugins: [prettierPluginMarkdown],
      });
      setMarkdownContent(formatted);
    } catch (error) {
      console.error("Failed to format markdown:", error);
      alert("Failed to format markdown. See console for details.");
    }
  }
}
