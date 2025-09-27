import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { githubDark } from "@uiw/codemirror-theme-github";
import { mermaid } from "codemirror-lang-mermaid";
import { useRef, useCallback, useEffect } from "react";
import EditorToolbar from "./EditorToolbar";
import { EditorSelection } from "@codemirror/state";

interface CodeMirrorEditorProps {
  content: string;
  onChange: (content: string) => void;
  path: string | null;
}

export default function CodeMirrorEditor({
  content,
  onChange,
  path,
}: CodeMirrorEditorProps) {
  const editor = useRef<ReactCodeMirrorRef>(null);

  const handleUpload = useCallback(
    async (file: File) => {
      if (!path) {
        alert("Cannot upload file: current document path is unknown.");
        return;
      }

      const newFileName = prompt("Enter the filename for the uploaded file:", file.name);
      if (!newFileName) {
        return; // User cancelled
      }

      const match = path.match(/(article|event)-(\d+)/);
      if (!match) {
        alert("Cannot determine asset folder for this file path.");
        return;
      }

      const type = match[1];
      const id = match[2];
      const assetPath = `assets/${type}-${id}/${newFileName}`;

      const newFile = new File([file], newFileName, { type: file.type });
      const formData = new FormData();
      formData.append("file", newFile);
      formData.append("path", assetPath);

      try {
        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const result = await response.json();
        const view = editor.current?.view;
        if (view) {
          const linkText = `\n![${newFileName}](${result.path})\n`;
          view.dispatch(
            view.state.update({
              changes: { from: view.state.selection.main.head, insert: linkText },
            })
          );
        }
      } catch (error) {
        console.error("Upload failed:", error);
        alert(`Upload failed: ${error}`);
      }
    },
    [path]
  );

  const onPaste = useCallback(
    (event: ClipboardEvent) => {
      const file = event.clipboardData?.files[0];
      if (file) {
        event.preventDefault();
        handleUpload(file);
      }
    },
    [handleUpload]
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      const file = event.dataTransfer?.files[0];
      if (file) {
        event.preventDefault();
        handleUpload(file);
      }
    },
    [handleUpload]
  );

  useEffect(() => {
    const editorEl = editor.current?.editor;
    if (editorEl) {
      editorEl.addEventListener("paste", onPaste as EventListener);
      editorEl.addEventListener("drop", onDrop as EventListener);
      return () => {
        editorEl.removeEventListener("paste", onPaste as EventListener);
        editorEl.removeEventListener("drop", onDrop as EventListener);
      };
    }
  }, [onPaste, onDrop]);


  const wrapSelection = (start: string, end: string = start) => {
    const view = editor.current?.view;
    if (!view) return;
    const { state, dispatch } = view;
    const changes = state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to);
      return {
        changes: {
          from: range.from,
          to: range.to,
          insert: `${start}${text}${end}`,
        },
        range: EditorSelection.range(
          range.from + start.length,
          range.to + start.length
        ),
      };
    });
    dispatch(changes);
    view.focus();
  };

  const handleBold = () => wrapSelection("**");
  const handleItalic = () => wrapSelection("*");

  const handleList = () => {
    const view = editor.current?.view;
    if (!view) return;
    const { state, dispatch } = view;
    const { from, to } = state.selection.main;
    const startLine = state.doc.lineAt(from);
    const endLine = state.doc.lineAt(to);

    const changes = [];
    for (let i = startLine.number; i <= endLine.number; i++) {
      const line = state.doc.line(i);
      if (line.length > 0) {
        changes.push({ from: line.from, insert: "- " });
      }
    }

    if (changes.length > 0) {
      dispatch(state.update({ changes }));
    }
    view.focus();
  };

  const handleLink = () => {
    const view = editor.current?.view;
    if (!view) return;
    const { state, dispatch } = view;
    const { from, to } = state.selection.main;
    const text = state.sliceDoc(from, to);

    const url = prompt("Enter the URL:");
    if (url) {
      const linkText = `[${text}](${url})`;
      dispatch(
        state.update({
          changes: { from, to, insert: linkText },
        })
      );
    }
    view.focus();
  };

  return (
    <div className="overflow-hidden rounded-lg border">
      <EditorToolbar
        onBold={handleBold}
        onItalic={handleItalic}
        onList={handleList}
        onLink={handleLink}
      />
      <CodeMirror
        ref={editor}
        value={content}
        height="500px"
        theme={githubDark}
        extensions={[
          // TODO: Add autocompletion and hinting functionality.
          // This would involve adding the @codemirror/autocomplete package
          // and configuring it with sources for markdown keywords, etc.
          markdown({
            base: markdownLanguage,
            codeLanguages: (info) => {
              if (info === "mermaid") {
                return mermaid().language;
              }
              const lang = languages.find(
                (l) => l.name === info || l.alias.includes(info)
              );
              if (lang) {
                return lang;
              }
              return null;
            },
          }),
        ]}
        onChange={onChange}
      />
    </div>
  );
}