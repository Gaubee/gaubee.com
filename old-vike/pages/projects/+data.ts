// https://vike.dev/data
export {data};
export type Data = Awaited<ReturnType<typeof data>>;

// The node-fetch package (which only works on the server-side) can be used since
// this file always runs on the server-side, see https://vike.dev/data#server-side
import type {PageContextServer} from 'vike/types';

import {readProjectsJson} from '../../database/projects.controller.ts';

const data = async (pageContext: PageContextServer) => {
  const projects = await readProjectsJson();

  return projects
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
};
