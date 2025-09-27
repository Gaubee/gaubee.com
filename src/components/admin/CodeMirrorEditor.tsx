import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { githubDark } from "@uiw/codemirror-theme-github";
import { mermaid } from "codemirror-lang-mermaid";
import { useRef, useCallback, useEffect, useState } from "react";
import EditorToolbar from "./EditorToolbar";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { type SyntaxNode } from "@lezer/common";

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
  const [activeFormats, setActiveFormats] = useState<Record<string, boolean>>({});

  const handleUpload = useCallback(
    async (file: File) => {
      if (!path) {
        alert("Cannot upload file: current document path is unknown.");
        return;
      }
      const newFileName = prompt("Enter the filename for the uploaded file:", file.name);
      if (!newFileName) { return; }
      const match = path.match(/(article|event)-(\d+)/);
      if (!match) { alert("Cannot determine asset folder for this file path."); return; }
      const type = match[1];
      const id = match[2];
      const assetPath = `assets/${type}-${id}/${newFileName}`;
      const newFile = new File([file], newFileName, { type: file.type });
      const formData = new FormData();
      formData.append("file", newFile);
      formData.append("path", assetPath);
      try {
        const response = await fetch("/api/upload", { method: "POST", body: formData });
        if (!response.ok) { throw new Error(await response.text()); }
        const result = await response.json();
        const view = editor.current?.view;
        if (view) {
          const linkText = `\n![${newFileName}](${result.path})\n`;
          view.dispatch(view.state.update({ changes: { from: view.state.selection.main.head, insert: linkText } }));
        }
      } catch (error) {
        console.error("Upload failed:", error);
        alert(`Upload failed: ${error}`);
      }
    },
    [path]
  );

  const onPaste = useCallback((event: ClipboardEvent) => { if (event.clipboardData?.files[0]) { event.preventDefault(); handleUpload(event.clipboardData.files[0]); } }, [handleUpload]);
  const onDrop = useCallback((event: DragEvent) => { if (event.dataTransfer?.files[0]) { event.preventDefault(); handleUpload(event.dataTransfer.files[0]); } }, [handleUpload]);

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

  const toggleWrap = (start: string, end: string = start) => {
    const view = editor.current?.view;
    if (!view) return;
    const { state, dispatch } = view;
    const { from, to } = state.selection.main;
    const selectionText = state.sliceDoc(from, to);

    if (state.sliceDoc(from - start.length, from) === start && state.sliceDoc(to, to + end.length) === end) {
      dispatch(state.update({ changes: [{ from: from - start.length, to: from }, { from: to, to: to + end.length, insert: '' }] }));
    } else {
      dispatch(state.update({ changes: { from, to, insert: `${start}${selectionText}${end}` } }));
    }
    view.focus();
  };

  const toggleLinePrefix = (prefix: string) => {
    const view = editor.current?.view;
    if (!view) return;
    const { state, dispatch } = view;
    const { from, to } = state.selection.main;

    const startLine = state.doc.lineAt(from);
    const endLine = state.doc.lineAt(to);

    let allPrefixed = true;
    for (let i = startLine.number; i <= endLine.number; i++) {
        const line = state.doc.line(i);
        if (line.length > 0 && !line.text.startsWith(prefix)) {
            allPrefixed = false;
            break;
        }
    }

    const changes = [];
    for (let i = startLine.number; i <= endLine.number; i++) {
        const line = state.doc.line(i);
        if (line.length === 0 && endLine.number > startLine.number) continue;

        if (allPrefixed) {
            if (line.text.startsWith(prefix)) {
                changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
            }
        } else {
            changes.push({ from: line.from, insert: prefix });
        }
    }

    if (changes.length > 0) {
      dispatch({ changes });
    }
    view.focus();
  };

  const handleBold = () => toggleWrap("**");
  const handleItalic = () => toggleWrap("*");
  const handleStrikethrough = () => toggleWrap("~~");
  const handleCode = () => toggleWrap("\n```\n", "\n```\n"); // For code blocks
  const handleQuote = () => toggleLinePrefix("> ");
  const handleList = () => toggleLinePrefix("- ");
  const handleLink = () => {
    const view = editor.current?.view;
    if (!view) return;
    const url = prompt("Enter the URL for the link:");
    if (!url) {
      view.focus();
      return;
    }
    const { from, to } = view.state.selection.main;
    const selection = view.state.sliceDoc(from, to);
    const link = `[${selection || 'link text'}](${url})`;
    view.dispatch(view.state.update({ changes: { from, to, insert: link } }));
    view.focus();
  };

  const checkActiveFormats = (state: EditorState) => {
    const { from } = state.selection.main;
    const tree = syntaxTree(state);
    const formats: Record<string, boolean> = {};

    // Resolve the node at the cursor and walk up the tree to find all active formats.
    let node: SyntaxNode | null = tree.resolve(from, -1); // -1 bias gets the node before the cursor, good for this use case
    while (node) {
      const nodeName = node.name;
      if (nodeName.includes("StrongEmphasis")) formats.bold = true;
      if (nodeName.includes("Emphasis")) formats.italic = true;
      if (nodeName.includes("Strikethrough")) formats.strikethrough = true;
      if (nodeName.includes("InlineCode")) formats.code = true;
      if (nodeName.includes("FencedCode")) formats.code = true;
      if (nodeName.includes("Blockquote")) formats.quote = true;
      if (nodeName.includes("ListItem")) formats.list = true;
      if (nodeName.includes("Link")) formats.link = true;
      node = node.parent;
    }
    setActiveFormats(formats);
  };

  return (
    <div className="overflow-hidden rounded-lg border">
      <EditorToolbar
        onBold={handleBold}
        onItalic={handleItalic}
        onList={handleList}
        onLink={handleLink}
        onStrikethrough={handleStrikethrough}
        onQuote={handleQuote}
        onCode={handleCode}
        activeFormats={activeFormats}
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
              if (info === "mermaid") return mermaid().language;
              const lang = languages.find(l => l.name === info || l.alias.includes(info));
              return lang ? lang : null;
            },
          }),
          EditorView.updateListener.of((update: ViewUpdate) => {
            if (update.docChanged || update.selectionSet) {
              checkActiveFormats(update.state);
            }
          })
        ]}
        onChange={onChange}
        onCreateEditor={(view) => {
          checkActiveFormats(view.state);
        }}
      />
    </div>
  );
}