/* ═══════════════════════════════════════════════════
   StudyFlow — Student Productivity Dashboard
   script.js
   ═══════════════════════════════════════════════════ */

// ─── State ────────────────────────────────────────────
let tasks = [];
let heatmapData = {}; // { "YYYY-MM-DD": count }
let draggedTaskId = null;
let modalSubtasks = [];
let chartDistribution = null;
let chartWeekly = null;
let calendarInstance = null;

const STORAGE_TASKS   = 'sf_tasks';
const STORAGE_HEATMAP = 'sf_heatmap';

// ─── Persistence ──────────────────────────────────────
function save() {
  localStorage.setItem(STORAGE_TASKS, JSON.stringify(tasks));
  localStorage.setItem(STORAGE_HEATMAP, JSON.stringify(heatmapData));
}

function load() {
  try {
    tasks       = JSON.parse(localStorage.getItem(STORAGE_TASKS))   || [];
    heatmapData = JSON.parse(localStorage.getItem(STORAGE_HEATMAP)) || {};
  } catch {
    tasks = []; heatmapData = {};
  }
}

// ─── Helpers ──────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function taskProgress(task) {
  if (!task.subtasks || task.subtasks.length === 0) {
    return task.manualStatus === 'done' ? 100 : (task.manualStatus === 'inprogress' ? 50 : 0);
  }
  const done = task.subtasks.filter(s => s.done).length;
  return Math.round((done / task.subtasks.length) * 100);
}

function taskStatus(task) {
  // Manual drag overrides if no subtasks
  if (!task.subtasks || task.subtasks.length === 0) {
    return task.manualStatus || 'todo';
  }
  const pct = taskProgress(task);
  if (pct === 0)   return 'todo';
  if (pct === 100) return 'done';
  return 'inprogress';
}

function showToast(msg, icon = '✅') {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent  = msg;
  document.getElementById('toast-icon').textContent = icon;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ─── Navigation ───────────────────────────────────────
const pageMeta = {
  dashboard: { title: 'Dashboard',       sub: 'Overview of your productivity' },
  kanban:    { title: 'Kanban Board',    sub: 'Drag and drop to manage tasks' },
  tasks:     { title: 'All Tasks',       sub: 'Everything in one place' },
  heatmap:   { title: 'Activity Heatmap',sub: 'Your year in productivity' },
  calendar:  { title: 'Calendar',        sub: 'Timeline view of tasks' },
};

function navigate(pageId, el) {
  // Update nav highlight
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  const navEl = el || document.querySelector(`[data-page="${pageId}"]`);
  if (navEl) navEl.classList.add('active');

  // Hide all pages, show target
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + pageId).classList.add('active');

  // Topbar
  const meta = pageMeta[pageId] || {};
  document.getElementById('topbar-title').textContent      = meta.title || pageId;
  document.getElementById('topbar-breadcrumb').textContent = meta.sub || '';

  // Lazy-init calendar
  if (pageId === 'calendar' && !calendarInstance) initCalendar();
  if (pageId === 'calendar' && calendarInstance) {
    setTimeout(() => calendarInstance.render(), 50);
  }

  // Re-render relevant page
  if (pageId === 'dashboard') renderDashboard();
  if (pageId === 'kanban')    renderKanban();
  if (pageId === 'tasks')     renderAllTasks();
  if (pageId === 'heatmap')   renderHeatmap();
  if (pageId === 'calendar')  syncCalendar();
}

// ─── Modal ────────────────────────────────────────────
function openModal() {
  document.getElementById('task-title-input').value = '';
  document.getElementById('subtask-input').value    = '';
  document.getElementById('subtask-preview').innerHTML = '';
  modalSubtasks = [];
  document.getElementById('modal').classList.add('open');
  setTimeout(() => document.getElementById('task-title-input').focus(), 100);
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
}

// Close on overlay click
document.getElementById('modal').addEventListener('click', e => {
  if (e.target === document.getElementById('modal')) closeModal();
});

function addSubtaskToModal() {
  const inp = document.getElementById('subtask-input');
  const val = inp.value.trim();
  if (!val) return;
  modalSubtasks.push({ id: uid(), text: val, done: false });
  inp.value = '';
  renderModalSubtasks();
  inp.focus();
}

