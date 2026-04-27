/**
 * CodeBuddy 配额工具函数
 *
 * 将 quota_raw / usage_raw / auth_raw JSON blob 解析为 UI 可渲染的分组结构。
 */

import type { CodebuddyAccount, OfficialQuotaResource, QuotaCategoryGroup } from '../types/codebuddy';
import { PACKAGE_CODE, RESOURCE_STATUS } from '../types/codebuddy';

// ── 基础解析工具 ─────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseDateTimeToEpoch(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const isoText = text.includes('T') ? text : text.replace(' ', 'T');
  const parsed = Date.parse(isoText);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCycleTotal(a: Record<string, unknown>): number {
  return (
    parseNumeric(a.CycleCapacitySizePrecise) ??
    parseNumeric(a.CycleCapacitySize) ??
    parseNumeric(a.CapacitySizePrecise) ??
    parseNumeric(a.CapacitySize) ??
    0
  );
}

function parseCycleRemain(a: Record<string, unknown>): number {
  return (
    parseNumeric(a.CycleCapacityRemainPrecise) ??
    parseNumeric(a.CycleCapacityRemain) ??
    parseNumeric(a.CapacityRemainPrecise) ??
    parseNumeric(a.CapacityRemain) ??
    0
  );
}

function isActiveResource(a: Record<string, unknown>): boolean {
  const s = typeof a.Status === 'number' ? a.Status : -1;
  return s === RESOURCE_STATUS.valid || s === RESOURCE_STATUS.usedUp;
}

function isExtraPackage(a: Record<string, unknown>): boolean {
  return typeof a.PackageCode === 'string' && a.PackageCode === PACKAGE_CODE.extra;
}

function isTrialOrFreeMonPackage(a: Record<string, unknown>): boolean {
  const code = typeof a.PackageCode === 'string' ? a.PackageCode : '';
  return code === PACKAGE_CODE.gift || code === PACKAGE_CODE.freeMon;
}

function isProPackage(a: Record<string, unknown>): boolean {
  if (isTrialOrFreeMonPackage(a)) return false;
  const code = typeof a.PackageCode === 'string' ? a.PackageCode : '';
  return code === PACKAGE_CODE.proMon || code === PACKAGE_CODE.proYear;
}

function extractResourceAccounts(account: CodebuddyAccount): Array<Record<string, unknown>> {
  const usageRoot = asRecord(account.usage_raw);
  const quotaRoot = asRecord(account.quota_raw);
  const userResource = asRecord(quotaRoot?.userResource) ?? usageRoot;
  const data = asRecord(userResource?.data);
  const response = asRecord(data?.Response);
  const payload = asRecord(response?.Data);
  const list = Array.isArray(payload?.Accounts) ? (payload!.Accounts as unknown[]) : [];
  return list.filter((a): a is Record<string, unknown> => a != null && typeof a === 'object');
}

function aggregateCycleResources(list: Array<Record<string, unknown>>): Record<string, unknown> | null {
  if (list.length === 0) return null;
  const first = list[0];
  const totals = list.reduce(
    (acc: { total: number; remain: number }, item) => {
      acc.total += parseCycleTotal(item);
      acc.remain += parseCycleRemain(item);
      return acc;
    },
    { total: 0, remain: 0 },
  );
  return {
    ...first,
    CycleCapacitySizePrecise: String(totals.total),
    CycleCapacityRemainPrecise: String(totals.remain),
  };
}

function toOfficialQuotaResource(raw: Record<string, unknown>): OfficialQuotaResource {
  const packageCode = typeof raw.PackageCode === 'string' ? raw.PackageCode : null;
  const packageName = typeof raw.PackageName === 'string' ? raw.PackageName : null;
  const cycleStartTime = typeof raw.CycleStartTime === 'string' ? raw.CycleStartTime : null;
  const cycleEndTime = typeof raw.CycleEndTime === 'string' ? raw.CycleEndTime : null;
  const deductionEndTime = parseNumeric(raw.DeductionEndTime);
  const expiredTime = typeof raw.ExpiredTime === 'string' ? raw.ExpiredTime : null;

  const total = parseCycleTotal(raw);
  const remain = parseCycleRemain(raw);
  const used = Math.max(0, total - remain);
  const usedPercent = total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : 0;
  const remainPercent = total > 0 ? Math.max(0, Math.min(100, (remain / total) * 100)) : null;

  const cycleEndAt = parseDateTimeToEpoch(cycleEndTime);
  const expireAt = deductionEndTime ?? parseDateTimeToEpoch(expiredTime) ?? cycleEndAt;
  const refreshAt = cycleEndAt != null && expireAt != null && cycleEndAt !== expireAt ? cycleEndAt + 1000 : null;

  const isBasePackage = packageCode === PACKAGE_CODE.free || packageCode === PACKAGE_CODE.freeMon;

  return {
    packageCode,
    packageName,
    cycleStartTime,
    cycleEndTime,
    deductionEndTime,
    expiredTime,
    total,
    remain,
    used,
    usedPercent,
    remainPercent,
    refreshAt,
    expireAt,
    isBasePackage,
  };
}

// ── 官方配额模型 ─────────────────────────────────────────────────────────────────

