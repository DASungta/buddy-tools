export interface CodebuddyCnAccount {
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
  usage_updated_at?: number | null;

  status?: string | null;
  status_reason?: string | null;
  quota_query_last_error?: string | null;
  quota_query_last_error_at?: number | null;

  last_checkin_time?: number | null;
  checkin_streak?: number;
  checkin_rewards?: unknown | null;

  created_at: number;
  last_used: number;
}

export interface CheckinStatusResponse {
  today_checked_in: boolean;
  active: boolean;
  streak_days: number;
  daily_credit: number;
  today_credit?: number | null;
  next_streak_day?: number | null;
  is_streak_day?: boolean | null;
  checkin_dates?: string[] | null;
}

export interface CheckinResponse {
  success: boolean;
  message?: string | null;
  reward?: unknown | null;
  next_checkin_in?: number | null;
}
