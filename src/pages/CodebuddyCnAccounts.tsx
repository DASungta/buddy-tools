import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Loader2, Trash2, CheckCircle, Bot, Calendar, LogIn } from 'lucide-react';
import { useCodebuddyCnAccountStore } from '../stores/useCodebuddyCnAccountStore';
import type { CodebuddyCnAccount } from '../types/codebuddyCn';
import * as cnService from '../services/codebuddyCnService';
import AddCodeBuddyCnAccountDialog from '../components/codebuddy/AddCodeBuddyCnAccountDialog';
import CodeBuddyOAuthDialog from '../components/codebuddy/CodeBuddyOAuthDialog';
import { getCodebuddyUsage, getCodebuddyPlanBadge } from '../utils/codebuddyQuota';
import { CodeBuddyQuotaCategoryList } from '../components/codebuddy/CodeBuddyQuotaCategoryList';

function PlanBadge({ planType }: { planType?: string }) {
  if (!planType) return null;
  const badge = getCodebuddyPlanBadge(planType);
  const colorMap: Record<string, string> = {
    ENTERPRISE: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
    PRO: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    TRIAL: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
    FREE: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  };
  const cls = colorMap[badge] ?? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide ${cls}`}>
      {badge}
    </span>
  );
}

function getAccountScope(account: CodebuddyCnAccount): 'personal' | 'enterprise' {
  const explicit = account.account_scope?.toLowerCase();
  if (explicit === 'enterprise') return 'enterprise';
  if (explicit === 'personal') return 'personal';
  if (account.enterprise_id || account.enterprise_name) return 'enterprise';
  const plan = account.plan_type?.toLowerCase() ?? '';
  if (
    plan.includes('enterprise') ||
    plan.includes('ultimate') ||
    plan.includes('exclusive') ||
    plan.includes('premise')
  ) {
    return 'enterprise';
  }
  return 'personal';
}

function AccountScopeBadge({ account }: { account: CodebuddyCnAccount }) {
  const { t } = useTranslation();
  const scope = getAccountScope(account);
  const title = scope === 'enterprise' ? account.enterprise_name || account.enterprise_id || undefined : undefined;
  const cls = scope === 'enterprise'
    ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
    : 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300';

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide ${cls}`} title={title}>
      {scope === 'enterprise'
        ? t('codebuddy.accounts.scope.enterprise', '企业版')
        : t('codebuddy.accounts.scope.personal', '个人版')}
    </span>
  );
}

interface AccountCardProps {
  account: CodebuddyCnAccount;
  isCurrent: boolean;
  onSwitch: (id: string) => void;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onCheckin: (id: string) => void;
  switchingId: string | null;
  refreshingId: string | null;
  deletingId: string | null;
  checkinId: string | null;
}

