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
  viewportHeight: number;
  viewportStableHeight: number;
  ready: () => void;
  expand: () => void;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  onEvent: (event: 'viewportChanged', handler: () => void) => void;
  offEvent: (event: 'viewportChanged', handler: () => void) => void;
  // Bot API 7.7+; guarded at every call site since older Telegram clients
  // (and Telegram Desktop for a while after) don't have it.
  disableVerticalSwipes?: () => void;
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

/**
 * Keeps --tg-vh (see index.css) equal to the WebView's own stable viewport
 * height, in px, so `h-[var(--tg-vh)]` fills exactly what Telegram gives the
 * Mini App -- not the taller `100vh`/`100dvh` a phone browser would report,
 * which used to leave a dead strip below the app (or a scrollbar) the size
 * of Telegram's own header/bottom chrome.
 */
function syncViewportHeight(app: TelegramWebApp) {
  const height = app.viewportStableHeight || app.viewportHeight || window.innerHeight;
  document.documentElement.style.setProperty('--tg-vh', `${height}px`);
}

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
  syncViewportHeight(app);
  app.onEvent('viewportChanged', () => syncViewportHeight(app));
  // The app already scrolls its own panes; Telegram's own pull-down-to-close
  // swipe fighting that on every scroll-to-top is the "app feels the wrong
  // size / keeps closing" complaint this silences.
  app.disableVerticalSwipes?.();
}
