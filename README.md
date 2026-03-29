# StudyFlow — Student Productivity Dashboard

A dark-themed student productivity dashboard with tasks, kanban, heatmap, and calendar.

## Setup

1. Put `index.html` and `script.js` in the same folder
2. Open `index.html` in a browser

No installation or server needed.

## Features

- **Tasks** — Create tasks with subtasks and checkboxes
- **Kanban** — Drag and drop cards across To Do / In Progress / Done
- **Dashboard** — Stats, charts, and recent tasks at a glance
- **Heatmap** — GitHub-style activity grid for the whole year
- **Calendar** — Monthly view of your tasks

## Shortcuts

| Key | Action |
|---|---|
| `Ctrl/Cmd + K` | New task |
| `Escape` | Close modal |

## Reset Data

```js
localStorage.clear(); location.reload();
```

## Stack

- HTML + Tailwind CSS + Vanilla JS
- Chart.js, FullCalendar.js
- localStorage for persistence
