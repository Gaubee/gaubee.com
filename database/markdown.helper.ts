import { createProcessor as createMdxProcessor, run } from "@mdx-js/mdx";
import { pathToFileURL } from "node:url";
import React from "react";
import * as ReactDOMServer from "react-dom/server";
import { markdownHightlightPlugins } from "./markdown-plugins/markdown-highlight-plugin.ts";

// // Initialize MarkdownIt instance with markdown-it-async
// export const md = MarkdownItAsync({ html: true });
// md.use(markdownItHightlight);
// md.use(markdownItMermaid);
// md.use(markdownItLinkTarget);

// remark plugins
// rehype plugins
import path from "node:path";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParser from "remark-parse";
import remarkRehype from "remark-rehype";
import { register } from "tsx/esm/api";
import { type Pluggable, type Processor, unified } from "unified";
import { isDev } from "../env.ts";
import { markdownMermaidPlugins } from "./markdown-plugins/markdown-mermaid-plugin.ts";
register();

const setupDebug = (md: Processor) => {
  md.use(() => {
    return (tree) => {
      console.log("tree", tree);
    };
  });
};
export type MdProcessor = Processor<import("unist").Node, any, any, any, any>;
export type Plugins = {
  remarkPlugins?: RemarkPluggable[];
  rehypePlugins?: RehypePluggable[];
};
/**参考 {@link Pluggable} */
type SafePluggable<
  Params extends unknown[],
  Input extends import("unist").Node,
  Output extends import("unist").Node = Input
> = SafePlugin<Params, Input, Output> | SafePluginTuple<Params, Input, Output>;
type SafePlugin<
  Params extends unknown[],
  Input extends import("unist").Node,
  Output extends import("unist").Node
> = (
  this: Processor,
  ...parameters: Params
) => void | import("unified").Transformer<Input, Output>;
type SafePluginTuple<
  Params extends unknown[],
  Input extends import("unist").Node,
  Output extends import("unist").Node
> = [SafePlugin<Params, Input, Output>, ...Params];
export type RemarkPluggable = SafePluggable<any[], import("mdast").Nodes>;
export type RehypePluggable = SafePluggable<any[], import("hast").Nodes>;

const remarkPlugins = [
  markdownMermaidPlugins.remarkPlugins,
  markdownHightlightPlugins.remarkPlugins,
]
  .flat()
  .filter((it) => it !== undefined);
const rehypePlugins = [
  markdownMermaidPlugins.rehypePlugins,
  markdownHightlightPlugins.rehypePlugins,
]
  .flat()
  .filter((it) => it !== undefined);

const mdx = createMdxProcessor({
  outputFormat: "function-body",
  development: isDev,
  jsx: false,
  jsxRuntime: "automatic",
  jsxImportSource: "react",
  format: "mdx",
  remarkPlugins: remarkPlugins,
  rehypePlugins: rehypePlugins,
});

const md = unified()
  .use(remarkParser)
  .use(remarkGfm)
  .use(remarkPlugins)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypePlugins)
  .use(rehypeStringify, { allowDangerousHtml: true });

export const markdownToHtml = async (
  content: string,
  opts: { filepath: string }
) => {
  console.log("parsing", opts.filepath);
  const vfile: import("vfile").Compatible = {
    value: content,
    basename: path.basename(opts.filepath),
    dirname: path.dirname(opts.filepath),
  };
  if (opts.filepath.endsWith(".mdx")) {
    const mdxContent = (await mdx.process(vfile)).toString();
    // console.log("mdxContent", mdxContent);

    const runtime = (await import(
      isDev ? "react/jsx-dev-runtime" : "react/jsx-runtime"
    )) as
      | typeof import("react/jsx-dev-runtime")
      | typeof import("react/jsx-runtime");

    const { default: MDXContent } = await run(mdxContent, {
      ...runtime,
      baseUrl: pathToFileURL(opts.filepath),
    });

    return ReactDOMServer.renderToString(React.createElement(MDXContent));
  }
  const res = await md.process(vfile);
  return res.toString();
};