export function getCodebuddyOfficialQuotaModel(account: CodebuddyAccount): {
  resources: OfficialQuotaResource[];
  extra: OfficialQuotaResource;
  updatedAt: number | null;
} {
  const lastUsed = account.last_used;
  const updatedAt =
    typeof lastUsed === 'number' && Number.isFinite(lastUsed) && lastUsed > 0
      ? Math.trunc(lastUsed * 1000)
      : null;

  const empty: OfficialQuotaResource = {
    packageCode: PACKAGE_CODE.extra,
    packageName: null,
    cycleStartTime: null,
    cycleEndTime: null,
    deductionEndTime: null,
    expiredTime: null,
    total: 0,
    remain: 0,
    used: 0,
    usedPercent: 0,
    remainPercent: null,
    refreshAt: null,
    expireAt: null,
    isBasePackage: false,
  };

  const all = extractResourceAccounts(account).filter(isActiveResource);
  if (all.length === 0) {
    return { resources: [], extra: empty, updatedAt };
  }

  const pro = all.filter(isProPackage);
  const extras = all.filter(isExtraPackage);
  const trialOrFreeMon = all.filter(isTrialOrFreeMonPackage);
  const free = all.filter((a) => {
    const code = typeof a.PackageCode === 'string' ? a.PackageCode : '';
    return code === PACKAGE_CODE.free;
  });
  const activity = all.filter((a) => {
    const code = typeof a.PackageCode === 'string' ? a.PackageCode : '';
    return code === PACKAGE_CODE.activity;
  });

  const mergedTrialOrFreeMon = aggregateCycleResources(trialOrFreeMon);
  const mergedFree = aggregateCycleResources(free);
  const ordered = [mergedTrialOrFreeMon, ...pro, ...activity, mergedFree].filter(
    (item): item is Record<string, unknown> => item != null && !!item.PackageCode,
  );
  const resources = ordered.map(toOfficialQuotaResource);

  const mergedExtra = aggregateCycleResources(extras);
  const extra = mergedExtra ? toOfficialQuotaResource(mergedExtra) : empty;
  return { resources, extra, updatedAt };
}

// ── 套餐徽章 ─────────────────────────────────────────────────────────────────────

export function getCodebuddyPlanBadge(planType: string): string {
  const pt = planType.toLowerCase();
  if (pt.includes('enterprise')) return 'ENTERPRISE';
  if (pt.includes('trial')) return 'TRIAL';
  if (pt.includes('pro')) return 'PRO';
  if (pt.includes('free')) return 'FREE';
  if (pt) return planType.toUpperCase();
  return 'UNKNOWN';
}

// ── 配额分组（主入口）────────────────────────────────────────────────────────────

export function getCodebuddyUsage(account: CodebuddyAccount): QuotaCategoryGroup[] {
  const model = getCodebuddyOfficialQuotaModel(account);

  // 按类型分组
  const baseItems: OfficialQuotaResource[] = [];
  const activityItems: OfficialQuotaResource[] = [];
  const extraItems: OfficialQuotaResource[] = [];
  const otherItems: OfficialQuotaResource[] = [];

  for (const resource of model.resources) {
    const code = resource.packageCode;
    if (
      code === PACKAGE_CODE.free ||
      code === PACKAGE_CODE.gift ||
      code === PACKAGE_CODE.freeMon ||
      code === PACKAGE_CODE.proMon ||
      code === PACKAGE_CODE.proYear
    ) {
      baseItems.push(resource);
    } else if (code === PACKAGE_CODE.activity) {
      activityItems.push(resource);
    } else {
      otherItems.push(resource);
    }
  }

  if (model.extra.total > 0 || model.extra.remain > 0 || model.extra.used > 0) {
    extraItems.push(model.extra);
  }

  const aggregate = (
    items: OfficialQuotaResource[],
  ): Omit<QuotaCategoryGroup, 'key' | 'label' | 'items' | 'visible'> => {
    const total = items.reduce((sum, r) => sum + r.total, 0);
    const remain = items.reduce((sum, r) => sum + r.remain, 0);
    const used = items.reduce((sum, r) => sum + r.used, 0);
    const usedPercent = total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : 0;
    const remainPercent = total > 0 ? Math.max(0, Math.min(100, (remain / total) * 100)) : null;
    const quotaClass =
      remainPercent != null
        ? remainPercent <= 10
          ? 'critical'
          : remainPercent <= 30
          ? 'low'
          : remainPercent <= 60
          ? 'medium'
          : 'high'
        : 'high';
    return { total, remain, used, usedPercent, remainPercent, quotaClass };
  };

  const baseAgg = aggregate(baseItems);
  const activityAgg = aggregate(activityItems);
  const extraAgg = aggregate(extraItems);
  const otherAgg = aggregate(otherItems);

  return [
    { key: 'base', label: '基础体验包', ...baseAgg, items: baseItems, visible: baseAgg.total > 0 },
    { key: 'activity', label: '活动赠送包', ...activityAgg, items: activityItems, visible: activityAgg.total > 0 },
    { key: 'extra', label: '加量包', ...extraAgg, items: extraItems, visible: extraAgg.total > 0 },
    { key: 'other', label: '其他', ...otherAgg, items: otherItems, visible: otherAgg.total > 0 },
  ];
}
