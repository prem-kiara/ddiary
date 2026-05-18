import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, Briefcase } from 'lucide-react';
import {
  DndContext, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import MoveTaskConfirmModal from '../dnd/MoveTaskConfirmModal';
import ConvertWorkspaceModal from '../dnd/ConvertWorkspaceModal';
import { moveTaskAcrossWorkspaces, convertWorkspaceToCategory } from '../../utils/dndMutations';
import { useAuth } from '../../contexts/AuthContext';
import {
  useMyWorkspaces,
  addWorkspaceTask, createWorkspace,
} from '../../hooks/useWorkspace';
import { logError } from '../../utils/errorLogger';
import WorkspaceInvitePrompt from '../WorkspaceInvitePrompt';
import { notifyTaskAssigned } from '../../utils/emailNotifications';
import DeepLinkContext from '../../contexts/DeepLinkContext';
import WorkspaceItem from './WorkspaceItem';
import NewWorkspaceModal from './NewWorkspaceModal';
import { AddTaskModal } from './AddTaskModal';

// Re-export AddTaskModal as a named export for backward compatibility
// so existing imports like:
//   import KanbanBoard, { AddTaskModal } from './components/KanbanBoard'
// continue to work.
export { AddTaskModal };

// ── Main KanbanBoard ──────────────────────────────────────────────────────────
export default function KanbanBoard({ onWorkspaceCreated, showToast }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { workspaces: rawWorkspaces, loading: wsListLoading } = useMyWorkspaces();

  // ── Deep-link consumption ────────────────────────────────────────────────
  // The Dashboard navigates here with router state when a user clicks a task.
  // We expose the values via DeepLinkContext so nested components can react,
  // then clear the state after a short delay so back/forward + refresh don't
  // re-trigger.
  const deepLink = location.state || {};
  const deepLinkValue = useMemo(() => ({
    openWorkspaceId:   deepLink.openWorkspaceId   || null,
    openCategoryId:    deepLink.openCategoryId    || null,
    openSubcategoryId: deepLink.openSubcategoryId || null,
    openTaskId:        deepLink.openTaskId        || null,
  }), [deepLink.openWorkspaceId, deepLink.openCategoryId, deepLink.openSubcategoryId, deepLink.openTaskId]);

  useEffect(() => {
    if (deepLinkValue.openTaskId || deepLinkValue.openWorkspaceId) {
      // Children consume the state on mount (fast). 1500 ms gives slow loads
      // a chance and avoids the state surviving a refresh.
      const t = setTimeout(() => {
        navigate(location.pathname, { replace: true, state: null });
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [deepLinkValue.openTaskId, deepLinkValue.openWorkspaceId, navigate, location.pathname]);
  // Sort workspaces alphabetically by name (case-insensitive, locale-aware).
  // Using a stable shallow copy so we don't mutate the hook's array.
  const workspaces = [...(rawWorkspaces || [])].sort((a, b) =>
    (a?.name || '').localeCompare(b?.name || '', undefined, { sensitivity: 'base' })
  );
  const [showNewTask,      setShowNewTask]      = useState(false);
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);

  // ── DnD state ──────────────────────────────────────────────────────────────
  // PointerSensor (mouse/trackpad): 8 px movement threshold so a normal click
  //   on a TaskCard or workspace header doesn't accidentally start a drag.
  // TouchSensor (iPad/mobile): 250 ms long-press + 5 px tolerance so a finger
  //   scroll doesn't get hijacked into a drag. Standard mobile DnD pattern —
  //   user must press-and-hold to begin dragging.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 250, tolerance: 5 } }),
  );
  // moveTaskModal: { task, srcWorkspace, destWorkspace } | null
  const [moveTaskModal,  setMoveTaskModal]  = useState(null);
  // convertWsModal: { srcWorkspace, destWorkspace } | null
  const [convertWsModal, setConvertWsModal] = useState(null);

  const handleDragEnd = (evt) => {
    const a = evt.active?.data?.current;
    const o = evt.over?.data?.current;
    if (!a || !o || o.kind !== 'workspaceDropZone') return;

    if (a.kind === 'task') {
      // Same-workspace drop = no-op (we don't support reordering yet).
      if (a.srcWorkspaceId === o.workspaceId) return;
      setMoveTaskModal({
        task:          a.task,
        srcWorkspace:  a.srcWorkspace,
        destWorkspace: o.workspace,
      });
    } else if (a.kind === 'workspace') {
      // Can't drop a workspace on itself.
      if (a.workspace.id === o.workspaceId) return;
      setConvertWsModal({
        srcWorkspace:  a.workspace,
        destWorkspace: o.workspace,
      });
    }
  };

  if (wsListLoading) {
    return <div className="empty-state fade-in"><p>Loading workspaces…</p></div>;
  }

  // Handler for AddTaskModal when creating from the header or empty state.
  // Each async step is wrapped so a hang/denial bubbles up with a clear label.
  const handleTopLevelAdd = async (taskData, wsOptions) => {
    let wsId = wsOptions.targetWorkspaceId || workspaces[0]?.id || null;
    try {
      if (wsOptions.newWorkspaceName) {
        wsId = await createWorkspace(
          user.uid, user.email, user.displayName || user.email, wsOptions.newWorkspaceName,
          wsOptions.newWorkspaceCategory || null,
        );
        if (onWorkspaceCreated) {
          try { await onWorkspaceCreated(wsId); } catch { /* non-fatal */ }
        }
        if (showToast) showToast(`Workspace "${wsOptions.newWorkspaceName}" created!`, 'success');
      }
    } catch (e) {
      e.message = `Could not create workspace: ${e?.message || e}`;
      throw e;
    }
    if (wsId) {
      try {
        await addWorkspaceTask(wsId, taskData, {
          uid: user.uid, email: user.email, displayName: user.displayName || user.email,
        });
      } catch (e) {
        e.message = `Workspace created, but task add failed: ${e?.message || e}`;
        throw e;
      }
      if (taskData.assigneeEmail) {
        notifyTaskAssigned({
          assigneeEmail: taskData.assigneeEmail,
          assigneeName:  taskData.assigneeName,
          taskText:      taskData.text,
          notes:         taskData.notes || null,
          dueDate:       taskData.dueDate,
          priority:      taskData.priority,
          ownerName:     user.displayName || user.email,
          ownerUid:      user.uid,
        }).catch(() => {});
      }
    }
  };

  return (
    <DeepLinkContext.Provider value={deepLinkValue}>
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
    <div className="fade-in">
      {/* Page header */}
      <div className="page-head">
        <h2 className="section-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Briefcase size={20} color="#7c3aed" /> Team Board
        </h2>
        <div className="page-actions">
          <button
            className="btn btn-outline btn-sm"
            onClick={() => setShowNewWorkspace(true)}
            style={{ gap: 5 }}
            title="Create a new workspace"
          >
            <Briefcase size={14} /> <span className="hide-mobile">New </span>Workspace
          </button>
          <button className="btn btn-teal btn-sm" onClick={() => setShowNewTask(true)} style={{ gap: 5 }}>
            <Plus size={14} /> <span className="hide-mobile">New </span>Task
          </button>
        </div>
      </div>

      {/* New Task modal */}
      {showNewTask && (
        <AddTaskModal
          onClose={() => setShowNewTask(false)}
          onAdd={handleTopLevelAdd}
          members={[]}
          workspaces={workspaces}
          showToast={showToast}
        />
      )}

      {/* New Workspace modal */}
      {showNewWorkspace && (
        <NewWorkspaceModal
          onClose={() => setShowNewWorkspace(false)}
          onCreated={onWorkspaceCreated}
          showToast={showToast}
          user={user}
        />
      )}

      {/* Pending invite banners (auto-dismiss on accept/decline) */}
      <WorkspaceInvitePrompt showToast={showToast} />

      {/* Empty state when no workspaces */}
      {!workspaces.length && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 24px', textAlign: 'center' }}>
          <Briefcase size={40} color="#7c3aed" style={{ opacity: 0.5 }} />
          <p style={{ marginTop: 12, color: '#475569', fontSize: 15, fontWeight: 600 }}>No team board yet</p>
          <p style={{ fontSize: 13, color: '#94a3b8', maxWidth: 340, lineHeight: 1.6, marginTop: 6 }}>
            Click <strong>New Task</strong> above to create your first task and workspace.
          </p>
        </div>
      )}

      {/* Collapsible workspace list */}
      {workspaces.map((ws, i) => (
        <WorkspaceItem
          key={ws.id}
          workspace={ws}
          showToast={showToast}
          user={user}
          workspaces={workspaces}
          onWorkspaceCreated={onWorkspaceCreated}
          isFirst={i === 0}
        />
      ))}

      {/* ── DnD modals ──────────────────────────────────────────────────────── */}
      {moveTaskModal && (
        <MoveTaskConfirmModal
          task={moveTaskModal.task}
          srcWorkspace={moveTaskModal.srcWorkspace}
          destWorkspace={moveTaskModal.destWorkspace}
          onCancel={() => setMoveTaskModal(null)}
          onConfirm={async ({ destCategoryId, destSubcategoryId }) => {
            try {
              await moveTaskAcrossWorkspaces({
                srcWorkspaceId:    moveTaskModal.srcWorkspace?.id || moveTaskModal.task?._srcWorkspaceId,
                taskId:            moveTaskModal.task.id,
                task:              moveTaskModal.task,
                destWorkspaceId:   moveTaskModal.destWorkspace.id,
                destCategoryId,
                destSubcategoryId,
                actor: { uid: user.uid, email: user.email, displayName: user.displayName || user.email },
              });
              if (showToast) showToast(`Task moved to "${moveTaskModal.destWorkspace.name}"`, 'success');
              setMoveTaskModal(null);
            } catch (e) {
              logError(e, { location: 'KanbanBoard:moveTaskAcrossWorkspaces' }, user.uid);
              throw e; // surfaced in the modal
            }
          }}
        />
      )}
      {convertWsModal && (
        <ConvertWorkspaceModal
          srcWorkspace={convertWsModal.srcWorkspace}
          destWorkspace={convertWsModal.destWorkspace}
          onCancel={() => setConvertWsModal(null)}
          onConfirm={async ({ bucketName, asSubcategory, parentCategoryId }) => {
            try {
              const result = await convertWorkspaceToCategory({
                srcWorkspace:    convertWsModal.srcWorkspace,
                destWorkspaceId: convertWsModal.destWorkspace.id,
                asSubcategory,
                parentCategoryId,
                bucketName,
                actor: { uid: user.uid, email: user.email, displayName: user.displayName || user.email },
              });
              if (showToast) {
                const where = asSubcategory ? 'sub-category' : 'category';
                const taskBit = result.taskCount
                  ? ` with ${result.taskCount} task${result.taskCount === 1 ? '' : 's'}`
                  : '';
                showToast(`Created "${bucketName}" ${where} in ${convertWsModal.destWorkspace.name}${taskBit}`, 'success');
              }
              setConvertWsModal(null);
            } catch (e) {
              logError(e, { location: 'KanbanBoard:convertWorkspaceToCategory' }, user.uid);
              throw e; // surfaced in the modal
            }
          }}
        />
      )}
    </div>
    </DndContext>
    </DeepLinkContext.Provider>
  );
}
