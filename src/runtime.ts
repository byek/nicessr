import { Fiber, FiberFn } from './jsx/vdom';
import { flattenFragments } from './jsx/jsx-runtime';

export function useAutoReload() {
  const updateHandler = (event) =>
    JSON.parse(event.data).type === 'update' && document.location.reload();
  const eventSource = new EventSource(
    '/.nicessr/auto-refresh?page=' +
      encodeURIComponent(document.location.pathname),
  );

  eventSource.addEventListener('message', updateHandler, false);
  eventSource.addEventListener('error', () => {
    eventSource.removeEventListener('message', updateHandler);
    eventSource.close();
    setTimeout(useAutoReload, 500);
  });
}

export function hydrate(rendererFn: FiberFn) {
  if (typeof document === 'undefined') return;
  const renderedTree = flattenFragments(
    rendererFn(JSON.parse((window as any).__nicessr_initial_props__)) as Fiber,
  );
  const hydratedRoot = document.getElementById('__nicessr__root__');

  if (Array.isArray(renderedTree))
    renderedTree.forEach((fiber, i) =>
      attachFunctionalProps(hydratedRoot.childNodes[i], fiber),
    );
  else attachFunctionalProps(hydratedRoot.childNodes[0], renderedTree);
}

function attachFunctionalProps(realRoot: Node, virtualRoot: Fiber) {
  if (process.env.NODE_ENV === 'development') {
    if (
      realRoot.nodeName.toLowerCase() !== virtualRoot.elementName.toLowerCase()
    ) {
      throw Error(
        `Invariant violation: invalid tree rendered, ${realRoot.nodeName} on server, ${virtualRoot.elementName} on client`,
      );
    }
    if (virtualRoot.elementName === '#text') {
      if (realRoot.textContent !== virtualRoot.props.children[0])
        throw Error(
          `Invariant violation: invalid tree rendered, ${realRoot.textContent} on server, ${virtualRoot.props.children[0]} on client`,
        );
      return;
    }
  }

  Object.entries(virtualRoot.props as any).forEach(
    ([key, value]: [string, Function]) => {
      if (typeof value !== 'function') return;
      if (key === 'onMount') value(realRoot);
      else realRoot.addEventListener(key, value as () => void);
    },
  );

  const childNodes = virtualRoot.props.children as Fiber[];
  childNodes.forEach((fiber, i) =>
    attachFunctionalProps(realRoot.childNodes[i], fiber),
  );
}

export function clientEntrypoint() {
  if (typeof document === 'undefined') return;
  const onLoad = () => {
    useAutoReload();
    hydrate((window as any).default);
  };

  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  )
    setTimeout(onLoad, 0);
  else document.addEventListener('DOMContentLoaded', onLoad);
}
