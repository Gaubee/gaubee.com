import React from 'react';
import { ArrowLeft, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  title?: string;
  className?: string;
  onMenuClick?: () => void;
  showBackButton?: boolean;
}

const MobileTopbar: React.FC<Props> = ({
  title = '',
  className,
  onMenuClick,
  showBackButton = true,
}) => {
  const handleBackClick = () => {
    window.history.back();
  };

  return (
    <div
      id="mobile-topbar"
      className={cn(
        "sticky top-0 z-50 flex h-14 items-center justify-between border-b border-zinc-200 bg-white/80 px-4 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/80 lg:hidden",
        className
      )}
    >
      {showBackButton ? (
        <button type="button" onClick={handleBackClick} aria-label="Go back">
          <ArrowLeft size={24} />
        </button>
      ) : (
        <div className="w-6" /> // Placeholder for alignment
      )}

      <div className="absolute left-1/2 -translate-x-1/2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {title}
      </div>

      {onMenuClick ? (
        <button type="button" onClick={onMenuClick} aria-label="Open menu">
          <Menu size={24} />
        </button>
      ) : (
        <div className="w-6" /> // Placeholder for alignment
      )}
    </div>
  );
};

export default MobileTopbar;
