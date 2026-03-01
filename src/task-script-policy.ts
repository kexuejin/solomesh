export type ScriptTaskPatch = {
  execution_type?: 'agent' | 'script';
  script_command?: string | null;
};

export function isScriptTaskAdminOnlyMutation(
  existingExecutionType: 'agent' | 'script' | undefined,
  patch: ScriptTaskPatch,
): boolean {
  return (
    existingExecutionType === 'script'
    || patch.execution_type === 'script'
    || patch.script_command !== undefined
  );
}
