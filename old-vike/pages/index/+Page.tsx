export {Page};

import {useData} from '../../renderer/useData.ts';
import type {Data} from './+data.ts';

function Page() {
  const data = useData<Data>();
  return (
    <>
      {data.map(({year, items}) => {
        return (
          <>
            <h2>{year}年</h2>
            <section>
              <ol>
                {items.map((item) => {
                  if (item.type === 'article') {
                    return (
                      <li>
                        <div className="article">
                          <h3 className="title">
                            <a href={`/article/${encodeURIComponent(item.data.id)}/`}>{item.data.title}</a>
                          </h3>
                          <article
                            dangerouslySetInnerHTML={{
                              __html: item.data.previewContent,
                            }}
                          ></article>
                        </div>
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
