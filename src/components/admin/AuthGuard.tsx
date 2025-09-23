import { useEffect, useState } from "react";

const GITHUB_TOKEN_KEY = "github_token";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(GITHUB_TOKEN_KEY);
    console.log("QAQ get token", token);
    if (!token) {
      window.location.href = "/admin/login";
    } else {
      setIsAuthorized(true);
    }
  }, []);

  if (!isAuthorized) {
    // Render nothing, or a loading spinner, while we check for the token.
    // The redirect will happen before anything meaningful is shown.
    return null;
  }

  return children;
}