document.getElementById('subtask-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); addSubtaskToModal(); }
});
document.getElementById('task-title-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveTask();
});

function renderModalSubtasks() {
  const el = document.getElementById('subtask-preview');
  el.innerHTML = modalSubtasks.map(s => `
    <div class="subtask-preview-item">
      <span>☐ ${escHtml(s.text)}</span>
      <button class="subtask-preview-rm" onclick="removeModalSubtask('${s.id}')">×</button>
    </div>
  `).join('');
}

function removeModalSubtask(id) {
  modalSubtasks = modalSubtasks.filter(s => s.id !== id);
  renderModalSubtasks();
}

function saveTask() {
  const title = document.getElementById('task-title-input').value.trim();
  if (!title) {
    document.getElementById('task-title-input').style.borderColor = 'var(--danger)';
    setTimeout(() => document.getElementById('task-title-input').style.borderColor = '', 1200);
    return;
  }
  const task = {
    id: uid(),
    title,
    subtasks: [...modalSubtasks],
    manualStatus: 'todo',
    createdAt: new Date().toISOString(),
  };
  tasks.unshift(task);
  save();
  closeModal();
  showToast('Task created!', '✨');
  refreshAll();
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Task Card Builder ────────────────────────────────
function buildTaskCard(task, draggable = true) {
  const pct    = taskProgress(task);
  const status = taskStatus(task);
  const done   = task.subtasks ? task.subtasks.filter(s => s.done).length : 0;
  const total  = task.subtasks ? task.subtasks.length : 0;

  const pctClass = status === 'done' ? 'done-pct' : status === 'inprogress' ? 'prog-pct' : 'todo-pct';
  const fillClass = pct === 100 ? 'full' : '';

  const subtasksHtml = task.subtasks && task.subtasks.length > 0 ? `
    <button class="task-expand-btn" onclick="toggleSubtasks('${task.id}', event)">
      ▸ ${total} subtask${total !== 1 ? 's' : ''}
    </button>
    <div class="subtask-list" id="sl-${task.id}">
      ${task.subtasks.map(s => `
        <div class="subtask-item ${s.done ? 'done-sub' : ''}" id="si-${s.id}">
          <input type="checkbox" ${s.done ? 'checked' : ''} onchange="toggleSubtask('${task.id}','${s.id}',this.checked)" />
          <span>${escHtml(s.text)}</span>
          <button class="subtask-del" onclick="deleteSubtask('${task.id}','${s.id}')">×</button>
        </div>
      `).join('')}
    </div>
  ` : '';

  return `
    <div class="task-card" id="tc-${task.id}"
      ${draggable ? `draggable="true" ondragstart="onDragStart(event,'${task.id}')" ondragend="onDragEnd(event)"` : ''}
    >
      <button class="task-del-btn" onclick="deleteTask('${task.id}',event)">🗑</button>
      <div class="task-title">${escHtml(task.title)}</div>
      ${subtasksHtml}
      <div class="task-progress-bar">
        <div class="task-progress-fill ${fillClass}" style="width:${pct}%"></div>
      </div>
      <div class="task-meta">
        <span class="task-subtask-count">${total > 0 ? `${done}/${total} subtasks` : 'No subtasks'}</span>
        <span class="task-pct ${pctClass}">${pct}%</span>
      </div>
    </div>
  `;
}

function toggleSubtasks(taskId, e) {
  e.stopPropagation();
  const sl  = document.getElementById('sl-' + taskId);
  const btn = e.target;
  const isOpen = sl.classList.toggle('open');
  btn.textContent = (isOpen ? '▾' : '▸') + btn.textContent.slice(1);
}

function toggleSubtask(taskId, subtaskId, checked) {
  const task    = tasks.find(t => t.id === taskId);
  const subtask = task && task.subtasks && task.subtasks.find(s => s.id === subtaskId);
  if (!subtask) return;

  subtask.done = checked;

  // Track heatmap: completing a subtask counts as activity
  if (checked) {
    const key = todayKey();
    heatmapData[key] = (heatmapData[key] || 0) + 1;
  }

  save();
  refreshAll();
  updateSubtaskUI(taskId, subtaskId, checked);
}

function updateSubtaskUI(taskId, subtaskId, checked) {
  // Update the item style without full re-render
  const si = document.getElementById('si-' + subtaskId);
  if (si) {
    if (checked) si.classList.add('done-sub');
    else         si.classList.remove('done-sub');
  }
  // Re-render just this card's progress bar & meta in place
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  ['todo','inprogress','done'].forEach(col => {
    const cont = document.getElementById('tasks-' + col);
    if (cont) {
      const card = document.getElementById('tc-' + taskId);
      if (card) {
        const pct    = taskProgress(task);
        const status = taskStatus(task);
        const done   = task.subtasks.filter(s => s.done).length;
        const total  = task.subtasks.length;
        const bar    = card.querySelector('.task-progress-fill');
        const meta   = card.querySelector('.task-subtask-count');
        const pctEl  = card.querySelector('.task-pct');
        if (bar) {
          bar.style.width = pct + '%';
          bar.className   = 'task-progress-fill' + (pct === 100 ? ' full' : '');
        }
        if (meta)  meta.textContent  = `${done}/${total} subtasks`;
        if (pctEl) {
          pctEl.textContent = pct + '%';
          pctEl.className   = 'task-pct ' + (status === 'done' ? 'done-pct' : status === 'inprogress' ? 'prog-pct' : 'todo-pct');
        }
      }
    }
  });
}

function deleteSubtask(taskId, subtaskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  task.subtasks = task.subtasks.filter(s => s.id !== subtaskId);
  save();
  refreshAll();
}

function deleteTask(taskId, e) {
  e && e.stopPropagation();
  tasks = tasks.filter(t => t.id !== taskId);
  save();
  refreshAll();
  showToast('Task removed', '🗑');
}

// ─── Kanban Render ────────────────────────────────────
function renderKanban() {
  const cols = { todo: [], inprogress: [], done: [] };
  tasks.forEach(t => {
    const s = taskStatus(t);
    if (cols[s]) cols[s].push(t);
  });

  ['todo','inprogress','done'].forEach(col => {
    const el = document.getElementById('tasks-' + col);
    if (!el) return;
    el.innerHTML = cols[col].map(t => buildTaskCard(t)).join('');
    document.getElementById('count-' + col).textContent = cols[col].length;
  });
}

// ─── Drag & Drop ──────────────────────────────────────
function onDragStart(e, taskId) {
  draggedTaskId = taskId;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => {
    const el = document.getElementById('tc-' + taskId);
    if (el) el.classList.add('dragging');
  }, 0);
}

