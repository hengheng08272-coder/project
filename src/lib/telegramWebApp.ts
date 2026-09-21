/**
 * Thin wrapper around the Telegram Mini App JS SDK (loaded in index.html as
 * a plain <script>, so it's a global rather than an npm package -- there is
 * no official @types package worth adding for the handful of fields used
 * here). Every export is a no-op/false when the page is opened as a normal
 * browser tab instead of inside Telegram, so the rest of the app never has
 * to branch on "are we in Telegram" beyond calling these.
 */

interface TelegramWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  ready: () => void;
  expand: () => void;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

function webApp(): TelegramWebApp | undefined {
  return typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
}

/** True only when the page is genuinely running inside Telegram's WebView with a live session to prove it. */
export const isTelegramMiniApp = Boolean(webApp()?.initData);

/** The raw, signed init data string the backend verifies -- see telegramLogin.js's Mini App branch. */
export const telegramInitData = webApp()?.initData ?? '';

/** Tells Telegram the page is ready to be shown, and asks for the full-height layout. */
export function prepareTelegramMiniApp() {
  const app = webApp();
  if (!app) return;
  app.ready();
  app.expand();
  // Match the app's own dark background (--c-dark-950 in index.css) instead
  // of Telegram's default, so there's no flash of a different color around
  // the WebView chrome.
  app.setHeaderColor('#020617');
  app.setBackgroundColor('#020617');
}
