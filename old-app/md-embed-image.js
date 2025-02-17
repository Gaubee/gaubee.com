// Copyright 2021 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the “License”);
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// <https://apache.org/licenses/LICENSE-2.0>.
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an “AS IS” BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

"use strict";

const imageSize = require("image-size");
const { existsSync, readFileSync } = require("fs");
const assert = require("assert");

module.exports = (md) => {
  //   md.block.ruler.before("paragraph", "figure", (state) => {
  //     for (let i = 0; i < state.tokens.length; i++) {
  //       let open = state.tokens[i];
  //       let inline = state.tokens[i + 1];
  //       let close = state.tokens[i + 2];

  //       // Find token sequence <p><img /></p>
  //       if (open.type !== "paragraph_open") continue;
  //       if (close.type !== "paragraph_close") continue;
  //       if (!/^!\[[^\]]*\]\([^)]+\)$/.test(inline.content)) continue;

  //       // Swap out the paragraphs for figures
  //       open.type = "figure_open";
  //       open.tag = "figure";

  //       close.type = "figure_close";
  //       close.tag = "figure";
  //     }
  //   });
  md.core.ruler.push("check_img_in_figure", (state) => {
    let inFigure = false;
    for (const t of state.tokens) {
      switch (t.type) {
        case "td_open":
        case "figure_open":
        case "container_figure_open":
          assert(!inFigure);
          inFigure = true;
          break;
        case "td_close":
        case "figure_close":
        case "container_figure_close":
          assert(inFigure);
          inFigure = false;
          break;
        case "inline":
          if (!inFigure) {
            const image = t.children.find((t) => t.type === "image");
            if (image) {
              debugger;
              throw new Error(
                `Image ${image.attrGet(
                  "src"
                )} is not in a separate block. Missing newlines around?`
              );
            }
          }
          break;
      }
    }
    assert(!inFigure);
  });

  // Add a post-process rule for inline items.
  md.inline.ruler2.push("embed_image", (state) => {
    for (const t of state.tokens) {
      // Skip non-image tokens.
      if (t.type !== "image") continue;
      let imgSrc = t.attrGet("src");
      // We only embed self-hosted images.
      if (imgSrc.startsWith("/img/")) {
        const { width, height } = imageSize("src" + imgSrc);
        // Lazify image and embed its sizes to avoid layout jump.
        t.attrs.push(["width", width], ["height", height], ["loading", "lazy"]);
        // Check if `file@2x.ext` exists for `file.ext`.
        const imgSrc2x = imgSrc.replace(/\.[^.]*$/, "@2x$&");
        if (existsSync("src" + imgSrc2x)) {
          // If it does, use it in `srcset` as an alternative variant.
          t.attrs.push(["srcset", `${imgSrc2x} 2x`]);
        }
      } else if (imgSrc.startsWith("/svg/")) {
        // Ignore; we’ll fix this in the embed_svg pass.
      } else {
        throw new Error(`Image ${imgSrc} is not in the \`/img/…\` directory.`);
      }
    }
  });

  // Add a post-process rule for inline SVGs. This has to be done after implicit
  // <figure>s, else we’d lose the implicit figures for the image.
  md.core.ruler.after("implicit_figures", "embed_svg", (state) => {
    for (const t of state.tokens) {
      // Skip non-inline images tokens.
      if (t.type !== "inline") continue;
      const image = t.children.find((t) => t.type === "image");
      if (!image) continue;
      const imgSrc = image.attrGet("src");
      if (imgSrc.startsWith("/svg/")) {
        const svgContent = readFileSync(`src${imgSrc}`, "utf8");
        image.type = "html_inline";
        image.tag = "";
        image.content = svgContent;
      }
    }
  });
};
