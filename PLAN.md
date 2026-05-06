# Forma — Task Management App

A personal kanban-style task manager. Simple to start, structured enough to scale.

---

## Core Concept

Kanban board with To Do → Doing → Done as the default flow.
Tasks live inside Groups (like projects). Each task can have priority, subtasks, and comments.
Everything is tied to a user account with full history.

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 15 (App Router) | Full-stack, one codebase, easy deploy |
| Language | TypeScript | Type safety everywhere |
| Database | PostgreSQL via Supabase | Free tier, auth built in, easy to maintain |
| ORM | Prisma | Type-safe queries, easy migrations |
| Auth | Supabase Auth | Google + GitHub + email, session history |
| UI | Tailwind CSS + shadcn/ui | Fast, clean, consistent |
| Drag & Drop | @dnd-kit/core | Best maintained DnD lib for React |
| State | Zustand | Lightweight, no boilerplate |
| Deployment | Vercel (frontend) + Supabase (db/auth) | Both have generous free tiers |

---

## Data Model

```
User
  id, email, name, avatar, created_at

Group (like a project/board)
  id, name, color, owner_id, created_at, order

Status (columns on the board)
  id, name, group_id, order
  defaults per group: "To Do", "Doing", "Done"
  user can add/rename custom statuses

Task
  id, title, description, group_id, status_id
  priority: URGENT | HIGH | MEDIUM | LOW
  order (float, for drag-drop sorting)
  parent_task_id (null = top-level, set = subtask)
  created_by, created_at, updated_at, due_date

Comment
  id, task_id, author_id, body, created_at, updated_at

Activity (history log)
  id, task_id, user_id, action, metadata, created_at
  tracks: created, status_changed, priority_changed, commented, etc.
```

---

## Features — Phase 1 (MVP)

### Auth
- [ ] Sign up / login (email + Google)
- [ ] Session persistence
- [ ] Protected routes

### Groups
- [ ] Create / rename / delete groups
- [ ] Each group gets its own board
- [ ] Groups listed in sidebar

### Board
- [ ] Kanban view with To Do / Doing / Done columns
- [ ] Drag tasks between columns (updates status)
- [ ] Drag tasks within a column (updates order)
- [ ] Add custom status columns

### Tasks
- [ ] Create task (title required, rest optional)
- [ ] Edit task (title, description, priority, due date)
- [ ] Delete task
- [ ] Priority badge: Urgent / High / Medium / Low
- [ ] Move task to different group

### Subtasks
- [ ] Add subtasks to any task (1 level deep)
- [ ] Subtasks shown inside task detail view
- [ ] Subtask completion checkbox
- [ ] Progress indicator on parent task (e.g. 2/5 done)

### Comments
- [ ] Add comments on any task
- [ ] Edit / delete own comments
- [ ] Timestamps shown

### Activity History
- [ ] Per-task activity feed (status changes, comments, edits)
- [ ] Shown in task detail panel

### UI/UX
- [ ] Task detail slide-over panel (open task without leaving board)
- [ ] Clean sidebar: Groups list + user avatar
- [ ] Responsive (works on mobile)
- [ ] Dark mode

---

## Features — Phase 2 (Post-MVP)

- [ ] Global view: all tasks across groups, filterable
- [ ] Filters: by priority, due date, status
- [ ] Search across all tasks
- [ ] Keyboard shortcuts (Cmd+K command palette)
- [ ] Due date reminders (email or browser notification)
- [ ] Recurring tasks
- [ ] Task labels / tags
- [ ] Attach files to tasks
- [ ] Export board to CSV

---

## Features — Phase 3 (If Going Commercial)

- [ ] Team support (invite members to a group)
- [ ] Role-based permissions (owner, editor, viewer)
- [ ] Real-time collaboration (WebSockets)
- [ ] Slack / GitHub integration
- [ ] Time tracking per task
- [ ] Stripe billing (Pro plan)
- [ ] API access

---

## Folder Structure

```
forma/
├── app/                        # Next.js App Router pages
│   ├── (auth)/                 # Login, signup pages
│   ├── (app)/                  # Protected app routes
│   │   ├── dashboard/          # All groups overview
│   │   ├── group/[id]/         # Board view for a group
│   │   └── task/[id]/          # Task detail (or slide-over)
│   └── api/                    # API routes
│       ├── groups/
│       ├── tasks/
│       ├── subtasks/
│       └── comments/
├── components/
│   ├── board/                  # KanbanBoard, Column, TaskCard
│   ├── task/                   # TaskDetail, SubtaskList, CommentThread
│   ├── sidebar/                # Sidebar, GroupList
│   └── ui/                     # shadcn components
├── lib/
│   ├── db.ts                   # Prisma client
│   ├── auth.ts                 # Supabase auth helpers
│   └── utils.ts
├── prisma/
│   └── schema.prisma
├── store/                      # Zustand stores
├── types/                      # Shared TS types
└── .env.local
```

---

## Build Order

1. **Setup** — Next.js + Tailwind + shadcn + Prisma + Supabase
2. **Auth** — login/signup, protected routes, session
3. **Groups** — CRUD, sidebar
4. **Board** — columns, task cards, drag and drop
5. **Tasks** — create/edit/delete, priority, detail panel
6. **Subtasks** — nested tasks, progress indicator
7. **Comments** — add/edit/delete comments on tasks
8. **Activity** — history log per task
9. **Polish** — dark mode, mobile, loading states, empty states
10. **Deploy** — Vercel + Supabase prod

---

## Environment Variables Needed

```
DATABASE_URL=
DIRECT_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

---

## Notes

- Supabase handles both the PostgreSQL database and auth — no need for a separate auth service
- Use Prisma for all DB queries (not Supabase JS client for data) — keeps queries typed and consistent
- Keep statuses user-configurable per group but seed To Do / Doing / Done on group creation
- Float-based ordering for drag-drop (reorder without updating all rows)
- Start with slide-over panel for task detail — avoids full page navigation and feels faster
