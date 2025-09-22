import { useState, useEffect } from 'react';
import FileBrowser from './FileBrowser';
import MarkdownEditor from './MarkdownEditor';
import StagedChanges from './StagedChanges';
import { getFileContent } from '../../lib/github';
import { upsertChange, getChange } from '../../lib/db';
import { Button } from '@/components/ui/button';
import { PlusCircle, GitCommit } from 'lucide-react';

export default function AdminView() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [editedContent, setEditedContent] = useState<string>('');
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [isNewFile, setIsNewFile] = useState(false);

  useEffect(() => {
    if (isNewFile) {
        // It's a new file, content is already set, so we just reset the flag.
        setIsNewFile(false);
    } else if (selectedFile) {
        setEditedContent('');
        fetchContent(selectedFile);
    } else {
        setFileContent('');
        setEditedContent('');
    }
  }, [selectedFile]);

  async function fetchContent(path: string) {
    setIsLoadingContent(true);
    try {
      const content = await getFileContent(path);
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
    if (!selectedFile) return;

    try {
      const existingChange = await getChange(selectedFile);
      const status = existingChange?.status === 'created' ? 'created' : 'updated';

      await upsertChange({
        path: selectedFile,
        content: editedContent,
        originalContent: fileContent,
        status: status,
      });
      alert(`Changes for ${selectedFile} have been staged.`);
      setFileContent(editedContent);
      window.dispatchEvent(new CustomEvent('refresh-staged-changes'));
    } catch (error) {
      console.error('Failed to stage changes:', error);
      alert('Error staging changes. See console for details.');
    }
  };

  const handleNewFile = async (type: 'article' | 'event') => {
    const filename = prompt(`Enter the filename for the new ${type} (e.g., my-new-post.md):`);
    if (!filename) return;

    if (!filename.endsWith('.md')) {
      alert('Filename must end with .md');
      return;
    }

    const basePath = type === 'article' ? 'src/content/articles' : 'src/content/events';
    const path = `${basePath}/${filename}`;
    const newContent = `# New ${type}: ${filename}\n\nStart writing...`;

    try {
      await upsertChange({
        path: path,
        content: newContent,
        status: 'created',
      });
      window.dispatchEvent(new CustomEvent('refresh-staged-changes'));

      setIsNewFile(true);
      setFileContent(newContent);
      setEditedContent(newContent);
      setSelectedFile(path);
    } catch (error) {
      console.error('Failed to create new file:', error);
      alert('Failed to create new file. See console for details.');
    }
  };

  const handleFileDelete = async (path: string) => {
    if (window.confirm(`Are you sure you want to stage deletion for "${path}"?`)) {
        try {
            await upsertChange({
                path: path,
                status: 'deleted',
            });
            window.dispatchEvent(new CustomEvent('refresh-staged-changes'));
            if (selectedFile === path) {
                setSelectedFile(null);
            }
            alert(`File ${path} has been staged for deletion.`);
        } catch (error) {
            console.error('Failed to stage deletion:', error);
            alert('Failed to stage deletion. See console for details.');
        }
    }
  };

  const hasChanges = fileContent !== editedContent;

  return (
    <div className="p-4 space-y-4">
      <header className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Admin Panel</h1>
        <div className="flex space-x-2">
            <Button onClick={() => handleNewFile('article')}>
                <PlusCircle className="mr-2 h-4 w-4" /> New Article
            </Button>
            <Button onClick={() => handleNewFile('event')}>
                <PlusCircle className="mr-2 h-4 w-4" /> New Event
            </Button>
        </div>
      </header>
      <main className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <aside className="md:col-span-1 space-y-4">
          <FileBrowser onFileSelect={setSelectedFile} onFileDelete={handleFileDelete} />
          <StagedChanges />
        </aside>
        <section className="md:col-span-2">
            {isLoadingContent ? (
                <div className="p-4 border rounded-lg h-full flex items-center justify-center bg-muted">
                    <p>Loading...</p>
                </div>
            ) : selectedFile ? (
                <div>
                    <div className="flex justify-end mb-2">
                        <Button onClick={handleStageChanges} disabled={!hasChanges}>
                            <GitCommit className="mr-2 h-4 w-4" />
                            Stage Changes
                        </Button>
                    </div>
                    <MarkdownEditor content={fileContent} onChange={setEditedContent} />
                </div>
            ) : (
                <div className="p-4 border rounded-lg h-full flex items-center justify-center bg-muted">
                    <p className="text-muted-foreground">Select a file to start editing</p>
                </div>
            )}
        </section>
      </main>
    </div>
  );
}