function AccountCard({
  account,
  isCurrent,
  onSwitch,
  onRefresh,
  onDelete,
  onCheckin,
  switchingId,
  refreshingId,
  deletingId,
  checkinId,
}: AccountCardProps) {
  const { t } = useTranslation();
  const isSwitching = switchingId === account.id;
  const isRefreshing = refreshingId === account.id;
  const isDeleting = deletingId === account.id;
  const isCheckingIn = checkinId === account.id;

  const displayName = account.email || account.uid || account.id.slice(0, 8);
  const lastUsedDate = account.last_used ? new Date(account.last_used * 1000).toLocaleString() : '-';
  const lastCheckinDate = account.last_checkin_time
    ? new Date(account.last_checkin_time * 1000).toLocaleDateString()
    : null;

  const groups = getCodebuddyUsage(account as any);

  return (
    <div
      className={`bg-white dark:bg-base-100 rounded-xl border shadow-sm p-4 transition-all ${
        isCurrent
          ? 'border-blue-400 dark:border-blue-500 ring-1 ring-blue-300 dark:ring-blue-600'
          : 'border-gray-200 dark:border-base-300 hover:border-gray-300 dark:hover:border-base-200'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-blue-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className="text-sm font-medium text-gray-900 dark:text-base-content truncate max-w-[160px]"
                title={displayName}
              >
                {displayName}
              </span>
              <PlanBadge planType={account.plan_type} />
              <AccountScopeBadge account={account} />
              {isCurrent && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                  <CheckCircle size={10} />
                  {t('codebuddy.accounts.current', '当前账号')}
                </span>
              )}
            </div>
            {account.nickname && account.nickname !== displayName && (
              <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                {account.nickname}
              </div>
            )}
            {account.enterprise_name && (
              <div className="text-[11px] text-purple-500 dark:text-purple-300 truncate" title={account.enterprise_id || account.enterprise_name}>
                {t('codebuddy.accounts.enterpriseName', '企业：{{name}}', { name: account.enterprise_name })}
              </div>
            )}
            <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
              {t('codebuddy.accounts.lastUsed', '最近使用：{{time}}', { time: lastUsedDate })}
            </div>
          </div>
        </div>
      </div>

      {/* Checkin streak */}
      {account.checkin_streak !== undefined && account.checkin_streak > 0 && (
        <div className="mb-3 px-2 py-1.5 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 flex items-center gap-2">
          <Calendar size={12} className="text-orange-500 flex-shrink-0" />
          <span className="text-xs text-orange-700 dark:text-orange-300">
            {t('codebuddy.checkin.streak', 'Streak')}: {account.checkin_streak}{' '}
            {t('codebuddy.checkin.days', 'days')}
            {lastCheckinDate && ` · ${lastCheckinDate}`}
          </span>
        </div>
      )}

      {/* Quota */}
      <div className="mb-3">
        {account.quota_query_last_error && (
          <div className="mb-2 px-2 py-1 rounded bg-yellow-50 dark:bg-yellow-900/20 text-[11px] text-yellow-700 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800">
            {account.quota_query_last_error}
          </div>
        )}
        <CodeBuddyQuotaCategoryList groups={groups} />
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-2">
        {!isCurrent && (
          <button
            className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1"
            onClick={() => onSwitch(account.id)}
            disabled={!!switchingId || !!refreshingId || !!deletingId}
          >
            {isSwitching ? <Loader2 size={12} className="animate-spin" /> : null}
            {t('codebuddy.accounts.switch', '切换到此账号')}
          </button>
        )}
        <button
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1"
          onClick={() => onCheckin(account.id)}
          disabled={!!checkinId}
          title={t('codebuddy.checkin.checkin', 'Daily Check-in')}
        >
          {isCheckingIn ? <Loader2 size={12} className="animate-spin" /> : <Calendar size={12} />}
        </button>
        <button
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-50 dark:bg-base-200 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-base-300 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1"
          onClick={() => onRefresh(account.id)}
          disabled={!!switchingId || !!refreshingId || !!deletingId}
        >
          {isRefreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {t('common.refresh', '刷新')}
        </button>
        <button
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1"
          onClick={() => onDelete(account.id)}
          disabled={!!switchingId || !!refreshingId || !!deletingId}
        >
          {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          {t('common.delete', '删除')}
        </button>
      </div>
    </div>
  );
}

export default function CodebuddyCnAccounts() {
  const { t } = useTranslation();
  const {
    accounts,
    currentAccountId,
    loading,
    error,
    fetchAccounts,
    switchAccount,
    refreshToken,
    refreshAllTokens,
    deleteAccount,
  } = useCodebuddyCnAccountStore();

  const [oauthOpen, setOauthOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [checkinId, setCheckinId] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [checkinMessage, setCheckinMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchAccounts().then(() => {
      const store = useCodebuddyCnAccountStore.getState();
      const now = Date.now() / 1000;
      const needsRefresh = store.accounts.some(
        (a) => !a.quota_raw || !a.usage_updated_at || now - a.usage_updated_at > 86400
      );
      if (needsRefresh) {
        refreshAllTokens();
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSwitch = async (id: string) => {
    setSwitchingId(id);
    try {
      await switchAccount(id);
    } finally {
      setSwitchingId(null);
    }
  };

  const handleRefresh = async (id: string) => {
    setRefreshingId(id);
    try {
      await refreshToken(id);
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('codebuddy.cn.deleteConfirm', 'Delete this account?'))) return;
    setDeletingId(id);
    try {
      await deleteAccount(id);
    } finally {
      setDeletingId(null);
    }
  };

  const handleCheckin = async (id: string) => {
    setCheckinId(id);
    setCheckinMessage(null);
    try {
      const [status, result] = await cnService.checkinCodebuddyCn(id);
      await fetchAccounts();
      if (result?.success) {
        setCheckinMessage(result.message || t('codebuddy.checkin.success', 'Check-in successful!'));
      } else if (status.today_checked_in) {
        setCheckinMessage(t('codebuddy.checkin.alreadyCheckedIn', 'Already checked in today'));
      }
      setTimeout(() => setCheckinMessage(null), 3000);
    } catch (e) {
      console.error(e);
    } finally {
      setCheckinId(null);
    }
  };

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    try {
      await refreshAllTokens();
    } finally {
      setRefreshingAll(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-green-500" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-base-content">
            {t('codebuddy.cn.title', 'CodeBuddy CN 账号管理')}
          </h1>
          {accounts.length > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
              {accounts.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-2 bg-white dark:bg-base-100 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-base-200 transition-colors flex items-center gap-2 shadow-sm border border-gray-200/50 dark:border-base-300 disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={handleRefreshAll}
            disabled={refreshingAll || loading}
          >
            {refreshingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="hidden sm:inline">{t('codebuddy.accounts.refreshAll', '刷新全部')}</span>
          </button>
          <AddCodeBuddyCnAccountDialog />
          <button
            onClick={() => setOauthOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20"
          >
            <LogIn size={14} />
            {t('codebuddy.oauth.button', 'OAuth 登录')}
          </button>
          <CodeBuddyOAuthDialog
            open={oauthOpen}
            variant="cn"
            onClose={() => setOauthOpen(false)}
            onSuccess={async (account) => {
              await fetchAccounts();
              if (account && 'id' in account) {
                await switchAccount(account.id);
              }
              setOauthOpen(false);
            }}
          />
        </div>
      </div>

      {/* Checkin feedback */}
      {checkinMessage && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-700 dark:text-green-300">
          {checkinMessage}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="alert alert-error mb-4 text-sm py-2">
          <span>{error}</span>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && accounts.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white dark:bg-base-100 rounded-xl border border-gray-200 dark:border-base-300 p-4 animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-base-300" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-gray-200 dark:bg-base-300 rounded w-2/3" />
                  <div className="h-2.5 bg-gray-100 dark:bg-base-200 rounded w-1/3" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-2 bg-gray-100 dark:bg-base-200 rounded" />
                <div className="h-2 bg-gray-100 dark:bg-base-200 rounded w-3/4" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && accounts.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Bot className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-4" />
          <h3 className="text-base font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('codebuddy.cn.noAccounts', '暂无 CodeBuddy CN 账号')}
          </h3>
          <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">
            {t('codebuddy.cn.emptyHint', '点击「添加账号」按钮导入你的 CodeBuddy CN token')}
          </p>
          <AddCodeBuddyCnAccountDialog />
        </div>
      )}

      {/* Account grid */}
      {accounts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {accounts.map((account: CodebuddyCnAccount) => (
            <AccountCard
              key={account.id}
              account={account}
              isCurrent={account.id === currentAccountId}
              onSwitch={handleSwitch}
              onRefresh={handleRefresh}
              onDelete={handleDelete}
              onCheckin={handleCheckin}
              switchingId={switchingId}
              refreshingId={refreshingId}
              deletingId={deletingId}
              checkinId={checkinId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
