import React from "react";

interface Props {
  href: string;
  title: string;
  date: string;
  type: "articles" | "events";
}

const Card: React.FC<Props> = ({ href, title, date, type }) => {
  const typeClasses = {
    articles: "text-purple-800 dark:text-purple-300",
    events: "text-green-700 dark:text-green-400",
  };

  return (
    <li className="list-none flex border-b border-gray-200 dark:border-gray-700 transition-colors duration-200 ease-in-out hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <a
        href={href}
        className="w-full no-underline leading-normal p-4 sm:p-6 text-zinc-900 dark:text-zinc-50"
      >
        <h2 className="m-0 text-lg flex justify-between font-semibold">
          {title}
        </h2>
        <div className="flex justify-between items-center text-sm text-gray-600 dark:text-gray-400 mt-2">
          <p className="mt-1 mb-0">
            <time dateTime={date}>
              {new Date(date).toLocaleDateString("en-us", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </time>
          </p>
          <p className={`font-bold capitalize text-xs ${typeClasses[type]}`}>
            {type}
          </p>
        </div>
      </a>
    </li>
  );
};

export default Card;
