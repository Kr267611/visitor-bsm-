import { createContext, ReactNode, useContext } from 'react';
import { useLiveSite } from './useLiveSite';

type LiveSite = ReturnType<typeof useLiveSite>;

const LiveSiteContext = createContext<LiveSite | null>(null);

/** Poore side menu ke liye ek hi live connection, har page par naya nahi. */
export function LiveSiteProvider({ children }: { children: ReactNode }) {
  const live = useLiveSite();
  return <LiveSiteContext.Provider value={live}>{children}</LiveSiteContext.Provider>;
}

/** Desk ke bahar ke users ke liye null. */
export const useLiveOptional = () => useContext(LiveSiteContext);

export function useLive(): LiveSite {
  const live = useContext(LiveSiteContext);
  if (!live) throw new Error('LiveSiteProvider missing');
  return live;
}
