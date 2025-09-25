import { Github } from "lucide-react";

const Footer = () => {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-700 mt-12 pt-8 pb-12">
      <div className="flex items-center justify-center space-x-6 text-sm text-zinc-600 dark:text-zinc-400">
        <a
          href="https://github.com/gaubee/gaubee.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center space-x-2 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <Github size={16} />
          <span>Source Code</span>
        </a>
        <a
          href="https://beian.miit.gov.cn/#/Integrated/recordQuery"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          闽ICP备17026139号-1
        </a>
      </div>
    </footer>
  );
};

export default Footer;
