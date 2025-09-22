import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { KeyRound } from 'lucide-react';

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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
            <KeyRound className="mr-2" /> GitHub Access Token
        </CardTitle>
        <CardDescription>
            Your GitHub Personal Access Token is stored securely in your browser's local storage.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Enter your GitHub PAT"
        />
        <Button onClick={handleSave} className="w-full">
            Save Token
        </Button>
      </CardContent>
    </Card>
  );
}