function onDragEnd(e) {
  const el = document.getElementById('tc-' + draggedTaskId);
  if (el) el.classList.remove('dragging');
  document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drag-target'));
}

function onDragOver(e, colId) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drag-target'));
  document.getElementById('col-' + colId).classList.add('drag-target');
}

function onDragLeave(e) {
  // Only remove if leaving the column entirely
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('drag-target');
  }
}

function onDrop(e, colId) {
  e.preventDefault();
  document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drag-target'));
  if (!draggedTaskId) return;

  const task = tasks.find(t => t.id === draggedTaskId);
  if (!task) return;

  // If task has no subtasks, update manualStatus
  if (!task.subtasks || task.subtasks.length === 0) {
    task.manualStatus = colId;
  } else {
    // If dragging to 'done', check all subtasks
    if (colId === 'done') {
      task.subtasks.forEach(s => { if (!s.done) { s.done = true; } });
      const key = todayKey();
      heatmapData[key] = (heatmapData[key] || 0) + task.subtasks.length;
    } else if (colId === 'todo') {
      task.subtasks.forEach(s => { s.done = false; });
    }
  }

  save();
  refreshAll();
  showToast(`Moved to "${colId === 'inprogress' ? 'In Progress' : colId === 'done' ? 'Done' : 'To Do'}"`, '📌');
  draggedTaskId = null;
}

