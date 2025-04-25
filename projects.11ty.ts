import page from './_includes/page.11ty.js';
import {EleventyData} from './_includes/types.js';
import {readProjectsJson} from './database/projects.controller.js';



export default async function (data: EleventyData) {
  const html = String.raw;
  data.title ??= `Gaubee Projects`;
  const allProjects = (await readProjectsJson())
    .map((project) => {
      return {
        ...project,
        from: new Date(project.firstCommitTime),
        to: new Date(project.lastCommitTime),
      };
    })
    .sort((a, b) => {
      return b.to.getTime() - a.to.getTime();
    });
  return page({
    ...data,
    content: html` <ol>
      ${allProjects
        .map((project) => {
          return html`<li>
            <h3>
              <a href="${project.url}" target="_blank"> ${project.fullName} </a>
            </h3>
            <section>
              <p>${project.description}</p>
              <p>
                <span>${project.from.toLocaleDateString()} - ${project.to.toLocaleDateString()}</span>
              </p>
            </section>
          </li>`;
        })
        .join('\n')}
    </ol>`,
  });
}
