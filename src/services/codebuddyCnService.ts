import { request as invoke } from '../utils/request';
import type {
  CodebuddyCnAccount,
  CheckinStatusResponse,
  CheckinResponse,
} from '../types/codebuddyCn';

export async function listCodebuddyCnAccounts(): Promise<CodebuddyCnAccount[]> {
  const response = await invoke<any>('list_codebuddy_cn_accounts');
  if (response && typeof response === 'object' && Array.isArray(response.accounts)) {
    return response.accounts;
  }
  return response || [];
}

export async function addCodebuddyCnAccountWithToken(
  accessToken: string,
): Promise<CodebuddyCnAccount> {
  return await invoke('add_codebuddy_cn_account_with_token', { accessToken });
}

export async function deleteCodebuddyCnAccount(accountId: string): Promise<void> {
  return await invoke('delete_codebuddy_cn_account', { accountId });
}

export async function deleteCodebuddyCnAccounts(accountIds: string[]): Promise<void> {
  return await invoke('delete_codebuddy_cn_accounts', { accountIds });
}

export async function refreshCodebuddyCnToken(accountId: string): Promise<CodebuddyCnAccount> {
  return await invoke('refresh_codebuddy_cn_token', { accountId });
}

export async function refreshAllCodebuddyCnTokens(): Promise<void> {
  return await invoke('refresh_all_codebuddy_cn_tokens');
}

export async function updateCodebuddyCnAccountTags(
  accountId: string,
  tags: string[],
): Promise<CodebuddyCnAccount> {
  return await invoke('update_codebuddy_cn_account_tags', { accountId, tags });
}

export async function getCodebuddyCnAccountsIndexPath(): Promise<string> {
  return await invoke('get_codebuddy_cn_accounts_index_path');
}

export async function importCodebuddyCnFromJson(
  jsonContent: string,
): Promise<CodebuddyCnAccount[]> {
  return await invoke('import_codebuddy_cn_from_json', { jsonContent });
}

export async function exportCodebuddyCnAccounts(accountIds: string[]): Promise<string> {
  return await invoke('export_codebuddy_cn_accounts', { accountIds });
}

export async function setCurrentCodebuddyCnAccount(id: string): Promise<void> {
  return await invoke('set_current_codebuddy_cn_account', { id });
}

export interface OAuthStartResponse {
  login_id: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval_seconds: number;
}

export async function startCodebuddyCnOAuthLogin(): Promise<OAuthStartResponse> {
  return await invoke('start_codebuddy_cn_oauth_login');
}

export async function completeCodebuddyCnOAuthLogin(
  loginId: string,
): Promise<CodebuddyCnAccount> {
  return await invoke('complete_codebuddy_cn_oauth_login', { loginId });
}

export async function cancelCodebuddyCnOAuthLogin(loginId?: string): Promise<void> {
  return await invoke('cancel_codebuddy_cn_oauth_login', { loginId });
}

export async function getCheckinStatusCodebuddyCn(
  accountId: string,
): Promise<CheckinStatusResponse> {
  return await invoke('get_checkin_status_codebuddy_cn', { accountId });
}

export async function checkinCodebuddyCn(
  accountId: string,
): Promise<[CheckinStatusResponse, CheckinResponse | null]> {
  return await invoke('checkin_codebuddy_cn', { accountId });
}
