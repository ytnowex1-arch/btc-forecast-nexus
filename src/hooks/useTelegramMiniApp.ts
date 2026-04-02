import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const TELEGRAM_SDK_URL = 'https://telegram.org/js/telegram-web-app.js';

function loadTelegramSdk(): Promise<void> {
  if (window.Telegram?.WebApp) {
    return Promise.resolve();
  }

  const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${TELEGRAM_SDK_URL}"]`);
  if (existingScript) {
    return new Promise((resolve, reject) => {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Telegram SDK failed to load')), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TELEGRAM_SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Telegram SDK failed to load'));
    document.head.appendChild(script);
  });
}

export function useTelegramMiniApp() {
  useEffect(() => {
    let cancelled = false;

    const syncTelegramUser = async () => {
      try {
        await loadTelegramSdk();

        const webApp = window.Telegram?.WebApp;
        const telegramUser = webApp?.initDataUnsafe?.user;
        const telegramId = telegramUser?.id ? String(telegramUser.id) : null;
        const username = telegramUser?.username ?? null;

        if (!webApp || !telegramId || !webApp.initData) {
          return;
        }

        webApp.ready();
        webApp.expand();

        const { error } = await supabase.functions.invoke('telegram-mini-app', {
          body: {
            initData: webApp.initData,
            telegramId,
            username,
          },
        });

        if (error && !cancelled) {
          console.error('Telegram Mini App sync failed:', error.message);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Telegram Mini App init failed:', error);
        }
      }
    };

    void syncTelegramUser();

    return () => {
      cancelled = true;
    };
  }, []);
}