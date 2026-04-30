/**
 * CodeBuddy 配额工具函数
 *
 * 将 quota_raw / usage_raw / auth_raw JSON blob 解析为 UI 可渲染的分组结构。
 */

import type { CodebuddyAccount, OfficialQuotaResource, QuotaCategory, QuotaCategoryGroup } from '../types/codebuddy';
import { PACKAGE_CODE, RESOURCE_STATUS } from '../types/codebuddy';

export type CodebuddyQuotaSyncState =
  | 'available'
  | 'token_expired'
  | 'model_list_not_refreshed'
  | 'quota_missing'
  | 'refresh_failed';

export interface CodebuddyQuotaStateMeta {
  quotaKnown: boolean;
  syncState: CodebuddyQuotaSyncState;
  stateReason: string | null;
  updatedAt: number | null;
}

export type CodebuddyQuotaResource = OfficialQuotaResource & {
  quotaKnown?: boolean;
  resourcePresent?: boolean;
};

export type CodebuddyQuotaCategoryGroup = QuotaCategoryGroup & CodebuddyQuotaStateMeta & {
  items: CodebuddyQuotaResource[];
};

const QUOTA_KNOWN_FIELD = '__quotaKnown';

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

function toEpochMillis(value: unknown): number | null {
  const numeric = parseNumeric(value);
  if (numeric == null || numeric <= 0) return null;
  return Math.trunc(numeric > 1_000_000_000_000 ? numeric : numeric * 1000);
}

