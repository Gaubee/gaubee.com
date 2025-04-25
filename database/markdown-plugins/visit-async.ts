import type {PromiseMaybe} from '@gaubee/util';
import type {Node, Parent} from 'unist';

type Test<T, O extends T> = (node: T, index?: number, parent?: Parent | undefined) => boolean | O | undefined | void | null;
type AsyncVisitor<T, O = T> = (node: T, index?: number, parent?: Parent | undefined) => PromiseMaybe<void | O | O[]>;

export async function visitAsync<T extends Node, N extends T>(tree: T, test: Test<T, N>, visitor: AsyncVisitor<N, T>, reverse?: boolean): Promise<void> {
  if (!tree) return;

  const queue: Array<{node: T; index?: number; parent?: Parent}> = [{node: tree}];
  let index = reverse ? queue.length - 1 : 0;

  while (reverse ? index >= 0 : index < queue.length) {
    const item = queue[index];
    const node = item.node;
    const parent = item.parent;
    const nodeIndex = item.index;

    if (test(node, nodeIndex, parent)) {
      const newNode = await visitor(node as N, nodeIndex, parent);
      if (newNode && parent && newNode !== node) {
        /// 做一个节点替换
        // item.node = newNode;
        parent.children.splice(parent.children.indexOf(node), 1, ...(Array.isArray(newNode) ? newNode : [newNode]));
      }
    }

    if ('children' in node && Array.isArray(node.children)) {
      const children = node.children;
      for (let i = 0; i < children.length; i++) {
        queue.push({
          node: children[i],
          index: i,
          parent: node as Parent,
        });
      }
    }

    index = reverse ? index - 1 : index + 1;
  }
}
