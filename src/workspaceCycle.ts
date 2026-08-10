export function cycleWorkspace(
  workspaceNames: string[],
  activeWorkspace: string,
  loadWorkspace: (name: string) => void,
  saveWorkspace?: (name: string) => void
): void {
  const workspaces = workspaceNames.filter(name => !/^mode:/i.test(name)).sort();
  if (workspaces.length === 0) return;

  if (saveWorkspace && activeWorkspace) saveWorkspace(activeWorkspace);

  const activeIndex = workspaces.indexOf(activeWorkspace);
  const nextWorkspace = workspaces[(activeIndex + 1) % workspaces.length];
  if (nextWorkspace !== activeWorkspace) loadWorkspace(nextWorkspace);
}
