import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

const MenuBar = ({ editor }: { editor: Editor | null }) => {
  if (!editor) {
    return null;
  }

  // A basic toolbar. We can expand this later with shadcn/ui components.
  return (
    <div className="border p-2 rounded-t-lg bg-gray-50">
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={!editor.can().chain().focus().toggleBold().run()}
        className={editor.isActive('bold') ? 'is-active' : ''}
      >
        bold
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={!editor.can().chain().focus().toggleItalic().run()}
        className={editor.isActive('italic') ? 'is-active' : ''}
      >
        italic
      </button>
      {/* Add more buttons as needed */}
    </div>
  );
};

import { useEffect } from 'react';

interface Props {
  content: string;
  onSave: (newContent: string) => void;
}

export default function MarkdownEditor({ content, onSave }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
    ],
    content: '', // Start with empty and load content via useEffect
    editorProps: {
      attributes: {
        class: 'prose dark:prose-invert max-w-none p-4 border-x border-b rounded-b-lg focus:outline-none',
      },
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  const handleSave = () => {
    if (editor) {
      onSave(editor.getHTML()); // For now, we save as HTML. We might want to save as Markdown later.
    }
  };

  return (
    <div className="mt-4">
      <MenuBar editor={editor} />
      <EditorContent editor={editor} />
      <button
        onClick={handleSave}
        className="mt-4 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
      >
        Save Changes
      </button>
    </div>
  );
}
