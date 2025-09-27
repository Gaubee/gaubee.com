import { Button } from "@/components/ui/button";
import { upsertChange } from "@/lib/db";
import { getFileContent } from "@/lib/github";
import { matter } from "@gaubee/nodekit/front-matter";
import { ArrowLeft, GitCommit, Sparkles } from "lucide-react";
import { useEffect, useState }from "react";
import MetadataEditor from "./MetadataEditor";
import CodeMirrorEditor from "./CodeMirrorEditor";
import MarkdownPreview from "./MarkdownPreview";
import TableOfContents from "./TableOfContents";
import prettier from "prettier/standalone";
import prettierPluginMarkdown from "prettier/plugins/markdown";

export default function EditorView() {
  const [path, setPath] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState<string>("");
  const [metadata, setMetadata] = useState<Record<string, any>>({});
  const [markdownContent, setMarkdownContent] = useState("");
  const [isLoadingContent, setIsLoadingContent] = useState(true);
  const [isNewFile, setIsNewFile] = useState(false);

  const handleFormat = async () => {
    try {
      const formattedContent = await prettier.format(markdownContent, {
        parser: "markdown",
        plugins: [prettierPluginMarkdown],
      });
      setMarkdownContent(formattedContent);
    } catch (error) {
      console.error("Failed to format markdown:", error);
      alert("Error formatting markdown. See console for details.");
    }
  };

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
      const { content, data } = matter<any>(newContent);
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
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleFormat}>
            <Sparkles className="mr-2 h-4 w-4" />
            Format
          </Button>
          <Button onClick={handleStageChanges} disabled={!hasChanges}>
            <GitCommit className="mr-2 h-4 w-4" />
            Stage Changes
          </Button>
        </div>
      </header>
      <MetadataEditor metadata={metadata} onChange={setMetadata} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:col-span-2">
          <CodeMirrorEditor
            content={markdownContent}
            onChange={setMarkdownContent}
            path={path}
          />
          <MarkdownPreview content={markdownContent} />
        </div>
        <div className="lg:col-span-1">
          <TableOfContents content={markdownContent} />
        </div>
      </div>
    </div>
  );
}
