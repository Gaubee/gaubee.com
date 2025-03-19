export { Page };

import { useData } from "../../renderer/useData.ts";
import type { Data } from "./+data.ts";

function Page() {
  const projects = useData<Data>();
  return (
    <ol>
      {projects.map((project) => {
        return (
          <li>
            <h3>
              <a href={project.url} target="_blank">{project.fullName}</a>
            </h3>
            <section>
              <p>{project.description}</p>
              <p>
                <span>
                  {`${project.from.toLocaleDateString()} - ${project.to.toLocaleDateString()}`}
                </span>
              </p>
            </section>
          </li>
        );
      })}
    </ol>
  );
}
