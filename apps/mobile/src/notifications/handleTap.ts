import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthProvider';

const VISIT_TEMPLATES = ['APPROVAL_REQUEST', 'APPROVAL_REMINDER', 'VISITOR_ARRIVED'];

/** Push data comes from outside, so only a clean id opens a visit. */
export function routeForNotification(data?: { visitId?: unknown; template?: unknown } | null): string {
  const { visitId, template } = data ?? {};
  const known = typeof template === 'string' && VISIT_TEMPLATES.includes(template);
  if (known && typeof visitId === 'string' && /^[\w-]+$/.test(visitId)) return `/(host)/visits/${visitId}`;
  return '/(host)';
}

/** Tapping a push opens the right visit once sign-in has loaded, even if the app was closed. */
export function useNotificationRouting(): void {
  const router = useRouter();
  const { user, ready } = useAuth();
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || user?.role !== 'employee' || !response) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    router.push(routeForNotification(response.notification.request.content.data) as never);
  }, [ready, user, response, router]);
}
