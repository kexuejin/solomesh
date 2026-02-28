export interface GroupInfo {
  name: string;
  folder: string;
  added_at: string;
  kind?: 'home' | 'main' | 'feishu' | 'telegram' | 'web';
  is_home?: boolean;
  is_my_home?: boolean;
  is_shared?: boolean;
  member_role?: 'owner' | 'member';
  member_count?: number;
  editable?: boolean;
  deletable?: boolean;
  lastMessage?: string;
  lastMessageTime?: string;
  execution_mode?: 'container' | 'host';
  custom_cwd?: string;
  created_by?: string;
  selected_skills?: string[] | null;
  effective_provider?: 'claude' | 'codex';
  workflow_status?: 'idle' | 'running' | 'paused' | 'completed' | 'cancelled';
  workflow_template_id?: string | null;
  workflow_stage_id?: string | null;
  workflow_stage_name?: string | null;
  workflow_stage_provider?: 'claude' | 'codex' | null;
  workflow_stage_default_provider?: 'claude' | 'codex' | null;
  workflow_stage_fallback_from_provider?: 'claude' | 'codex' | null;
  workflow_stage_index?: number | null;
  workflow_stage_total?: number | null;
  workflow_blocked_by?: string | null;
  workflow_blocked_reason?: string | null;
  im_binding_enabled?: boolean;
  im_binding_target_folder?: string | null;
  im_binding_updated_at?: string | null;
}

export interface AgentInfo {
  id: string;
  name: string;
  prompt: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  kind: 'task' | 'conversation';
  created_at: string;
  completed_at?: string;
  result_summary?: string;
}

export interface GroupMember {
  user_id: string;
  role: 'owner' | 'member';
  added_at: string;
  added_by?: string;
  username: string;
  display_name: string;
}
