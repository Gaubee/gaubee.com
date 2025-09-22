import React from "react";

// Define a simplified type for the event prop to be passed from Astro
interface EventForNav {
  slug: string;
  data: {
    title?: string;
  };
}

interface Props {
  prevEvent?: EventForNav | null;
  nextEvent?: EventForNav | null;
}

const PrevNextEvent: React.FC<Props> = ({ prevEvent, nextEvent }) => {
  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 bg-white dark:bg-zinc-800/50 mt-12">
      <h3 className="mt-0 text-lg border-b border-zinc-200 dark:border-zinc-700 pb-2 mb-4 font-semibold">
        导航
      </h3>
      <ul className="list-none p-0 m-0 flex flex-col gap-4">
        {prevEvent ? (
          <li>
            <a
              href={`/events/${prevEvent.slug}`}
              className="no-underline text-zinc-800 dark:text-zinc-200 block p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700/50"
            >
              <strong className="block font-medium mb-1 text-zinc-600 dark:text-zinc-400">
                上一篇:
              </strong>
              <span className="text-sm">
                {prevEvent.data.title || prevEvent.slug}
              </span>
            </a>
          </li>
        ) : (
          <li className="p-2 text-sm text-zinc-500 dark:text-zinc-400">
            <span>这是第一篇</span>
          </li>
        )}
        {nextEvent ? (
          <li>
            <a
              href={`/events/${nextEvent.slug}`}
              className="no-underline text-zinc-800 dark:text-zinc-200 block p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700/50"
            >
              <strong className="block font-medium mb-1 text-zinc-600 dark:text-zinc-400">
                下一篇:
              </strong>
              <span className="text-sm">
                {nextEvent.data.title || nextEvent.slug}
              </span>
            </a>
          </li>
        ) : (
          <li className="p-2 text-sm text-zinc-500 dark:text-zinc-400">
            <span>这是最后一篇</span>
          </li>
        )}
      </ul>
    </div>
  );
};

export default PrevNextEvent;
