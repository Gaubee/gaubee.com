export { Page };

import { useData } from "../../renderer/useData";
import { Data } from "./+data";
import { Counter } from "./Counter";

function Page() {
  const data = useData<Data>();
  return (
    <>
      <h1>文章</h1>
      <ol>
        {data.articles.map((article, index) => (
          <li key={index}>{article.data.title}</li>
        ))}
      </ol>
    </>
  );
}
