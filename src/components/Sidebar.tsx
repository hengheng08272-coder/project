import { useEffect, useState } from 'react';
import {
  BookOpen,
  DownloadCloud,
  LayoutDashboard,
  Link2,
  LogOut,
  Settings,
  ShieldCheck,
  Users,
  Languages,
} from 'lucide-react';

import { AppLogo } from '@/components/Brand';
import { supabase } from '@/lib/supabase';
import { useConnectionStatus } from '@/lib/hooks';
import { useLanguage } from '@/lib/i18n';
import type { PageKey } from '@/lib/types';

interface SidebarProps {
  currentPage: PageKey;
  onNavigate: (page: PageKey) => void;
  collapsed: boolean;
  isAdmin?: boolean;
}

export function Sidebar({ currentPage, onNavigate, collapsed, isAdmin }: SidebarProps) {
  const [queueCount, setQueueCount] = useState(0);
  const [activeGroups, setActiveGroups] = useState(0);
  const { language, toggleLanguage, t } = useLanguage();
  const status = useConnectionStatus();

  useEffect(() => {
    (async () => {
      const [downloads, groups] = await Promise.all([
        supabase.from('downloads').select('*', { count: 'exact', head: true }).in('status', ['queued', 'downloading']),
        supabase.from('groups').select('*', { count: 'exact', head: true }).eq('active', true),
      ]);
      setQueueCount(downloads.count ?? 0);
      setActiveGroups(groups.count ?? 0);
    })();
  }, [currentPage]);

  const menuItems: { key: PageKey; label: string; icon: typeof LayoutDashboard; badge?: number }[] = [
    { key: 'dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
    { key: 'groups', label: t('nav.groups'), icon: Users, badge: activeGroups },
    { key: 'downloads', label: t('nav.downloads'), icon: DownloadCloud, badge: queueCount },
    { key: 'urllists', label: t('nav.urllists'), icon: Link2 },
    { key: 'settings', label: t('nav.settings'), icon: Settings },
    { key: 'guide', label: t('nav.guide'), icon: BookOpen },
    ...(isAdmin ? [{ key: 'admin' as PageKey, label: t('nav.admin'), icon: ShieldCheck }] : []),
  ];

  // Green only when everything the app needs is actually reachable.
  const allGood = status.backend === true && status.telegram;

  return (
    <aside
      className={`${collapsed ? 'w-16' : 'w-60'} flex shrink-0 flex-col border-r border-dark-800 bg-dark-900 transition-all duration-300`}
    >
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-dark-800 px-4">
        <AppLogo size={36} className="glow" />
        {!collapsed && (
          <div className="overflow-hidden">
            <p className="text-sm font-bold tracking-tight text-white">{t('nav.appName')}</p>
            <p className="text-[10px] font-medium text-dark-500">{t('nav.appTagline')}</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-primary-500/15 text-primary-400'
                  : 'text-dark-400 hover:bg-dark-800 hover:text-white'
              }`}
              title={collapsed ? item.label : undefined}
            >
              {isActive && (
                <div className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary-500" />
              )}
              <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-primary-400' : ''}`} />
              {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
              {!collapsed && item.badge !== undefined && item.badge > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    isActive ? 'bg-primary-500 text-white' : 'bg-dark-700 text-dark-300'
                  }`}
                >
                  {item.badge}
                </span>
              )}
              {collapsed && item.badge !== undefined && item.badge > 0 && (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary-500" />
              )}
            </button>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-dark-800 p-2">
        <button
          onClick={toggleLanguage}
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-dark-300 transition-colors hover:bg-dark-800 hover:text-white ${
            collapsed ? 'justify-center' : ''
          }`}
          title={collapsed ? (language === 'en' ? 'ខ្មែរ' : 'English') : undefined}
        >
          <Languages className="h-3.5 w-3.5 shrink-0" />
          {!collapsed && <span>{language === 'en' ? 'ខ្មែរ' : 'English'}</span>}
        </button>

        <button
          onClick={() => onNavigate('settings')}
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-dark-800 ${
            collapsed ? 'justify-center' : ''
          }`}
          title={collapsed ? t('nav.systemStatus') : undefined}
        >
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              status.backend === null
                ? 'bg-dark-600'
                : allGood
                ? 'animate-pulse bg-success-500'
                : 'bg-warning-500'
            }`}
          />
          {!collapsed && (
            <div className="text-left">
              <p className="text-[10px] font-medium text-dark-500">{t('nav.systemStatus')}</p>
              <p
                className={`text-xs font-semibold ${allGood ? 'text-success-400' : 'text-warning-400'}`}
              >
                {status.backend === null
                  ? t('status.checking')
                  : allGood
                  ? t('nav.online')
                  : t('nav.offline')}
              </p>
            </div>
          )}
        </button>

        <button
          onClick={() => supabase.auth.signOut()}
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-dark-400 transition-colors hover:bg-error-500/10 hover:text-error-400 ${
            collapsed ? 'justify-center' : ''
          }`}
          title={collapsed ? t('auth.signOut') : undefined}
        >
          <LogOut className="h-3.5 w-3.5 shrink-0" />
          {!collapsed && <span>{t('auth.signOut')}</span>}
        </button>
      </div>
    </aside>
  );
}
