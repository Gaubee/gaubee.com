import { useState, useEffect } from 'react';
import { getAllChanges, deleteChange, type StagedChange } from '../../lib/db';
import { commitChanges } from '../../lib/github';

const statusStyles = {
  created: 'text-green-500',
  updated: 'text-yellow-500',
  deleted: 'text-red-500',
};

export default function StagedChanges() {
  const [changes, setChanges] = useState<StagedChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);

  async function refreshChanges() {
    setLoading(true);
    const allChanges = await getAllChanges();
    setChanges(allChanges);
    setLoading(false);
  }

  useEffect(() => {
    refreshChanges();
  }, []);

  // This is a temporary way to allow parent components to trigger a refresh.
  // A more robust solution might use a state management library or context.
  useEffect(() => {
    window.addEventListener('refresh-staged-changes', refreshChanges);
    return () => {
      window.removeEventListener('refresh-staged-changes', refreshChanges);
    };
  }, []);

  if (loading) {
    return <div>Loading staged changes...</div>;
  }

  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      alert('Please enter a commit message.');
      return;
    }
    if (changes.length === 0) {
      alert('There are no changes to commit.');
      return;
    }

    setIsCommitting(true);
    try {
      await commitChanges(commitMessage, changes);

      // If commit is successful, clear the staged changes from IndexedDB
      const deletionPromises = changes.map(change => deleteChange(change.path));
      await Promise.all(deletionPromises);

      alert('Commit successful!');
      setCommitMessage('');
      refreshChanges(); // Refresh the list (will be empty)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Commit failed:', error);
      alert(`Commit failed: ${message}. See console for details.`);
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <div className="p-4 border rounded-lg mt-4">
      <h2 className="text-lg font-semibold mb-2">Staged Changes</h2>
      {loading && <p>Loading staged changes...</p>}
      {!loading && changes.length === 0 && (
        <p className="text-gray-500">No changes have been staged.</p>
      )}
      {!loading && changes.length > 0 && (
        <>
          <ul>
            {changes.map((change) => (
              <li key={change.path} className="flex justify-between items-center py-1">
                <span>{change.path}</span>
                <span className={`font-bold ${statusStyles[change.status]}`}>
                  {change.status.toUpperCase()}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 pt-4 border-t">
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Enter your commit message..."
              className="w-full p-2 border rounded"
              rows={3}
              disabled={isCommitting}
            />
            <button
              onClick={handleCommit}
              disabled={isCommitting || changes.length === 0}
              className="mt-2 w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
            >
              {isCommitting ? 'Committing...' : 'Commit Changes'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
