export { Page };

import { useData } from "../../renderer/useData";
import { Data } from "./+data";
import { Counter } from "./Counter";

function Page() {
  const data = useData<Data>();
  return (
    <>
      {data.map(({ year, items }) => {
        return (
          <>
            <h2>{year}年</h2>
            <section>
              <ol>
                {items.map((item) => {
                  if (item.type === "article") {
                    return (
                      <li>
                        <a
                          href={`/article/${encodeURIComponent(
                            item.data.title
                          )}`}
                        >
                          {item.data.title}
                        </a>
                      </li>
                    );
                  } else {
                    return (
                      <li>
                        <div
                          className="event"
                          dangerouslySetInnerHTML={{
                            __html: item.data.htmlContent,
                          }}
                        ></div>
                      </li>
                    );
                  }
                })}
              </ol>
            </section>
          </>
        );
      })}
    </>
  );
}
