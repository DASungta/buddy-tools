/**
 * CodeBuddy 多实例管理类型定义
 */

export type InstanceLaunchMode = 'app' | 'cli';

export interface CodebuddyInstance {
  id: string;
  name: string;
  user_data_dir: string;
  working_dir?: string | null;
  extra_args: string;
  bind_account_id?: string | null;
  launch_mode: InstanceLaunchMode;
  created_at: number;
  last_launched_at?: number | null;
  last_pid?: number | null;
  running: boolean;
  initialized: boolean;
  is_default: boolean;
  follow_local_account: boolean;
}

export interface InstanceDefaults {
  root_dir: string;
  default_user_data_dir: string;
}

export interface DefaultInstanceSettings {
  bind_account_id?: string | null;
  extra_args: string;
  working_dir?: string | null;
  launch_mode: InstanceLaunchMode;
  follow_local_account: boolean;
  last_pid?: number | null;
}

export interface CreateInstanceParams {
  name: string;
  user_data_dir: string;
  working_dir?: string | null;
  extra_args: string;
  bind_account_id?: string | null;
  copy_source_instance_id?: string | null;
  init_mode?: 'copy' | 'empty' | 'existingdir' | null;
}

export interface UpdateInstanceParams {
  instance_id: string;
  name?: string | null;
  working_dir?: string | null;
  extra_args?: string | null;
  bind_account_id?: string | null | undefined;
}
