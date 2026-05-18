import { createContext, useContext } from 'react';

// Carries router-state values from KanbanBoard down to nested components so
// they can auto-expand / auto-open when navigated to from the Dashboard.
// All four ids may be null when the user landed here normally (no deep link).
const DeepLinkContext = createContext({
  openWorkspaceId:   null,
  openCategoryId:    null,
  openSubcategoryId: null,
  openTaskId:        null,
});

export function useDeepLink() {
  return useContext(DeepLinkContext);
}

export default DeepLinkContext;
