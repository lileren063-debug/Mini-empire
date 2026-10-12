/**
 * Telegram Mini App bridge. Only the raw, signed `initData` string is sent to the server, which
 * verifies the signature with the bot token. The client never asserts a Telegram identity itself.
 */
declare global {
  interface Window {
    Telegram?: { WebApp?: { initData: string; ready(): void; expand(): void; colorScheme?: string } };
  }
}

export function inTelegram(): boolean {
  return location.hash.includes('tgWebAppData') || !!window.Telegram?.WebApp?.initData;
}

export async function telegramInitData(): Promise<string | null> {
  if (!inTelegram()) return null;
  if (!window.Telegram?.WebApp) {
    await new Promise<void>((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://telegram.org/js/telegram-web-app.js';
      s.onload = () => resolve();
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }
  const wa = window.Telegram?.WebApp;
  if (!wa?.initData) return null;
  wa.ready();
  wa.expand();
  return wa.initData;
}
