import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import {
  Bold, Italic, Strikethrough, Code, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Link as LinkIcon
} from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Link } from '@tiptap/extension-link';
import { useEffect, useMemo, useState } from 'react';
import { debounce } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from '../ui/input';
import { Label } from '../ui/label';


const LinkDialog = ({ editor, onSetLink }: { editor: Editor, onSetLink: (url: string) => void }) => {
    const [url, setUrl] = useState(editor.getAttributes('link').href || '');

    return (
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Edit Link</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="url" className="text-right">
                        URL
                    </Label>
                    <Input
                        id="url"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        className="col-span-3"
                    />
                </div>
            </div>
            <DialogFooter>
                <Button onClick={() => onSetLink(url)}>Save changes</Button>
            </DialogFooter>
        </DialogContent>
    )
}


const EditorToolbar = ({ editor }: { editor: Editor | null }) => {
  if (!editor) {
    return null;
  }

  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);

  const handleSetLink = (url: string) => {
    if (url) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    } else {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    }
    setIsLinkDialogOpen(false);
  }

  return (
    <div className="border border-b-0 p-2 rounded-t-lg flex items-center space-x-1 overflow-x-auto">
        <Toggle size="sm" pressed={editor.isActive('bold')} onPressedChange={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></Toggle>
        <Toggle size="sm" pressed={editor.isActive('italic')} onPressedChange={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></Toggle>
        <Toggle size="sm" pressed={editor.isActive('strike')} onPressedChange={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="h-4 w-4" /></Toggle>
        <Toggle size="sm" pressed={editor.isActive('code')} onPressedChange={() => editor.chain().focus().toggleCode().run()}><Code className="h-4 w-4" /></Toggle>
        <Separator orientation="vertical" className="h-6" />
        <Toggle size="sm" pressed={editor.isActive('heading', { level: 1 })} onPressedChange={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 className="h-4 w-4" /></Toggle>
        <Toggle size="sm" pressed={editor.isActive('heading', { level: 2 })} onPressedChange={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></Toggle>
        <Toggle size="sm" pressed={editor.isActive('heading', { level: 3 })} onPressedChange={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-4 w-4" /></Toggle>
        <Separator orientation="vertical" className="h-6" />
        <Toggle size="sm" pressed={editor.isActive('bulletList')} onPressedChange={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></Toggle>
        <Toggle size="sm" pressed={editor.isActive('orderedList')} onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></Toggle>
        <Toggle size="sm" pressed={editor.isActive('blockquote')} onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="h-4 w-4" /></Toggle>
        <Separator orientation="vertical" className="h-6" />
        <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="sm"><LinkIcon className="h-4 w-4" /></Button>
            </DialogTrigger>
            <LinkDialog editor={editor} onSetLink={handleSetLink} />
        </Dialog>
    </div>
  );
};

interface Props {
  content: string;
  onChange: (newContent: string) => void;
}

export default function MarkdownEditor({ content, onChange }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown,
      Link.configure({
        openOnClick: false,
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'prose dark:prose-invert max-w-none p-4 border rounded-b-lg focus:outline-none min-h-[300px]',
      },
    },
    onUpdate: ({ editor }) => {
      debouncedOnChange((editor.storage as any).markdown.getMarkdown());
    },
  });

  const debouncedOnChange = useMemo(() => {
    return debounce(onChange, 500);
  }, [onChange]);

  useEffect(() => {
    if (editor && content !== (editor.storage as any).markdown.getMarkdown()) {
        editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor]);

  // Force re-render on selection update to update toolbar state
  const [, setForceRender] = useState(0);
  useEffect(() => {
    if (editor) {
        const handleUpdate = () => setForceRender(v => v + 1);
        editor.on('selectionUpdate', handleUpdate);
        editor.on('transaction', handleUpdate); // Also update on transactions
        return () => {
            editor.off('selectionUpdate', handleUpdate);
            editor.off('transaction', handleUpdate)
        };
    }
  }, [editor]);

  return (
    <div className="mt-4">
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
