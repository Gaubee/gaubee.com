import React from 'react';
import { Home, Rss } from 'lucide-react';

const links = [
  { href: '/', label: '主页', icon: Home },
  { href: '/events', label: '时事快讯', icon: Rss },
  // Add more links as needed
];

const LeftSidebar: React.FC = () => {
  return (
    <aside className="w-64 p-4 pr-8">
      <nav className="flex flex-col space-y-2">
        {links.map(({ href, label, icon: Icon }) => (
          <a
            key={href}
            href={href}
            className="flex items-center gap-4 py-3 px-6 text-lg font-semibold no-underline text-zinc-900 dark:text-zinc-100 rounded-full transition-colors duration-200 ease-in-out hover:bg-gray-200 dark:hover:bg-zinc-800"
          >
            <Icon size={24} />
            <span>{label}</span>
          </a>
        ))}
      </nav>
    </aside>
  );
};

export default LeftSidebar;
