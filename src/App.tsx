import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';

import { Header } from '@/components/Header';
import { SetupNotice } from '@/components/SetupNotice';
import { Sidebar } from '@/components/Sidebar';
import { AdminPage } from '@/pages/AdminPage';
import { AuthPage } from '@/pages/AuthPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { DownloadsPage } from '@/pages/DownloadsPage';
import { GroupsPage } from '@/pages/GroupsPage';
import { GuidePage } from '@/pages/GuidePage';
import { SettingsPage, type SettingsTab } from '@/pages/SettingsPage';
import { SubscribePage } from '@/pages/SubscribePage';
import { UrlListsPage } from '@/pages/UrlListsPage';
import { getSubscriptionStatus, telegramMiniAppLogin, type SubscriptionStatusResult } from '@/lib/backend';
import { useLanguage } from '@/lib/i18n';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { isTelegramMiniApp, prepareTelegramMiniApp, telegramInitData } from '@/lib/telegramWebApp';
import type { PageKey } from '@/lib/types';

// The paywall/tier system is fully built (SubscribePage, AdminPage, capability
// gating, quota) but not in use right now -- flip this back to true to bring
// it back without redoing any of that work.
const SUBSCRIPTION_ENFORCED = false;

function App() {
  const [currentPage, setCurrentPage] = useState<PageKey>('dashboard');
  // Set right before navigating to 'settings' so a Dashboard connection chip
  // (e.g. "R2") lands on that account's own tab instead of always Telegram.
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined);
  const goToSettings = (tab: SettingsTab) => {
    setSettingsTab(tab);
    setCurrentPage('settings');
  };
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [subStatus, setSubStatus] = useState<SubscriptionStatusResult | null>(null);
  const [subLoading, setSubLoading] = useState(true);
  const { t } = useLanguage();

  useEffect(() => {
    prepareTelegramMiniApp();
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) {
      setSessionLoading(false);
      return;
    }
    supabase.auth.getSession().then(async ({ data }) => {
      // Opened inside Telegram with no browser session yet -- sign in
      // silently from the Mini App's own signed init data instead of
      // showing AuthPage's email/password form at all.
      if (!data.session && isTelegramMiniApp) {
        try {
          const { email, token_hash } = await telegramMiniAppLogin(telegramInitData);
          const { data: otpData } = await supabase.auth.verifyOtp({ email, token_hash, type: 'magiclink' });
          setSession(otpData.session ?? null);
          setSessionLoading(false);
          return;
        } catch (err) {
          console.error('Telegram Mini App sign-in failed:', err);
          // Falls through to AuthPage -- better than a stuck loading screen.
        }
      }
      setSession(data.session);
      setSessionLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);

  const refreshEntitlements = async () => {
    if (!session) return;
    setSubLoading(true);
    const [{ data: profile }, status] = await Promise.all([
      supabase.from('profiles').select('is_admin').eq('id', session.user.id).maybeSingle(),
      getSubscriptionStatus().catch(() => ({ subscribed: false, tier: null, capability: null, expiresAt: null })),
    ]);
    setIsAdmin(Boolean((profile as { is_admin?: boolean } | null)?.is_admin));
    setSubStatus(status);
    setSubLoading(false);
  };

  useEffect(() => {
    if (session) refreshEntitlements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  const PAGE_INFO: Record<PageKey, { title: string; subtitle: string }> = {
    dashboard: { title: t('page.dashboard.title'), subtitle: t('page.dashboard.subtitle') },
    groups: { title: t('page.groups.title'), subtitle: t('page.groups.subtitle') },
    downloads: { title: t('page.downloads.title'), subtitle: t('page.downloads.subtitle') },
    urllists: { title: t('page.urllists.title'), subtitle: t('page.urllists.subtitle') },
    settings: { title: t('page.settings.title'), subtitle: t('page.settings.subtitle') },
    guide: { title: t('page.guide.title'), subtitle: t('page.guide.subtitle') },
    admin: { title: 'Admin', subtitle: 'Payments, pricing and subscribers' },
  };

  const info = PAGE_INFO[currentPage];

  // Every page reads from the database, so without credentials the app can
  // only explain itself.
  if (!supabaseConfigured) return <SetupNotice />;

  if (sessionLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-dark-950">
        <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
      </div>
    );
  }

  // The Settings and R2/Telegram tables are still one shared dataset today
  // (multi-tenant data isolation is a separate, not-yet-built phase) -- this
  // gate only decides who gets *past the paywall*, not who sees whose data.
  if (!session) return <AuthPage />;

  if (subLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-dark-950">
        <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
      </div>
    );
  }

  // The operator's own account (profiles.is_admin) always gets in, active
  // subscription or not -- otherwise flagging yourself admin after signup
  // would still leave you stuck behind your own paywall.
  if (SUBSCRIPTION_ENFORCED && !isAdmin && !subStatus?.subscribed) {
    return <SubscribePage onApproved={refreshEntitlements} />;
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <DashboardPage onNavigate={setCurrentPage} onNavigateSettings={goToSettings} />;
      case 'groups':
        return <GroupsPage />;
      case 'downloads':
        return <DownloadsPage />;
      case 'urllists':
        // The URL-list / upload groups moved off the Groups page and sit here,
        // under the lists they are made of -- one mount of GroupsPage limited
        // to those groups, so opening one still gets the full video browser.
        return (
          <div className="space-y-6">
            <UrlListsPage />
            <GroupsPage source="manual" />
          </div>
        );
      case 'settings':
        return (
          <SettingsPage
            capability={SUBSCRIPTION_ENFORCED ? subStatus?.capability ?? (isAdmin ? 'pro' : 'basic') : 'pro'}
            initialTab={settingsTab}
          />
        );
      case 'guide':
        return <GuidePage onNavigate={setCurrentPage} />;
      case 'admin':
        return isAdmin ? <AdminPage /> : null;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-dark-950 text-white">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} collapsed={sidebarCollapsed} isAdmin={isAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={info.title}
          subtitle={info.subtitle}
        />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{renderPage()}</main>
      </div>
    </div>
  );
}

export default App;
