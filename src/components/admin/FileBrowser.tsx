import { useState, useEffect } from 'react';
import { getRepoContents } from '../../lib/github';

type RepoContent = {
  name: string;
  path: string;
  type: 'file' | 'dir';
};

interface Props {
  onFileSelect: (path: string) => void;
  onFileDelete: (path: string) => void;
}

export default function FileBrowser({ onFileSelect, onFileDelete }: Props) {
  const [contents, setContents] = useState<RepoContent[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchContents() {
      try {
        setLoading(true);
        setError(null);
        const items = await getRepoContents(currentPath);
        const simplifiedItems = items.map(item => ({
          name: item.name,
          path: item.path,
          type: item.type as 'file' | 'dir',
        })).sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === 'dir' ? -1 : 1;
        });
        setContents(simplifiedItems);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }

    fetchContents();
  }, [currentPath]);

  const handleItemClick = (item: RepoContent) => {
    if (item.type === 'dir') {
      setCurrentPath(item.path);
    } else {
      onFileSelect(item.path);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, item: RepoContent) => {
    e.stopPropagation(); // Prevent triggering the item click
    if (window.confirm(`Are you sure you want to delete "${item.name}"?`)) {
      onFileDelete(item.path);
    }
  };

  const handleGoUp = () => {
    const pathParts = currentPath.split('/').filter(p => p);
    pathParts.pop();
    setCurrentPath(pathParts.join('/'));
  };

  return (
    <div className="p-4 border rounded-lg mt-4">
      <h2 className="text-lg font-semibold mb-2">File Browser</h2>
      <div className="mb-2">
        {currentPath && (
          <button onClick={handleGoUp} className="text-blue-500 hover:underline">
            .. Up
          </button>
        )}
        <span className="ml-2 text-gray-500">/{currentPath}</span>
      </div>
      {loading && <div>Loading files...</div>}
      {error && <div className="text-red-500">Error: {error}</div>}
      {!loading && !error && (
        <ul>
          {contents.map((item) => (
            <li
              key={item.path}
              className="flex items-center justify-between cursor-pointer hover:bg-gray-100 p-1 rounded"
            >
              <div onClick={() => handleItemClick(item)} className="flex-grow flex items-center">
                <span className="mr-2">{item.type === 'dir' ? '📁' : '📄'}</span>
                {item.name}
              </div>
              <button
                onClick={(e) => handleDeleteClick(e, item)}
                className="text-red-500 hover:text-red-700 px-2"
                title={`Delete ${item.name}`}
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
