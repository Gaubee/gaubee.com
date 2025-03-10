export { Page };

import { useData } from "../../../renderer/useData.ts";
import { Data } from "./+data.ts";
const css = String.raw;

function Page() {
  const data = useData<Data>();
  return (
    <>
      <style type="text/css">
        {css`
          p {
            text-indent: "2em";
            line-height: 3;
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
