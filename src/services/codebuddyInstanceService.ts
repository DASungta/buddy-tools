/**
 * CodeBuddy 多实例服务层
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  CodebuddyInstance,
  CreateInstanceParams,
  DefaultInstanceSettings,
  InstanceDefaults,
  UpdateInstanceParams,
} from '../types/codebuddyInstance';

export async function listCodebuddyInstances(): Promise<CodebuddyInstance[]> {
  return invoke<CodebuddyInstance[]>('list_codebuddy_instances');
}

export async function getCodebuddyInstanceDefaults(): Promise<InstanceDefaults> {
  return invoke<InstanceDefaults>('get_codebuddy_instance_defaults');
}

export async function getCodebuddyDefaultSettings(): Promise<DefaultInstanceSettings> {
  return invoke<DefaultInstanceSettings>('get_codebuddy_default_settings');
}

export async function createCodebuddyInstance(
  params: CreateInstanceParams,
): Promise<CodebuddyInstance> {
  return invoke<CodebuddyInstance>('create_codebuddy_instance', params as unknown as Record<string, unknown>);
}

export async function updateCodebuddyInstance(
  params: UpdateInstanceParams,
): Promise<CodebuddyInstance> {
  return invoke<CodebuddyInstance>('update_codebuddy_instance', params as unknown as Record<string, unknown>);
}

export async function deleteCodebuddyInstance(instanceId: string): Promise<void> {
  return invoke<void>('delete_codebuddy_instance', { instance_id: instanceId });
}

export async function startCodebuddyInstance(instanceId: string): Promise<number> {
  return invoke<number>('start_codebuddy_instance', { instance_id: instanceId });
}

export async function focusCodebuddyInstance(instanceId: string): Promise<number> {
  return invoke<number>('focus_codebuddy_instance', { instance_id: instanceId });
}

export async function stopCodebuddyInstance(instanceId: string): Promise<void> {
  return invoke<void>('stop_codebuddy_instance', { instance_id: instanceId });
}

export async function getCodebuddyInstancePid(instanceId: string): Promise<number> {
  return invoke<number>('get_codebuddy_instance_pid', { instance_id: instanceId });
}

export async function injectTokenForCodebuddyInstance(instanceId: string): Promise<void> {
  return invoke<void>('inject_token_for_codebuddy_instance', { instance_id: instanceId });
}
