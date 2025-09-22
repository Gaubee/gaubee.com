import React, { useState, useEffect } from "react";
import { ArrowUp } from "lucide-react";

const BackToTop: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);

  const toggleVisibility = () => {
    if (window.scrollY > 200) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  };

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  useEffect(() => {
    window.addEventListener("scroll", toggleVisibility);

    return () => {
      window.removeEventListener("scroll", toggleVisibility);
    };
  }, []);

  return (
    <button
      type="button"
      aria-label="Back to top"
      onClick={scrollToTop}
      className={`fixed right-8 bottom-8 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900/20 text-white shadow-lg backdrop-blur-sm backdrop-saturate-200 transition-opacity duration-300 hover:bg-zinc-700 dark:bg-zinc-100/20 dark:text-zinc-900 dark:hover:bg-zinc-300 ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      <ArrowUp size={24} />
    </button>
  );
};

export default BackToTop;