function parseDateTimeToEpoch(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const isoText = text.includes('T') ? text : text.replace(' ', 'T');
  const parsed = Date.parse(isoText);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCycleTotal(a: Record<string, unknown>): number | null {
  return (
    parseNumeric(a.CycleCapacitySizePrecise) ??
    parseNumeric(a.CycleCapacitySize) ??
    parseNumeric(a.CapacitySizePrecise) ??
    parseNumeric(a.CapacitySize)
  );
}

function parseCycleRemain(a: Record<string, unknown>): number | null {
  return (
    parseNumeric(a.CycleCapacityRemainPrecise) ??
    parseNumeric(a.CycleCapacityRemain) ??
    parseNumeric(a.CapacityRemainPrecise) ??
    parseNumeric(a.CapacityRemain)
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
  const quotaRoot = asRecord(account.quota_raw);
  const usageRoot = asRecord(account.usage_raw);
  const candidates = [
    asRecord(quotaRoot?.userResource),
    quotaRoot,
    asRecord(usageRoot?.userResource),
    asRecord(usageRoot?.profileUsage),
    usageRoot,
  ];

  for (const candidate of candidates) {
    const data = asRecord(candidate?.data);
    const response = asRecord(data?.Response);
    const payload = asRecord(response?.Data);
    if (Array.isArray(payload?.Accounts)) {
      return payload.Accounts.filter((a): a is Record<string, unknown> => a != null && typeof a === 'object');
    }
  }

  return [];
}

function containsCachedModels(value: unknown, depth = 0): boolean {
  if (depth > 5) return false;
  const record = asRecord(value);
  if (!record) return false;

  const models = record.models ?? record.Models;
  if (Array.isArray(models) && models.length > 0) {
    return true;
  }

  return ['raw', 'userResource', 'profileUsage', 'data', 'Response', 'Data'].some((key) =>
    containsCachedModels(record[key], depth + 1),
  );
}

function accountHasCachedModels(account: CodebuddyAccount): boolean {
  return containsCachedModels(account.quota_raw) || containsCachedModels(account.usage_raw);
}

function aggregateCycleResources(list: Array<Record<string, unknown>>): Record<string, unknown> | null {
  if (list.length === 0) return null;
  const first = list[0];
  const totals = list.reduce(
    (acc: { total: number; remain: number; totalKnown: boolean; remainKnown: boolean }, item) => {
      const total = parseCycleTotal(item);
      const remain = parseCycleRemain(item);
      if (total == null) {
        acc.totalKnown = false;
      } else {
        acc.total += total;
      }
      if (remain == null) {
        acc.remainKnown = false;
      } else {
        acc.remain += remain;
      }
      return acc;
    },
    { total: 0, remain: 0, totalKnown: true, remainKnown: true },
  );

  return {
    ...first,
    ...(totals.totalKnown ? { CycleCapacitySizePrecise: String(totals.total) } : {}),
    ...(totals.remainKnown ? { CycleCapacityRemainPrecise: String(totals.remain) } : {}),
    [QUOTA_KNOWN_FIELD]: totals.totalKnown && totals.remainKnown,
  };
}

function toOfficialQuotaResource(raw: Record<string, unknown>): CodebuddyQuotaResource {
  const packageCode = typeof raw.PackageCode === 'string' ? raw.PackageCode : null;
  const packageName = typeof raw.PackageName === 'string' ? raw.PackageName : null;
  const cycleStartTime = typeof raw.CycleStartTime === 'string' ? raw.CycleStartTime : null;
  const cycleEndTime = typeof raw.CycleEndTime === 'string' ? raw.CycleEndTime : null;
  const deductionEndTime = parseNumeric(raw.DeductionEndTime);
  const expiredTime = typeof raw.ExpiredTime === 'string' ? raw.ExpiredTime : null;

  const totalValue = parseCycleTotal(raw);
  const remainValue = parseCycleRemain(raw);
  const rawQuotaKnown = typeof raw[QUOTA_KNOWN_FIELD] === 'boolean' ? raw[QUOTA_KNOWN_FIELD] === true : null;
  const quotaKnown = rawQuotaKnown ?? (totalValue != null && remainValue != null);
  const total = totalValue ?? 0;
  const remain = remainValue ?? 0;
  const used = quotaKnown ? Math.max(0, total - remain) : 0;
  const usedPercent = quotaKnown && total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : 0;
  const remainPercent = quotaKnown && total > 0 ? Math.max(0, Math.min(100, (remain / total) * 100)) : null;

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
    quotaKnown,
    resourcePresent: true,
  };
}

function isQuotaResourceKnown(resource: OfficialQuotaResource): boolean {
  return (resource as CodebuddyQuotaResource).quotaKnown === true;
}

function isQuotaResourcePresent(resource: OfficialQuotaResource): boolean {
  return (resource as CodebuddyQuotaResource).resourcePresent === true;
}

function isTokenExpired(account: CodebuddyAccount): boolean {
  const expiresAt = toEpochMillis(account.expires_at);
  if (expiresAt != null && expiresAt <= Date.now()) {
    return true;
  }

  const statusText = `${account.status ?? ''} ${account.status_reason ?? ''}`.toLowerCase();
  return /(?:token[_\s-]?)?expired|unauthorized|invalid[_\s-]?token/.test(statusText);
}

function getQuotaSyncState(
  account: CodebuddyAccount,
  resources: CodebuddyQuotaResource[],
  extra: CodebuddyQuotaResource,
): Pick<CodebuddyQuotaStateMeta, 'syncState' | 'stateReason'> {
  const quotaError = typeof account.quota_query_last_error === 'string' ? account.quota_query_last_error.trim() : '';
  const statusReason = typeof account.status_reason === 'string' ? account.status_reason.trim() : '';
  const hasRawPayload = account.quota_raw != null || account.usage_raw != null;
  const hasCachedModels = accountHasCachedModels(account);
  const hasResource = resources.length > 0 || isQuotaResourcePresent(extra);
  const hasKnownQuota = resources.some(isQuotaResourceKnown) || isQuotaResourceKnown(extra);

  if (isTokenExpired(account)) {
    return { syncState: 'token_expired', stateReason: statusReason || null };
  }
  if (quotaError) {
    return { syncState: 'refresh_failed', stateReason: quotaError };
  }
  if ((!hasRawPayload && !hasCachedModels) || (!hasCachedModels && !hasResource)) {
    return { syncState: 'model_list_not_refreshed', stateReason: null };
  }
  if (!hasKnownQuota) {
    return { syncState: 'quota_missing', stateReason: null };
  }
  return { syncState: 'available', stateReason: null };
}

// ── 官方配额模型 ─────────────────────────────────────────────────────────────────

export function hasCodebuddyQuotaData(account: CodebuddyAccount): boolean {
  const { resources, extra } = getCodebuddyOfficialQuotaModel(account);
  return resources.some(isQuotaResourceKnown) || isQuotaResourceKnown(extra);
}

export function getCodebuddyOfficialQuotaModel(account: CodebuddyAccount): {
  resources: CodebuddyQuotaResource[];
  extra: CodebuddyQuotaResource;
  updatedAt: number | null;
} {
  const updatedAt =
    toEpochMillis((account as { usage_updated_at?: unknown }).usage_updated_at) ??
    toEpochMillis(account.last_used);

  const empty: CodebuddyQuotaResource = {
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
    quotaKnown: false,
    resourcePresent: false,
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

interface QuotaAggregate {
  total: number;
  remain: number;
  used: number;
  usedPercent: number;
  remainPercent: number | null;
  quotaClass: string;
  quotaKnown: boolean;
}

function aggregateQuotaItems(items: CodebuddyQuotaResource[]): QuotaAggregate {
  const quotaKnown = items.length > 0 && items.every(isQuotaResourceKnown);
  const total = items.reduce((sum, r) => sum + r.total, 0);
  const remain = items.reduce((sum, r) => sum + r.remain, 0);
  const used = quotaKnown ? items.reduce((sum, r) => sum + r.used, 0) : 0;
  const usedPercent = quotaKnown && total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : 0;
  const remainPercent = quotaKnown && total > 0 ? Math.max(0, Math.min(100, (remain / total) * 100)) : null;
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
  return { total, remain, used, usedPercent, remainPercent, quotaClass, quotaKnown };
}

function buildQuotaGroup(
  key: QuotaCategory,
  label: string,
  aggregate: QuotaAggregate,
  items: CodebuddyQuotaResource[],
  meta: CodebuddyQuotaStateMeta,
): CodebuddyQuotaCategoryGroup {
  return {
    key,
    label,
    ...aggregate,
    items,
    visible: items.length > 0,
    syncState: meta.syncState,
    stateReason: meta.stateReason,
    updatedAt: meta.updatedAt,
  };
}

export function getCodebuddyUsage(account: CodebuddyAccount): QuotaCategoryGroup[] {
  const model = getCodebuddyOfficialQuotaModel(account);

  const baseItems: CodebuddyQuotaResource[] = [];
  const activityItems: CodebuddyQuotaResource[] = [];
  const extraItems: CodebuddyQuotaResource[] = [];
  const otherItems: CodebuddyQuotaResource[] = [];

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

  if (isQuotaResourcePresent(model.extra)) {
    extraItems.push(model.extra);
  }

  const baseAgg = aggregateQuotaItems(baseItems);
  const activityAgg = aggregateQuotaItems(activityItems);
  const extraAgg = aggregateQuotaItems(extraItems);
  const otherAgg = aggregateQuotaItems(otherItems);
  const state = getQuotaSyncState(account, model.resources, model.extra);
  const meta: CodebuddyQuotaStateMeta = {
    quotaKnown: model.resources.some(isQuotaResourceKnown) || isQuotaResourceKnown(model.extra),
    syncState: state.syncState,
    stateReason: state.stateReason,
    updatedAt: model.updatedAt,
  };

  const groups: CodebuddyQuotaCategoryGroup[] = [
    buildQuotaGroup('base', '基础体验包', baseAgg, baseItems, meta),
    buildQuotaGroup('activity', '活动赠送包', activityAgg, activityItems, meta),
    buildQuotaGroup('extra', '加量包', extraAgg, extraItems, meta),
    buildQuotaGroup('other', '其他', otherAgg, otherItems, meta),
  ];

  return groups;
}
