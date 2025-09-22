import React, { useState, useEffect, useRef } from 'react';

// This type is used by Astro content collections
interface MarkdownHeading {
  depth: number;
  slug: string;
  text: string;
}

export interface Props {
  headings: MarkdownHeading[];
}

const TableOfContents: React.FC<Props> = ({ headings }) => {
  const [activeId, setActiveId] = useState<string>('');
  const observerRef = useRef<IntersectionObserver | null>(null);
  const headingElementsRef = useRef<Map<string, IntersectionObserverEntry>>(new Map());

  // Filter for h2 and h3 headings
  const filteredHeadings = headings.filter(h => h.depth === 2 || h.depth === 3);

  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    const callback = (entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        headingElementsRef.current.set(entry.target.id, entry);
      }

      const visibleHeadings: IntersectionObserverEntry[] = [];
      headingElementsRef.current.forEach(entry => {
        if (entry.isIntersecting) {
          visibleHeadings.push(entry);
        }
      });

      if (visibleHeadings.length > 0) {
        visibleHeadings.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        setActiveId(visibleHeadings[0].target.id);
      }
    };

    observerRef.current = new IntersectionObserver(callback, {
      rootMargin: '0px 0px -60% 0px',
    });

    const elements = filteredHeadings.map(h => document.getElementById(h.slug)).filter(Boolean);
    elements.forEach(el => observerRef.current?.observe(el!));

    return () => observerRef.current?.disconnect();
  }, [filteredHeadings]);

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, slug: string) => {
    e.preventDefault();
    const element = document.getElementById(slug);
    element?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
    window.history.pushState(null, '', `#${slug}`);
  };

  if (filteredHeadings.length === 0) {
    return null;
  }

  return (
    <nav className="p-4 bg-white dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700/50">
      <h3 className="m-0 mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">目录</h3>
      <ul className="list-none p-0 m-0 space-y-1">
        {filteredHeadings.map(heading => {
          const isActive = activeId === heading.slug;
          return (
            <li key={heading.slug}>
              <a
                href={`#${heading.slug}`}
                onClick={(e) => handleLinkClick(e, heading.slug)}
                className={`block no-underline py-1.5 text-sm transition-colors duration-200 ease-in-out
                  ${heading.depth === 3 ? 'pl-6' : 'pl-2'}
                  ${isActive
                    ? 'font-semibold text-sky-500'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                  }`
                }
              >
                {heading.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default TableOfContents;
