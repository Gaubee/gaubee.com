import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import MiniSearch, { type SearchResult as MiniSearchResult } from "minisearch";
import React, {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MagicCard } from "./ui/magic-card";

// Define a more specific type for our search results, including the match data
interface SearchResultData {
  id: string;
  title: string;
  description?: string;
  collection: string;
}
interface SearchResult extends MiniSearchResult {
  match: Record<string, string[]>;
  title: string;
  id: string;
  description?: string;
  collection: string;
}

// A component to highlight matched terms in a text
const Highlight: React.FC<{ text: string; terms: string[] }> = ({
  text,
  terms,
}) => {
  if (!terms.length || !text) {
    return <>{text}</>;
  }

  // Create a single regex to find any of the terms
  const regex = new RegExp(
    `(${terms
      .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|")})`,
    "gi",
  );
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        terms.some((term) => part.toLowerCase() === term.toLowerCase()) ? (
          <mark key={i}>{part}</mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
};

const SearchModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [query, setQuery] = useState("");
  const miniSearch = useRef<MiniSearch<SearchResultData> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const initSearch = useCallback(async () => {
    if (miniSearch.current) return;

    try {
      const indexResponse = await fetch("/search-index.json");
      if (!indexResponse.ok) {
        console.error("Failed to fetch search index");
        return;
      }
      const searchIndexText = await indexResponse.text();
      miniSearch.current = MiniSearch.loadJSON(searchIndexText, {
        fields: ["title", "description", "tags", "content"],
        storeFields: ["title", "description", "collection", "id"],
        idField: "id",
      });
      console.log("Search index loaded and initialized.");
    } catch (e) {
      console.error("Error initializing search:", e);
    }
  }, []);

  // This useEffect handles the debounced search.
  // It runs whenever the 'query' state changes.
  useEffect(() => {
    // If the query is empty, clear the results immediately.
    if (!query) {
      setResults([]);
      return;
    }

    // Set up a timer for the debounce effect.
    const debounceTimer = setTimeout(() => {
      if (!miniSearch.current) {
        // If search isn't initialized, do nothing.
        // initSearch should have been called when the modal opened.
        return;
      }
      const searchResults = miniSearch.current.search(query, {
        prefix: true,
        fuzzy: 0.2,
      }) as SearchResult[];
      setResults(searchResults);
    }, 250); // 250ms debounce delay

    // Cleanup function: this is called when the component unmounts
    // or when the 'query' dependency changes.
    return () => clearTimeout(debounceTimer);
  }, [query]); // Dependency array ensures this runs only when query changes.

  useEffect(() => {
    if (isOpen) {
      // Focus the input when the dialog opens. A small delay is needed for the dialog animation.
      setTimeout(() => inputRef.current?.focus(), 100);
      initSearch(); // Preload index when modal opens
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsOpen((open) => !open);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const allMatchedTerms = useMemo(() => {
    if (!results.length) return [];
    const terms = new Set<string>();
    results.forEach((result) => {
      Object.values(result.match).forEach((fieldMatches) => {
        fieldMatches.forEach((term) => terms.add(term));
      });
    });
    return Array.from(terms);
  }, [results]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-start text-muted-foreground"
        >
          <Search className="w-4 h-4 mr-2" />
          搜索...
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[650px] bg-background/80 backdrop-blur-sm">
        <DialogHeader>
          <DialogTitle>搜索</DialogTitle>
          <DialogDescription>
            输入关键词搜索文章、短评等内容。
          </DialogDescription>
        </DialogHeader>
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索..."
          className="my-4"
        />
        <div className="max-h-[60vh] overflow-y-auto pr-4 -mr-4">
          {results.length > 0 && (
            <ul className="list-none p-0 space-y-2">
              {results.map((result) => (
                <MagicCard
                  key={result.id}
                  className="rounded-lg"
                  gradientColor="var(--color-text-base)"
                >
                  <a
                    href={`/${result.collection}/${result.id}/`}
                    className="block p-4"
                  >
                    <h3 className="font-semibold text-lg text-foreground mb-1">
                      <Highlight text={result.title} terms={allMatchedTerms} />
                    </h3>
                    {result.description && (
                      <p className="text-muted-foreground text-sm">
                        <Highlight
                          text={result.description}
                          terms={allMatchedTerms}
                        />
                      </p>
                    )}
                  </a>
                </MagicCard>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SearchModal;
