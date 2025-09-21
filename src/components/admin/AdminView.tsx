import { useState, useEffect } from 'react';
import FileBrowser from './FileBrowser';
import MarkdownEditor from './MarkdownEditor';
import StagedChanges from './StagedChanges';
import { getFileContent } from '../../lib/github';
import { upsertChange, getChange } from '../../lib/db';

export default function AdminView() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isLoadingContent, setIsLoadingContent] = useState(false);

  useEffect(() => {
    if (!selectedFile) return;

    async function fetchContent() {
      if (!selectedFile) return; // Redundant guard to satisfy TS
      setIsLoadingContent(true);
      try {
        const content = await getFileContent(selectedFile);
        setFileContent(content);
      } catch (error) {
        console.error('Failed to fetch file content:', error);
        // Optionally, show an error message to the user
      } finally {
        setIsLoadingContent(false);
      }
    }

    fetchContent();
  }, [selectedFile]);

  const handleSave = async (newContent: string) => {
    if (!selectedFile) return;

    try {
      // Check if the file is already staged as 'created'
      const existingChange = await getChange(selectedFile);
      const status = existingChange?.status === 'created' ? 'created' : 'updated';

      await upsertChange({
        path: selectedFile,
        content: newContent,
        status: status,
      });
      alert(`Changes for ${selectedFile} have been staged.`);
      window.dispatchEvent(new CustomEvent('refresh-staged-changes'));
    } catch (error) {
      console.error('Failed to stage changes:', error);
      alert('Error staging changes. See console for details.');
    }
  };

  const handleNewFile = async (type: 'article' | 'event') => {
    const filename = prompt(`Enter the filename for the new ${type} (e.g., my-new-post.md):`);
    if (!filename) return;

    // Basic validation for filename
    if (!filename.endsWith('.md')) {
      alert('Filename must end with .md');
      return;
    }

    const basePath = type === 'article' ? 'src/content/articles' : 'src/content/events';
    const path = `${basePath}/${filename}`;

    try {
      await upsertChange({
        path: path,
        content: `# New ${type}: ${filename}\n\nStart writing...`,
        status: 'created',
      });
      window.dispatchEvent(new CustomEvent('refresh-staged-changes'));
      setSelectedFile(path); // Open the new file in the editor
    } catch (error) {
      console.error('Failed to create new file:', error);
      alert('Failed to create new file. See console for details.');
    }
  };

  const handleFileDelete = async (path: string) => {
    try {
      await upsertChange({
        path: path,
        status: 'deleted',
      });
      window.dispatchEvent(new CustomEvent('refresh-staged-changes'));
      if (selectedFile === path) {
        setSelectedFile(null); // Clear editor if the opened file is deleted
      }
      alert(`File ${path} has been staged for deletion.`);
    } catch (error) {
      console.error('Failed to stage deletion:', error);
      alert('Failed to stage deletion. See console for details.');
    }
  };

  return (
    <div>
      <div className="my-4 flex space-x-2">
        <button onClick={() => handleNewFile('article')} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
          New Article
        </button>
        <button onClick={() => handleNewFile('event')} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
          New Event
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-1">
          <FileBrowser onFileSelect={setSelectedFile} onFileDelete={handleFileDelete} />
        </div>
        <div className="md:col-span-2">
        {isLoadingContent ? (
          <div>Loading editor...</div>
        ) : selectedFile ? (
          <MarkdownEditor content={fileContent} onSave={handleSave} />
        ) : (
          <div className="p-4 border rounded-lg h-full flex items-center justify-center bg-gray-50">
            <p className="text-gray-500">Select a file to start editing</p>
          </div>
        )}
        </div>
      </div>
      <StagedChanges />
    </div>
  );
}
