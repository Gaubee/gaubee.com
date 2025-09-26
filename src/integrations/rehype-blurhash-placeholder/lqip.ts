document.addEventListener("DOMContentLoaded", () => {
  // 直接选择待加载的图片
  const images = document.querySelectorAll<HTMLImageElement>(
    "img.lqip-img[data-srcset]",
  );
  images.forEach((img) => {
    img.addEventListener(
      "load",
      () => {
        img.dataset.loaded = "true";
        img.classList.add("loaded");
      },
      { once: true },
    );
  });

  const observer = new IntersectionObserver(
    (entries, self) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target as HTMLImageElement; // 现在 target 直接就是 img 标签
          const srcset = img.dataset.srcset;

          if (srcset) {
            const imgWidth = img.clientWidth; // 直接测量图片元素的宽度
            img.sizes = `${imgWidth}px`;
            img.srcset = srcset;
          }

          self.unobserve(img);
        }
      });
    },
    { rootMargin: "200px" },
  );

  images.forEach((img) => {
    observer.observe(img);
  });
});