// ─── All Tasks Page ───────────────────────────────────
function renderAllTasks() {
  const el = document.getElementById('all-tasks-list');
  if (!el) return;

  if (tasks.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">No tasks yet. Create one!</div></div>`;
    return;
  }

  el.innerHTML = tasks.map(task => {
    const status = taskStatus(task);
    const pct    = taskProgress(task);
    const badgeClass = { todo: 'badge-todo', inprogress: 'badge-progress', done: 'badge-done' }[status];
    const badgeText  = { todo: 'To Do', inprogress: 'In Progress', done: 'Done' }[status];
    const subtaskInfo = task.subtasks && task.subtasks.length > 0
      ? `${task.subtasks.filter(s => s.done).length}/${task.subtasks.length} subtasks`
      : 'No subtasks';

    return `
      <div class="task-list-item" onclick="expandTaskInList('${task.id}')">
        <span class="status-badge ${badgeClass}">${badgeText}</span>
        <span style="flex:1;font-size:13.5px;font-weight:500;">${escHtml(task.title)}</span>
        <span style="font-size:12px;color:var(--text-muted);">${subtaskInfo}</span>
        <span style="font-size:12px;font-weight:600;font-family:'JetBrains Mono',monospace;color:${pct===100?'var(--success)':pct>0?'var(--accent)':'var(--text-muted)'};">${pct}%</span>
        <button class="btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="deleteTask('${task.id}',event)">🗑 Delete</button>
      </div>
    `;
  }).join('');
}

function expandTaskInList(taskId) {
  // Navigate to kanban and highlight
  navigate('kanban', document.querySelector('[data-page="kanban"]'));
}

