import type { Element, Root } from "hast";
import { existsSync } from "node:fs";
import path from "node:path";
import { match, P } from "ts-pattern";
import { visit } from "unist-util-visit";
import { PUBLIC_DIR } from "./dirs";

export const getLocalImgs = (tree: Root, publicDir: string = PUBLIC_DIR) => {
  const imageNodes: {
    imgSrc: string;
    imgFilepath: string;
    node: Element;
    index: number;
    parent: Root | Element;
    updateImageNode: (node?: Element) => void;
  }[] = [];

  visit(tree, "element", (node, index, parent) => {
    if (
      index != null &&
      parent != null &&
      node.tagName === "img" &&
      node.properties.src
    ) {
      const src = node.properties.src;
      // 只处理本地图片，跳过外部链接
      match(src)
        .with(
          P.string.startsWith("http://"),
          P.string.startsWith("https://"),
          () => {
            // ignore
          },
        )
        .with(P.string, (src) => {
          const imgFilepath = path.join(publicDir, src);

          if (!existsSync(imgFilepath)) {
            return;
          }
          const updateImageNode = (n: Element = node) => {
            parent.children.splice(index, 1, { ...n });
          };
          imageNodes.push({
            imgSrc: src,
            imgFilepath,
            node,
            index,
            parent,
            updateImageNode,
          });
        })
        .otherwise(() => {
          //ignore
        });
    }
  });
  return imageNodes;
};
