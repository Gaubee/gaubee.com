// https://vike.dev/onRenderClient
export {onRenderClient};

import ReactDOM from 'react-dom/client';
import type {OnRenderClientAsync} from 'vike/types';
import {Layout} from './Layout.tsx';
import {getPageTitle} from './getPageTitle.ts';

let root: ReactDOM.Root;
const onRenderClient: OnRenderClientAsync = async (pageContext): ReturnType<OnRenderClientAsync> => {
  const {Page} = pageContext;

  // This onRenderClient() hook only supports SSR, see https://vike.dev/render-modes for how to modify onRenderClient()
  // to support SPA
  if (!Page) throw new Error('My onRenderClient() hook expects pageContext.Page to be defined');

  const container = document.getElementById('root');
  if (!container) throw new Error('DOM element #root not found');

  const page = (
    <Layout pageContext={pageContext}>
      <Page />
    </Layout>
  );
  if (pageContext.isHydration) {
    root = ReactDOM.hydrateRoot(container, page);
  } else {
    if (!root) {
      root = ReactDOM.createRoot(container);
    }
    root.render(page);
  }
  document.title = getPageTitle(pageContext);
};
