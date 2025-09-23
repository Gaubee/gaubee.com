import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { validateToken } from "@/lib/github";
import { KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

const GITHUB_TOKEN_KEY = "github_token";

interface TokenManagerProps {}
export default function TokenManager({}: TokenManagerProps) {
  const [token, setToken] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = localStorage.getItem(GITHUB_TOKEN_KEY);
    if (storedToken) {
      setToken(storedToken);
    }
  }, []);

  const handleSaveAndValidate = async () => {
    setIsLoading(true);
    setError(null);
    const isValid = await validateToken(token);
    setIsLoading(false);

    if (isValid) {
      localStorage.setItem(GITHUB_TOKEN_KEY, token);
      console.log("QAQ set token", token);
      window.location.href = "/admin"; // Redirect to the main admin page
    } else {
      console.error("Invalid token. Please check your token and try again.");
      setError("Invalid token. Please check your token and try again.");
      localStorage.removeItem(GITHUB_TOKEN_KEY); // Clear invalid token
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <KeyRound className="mr-2" /> Enter Your Access Token
        </CardTitle>
        <CardDescription>
          To use the admin panel, please provide a GitHub Personal Access Token
          with repository access.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          type="password"
          value={token}
          onInput={(e) => setToken((e.target as any).value)}
          onChange={(e) => setToken((e.target as any).value)}
          placeholder="ghp_..."
          onKeyDown={(e) => e.key === "Enter" && handleSaveAndValidate()}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          onClick={handleSaveAndValidate}
          disabled={isLoading || token.length === 0}
          aria-disabled={isLoading || token.length === 0}
          className="w-full"
        >
          {isLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            "Save and Continue"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
