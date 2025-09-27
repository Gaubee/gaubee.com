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
import { closeBrackets } from "@codemirror/autocomplete";

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

  const handleFormatToggle = (controlSymbol: string, formatName: "bold" | "italic" | "strikethrough" | "code") => {
    const view = editor.current?.view;
    if (!view) return;
    const { state, dispatch } = view;
    const { from, to, empty } = state.selection.main;

    const formatNodeName = {
        bold: "StrongEmphasis",
        italic: "Emphasis",
        strikethrough: "Strikethrough",
        code: "InlineCode"
    }[formatName];

    if (empty) {
      if (activeFormats[formatName]) {
        let node: SyntaxNode | null = syntaxTree(state).resolve(from, -1);
        while (node) {
          if (node.name === formatNodeName) {
            const startMarkerLength = controlSymbol.length;
            const endMarkerLength = controlSymbol.length;
            dispatch({
              changes: [
                { from: node.from, to: node.from + startMarkerLength },
                { from: node.to - endMarkerLength, to: node.to },
              ],
            });
            return;
          }
          node = node.parent;
        }
      } else {
        const transaction = state.update({
          changes: { from, insert: controlSymbol + controlSymbol },
          selection: { anchor: from + controlSymbol.length },
        });
        dispatch(transaction);
      }
    } else {
      const isWrapped =
        state.sliceDoc(from - controlSymbol.length, from) === controlSymbol &&
        state.sliceDoc(to, to + controlSymbol.length) === controlSymbol;

      if (isWrapped) {
        dispatch({
          changes: [
            { from: from - controlSymbol.length, to: from },
            { from: to, to: to + controlSymbol.length },
          ],
        });
      } else {
        const selectionText = state.sliceDoc(from, to);
        dispatch({
          changes: { from, to, insert: `${controlSymbol}${selectionText}${controlSymbol}` },
        });
      }
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
      if (line.length > 0) {
        const lineText = line.text;
        const linePrefix = lineText.match(/^\s*/)?.[0] ?? '';
        if (!lineText.slice(linePrefix.length).startsWith(prefix)) {
          allPrefixed = false;
          break;
        }
      }
    }

    const changes = [];
    for (let i = startLine.number; i <= endLine.number; i++) {
      const line = state.doc.line(i);
      if (line.length === 0 && endLine.number > startLine.number) continue;

      const linePrefix = line.text.match(/^\s*/)?.[0] ?? '';
      if (allPrefixed) {
        if (line.text.slice(linePrefix.length).startsWith(prefix)) {
          changes.push({ from: line.from + linePrefix.length, to: line.from + linePrefix.length + prefix.length, insert: "" });
        }
      } else {
        changes.push({ from: line.from + linePrefix.length, insert: prefix });
      }
    }

    if (changes.length > 0) {
      dispatch({ changes });
    }
    view.focus();
  };

  const handleBold = () => handleFormatToggle("**", "bold");
  const handleItalic = () => handleFormatToggle("*", "italic");
  const handleStrikethrough = () => handleFormatToggle("~~", "strikethrough");
  const handleCode = () => handleFormatToggle("`", "code");
  const handleCodeBlock = () => {
    const view = editor.current?.view;
    if (!view) return;
    const { state, dispatch } = view;
    const { from, to, empty } = state.selection.main;

    const startLine = state.doc.lineAt(from);
    const endLine = empty ? startLine : state.doc.lineAt(to);

    const selectionText = state.sliceDoc(startLine.from, endLine.to);
    const fences = selectionText.match(/^(\s*)`{3,}/gm) || [];
    let maxTicks = 0;
    for (const fence of fences) {
      maxTicks = Math.max(maxTicks, fence.trim().length);
    }

    const newFence = '`'.repeat(Math.max(3, maxTicks + 1));

    dispatch({
      changes: [
        { from: startLine.from, insert: newFence + '\n' },
        { from: endLine.to, insert: '\n' + newFence }
      ],
      selection: { anchor: startLine.from + newFence.length + 1 }
    });
    view.focus();
  };
  const handleQuote = () => toggleLinePrefix("> ");
  const handleList = () => toggleLinePrefix("- ");

  const handleTaskList = () => {
    const view = editor.current?.view;
    if (!view) return;
    const { state, dispatch } = view;
    const { from, empty } = state.selection.main;

    const line = state.doc.lineAt(from);
    // If it's just a cursor and we are on a task list item, toggle its state
    if (empty) {
        const taskMatch = line.text.match(/^(\s*-\s*\[)([ x])(\]\s)/);
        if (taskMatch) {
            const newMark = taskMatch[2] === ' ' ? 'x' : ' ';
            const change = {
                from: line.from + taskMatch[1].length,
                to: line.from + taskMatch[1].length + 1,
                insert: newMark
            };
            dispatch({ changes: [change] });
            view.focus();
            return;
        }
    }
    // If there's a selection or we are not on a task list item, use toggleLinePrefix
    toggleLinePrefix('- [ ] ');
  };

  const handleOrderedList = () => {
    const view = editor.current?.view;
    if (!view) return;
    const { state, dispatch } = view;
    const { from, to } = state.selection.main;

    const startLine = state.doc.lineAt(from);
    const endLine = state.doc.lineAt(to);

    let allAreOrdered = true;
    for (let i = startLine.number; i <= endLine.number; i++) {
        const line = state.doc.line(i);
        if (line.length > 0 && !/^\s*\d+\.\s/.test(line.text)) {
            allAreOrdered = false;
            break;
        }
    }

    const changes = [];
    if (allAreOrdered) {
        // Remove numbering
        for (let i = startLine.number; i <= endLine.number; i++) {
            const line = state.doc.line(i);
            const match = line.text.match(/^(\s*)(\d+)\.\s/);
            if (match) {
                changes.push({ from: line.from + match[1].length, to: line.from + match[0].length });
            }
        }
    } else {
        // Add numbering
        let startNumber = 1;
        if (startLine.number > 1) {
            const prevLine = state.doc.line(startLine.number - 1);
            const match = prevLine.text.match(/^(\s*)(\d+)\.\s/);
            if (match) {
                startNumber = parseInt(match[2], 10) + 1;
            }
        }
        for (let i = startLine.number; i <= endLine.number; i++) {
            const line = state.doc.line(i);
            if (line.length === 0 && endLine.number > startLine.number) continue;

            const existingPrefixMatch = line.text.match(/^\s*(-|\*|\+)\s/);
            if (existingPrefixMatch) {
                const linePrefix = existingPrefixMatch[1];
                const prefix = `${startNumber}. `;
                changes.push({ from: line.from + line.text.indexOf(linePrefix), to: line.from + line.text.indexOf(linePrefix) + linePrefix.length, insert: prefix });
            } else {
                const linePrefix = line.text.match(/^\s*/)?.[0] ?? '';
                const prefix = `${startNumber}. `;
                changes.push({ from: line.from + linePrefix.length, insert: prefix });
            }
            startNumber++;
        }
    }

    if (changes.length > 0) {
      dispatch({ changes });
    }
    view.focus();
  };

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

    let node: SyntaxNode | null = tree.resolve(from, -1);
    while (node) {
      const nodeName = node.name;
      if (nodeName.includes("StrongEmphasis")) formats.bold = true;
      if (nodeName.includes("Emphasis")) formats.italic = true;
      if (nodeName.includes("Strikethrough")) formats.strikethrough = true;
      if (nodeName.includes("InlineCode")) formats.code = true;
      if (nodeName.includes("FencedCode")) formats["code-block"] = true;
      if (nodeName.includes("Blockquote")) formats.quote = true;
      if (nodeName.includes("ListItem")) {
        const listItemText = state.sliceDoc(node.from, node.to);
        if (listItemText.match(/^\s*-\s*\[[ x]\]/)) {
            formats["task-list"] = true;
        } else if (listItemText.match(/^\s*\d+\.\s/)) {
            formats["ordered-list"] = true;
        } else {
            formats.list = true;
        }
      }
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
        onOrderedList={handleOrderedList}
        onTaskList={handleTaskList}
        onLink={handleLink}
        onStrikethrough={handleStrikethrough}
        onQuote={handleQuote}
        onCode={handleCode}
        onCodeBlock={handleCodeBlock}
        activeFormats={activeFormats}
      />
      <CodeMirror
        ref={editor}
        value={content}
        height="500px"
        theme={githubDark}
        extensions={[
          closeBrackets(),
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