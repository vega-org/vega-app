import {create} from 'zustand';
import {isTabRouteOnSubpage, type RouteWithNestedState} from '../../components/navigation/FloatingTabBarInsetContext';

type State = {index?: number; type?: string; routes: readonly (RouteWithNestedState & {key?: string; name?: string; state?: State})[]};

// The container publishes complete state after nested pushes and pops. Cached
// tab descriptors/layout callbacks need not rerender for those child changes.
export const useTabVisibilityStore = create<{subpages: Record<string, boolean>}>(() => ({subpages: {}}));

export function syncTabVisibility(state: State | undefined) {
  const subpages: Record<string, boolean> = {};
  const visit = (current: State | undefined) => {
    if (!current) return;
    if (current.type === 'tab') {
      for (const route of current.routes) {
        if (route.key) subpages[route.key] = isTabRouteOnSubpage(route);
      }
      return;
    }
    for (const route of current.routes) visit(route.state);
  };
  visit(state);
  const previous = useTabVisibilityStore.getState().subpages;
  if (JSON.stringify(previous) !== JSON.stringify(subpages)) useTabVisibilityStore.setState({subpages});
}
