import React, { useState, useEffect, useMemo, Fragment } from "react";
import type { SearchResult as MiniSearchResult } from "minisearch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// Define a more specific type for our search results, including the match data
interface SearchResult extends MiniSearchResult {
  match: Record<string, string[]>;
  title: string;
  slug: string;
  description?: string;
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
        terms.some(
          (term) => part.toLowerCase() === term.toLowerCase(),
        ) ? (
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

  useEffect(() => {
    const handleShowResults = (event: CustomEvent) => {
      setResults(event.detail.results);
      setQuery(event.detail.query);
      setIsOpen(true);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsOpen((open) => !open);
      }
    };

    document.addEventListener(
      "show-search-results",
      handleShowResults as EventListener,
    );
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener(
        "show-search-results",
        handleShowResults as EventListener,
      );
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
      <DialogContent className="sm:max-w-[650px] bg-background/80 backdrop-blur-sm">
        <DialogHeader>
          <DialogTitle>搜索结果: "{query}"</DialogTitle>
          <DialogDescription>
            {results.length > 0
              ? `找到了 ${results.length} 个结果。`
              : `没有找到与 "${query}" 相关的内容。`}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-4 -mr-4">
          {results.length > 0 && (
            <ul className="list-none p-0">
              {results.map((result) => (
                <li key={result.id} className="mb-2 last:mb-0">
                  <a
                    href={`/${result.slug}.html`}
                    className="block p-4 rounded-lg transition-colors hover:bg-muted/50"
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
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SearchModal;
