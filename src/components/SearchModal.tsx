import React, { useState, useEffect } from "react";
import type { SearchResult } from "minisearch";

// Simple styles for the modal, can be improved later
const modalStyles: React.CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  backgroundColor: "white",
  padding: "2rem",
  borderRadius: "8px",
  boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
  zIndex: 1000,
  width: "90%",
  maxWidth: "600px",
  maxHeight: "80vh",
  overflowY: "auto",
  color: "#333", // Ensuring text is visible
};

const overlayStyles: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0, 0, 0, 0.5)",
  zIndex: 999,
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

    const handleClose = () => setIsOpen(false);

    document.addEventListener(
      "show-search-results",
      handleShowResults as EventListener,
    );
    document.body.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        handleClose();
      }
    });

    return () => {
      document.removeEventListener(
        "show-search-results",
        handleShowResults as EventListener,
      );
    };
  }, []);

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div style={overlayStyles} onClick={() => setIsOpen(false)} />
      <div style={modalStyles}>
        <button
          onClick={() => setIsOpen(false)}
          style={{
            position: "absolute",
            top: "1rem",
            right: "1rem",
            cursor: "pointer",
          }}
        >
          &times;
        </button>
        <h2>搜索结果: "{query}"</h2>
        {results.length > 0 ? (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {results.map((result) => (
              <li
                key={result.id}
                style={{
                  marginBottom: "1rem",
                  borderBottom: "1px solid #eee",
                  paddingBottom: "1rem",
                }}
              >
                <a
                  href={`/${result.slug}.html`}
                  style={{ textDecoration: "none", color: "#007bff" }}
                >
                  <h3 style={{ margin: "0 0 0.5rem 0" }}>{result.title}</h3>
                  <p style={{ margin: 0, color: "#555" }}>
                    {result.description}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p>没有找到与 "{query}" 相关的内容。</p>
        )}
      </div>
    </>
  );
};

export default SearchModal;
