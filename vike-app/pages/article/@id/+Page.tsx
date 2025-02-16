export { Page };

import { useData } from "../../../renderer/useData";
import { Data } from "./+data";

function Page() {
  const data = useData<Data>();
  return (
    <>
      <h1>{data.article.metadata.title}</h1>
      <main
        dangerouslySetInnerHTML={{ __html: data.article.htmlContent }}
      ></main>
    </>
  );
}
