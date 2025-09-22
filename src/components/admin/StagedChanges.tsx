import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { GitCommit, Rocket, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import ReactDiffViewer from "react-diff-viewer";
import { deleteChange, getAllChanges, type StagedChange } from "../../lib/db";
import { commitChanges } from "../../lib/github";

const statusStyles: {
  [key in StagedChange["status"]]: "default" | "destructive" | "outline";
} = {
  created: "default",
  updated: "outline",
  deleted: "destructive",
};

const DiffDialog = ({ change }: { change: StagedChange }) => {
  const handleUnstage = async () => {
    if (
      window.confirm(
        `Are you sure you want to unstage changes for "${change.path}"?`,
      )
    ) {
      await deleteChange(change.path);
      window.dispatchEvent(new CustomEvent("refresh-staged-changes"));
      // The dialog will close automatically as the change disappears from the list
    }
  };

  return (
    <DialogContent className="max-w-4xl">
      <DialogHeader>
        <DialogTitle>
          Diff for {change.path.replace("src/content/", "")}
        </DialogTitle>
        <DialogDescription>
          Showing changes for a {change.status} file.
        </DialogDescription>
      </DialogHeader>
      <div className="max-h-[60vh] overflow-y-auto">
        <ReactDiffViewer
          oldValue={change.originalContent || ""}
          newValue={change.content || ""}
          splitView={true}
          useDarkTheme={document.documentElement.classList.contains("dark")}
        />
      </div>
      <DialogFooter>
        <Button variant="destructive" onClick={handleUnstage}>
          <Trash2 className="mr-2 h-4 w-4" /> Unstage
        </Button>
      </DialogFooter>
    </DialogContent>
  );
};

export default function StagedChanges() {
  const [changes, setChanges] = useState<StagedChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [commitMessage, setCommitMessage] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);

  async function refreshChanges() {
    setLoading(true);
    const allChanges = await getAllChanges();
    setChanges(allChanges);
    setLoading(false);
  }

  useEffect(() => {
    refreshChanges();
    window.addEventListener("refresh-staged-changes", refreshChanges);
    return () => {
      window.removeEventListener("refresh-staged-changes", refreshChanges);
    };
  }, []);

  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      alert("Please enter a commit message.");
      return;
    }
    if (changes.length === 0) {
      alert("There are no changes to commit.");
      return;
    }

    setIsCommitting(true);
    try {
      await commitChanges(commitMessage, changes);

      const deletionPromises = changes.map((change) =>
        deleteChange(change.path),
      );
      await Promise.all(deletionPromises);

      alert("Commit successful!");
      setCommitMessage("");
      refreshChanges();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Commit failed:", error);
      alert(`Commit failed: ${message}. See console for details.`);
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <GitCommit className="mr-2" /> Staged Changes
        </CardTitle>
        <CardDescription>
          Review and commit your pending changes. Click a file to see the diff.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading && <p className="text-center p-4">Loading...</p>}
        {!loading && changes.length === 0 && (
          <p className="text-muted-foreground text-center p-4">
            No changes have been staged.
          </p>
        )}
        {!loading && changes.length > 0 && (
          <ul className="space-y-2">
            {changes.map((change) => (
              <Dialog key={change.path}>
                <DialogTrigger asChild>
                  <li className="flex justify-between items-center py-2 px-3 bg-accent rounded-md cursor-pointer hover:ring-2 ring-primary">
                    <span className="font-mono text-sm truncate">
                      {change.path.replace("src/content/", "")}
                    </span>
                    <Badge variant={statusStyles[change.status]}>
                      {change.status}
                    </Badge>
                  </li>
                </DialogTrigger>
                <DiffDialog change={change} />
              </Dialog>
            ))}
          </ul>
        )}
      </CardContent>
      {changes.length > 0 && (
        <CardFooter className="flex flex-col items-start gap-4">
          <Textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Enter your commit message..."
            rows={3}
            disabled={isCommitting}
          />
          <Button
            onClick={handleCommit}
            disabled={
              isCommitting || changes.length === 0 || !commitMessage.trim()
            }
            className="w-full"
          >
            {isCommitting ? (
              "Committing..."
            ) : (
              <>
                <Rocket className="mr-2 h-4 w-4" /> Commit Changes
              </>
            )}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
