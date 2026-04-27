import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Package, Gift, Zap, MoreHorizontal } from 'lucide-react';
import type { QuotaCategoryGroup, OfficialQuotaResource } from '../../types/codebuddy';

interface CodeBuddyQuotaCategoryListProps {
  groups: QuotaCategoryGroup[];
  formatDateTime?: (timeMs: number | null) => string;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  base: <Package size={14} />,
  activity: <Gift size={14} />,
  extra: <Zap size={14} />,
  other: <MoreHorizontal size={14} />,
};

const CATEGORY_COLORS: Record<string, string> = {
  base: '#3b82f6',
  activity: '#f59e0b',
  extra: '#8b5cf6',
  other: '#6b7280',
};

function formatQuotaNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Math.max(0, value));
}

function getQuotaClass(remainPercent: number | null): string {
  if (remainPercent == null || !Number.isFinite(remainPercent)) return 'high';
  if (remainPercent <= 10) return 'critical';
  if (remainPercent <= 30) return 'low';
  if (remainPercent <= 60) return 'medium';
  return 'high';
}

function getProgressBarColor(quotaClass: string): string {
  switch (quotaClass) {
    case 'critical': return 'bg-red-500';
    case 'low': return 'bg-orange-500';
    case 'medium': return 'bg-yellow-500';
    default: return 'bg-blue-500';
  }
}

export function CodeBuddyQuotaCategoryList({ groups, formatDateTime }: CodeBuddyQuotaCategoryListProps) {
  const { t } = useTranslation();
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const defaultFormatDateTime = (timeMs: number | null): string => {
    if (!timeMs) return '-';
    return new Date(timeMs).toLocaleString();
  };

  const fmt = formatDateTime ?? defaultFormatDateTime;

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const visibleGroups = groups.filter((g) => g.visible);

  if (visibleGroups.length === 0) {
    return (
      <div className="text-xs text-gray-400 dark:text-gray-500 py-2 text-center">
        {t('codebuddy.quotaCategory.empty', '暂无配额数据')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {visibleGroups.map((group) => {
        const isExpanded = expandedKeys.has(group.key);
        const hasDetails = group.items.length > 1 || (group.items.length === 1 && group.items[0].packageName);
        const quotaClass = getQuotaClass(group.remainPercent);

        return (
          <div
            key={group.key}
            className="bg-gray-50 dark:bg-base-200 rounded-lg p-2.5 border border-gray-100 dark:border-base-300"
          >
            {/* Group header */}
            <div
              className="flex items-center justify-between cursor-pointer select-none"
              onClick={() => hasDetails && toggleExpand(group.key)}
              style={{ cursor: hasDetails ? 'pointer' : 'default' }}
            >
              <div className="flex items-center gap-1.5">
                <span style={{ color: CATEGORY_COLORS[group.key] ?? CATEGORY_COLORS.other }}>
                  {CATEGORY_ICONS[group.key] ?? CATEGORY_ICONS.other}
                </span>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{group.label}</span>
                {hasDetails && (
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">({group.items.length})</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">
                  {formatQuotaNumber(group.used)} / {formatQuotaNumber(group.total)}
                </span>
                {hasDetails && (
                  <span className="text-gray-400 dark:text-gray-500">
                    {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </span>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-1.5 h-1.5 bg-gray-200 dark:bg-base-300 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${getProgressBarColor(quotaClass)}`}
                style={{ width: `${Math.min(100, group.usedPercent)}%` }}
              />
            </div>

            {/* Expanded details */}
            {isExpanded && hasDetails && (
              <div className="mt-2 space-y-1.5 pt-2 border-t border-gray-200 dark:border-base-300">
                {group.items.map((item, idx) => (
                  <QuotaItemDetail
                    key={`${group.key}-${idx}`}
                    item={item}
                    formatDateTime={fmt}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface QuotaItemDetailProps {
  item: OfficialQuotaResource;
  formatDateTime: (timeMs: number | null) => string;
}

function QuotaItemDetail({ item, formatDateTime }: QuotaItemDetailProps) {
  const { t } = useTranslation();
  const remainPercent = item.remainPercent ?? (item.total > 0 ? (item.remain / item.total) * 100 : null);

  let timeText = '';
  if (item.expireAt) {
    timeText = t('codebuddy.quotaQuery.expireAt', '到期：{{time}}', { time: formatDateTime(item.expireAt) });
  } else if (item.refreshAt) {
    timeText = t('codebuddy.quotaQuery.updatedAt', '刷新：{{time}}', { time: formatDateTime(item.refreshAt) });
  }

  const quotaClass = getQuotaClass(remainPercent);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-600 dark:text-gray-400 truncate max-w-[60%]" title={item.packageName || ''}>
          {item.packageName || t('codebuddy.quotaQuery.packageUnknown', '套餐信息未知')}
        </span>
        <span className={`text-[11px] font-mono ${quotaClass === 'critical' ? 'text-red-500' : quotaClass === 'low' ? 'text-orange-500' : 'text-gray-500 dark:text-gray-400'}`}>
          {formatQuotaNumber(item.used)} / {formatQuotaNumber(item.total)}
        </span>
      </div>
      {timeText && (
        <div className="text-[10px] text-gray-400 dark:text-gray-500">{timeText}</div>
      )}
    </div>
  );
}

export default CodeBuddyQuotaCategoryList;
