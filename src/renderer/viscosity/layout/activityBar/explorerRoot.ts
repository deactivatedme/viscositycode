/**
 * ViscosityCode: which project root the left-sidebar Explorer shows.
 */
import { isHomeProject } from "@/shared/homeScope";
import { selectFocusedThreadId, useCurrentProjectId } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { type FileEditorRootContext, useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { getThreadMap } from "@/renderer/state/useThread";
import { buildFileEditorContext, resolveWorktreeBranch } from "@/renderer/utils/gitHelpers";
import { resolveFilesRootContext } from "@/renderer/views/MainView/parts/RightPanel/parts/resolveFilesRootContext";

export interface ExplorerScopeRef {
  projectId: string;
  worktreePath?: string | undefined;
}

export type ExplorerScopeSource = "files-panel" | "thread" | "editor" | "workspace";

export interface ExplorerScope {
  source: ExplorerScopeSource;
  projectId: string;
  worktreePath?: string;
}

/**
 * Priority, highest first:
 * 1. the right panel's Files tab root: the project tree store and loader are
 *    window singletons, so two visible trees on different roots would fight;
 * 2. the focused thread / draft (Cursor's "open folder");
 * 3. the file editor's current root;
 * 4. the first project of the active workspace.
 */
export function resolveExplorerScope(input: {
  filesPanel: ExplorerScopeRef | null;
  focused: ExplorerScopeRef | null;
  editorRoot: ExplorerScopeRef | null;
  fallbackProjectId: string | undefined;
}): ExplorerScope | null {
  const pick = (source: ExplorerScopeSource, ref: ExplorerScopeRef): ExplorerScope => ({
    source,
    projectId: ref.projectId,
    ...(ref.worktreePath ? { worktreePath: ref.worktreePath } : {}),
  });
  if (input.filesPanel) return pick("files-panel", input.filesPanel);
  if (input.focused) return pick("thread", input.focused);
  if (input.editorRoot) return pick("editor", input.editorRoot);
  if (input.fallbackProjectId) return pick("workspace", { projectId: input.fallbackProjectId });
  return null;
}

function useFocusedWorktreePath(): string | undefined {
  return useAppStore((state) => {
    const threadId = selectFocusedThreadId(state);
    return threadId ? getThreadMap(state.threads).get(threadId)?.worktreePath : undefined;
  });
}

/** The root context for the Explorer view, or null when there is no project. */
export function useExplorerRootContext(): FileEditorRootContext | null {
  const filesPanelContext = usePanelStore((state) => state.filesPanelContext);
  const focusedProjectId = useCurrentProjectId();
  const focusedWorktreePath = useFocusedWorktreePath();
  const editorRoot = useFileEditorStore((state) => state.rootContext);
  const projects = useAppStore((state) => state.projects);
  const fallbackProjectId = projects.find((project) => !isHomeProject(project))?.id;

  const scope = resolveExplorerScope({
    filesPanel: filesPanelContext,
    focused: focusedProjectId
      ? { projectId: focusedProjectId, worktreePath: focusedWorktreePath }
      : null,
    editorRoot,
    fallbackProjectId,
  });
  if (!scope) return null;
  if (scope.source === "files-panel") return resolveFilesRootContext(filesPanelContext, projects);
  if (scope.source === "editor") return editorRoot;
  const project = projects.find((candidate) => candidate.id === scope.projectId);
  if (!project) return null;
  return buildFileEditorContext(
    project,
    scope.worktreePath,
    scope.worktreePath ? resolveWorktreeBranch(project.id, scope.worktreePath) : undefined,
  );
}
