import React from 'react';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useRow, useStore } from '@livestore/react';
import { tables } from '../livestore/schema';
import { updateNavigationHistory } from '../livestore/mutations';

export function NavigationHistoryTracker() {
  const pathname = usePathname();
  const globalParams = useGlobalSearchParams();
  const { store } = useStore();
  const [{ navigationHistory }] = useRow(tables.app);
  const router = useRouter();

  const constructPathWithParams = React.useCallback(
    (path: string, params: any) => {
      if (Object.keys(params).length > 0) {
        return `${path}?${Object.entries(params)
          .map(([key, value]) => `${key}=${value}`)
          .join('&')}`;
      }
      return path;
    },
    [],
  );

  // Update navigation history on path change
  useEffect(() => {
    if (!pathname) return;

    // ignore root path only for the initial mount
    if (pathname === '/' && navigationHistory === '/') return;

    if (navigationHistory !== pathname) {
      store.mutate(
        updateNavigationHistory({
          history: constructPathWithParams(pathname, globalParams),
        }),
      );
    }
  }, [pathname]);

  // Restore navigation on mount
  useEffect(() => {
    if (!navigationHistory) return;
    if (navigationHistory === '/') return;
    if (pathname === navigationHistory) return;

    const path = constructPathWithParams(navigationHistory, globalParams);

    // Use replace to avoid adding to history stack
    console.log('📜 Restoring navigation', path);
    // timeout to allow router to mount
    setTimeout(() => {
      router.push(path as any);
    }, 100);
  }, []); // Empty dependency array ensures this only runs once on mount

  return null;
}
