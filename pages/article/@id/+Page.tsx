export { Page };

import { useData } from "../../../renderer/useData.ts";
import type { Data } from "./+data.ts";
const css = String.raw;

function Page() {
  const data = useData<Data>();
  return (
    <>
      <style type="text/css">
        {css`
          main > p {
            text-indent: 1em;
          }
        `}
      </style>
      <h1>{data.article.metadata.title}</h1>
      <main
        dangerouslySetInnerHTML={{ __html: data.article.htmlContent }}
      ></main>
    </>
  );
}
