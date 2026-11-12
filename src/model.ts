export const STORAGE_KEY = "todolistapp.notebook.v1";
export const TITLE_MAX = 100;
export const NOTES_MAX = 4000;

export type Task = {
  id: string;
  title: string;
  notes: string;
  completed: boolean;
  photoId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type FilterId = "all" | "active" | "completed";

export type TaskCounts = {
  all: number;
  active: number;
  completed: number;
};

export type LoadResult =
  | { ok: true; tasks: Task[] }
  | { ok: false };

const FILTERS: ReadonlySet<FilterId> = new Set(["all", "active", "completed"]);

export function isFilterId(value: string): value is FilterId {
  return FILTERS.has(value as FilterId);
}

export function charLength(value: string): number {
  return [...value].length;
}

export function normalizeTitle(title: string): string {
  return title.trim();
}

export function normalizeNotes(notes: string): string {
  return notes.trim();
}

export function validateTitle(title: string): string | null {
  const normalized = normalizeTitle(title);
  if (!normalized) return "請寫低標題。";
  if (charLength(normalized) > TITLE_MAX) return `標題不可超過 ${TITLE_MAX} 字。`;
  return null;
}

export function validateNotes(notes: string): string | null {
  const normalized = normalizeNotes(notes);
  if (charLength(normalized) > NOTES_MAX) return `備註不可超過 ${NOTES_MAX} 字。`;
  return null;
}

export function createTask(
  input: { title: string; notes: string; photoId?: string | null },
  meta: { id: string; now: number },
): Task {
  const title = normalizeTitle(input.title);
  const notes = normalizeNotes(input.notes);
  const error = validateTitle(title) ?? validateNotes(notes);
  if (error) throw new Error(error);
  return {
    id: meta.id,
    title,
    notes,
    completed: false,
    photoId: input.photoId ?? null,
    createdAt: meta.now,
    updatedAt: meta.now,
  };
}

export function updateTask(
  tasks: readonly Task[],
  id: string,
  input: { title: string; notes: string; photoId?: string | null },
  now: number,
): Task[] {
  const title = normalizeTitle(input.title);
  const notes = normalizeNotes(input.notes);
  const error = validateTitle(title) ?? validateNotes(notes);
  if (error) throw new Error(error);
  return tasks.map((task) =>
    task.id === id
      ? {
          ...task,
          title,
          notes,
          photoId: input.photoId === undefined ? task.photoId : input.photoId,
          updatedAt: now,
        }
      : task,
  );
}

export function toggleTask(tasks: readonly Task[], id: string, now: number): Task[] {
  return tasks.map((task) =>
    task.id === id ? { ...task, completed: !task.completed, updatedAt: now } : task,
  );
}

export function removeTask(tasks: readonly Task[], id: string): Task[] {
  return tasks.filter((task) => task.id !== id);
}

export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

export function filterTasks(tasks: readonly Task[], filter: FilterId): Task[] {
  if (filter === "active") return tasks.filter((task) => !task.completed);
  if (filter === "completed") return tasks.filter((task) => task.completed);
  return [...tasks];
}

export function countTasks(tasks: readonly Task[]): TaskCounts {
  let completed = 0;
  for (const task of tasks) {
    if (task.completed) completed += 1;
  }
  return {
    all: tasks.length,
    active: tasks.length - completed,
    completed,
  };
}

export function serializeTasks(tasks: readonly Task[]): string {
  return JSON.stringify({ version: 1, tasks });
}

export function parseTasks(raw: string | null): LoadResult {
  if (raw === null) return { ok: true, tasks: [] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (!data || typeof data !== "object") return { ok: false };
  const record = data as { version?: unknown; tasks?: unknown };
  if (record.version !== 1 || !Array.isArray(record.tasks)) return { ok: false };
  const tasks: Task[] = [];
  for (const item of record.tasks) {
    const task = readTask(item);
    if (!task) return { ok: false };
    tasks.push(task);
  }
  return { ok: true, tasks: sortTasks(tasks) };
}

function readTask(value: unknown): Task | null {
  if (!value || typeof value !== "object") return null;
  const task = value as Record<string, unknown>;
  if (typeof task.id !== "string" || task.id.length === 0 || task.id.length > 80) return null;
  if (typeof task.title !== "string" || task.title !== task.title.trim()) return null;
  if (!task.title || charLength(task.title) > TITLE_MAX) return null;
  if (typeof task.notes !== "string" || task.notes !== task.notes.trim()) return null;
  if (charLength(task.notes) > NOTES_MAX) return null;
  if (typeof task.completed !== "boolean") return null;
  if (task.photoId != null && (typeof task.photoId !== "string" || task.photoId.length === 0 || task.photoId.length > 80)) {
    return null;
  }
  if (typeof task.createdAt !== "number" || !Number.isFinite(task.createdAt)) return null;
  if (typeof task.updatedAt !== "number" || !Number.isFinite(task.updatedAt)) return null;
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    completed: task.completed,
    photoId: typeof task.photoId === "string" ? task.photoId : null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}
