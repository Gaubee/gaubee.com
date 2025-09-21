import { useState, useEffect } from 'react';

const GITHUB_TOKEN_KEY = 'github_token';

export default function TokenManager() {
  const [token, setToken] = useState('');

  useEffect(() => {
    const storedToken = localStorage.getItem(GITHUB_TOKEN_KEY);
    if (storedToken) {
      setToken(storedToken);
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem(GITHUB_TOKEN_KEY, token);
    alert('Token saved!');
  };

  return (
    <div className="p-4 border rounded-lg">
      <h2 className="text-lg font-semibold mb-2">GitHub Access Token</h2>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        className="w-full p-2 border rounded"
        placeholder="Enter your GitHub PAT"
      />
      <button
        onClick={handleSave}
        className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Save Token
      </button>
    </div>
  );
}
