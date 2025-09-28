import PhotoSwipeLightbox from "photoswipe/lightbox";
import "photoswipe/style.css";

// 这个选择器是 PhotoSwipe 的画廊的根元素。
// 'main' 是一个比较通用的选择，如果您的文章内容在更特定的元素里，
// 例如 <article class="prose">，那么使用 '.prose' 会更精确。

const lightbox = new PhotoSwipeLightbox({
  // 将画廊绑定到我们指定的根元素
  gallery: ".prose",

  // 告诉 PhotoSwipe，画廊里的每个子项都是一个带有 data-pswp-width 属性的 <a> 标签
  children: "a[data-pswp-width]",

  // 这是 PhotoSwipe 5+ 推荐的动态导入模块的方式，有助于代码分割
  pswpModule: () => import("photoswipe"),
});

// 初始化灯箱
lightbox.init();
