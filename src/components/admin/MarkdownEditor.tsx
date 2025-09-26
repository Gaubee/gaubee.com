"use client";

import { Editor } from "@/components/blocks/editor-00/editor";
import type { FC } from "react";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import type { EditorState } from "lexical";
import { ImagesPlugin, INSERT_IMAGE_COMMAND } from "@/components/editor/plugins/images-plugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect, useState } from "react";
import { uploadFile } from "@/lib/github";
import { createHeadlessEditor } from "@lexical/headless";
import { nodes } from "@/components/blocks/editor-00/nodes";

interface MarkdownEditorProps {
  content: string;
  onChange: (value: string) => void;
  path: string | null;
}

const CustomImageUploadPlugin = ({ path }: { path: string | null }) => {
  const [editor] = useLexicalComposerContext();

  const handleImageUpload = async (file: File) => {
    if (!path) {
      alert("Cannot upload image without a file path.");
      return;
    }

    const match = path.match(/(\d+)\..+\.md$/);
    if (!match) {
      alert("Could not determine article ID from path.");
      return;
    }
    const articleId = match[1];
    const assetPath = `assets/article-${articleId}/${file.name}`;

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const base64 = (reader.result as string).split(",")[1];
        await uploadFile(assetPath, base64);
        editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
          src: `/${assetPath}`,
          altText: file.name,
        });
      } catch (error) {
        console.error("Failed to upload image:", error);
      }
    };
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              handleImageUpload(file);
            }
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("paste", onPaste);
    };
  }, [editor, path]);

  return null;
};

const MarkdownEditor: FC<MarkdownEditorProps> = ({
  content,
  onChange,
  path,
}) => {
  const [editorState, setEditorState] = useState<EditorState>();

  useEffect(() => {
    const headlessEditor = createHeadlessEditor({
      nodes: nodes,
      onError: () => {},
    });
    headlessEditor.update(
      () => {
        $convertFromMarkdownString(content, TRANSFORMERS);
      },
      { discrete: true }
    );
    setEditorState(headlessEditor.getEditorState());
  }, [content]);

  const handleStateChange = (editorState: EditorState) => {
    setEditorState(editorState);
    editorState.read(() => {
      const markdown = $convertToMarkdownString(TRANSFORMERS);
      onChange(markdown);
    });
  };

  if (!editorState) return null;

  return (
    <div className="w-full">
      <Editor editorState={editorState} onChange={handleStateChange} />
      <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
      <ListPlugin />
      <ImagesPlugin captionsEnabled={false} />
      <CustomImageUploadPlugin path={path} />
    </div>
  );
};

export default MarkdownEditor;