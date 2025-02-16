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
          <li key={index}>
            <a href={`/article/${article.metadata.title}`}>
              {article.metadata.title}
            </a>
          </li>
        ))}
      </ol>
    </>
  );
}
