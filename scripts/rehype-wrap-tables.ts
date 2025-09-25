import type { RehypePlugins } from "astro";
import { h } from "hastscript";
import { visit } from "unist-util-visit";
import { cn } from "../src/lib/utils";

// 这是我们的自定义 Rehype 插件
export const rehypeWrapTables: RehypePlugins[number] = () => {
  return (tree) => {
    visit(tree, "element", (node, index, parent) => {
      // 如果当前节点是一个 <table> 元素...
      if (node.tagName === "table" && parent != null && index != null) {
        node.properties.className = cn(
          node.properties.className,
          "whitespace-nowrap",
        );
        node.properties.dataX = "1";
        console.log("QAQ", node);
        node.properties = { ...node.properties };
        // 创建一个 <div> 元素，并添加 class
        const wrapper = h("div", { className: "overflow-x-auto" }, [
          // 把当前的 <table> 元素放进 div 里
          {
            ...node,
            properties: { ...node.properties },
          },
        ]);

        // 用我们新创建的 wrapper 替换掉原来的 <table> 节点
        parent.children.splice(index, 1, wrapper);
      }
    });
  };
};
