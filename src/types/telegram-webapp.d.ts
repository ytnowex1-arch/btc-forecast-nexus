export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }

  interface TelegramWebApp {
    initData: string;
    initDataUnsafe: {
      user?: {
        id?: number;
        username?: string;
        first_name?: string;
        last_name?: string;
      };
      [key: string]: unknown;
    };
    ready: () => void;
    expand: () => void;
  }
}