import { MarkdownItAsync } from "markdown-it-async";

export const markdownItLinkTarget = (md: MarkdownItAsync) => {
  // Remember the old renderer if overridden, or proxy to the default renderer.
  const defaultRender =
    md.renderer.rules.link_open ||
    function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };

  md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
    // Add a new `target` attribute, or replace the value of the existing one.
    const href = tokens[idx].attrGet("href");
    if (href?.startsWith("https://")) {
      // 外部链接
      tokens[idx].attrSet("target", "_blank");
    }

    // Pass the token to the default renderer.
    return defaultRender(tokens, idx, options, env, self);
  };
};