// ─── Dashboard Render ─────────────────────────────────
function renderDashboard() {
  const total      = tasks.length;
  const doneTasks  = tasks.filter(t => taskStatus(t) === 'done').length;
  const inprog     = tasks.filter(t => taskStatus(t) === 'inprogress').length;
  const score      = total > 0 ? Math.round((doneTasks / total) * 100) : 0;
  const streak     = computeStreak();

  document.getElementById('stat-total').textContent     = total;
  document.getElementById('stat-score').textContent     = score + '%';
  document.getElementById('stat-streak').textContent    = streak;
  document.getElementById('stat-inprogress').textContent= inprog;

  // Recent tasks
  const recent = document.getElementById('dashboard-recent-tasks');
  if (tasks.length === 0) {
    recent.innerHTML = `<div class="empty-state" style="padding:30px 20px;"><div class="empty-icon">✨</div><div class="empty-text">No tasks yet — add your first one!</div></div>`;
  } else {
    recent.innerHTML = tasks.slice(0,5).map(task => {
      const status    = taskStatus(task);
      const pct       = taskProgress(task);
      const badgeClass= { todo:'badge-todo', inprogress:'badge-progress', done:'badge-done' }[status];
      const badgeText = { todo:'To Do', inprogress:'In Progress', done:'Done' }[status];
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);">
          <span class="status-badge ${badgeClass}">${badgeText}</span>
          <span style="flex:1;font-size:13.5px;">${escHtml(task.title)}</span>
          <span style="font-size:12px;font-weight:700;font-family:'JetBrains Mono',monospace;color:${pct===100?'var(--success)':pct>0?'var(--accent)':'var(--text-muted)'};">${pct}%</span>
        </div>
      `;
    }).join('');
  }

  renderCharts();
}

// ─── Charts ───────────────────────────────────────────
const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#8b93b0', font: { family: 'DM Sans', size: 12 } } } },
};

function renderCharts() {
  renderDistributionChart();
  renderWeeklyChart();
}

function renderDistributionChart() {
  const todo    = tasks.filter(t => taskStatus(t) === 'todo').length;
  const prog    = tasks.filter(t => taskStatus(t) === 'inprogress').length;
  const done    = tasks.filter(t => taskStatus(t) === 'done').length;

  const ctx = document.getElementById('chart-distribution');
  if (!ctx) return;

  if (chartDistribution) { chartDistribution.destroy(); chartDistribution = null; }

  chartDistribution = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['To Do', 'In Progress', 'Done'],
      datasets: [{
        data: [Math.max(todo, 0.01), Math.max(prog, 0.01), Math.max(done, 0.01)],
        backgroundColor: ['#2e3650', '#6c8cff', '#34d399'],
        borderColor:     ['#1a1e28', '#1a1e28', '#1a1e28'],
        borderWidth: 3,
        hoverOffset: 6,
      }],
    },
    options: {
      ...chartDefaults,
      cutout: '68%',
      plugins: {
        ...chartDefaults.plugins,
        legend: { position: 'bottom', labels: { color: '#8b93b0', padding: 16, font: { family: 'DM Sans', size: 12 } } },
      },
    },
  });
}

function renderWeeklyChart() {
  // Build last 7 days activity from heatmap
  const labels = [];
  const data   = [];
  for (let i = 6; i >= 0; i--) {
    const d   = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    labels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
    data.push(heatmapData[key] || 0);
  }

  const ctx = document.getElementById('chart-weekly');
  if (!ctx) return;

  if (chartWeekly) { chartWeekly.destroy(); chartWeekly = null; }

  chartWeekly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Completions',
        data,
        backgroundColor: data.map((_, i) => i === 6 ? '#6c8cff' : 'rgba(108,140,255,0.3)'),
        borderRadius: 5,
        borderSkipped: false,
      }],
    },
    options: {
      ...chartDefaults,
      scales: {
        x: { grid: { color: 'rgba(37,43,59,0.8)' }, ticks: { color: '#8b93b0', font: { family: 'DM Sans', size: 11 } } },
        y: { grid: { color: 'rgba(37,43,59,0.8)' }, ticks: { color: '#8b93b0', font: { family: 'DM Sans', size: 11 }, stepSize: 1 }, beginAtZero: true },
      },
      plugins: { ...chartDefaults.plugins, legend: { display: false } },
    },
  });
}

// ─── Streak Calculator ────────────────────────────────
function computeStreak() {
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d   = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (heatmapData[key] && heatmapData[key] > 0) streak++;
    else if (i > 0) break; // gap found
  }
  return streak;
}

// ─── Heatmap ──────────────────────────────────────────
function renderHeatmap() {
  const grid = document.getElementById('heatmap-grid');
  if (!grid) return;

  // Build 52 weeks × 7 days grid, ending today
  const today = new Date();
  today.setHours(0,0,0,0);

  // Go back to start of current week's Sunday
  const endDate   = new Date(today);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 364); // ~52 weeks

  // Align to Sunday
  const dow = startDate.getDay(); // 0=Sun
  startDate.setDate(startDate.getDate() - dow);

  // Max value for color scaling
  const maxVal = Math.max(1, ...Object.values(heatmapData));

  let html = '';
  const cur = new Date(startDate);

  while (cur <= today) {
    // New week column
    html += '<div class="heatmap-week">';
    for (let d = 0; d < 7; d++) {
      if (cur > today) {
        html += '<div class="heatmap-day" style="visibility:hidden;"></div>';
      } else {
        const key   = cur.toISOString().slice(0, 10);
        const count = heatmapData[key] || 0;
        const ratio = count / maxVal;
        const lvl   = count === 0 ? '' : ratio < 0.25 ? 'l1' : ratio < 0.5 ? 'l2' : ratio < 0.75 ? 'l3' : 'l4';
        const label = cur.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        html += `<div class="heatmap-day ${lvl}" data-tooltip="${label}: ${count} completions" style="position:relative;"></div>`;
      }
      cur.setDate(cur.getDate() + 1);
    }
    html += '</div>';
  }

  grid.innerHTML = html;

  // Stats
  const activeDays = Object.values(heatmapData).filter(v => v > 0).length;
  document.getElementById('hm-active-days').textContent = activeDays;

  // Best day
  let bestKey = null, bestVal = 0;
  Object.entries(heatmapData).forEach(([k, v]) => { if (v > bestVal) { bestVal = v; bestKey = k; } });
  document.getElementById('hm-best-day').textContent = bestKey
    ? new Date(bestKey + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—';

  // Streak
  document.getElementById('hm-streak').textContent = computeStreak() + ' 🔥';
}

// ─── Calendar ─────────────────────────────────────────
function initCalendar() {
  const el = document.getElementById('fullcalendar');
  if (!el) return;

  calendarInstance = new FullCalendar.Calendar(el, {
    initialView: 'dayGridMonth',
    headerToolbar: {
      left:   'prev,next today',
      center: 'title',
      right:  'dayGridMonth,timeGridWeek',
    },
    height: 560,
    events: buildCalendarEvents(),
    eventColor: '#6c8cff',
    nowIndicator: true,
  });

  calendarInstance.render();
}

function buildCalendarEvents() {
  const events = [];

  // Task creation events
  tasks.forEach(task => {
    const status = taskStatus(task);
    events.push({
      title: task.title,
      date:  task.createdAt ? task.createdAt.slice(0, 10) : todayKey(),
      color: status === 'done' ? '#34d399' : status === 'inprogress' ? '#6c8cff' : '#4a5170',
    });
  });

  // Heatmap activity dots
  Object.entries(heatmapData).forEach(([date, count]) => {
    if (count > 0) {
      events.push({
        title:           `${count} completion${count > 1 ? 's' : ''}`,
        date,
        color:           'rgba(251,191,36,0.7)',
        display:         'background',
      });
    }
  });

  return events;
}

function syncCalendar() {
  if (!calendarInstance) { initCalendar(); return; }
  calendarInstance.removeAllEvents();
  buildCalendarEvents().forEach(ev => calendarInstance.addEvent(ev));
}

// ─── Refresh All ──────────────────────────────────────
function refreshAll() {
  const activePage = document.querySelector('.page.active');
  const pageId     = activePage ? activePage.id.replace('page-', '') : 'dashboard';

  if (pageId === 'dashboard') renderDashboard();
  if (pageId === 'kanban')    renderKanban();
  if (pageId === 'tasks')     renderAllTasks();
  if (pageId === 'heatmap')   renderHeatmap();
  if (pageId === 'calendar')  syncCalendar();

  // Always keep dashboard stats in sync even if not on that page
  if (pageId !== 'dashboard') {
    const total   = tasks.length;
    const done    = tasks.filter(t => taskStatus(t) === 'done').length;
    const inprog  = tasks.filter(t => taskStatus(t) === 'inprogress').length;
    const score   = total > 0 ? Math.round((done / total) * 100) : 0;
    const streak  = computeStreak();
    const s = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    s('stat-total', total); s('stat-score', score + '%'); s('stat-streak', streak); s('stat-inprogress', inprog);
  }
}

// ─── Keyboard Shortcut ────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openModal(); }
  if (e.key === 'Escape') closeModal();
});

// ─── Seed Demo Data (first time only) ────────────────
function seedDemoData() {
  if (localStorage.getItem('sf_seeded')) return;

  const demoDays = [1, 2, 3, 5, 6, 8, 9, 10, 12];
  demoDays.forEach(offset => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    const key = d.toISOString().slice(0, 10);
    heatmapData[key] = Math.floor(Math.random() * 5) + 1;
  });
  heatmapData[todayKey()] = 2;

  tasks = [
    {
      id: uid(), title: 'Study Binary Search Trees in C++',
      subtasks: [
        { id: uid(), text: 'Understand BST insertion', done: true },
        { id: uid(), text: 'Implement BST deletion', done: true },
        { id: uid(), text: 'Practice BST traversals', done: false },
        { id: uid(), text: 'Solve 3 LeetCode BST problems', done: false },
      ],
      manualStatus: 'todo',
      createdAt: new Date().toISOString(),
    },
    {
      id: uid(), title: 'Complete Hashing Assignment',
      subtasks: [
        { id: uid(), text: 'Read chapter on open addressing', done: true },
        { id: uid(), text: 'Implement hash table with chaining', done: true },
        { id: uid(), text: 'Write unit tests', done: true },
      ],
      manualStatus: 'todo',
      createdAt: new Date(Date.now() - 86400000).toISOString(),
    },
    {
      id: uid(), title: 'Review Sorting Algorithms',
      subtasks: [
        { id: uid(), text: 'Revise Quick Sort', done: true },
        { id: uid(), text: 'Revise Merge Sort', done: true },
        { id: uid(), text: 'Compare time complexities', done: true },
        { id: uid(), text: 'Write summary notes', done: true },
      ],
      manualStatus: 'todo',
      createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    },
    {
      id: uid(), title: 'Submit Lab Report',
      subtasks: [],
      manualStatus: 'done',
      createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    },
  ];

  save();
  localStorage.setItem('sf_seeded', '1');
}

// ─── Init ─────────────────────────────────────────────
(function init() {
  load();
  seedDemoData();
  load(); // reload after seeding
  renderDashboard();
  renderCharts();
})();