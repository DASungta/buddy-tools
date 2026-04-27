import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

interface QuotaAlertPayload {
  account_id: string;
  email: string;
  message_zh: string;
  message_en: string;
}

export function useQuotaAlertListener() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<QuotaAlertPayload>('quota:alert', (event) => {
      const { email, message_zh } = event.payload;
      console.warn(`[CodeBuddy Quota Alert] ${email}: ${message_zh}`);
      // TODO: integrate with toast system when available
      window.alert(`CodeBuddy 配额提醒\n${email}: ${message_zh}`);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);
}
