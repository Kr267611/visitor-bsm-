import { createContext, ReactNode, useContext } from 'react';
import { useLiveSite } from './useLiveSite';

type LiveSite = ReturnType<typeof useLiveSite>;

const LiveSiteContext = createContext<LiveSite | null>(null);

/** One live connection for the whole side menu, not one per page. */
export function LiveSiteProvider({ children }: { children: ReactNode }) {
  const live = useLiveSite();
  return <LiveSiteContext.Provider value={live}>{children}</LiveSiteContext.Provider>;
}

/** null for users outside the desk. */
export const useLiveOptional = () => useContext(LiveSiteContext);

export function useLive(): LiveSite {
  const live = useContext(LiveSiteContext);
  if (!live) throw new Error('LiveSiteProvider missing');
  return live;
}
