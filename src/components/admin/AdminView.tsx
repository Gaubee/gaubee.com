import StagedChanges from './StagedChanges';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import FileBrowser from './FileBrowser';
import { upsertChange } from '@/lib/db';

export default function AdminView() {
  const handleNewFile = (type: 'article' | 'event') => {
    window.location.href = `/gaubee/editor?new=${type}`;
  };

  const handleFileSelect = (path: string) => {
    window.location.href = `/gaubee/editor?path=${path}`;
  };

  const handleFileDelete = async (path: string) => {
    if (window.confirm(`Are you sure you want to stage deletion for "${path}"?`)) {
        try {
            await upsertChange({
                path: path,
                status: 'deleted',
            });
            window.dispatchEvent(new CustomEvent('refresh-staged-changes'));
            alert(`File ${path} has been staged for deletion.`);
        } catch (error) {
            console.error('Failed to stage deletion:', error);
            alert('Failed to stage deletion. See console for details.');
        }
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-4">
      <header className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">File Management</h1>
        <div className="flex space-x-2">
            <Button onClick={() => handleNewFile('article')}>
                <PlusCircle className="mr-2 h-4 w-4" /> New Article
            </Button>
            <Button onClick={() => handleNewFile('event')}>
                <PlusCircle className="mr-2 h-4 w-4" /> New Event
            </Button>
        </div>
      </header>
      <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
            <FileBrowser onFileSelect={handleFileSelect} onFileDelete={handleFileDelete} />
        </div>
        <aside>
            <StagedChanges />
        </aside>
      </main>
    </div>
  );
}
