import { Button } from "@/components/ui/button";
import { upsertChange } from "@/lib/db";
import { getFileContent } from "@/lib/github";
import { matter } from "@gaubee/nodekit/front-matter";
import {
  ArrowLeft,
  GitCommit,
  Sparkles,
  PanelLeft,
  PanelRight,
  Columns,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import MetadataEditor from "./MetadataEditor";
import CodeMirrorEditor from "./CodeMirrorEditor";
import MarkdownPreview from "./MarkdownPreview";
import TableOfContents from "./TableOfContents";
import prettier from "prettier/standalone";
import prettierPluginMarkdown from "prettier/plugins/markdown";

export type MetadataFieldSchema = {
  type: "text" | "date" | "datetime" | "number" | "url" | "tel" | "color" | "object";
  isArray: boolean;
  order: number;
  description: string;
};

export type EditorMetadata = {
  __editor_metadata?: Record<string, MetadataFieldSchema>;
  [key: string]: any;
};

function generateInitialSchema(data: Record<string, any>): Record<string, MetadataFieldSchema> {
  const schema: Record<string, MetadataFieldSchema> = {};
  Object.keys(data).forEach((key, index) => {
    if (key === "__editor_metadata") return;
    const value = data[key];
    let detectedType: MetadataFieldSchema["type"] = "text";
    if (typeof value === "number") {
      detectedType = "number";
    } else if (value instanceof Date || (typeof value === "string" && !isNaN(new Date(value).getTime()))) {
      detectedType = "date";
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      detectedType = "object";
    }

    schema[key] = {
      type: detectedType,
      isArray: Array.isArray(value),
      order: index,
      description: `Configuration for the '${key}' field.`,
    };
  });
  return schema;
}

export default function EditorView() {
  const [path, setPath] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState<string>("");
  const [metadata, setMetadata] = useState<EditorMetadata>({});
  const [markdownContent, setMarkdownContent] = useState("");
  const [isLoadingContent, setIsLoadingContent] = useState(true);
  const [isNewFile, setIsNewFile] = useState(false);
  const [viewMode, setViewMode] = useState("split"); // 'editor', 'preview', 'split'
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (isMobile && viewMode === "split") {
      setViewMode("editor");
    }
  }, [isMobile, viewMode]);

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

      if (!data.__editor_metadata) {
        data.__editor_metadata = generateInitialSchema(data);
      }

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

      if (!data.__editor_metadata) {
        data.__editor_metadata = generateInitialSchema(data);
      }

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
        <div className="order-last flex-grow text-center sm:order-none">
          <ToggleGroup
            type="single"
            defaultValue="split"
            value={viewMode}
            onValueChange={(value) => {
              if (value) setViewMode(value);
            }}
            aria-label="Editor view mode"
            className="mx-auto inline-flex"
          >
            <ToggleGroupItem value="editor" aria-label="Editor only">
              <PanelLeft className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="split"
              aria-label="Split view"
              disabled={isMobile}
            >
              <Columns className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="preview" aria-label="Preview only">
              <PanelRight className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
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
      <div className="w-full truncate text-center font-mono text-sm text-muted-foreground">
        {path}
      </div>
      <MetadataEditor metadata={metadata} onChange={setMetadata} />
      <div
        className={`grid grid-cols-1 gap-4 ${
          viewMode === "split" && !isMobile ? "md:grid-cols-2" : ""
        }`}
      >
        {(viewMode === "editor" || (viewMode === "split" && !isMobile)) && (
          <div
            className={
              viewMode === "split" && !isMobile ? "" : "col-span-full"
            }
          >
            <CodeMirrorEditor
              content={markdownContent}
              onChange={setMarkdownContent}
              path={path}
            />
          </div>
        )}
        {(viewMode === "preview" || (viewMode === "split" && !isMobile)) && (
          <div
            className={
              viewMode === "split" && !isMobile ? "" : "col-span-full"
            }
          >
            <div className="space-y-4">
              <TableOfContents content={markdownContent} />
              <MarkdownPreview content={markdownContent} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
