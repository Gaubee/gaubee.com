import { useState, useEffect } from 'react';
import { getFileContent } from '@/lib/github';
import { upsertChange, getChange } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { GitCommit, ArrowLeft } from 'lucide-react';
import MarkdownEditor from './MarkdownEditor';

export default function EditorView() {
  const [path, setPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [editedContent, setEditedContent] = useState<string>('');
  const [isLoadingContent, setIsLoadingContent] = useState(true);
  const [isNewFile, setIsNewFile] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const filePath = urlParams.get('path');
    const newFileType = urlParams.get('new');

    if (filePath) {
      setPath(filePath);
      fetchContent(filePath);
    } else if (newFileType) {
        const type = newFileType === 'article' ? 'article' : 'event';
        const filename = prompt(`Enter the filename for the new ${type} (e.g., my-new-post.md):`);
        if (!filename || !filename.endsWith('.md')) {
            alert('Invalid filename. Must end with .md');
            window.location.href = '/gaubee'; // Go back if invalid
            return;
        }
        const newPath = `src/content/${type}s/${filename}`;
        const newContent = `# New ${type}: ${filename}\n\nStart writing...`;

        setPath(newPath);
        setFileContent(newContent);
        setEditedContent(newContent);
        setIsNewFile(true);
        setIsLoadingContent(false);
    } else {
        // No path or new file type, redirect to file browser
        window.location.href = '/gaubee';
    }
  }, []);

  async function fetchContent(filePath: string) {
    setIsLoadingContent(true);
    try {
      const content = await getFileContent(filePath);
      setFileContent(content);
      setEditedContent(content);
    } catch (error) {
      console.error('Failed to fetch file content:', error);
      setFileContent('Failed to load file.');
      setEditedContent('Failed to load file.');
    } finally {
      setIsLoadingContent(false);
    }
  }

  const handleStageChanges = async () => {
    if (!path) return;

    try {
      const status = isNewFile ? 'created' : 'updated';
      await upsertChange({
        path: path,
        content: editedContent,
        originalContent: fileContent,
        status: status,
      });
      alert(`Changes for ${path} have been staged.`);
      // After staging, go back to the file browser view
      window.location.href = '/gaubee';
    } catch (error) {
      console.error('Failed to stage changes:', error);
      alert('Error staging changes. See console for details.');
    }
  };

  const hasChanges = fileContent !== editedContent;

  if (isLoadingContent) {
    return (
        <div className="p-4 border rounded-lg h-full flex items-center justify-center bg-muted">
            <p>Loading...</p>
        </div>
    )
  }

  return (
    <div className="p-4 md:p-8 space-y-4">
        <header className="flex flex-wrap gap-4 justify-between items-center">
            <Button variant="outline" onClick={() => window.location.href = '/gaubee'}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Back to Files</span>
            </Button>
            <div className="font-mono text-sm truncate order-last sm:order-none w-full sm:w-auto text-center">{path}</div>
            <Button onClick={handleStageChanges} disabled={!hasChanges}>
                <GitCommit className="mr-2 h-4 w-4" />
                Stage Changes
            </Button>
        </header>
        <MarkdownEditor content={fileContent} onChange={setEditedContent} />
    </div>
  );
}
