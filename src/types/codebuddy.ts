/**
 * CodeBuddy 多账号管理类型定义
 */

// ── 套餐代码常量 ────────────────────────────────────────────────────────────────
export const PACKAGE_CODE = {
  free: 'TCACA_code_001_PqouKr6QWV',
  proMon: 'TCACA_code_002_AkiJS3ZHF5',
  proYear: 'TCACA_code_003_FAnt7lcmRT',
  gift: 'TCACA_code_006_DbXS0lrypC',
  activity: 'TCACA_code_007_nzdH5h4Nl0',
  freeMon: 'TCACA_code_008_cfWoLwvjU4',
  extra: 'TCACA_code_009_0XmEQc2xOf',
} as const;

export const RESOURCE_STATUS = {
  valid: 0,
  refund: 1,
  expired: 2,
  usedUp: 3,
} as const;

export const ENTERPRISE_ACCOUNT_TYPES = ['ultimate', 'exclusive', 'premise'];

// ── 核心账号类型 ─────────────────────────────────────────────────────────────────
export interface CodebuddyAccount {
  id: string;
  email: string;
  uid?: string | null;
  nickname?: string | null;
  enterprise_id?: string | null;
  enterprise_name?: string | null;
  tags?: string[] | null;

  access_token: string;
  refresh_token?: string | null;
  token_type?: string | null;
  expires_at?: number | null;
  domain?: string | null;

  plan_type?: string;
  dosage_notify_code?: string;
  dosage_notify_zh?: string;
  dosage_notify_en?: string;
  payment_type?: string;

  quota_raw?: unknown;
  auth_raw?: unknown;
  profile_raw?: unknown;
  usage_raw?: unknown;

  status?: string | null;
  status_reason?: string | null;
  quota_query_last_error?: string | null;
  quota_query_last_error_at?: number | null;

  created_at: number;
  last_used: number;
}

// ── 账号摘要（列表展示用）────────────────────────────────────────────────────────
export interface CodebuddyAccountSummary {
  id: string;
  email: string;
  uid?: string | null;
  nickname?: string | null;
  tags?: string[] | null;
  plan_type?: string;
  status?: string | null;
  payment_type?: string | null;
  quota_raw?: unknown;
  usage_raw?: unknown;
  usage_updated_at?: number | null;
  created_at: number;
  last_used: number;
  /** 积分余额（可选，由后端计算后附加） */
  credits_balance?: number | null;
}

// ── 新增账号 DTO（add-by-token，对应后端 CodebuddyOAuthCompletePayload）──────────
export interface CodebuddyAccountPayload {
  access_token: string;
  refresh_token: string;
  /** 后端可能需要的用户标识 */
  uid?: string;
  email?: string;
}

// ── 配额相关类型 ─────────────────────────────────────────────────────────────────
export interface OfficialQuotaResource {
  packageCode: string | null;
  packageName: string | null;
  cycleStartTime: string | null;
  cycleEndTime: string | null;
  deductionEndTime: number | null;
  expiredTime: string | null;
  total: number;
  remain: number;
  used: number;
  usedPercent: number;
  remainPercent: number | null;
  refreshAt: number | null;
  expireAt: number | null;
  isBasePackage: boolean;
}

export type QuotaCategory = 'base' | 'activity' | 'extra' | 'other';

export interface QuotaCategoryGroup {
  key: QuotaCategory;
  label: string;
  used: number;
  total: number;
  remain: number;
  usedPercent: number;
  remainPercent: number | null;
  quotaClass: string;
  items: OfficialQuotaResource[];
  visible: boolean;
}

export interface QuotaItem {
  key: string;
  label: string;
  used: number;
  total: number;
  remain: number;
  usedPercent: number;
  remainPercent: number | null;
  quotaClass: string;
  refreshAt: number | null;
}
