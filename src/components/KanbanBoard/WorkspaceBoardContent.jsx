import { useState, useEffect } from 'react';
import { useConfirm } from '../../contexts/ConfirmContext';
import {
  useWorkspace, useWorkspaceTasks,
  addWorkspaceTask, deleteWorkspaceTask, createWorkspace,
} from '../../hooks/useWorkspace';
import { logError } from '../../utils/errorLogger';
import { notifyTaskAssigned } from '../../utils/emailNotifications';
import CategoryBoard from './CategoryBoard';
import { AddTaskModal } from './AddTaskModal';

// ── WorkspaceBoardContent ─────────────────────────────────────────────────────
// The actual kanban board — rendered only when a workspace is expanded.
function WorkspaceBoardContent({ workspaceId, members, showToast, user, workspaces, onWorkspaceCreated, showAddTaskInitial, onAddTaskClose, showAddCategoryInitial, onAddCategoryClose, isAdmin, highlightTaskId, onHighlightTaskConsumed }) {
  const confirm = useConfirm();
  const { workspace } = useWorkspace(workspaceId);
  const { tasks, loading: tasksLoading, error } = useWorkspaceTasks(workspaceId);
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [filterStatus,   setFilterStatus]   = useState('all');
  const [showAddTask, setShowAddTask]       = useState(showAddTaskInitial || false);
  // When "+ Add task" is clicked inside a category/subcategory, remember where
  // so AddTaskModal can pre-fill categoryId/subcategoryId.
  const [addTaskContext, setAddTaskContext] = useState({ categoryId: null, subcategoryId: null });

  // Sync with parent-triggered add (e.g. WorkspaceItem header "Task" button)
  useEffect(() => {
    if (showAddTaskInitial) {
      setAddTaskContext({ categoryId: null, subcategoryId: null });
      setShowAddTask(true);
    }
  }, [showAddTaskInitial]);

  const handleAddTask = async (taskData, wsOptions = {}) => {
    let targetWsId = workspaceId;
    try {
      if (wsOptions.newWorkspaceName) {
        let newId;
        try {
          newId = await createWorkspace(
            user.uid, user.email, user.displayName || user.email, wsOptions.newWorkspaceName,
            wsOptions.newWorkspaceCategory || null,
          );
        } catch (err) {
          err.message = `Could not create workspace: ${err?.message || err}`;
          throw err;
        }
        if (onWorkspaceCreated) {
          try { await onWorkspaceCreated(newId); } catch { /* non-fatal */ }
        }
        if (showToast) showToast(`Workspace "${wsOptions.newWorkspaceName}" created!`, 'success');
        targetWsId = newId;
      } else if (wsOptions.targetWorkspaceId && wsOptions.targetWorkspaceId !== workspaceId) {
        targetWsId = wsOptions.targetWorkspaceId;
      }

      const newTaskRef = await addWorkspaceTask(targetWsId, taskData, {
        uid: user.uid, email: user.email, displayName: user.displayName || user.email,
      });

      // Notify all assignees (primary + co-assignees)
      const allAssignees = [
        taskData.assigneeEmail ? { email: taskData.assigneeEmail, name: taskData.assigneeName } : null,
        ...(taskData.coAssignees || []),
      ].filter(Boolean);
      allAssignees.forEach(ca => {
        if (ca.email) notifyTaskAssigned({
          assigneeEmail: ca.email,
          assigneeName:  ca.name,
          taskText:      taskData.text,
          notes:         taskData.notes || null,
          dueDate:       taskData.dueDate,
          priority:      taskData.priority,
          ownerName:     user.displayName || user.email,
          ownerUid:      user.uid,
          taskId:        newTaskRef?.id,
          workspaceId,
        }).catch(() => {});
      });
    } catch (e) {
      logError(e, { location: 'KanbanBoard:WorkspaceBoardContent', action: 'addWorkspaceTask' }, user.uid);
      throw e;
    }
  };

  const handleDelete = async (taskId) => {
    if (!await confirm('Delete this task from the workspace?', { danger: true, okText: 'Delete' })) return;
    try {
      await deleteWorkspaceTask(workspaceId, taskId);
    } catch (e) {
      logError(e, { location: 'KanbanBoard:handleDelete', action: 'deleteWorkspaceTask' }, user.uid);
      if (showToast) showToast('Failed to delete task.', 'warning');
    }
  };

  const closeAddTask = () => {
    setShowAddTask(false);
    if (onAddTaskClose) onAddTaskClose();
  };

  // Apply both assignee AND status filters.
  const filteredTasks = tasks.filter(t => {
    if (filterAssignee !== 'all') {
      if (filterAssignee === 'unassigned') {
        if (t.assigneeUid || t.assigneeEmail) return false;
      } else if (t.assigneeUid !== filterAssignee) {
        return false;
      }
    }
    if (filterStatus !== 'all' && (t.status || 'open') !== filterStatus) return false;
    return true;
  });

  // "+ Add task in X" handler — opens modal pre-filled with category context
  const handleAddTaskHere = (categoryId, subcategoryId) => {
    setAddTaskContext({ categoryId, subcategoryId });
    setShowAddTask(true);
  };

  // Build a human label for the category context shown in the modal header
  const categoryContextLabel = (() => {
    if (!addTaskContext.categoryId) return null;
    const cat = (workspace?.categories || []).find(c => c.id === addTaskContext.categoryId);
    if (!cat) return null;
    const sub = (cat.subcategories || []).find(s => s.id === addTaskContext.subcategoryId);
    return sub ? `${cat.name} › ${sub.name}` : cat.name;
  })();

  return (
    <div style={{ paddingTop: 14 }}>
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #dc262644', color: '#dc2626', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Nested-accordion category board (replaces the 4-column Kanban) */}
      {tasksLoading
        ? <div style={{ padding: '20px 0', color: '#475569', fontSize: 13 }}>Loading tasks…</div>
        : (
          <CategoryBoard
            workspace={workspace}
            workspaceId={workspaceId}
            tasks={filteredTasks}
            members={members}
            onDelete={handleDelete}
            currentUid={user.uid}
            isAdmin={isAdmin}
            user={user}
            showToast={showToast}
            onAddTaskHere={handleAddTaskHere}
            filterAssignee={filterAssignee}
            setFilterAssignee={setFilterAssignee}
            filterStatus={filterStatus}
            setFilterStatus={setFilterStatus}
            showAddCategoryInitial={showAddCategoryInitial}
            onAddCategoryClose={onAddCategoryClose}
            highlightTaskId={highlightTaskId}
            onHighlightTaskConsumed={onHighlightTaskConsumed}
          />
        )
      }

      {showAddTask && (
        <AddTaskModal
          onClose={closeAddTask}
          onAdd={handleAddTask}
          members={members}
          workspaces={workspaces}
          currentWorkspaceId={workspaceId}
          categories={workspace?.categories || []}
          showToast={showToast}
          initialCategoryId={addTaskContext.categoryId}
          initialSubcategoryId={addTaskContext.subcategoryId}
          categoryContextLabel={categoryContextLabel}
          hideWorkspacePicker={true}
        />
      )}
    </div>
  );
}

export default WorkspaceBoardContent;
