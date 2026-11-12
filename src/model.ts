export const STORAGE_KEY = "todolistapp.notebook.v1";
export const TITLE_MAX = 100;
export const NOTES_MAX = 4000;
export const CATEGORY_NAME_MAX = 30;
export const UNCATEGORIZED_NAME = "未分類";

export type Category = {
  id: string;
  name: string;
  createdAt: number;
};

export type Task = {
  id: string;
  title: string;
  notes: string;
  completed: boolean;
  photoId: string | null;
  categoryId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Notebook = {
  tasks: Task[];
  categories: Category[];
};

export type CategoryQuery = { kind: "all" } | { kind: "uncategorized" } | { kind: "category"; id: string };

export type FilterId = "all" | "active" | "completed";

export type TaskCounts = {
  all: number;
  active: number;
  completed: number;
};

export type LoadResult =
  | { ok: true; tasks: Task[]; categories: Category[] }
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

export function normalizeCategoryName(name: string): string {
  return name.trim();
}

export function validateCategoryName(
  name: string,
  categories: readonly Category[],
  exceptId?: string,
): string | null {
  const normalized = normalizeCategoryName(name);
  if (!normalized) return "請寫低分類名稱。";
  if (normalized === UNCATEGORIZED_NAME) return "「未分類」唔可以做分類名稱。";
  if (charLength(normalized) > CATEGORY_NAME_MAX) return `分類名稱不可超過 ${CATEGORY_NAME_MAX} 字。`;
  if (categories.some((category) => category.id !== exceptId && category.name === normalized)) {
    return "已經有呢個分類。";
  }
  return null;
}

export function createCategory(
  categories: readonly Category[],
  name: string,
  meta: { id: string; now: number },
): { categories: Category[]; category: Category } {
  const error = validateCategoryName(name, categories);
  if (error) throw new Error(error);
  const category: Category = { id: meta.id, name: normalizeCategoryName(name), createdAt: meta.now };
  return { categories: sortCategories([...categories, category]), category };
}

export function renameCategory(
  categories: readonly Category[],
  id: string,
  name: string,
): Category[] {
  const error = validateCategoryName(name, categories, id);
  if (error) throw new Error(error);
  return sortCategories(
    categories.map((category) =>
      category.id === id ? { ...category, name: normalizeCategoryName(name) } : category,
    ),
  );
}

export function deleteCategory(
  categories: readonly Category[],
  tasks: readonly Task[],
  id: string,
): { categories: Category[]; tasks: Task[] } {
  return {
    categories: categories.filter((category) => category.id !== id),
    tasks: tasks.map((task) => (task.categoryId === id ? { ...task, categoryId: null } : task)),
  };
}

export function createTask(
  input: { title: string; notes: string; photoId?: string | null; categoryId?: string | null },
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
    categoryId: input.categoryId ?? null,
    createdAt: meta.now,
    updatedAt: meta.now,
  };
}

export function updateTask(
  tasks: readonly Task[],
  id: string,
  input: { title: string; notes: string; photoId?: string | null; categoryId?: string | null },
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
          categoryId: input.categoryId === undefined ? task.categoryId : input.categoryId,
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

export function tasksForCategory(tasks: readonly Task[], query: CategoryQuery): Task[] {
  if (query.kind === "uncategorized") return tasks.filter((task) => task.categoryId === null);
  if (query.kind === "category") return tasks.filter((task) => task.categoryId === query.id);
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

export function serializeNotebook(notebook: { tasks: readonly Task[]; categories: readonly Category[] }): string {
  return JSON.stringify({
    version: 2,
    categories: notebook.categories,
    tasks: notebook.tasks,
  });
}

export function parseNotebook(raw: string | null): LoadResult {
  if (raw === null) return { ok: true, tasks: [], categories: [] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (!data || typeof data !== "object") return { ok: false };
  const record = data as { version?: unknown; tasks?: unknown; categories?: unknown };
  if (record.version !== 1 && record.version !== 2) return { ok: false };
  if (!Array.isArray(record.tasks)) return { ok: false };
  if (record.version === 2 && !Array.isArray(record.categories)) return { ok: false };

  const categories: Category[] = [];
  if (record.version === 2 && Array.isArray(record.categories)) {
    for (const item of record.categories) {
      const category = readCategory(item);
      if (!category) return { ok: false };
      categories.push(category);
    }
  }
  if (new Set(categories.map((category) => category.id)).size !== categories.length) return { ok: false };
  if (new Set(categories.map((category) => category.name)).size !== categories.length) return { ok: false };

  const known = new Set(categories.map((category) => category.id));
  const tasks: Task[] = [];
  for (const item of record.tasks) {
    const task = readTask(item);
    if (!task) return { ok: false };
    if (task.categoryId && !known.has(task.categoryId)) task.categoryId = null;
    tasks.push(task);
  }
  return { ok: true, tasks: sortTasks(tasks), categories: sortCategories(categories) };
}

function readCategory(value: unknown): Category | null {
  if (!value || typeof value !== "object") return null;
  const category = value as Record<string, unknown>;
  if (!isId(category.id)) return null;
  if (typeof category.name !== "string" || category.name !== category.name.trim()) return null;
  if (!category.name || category.name === UNCATEGORIZED_NAME || charLength(category.name) > CATEGORY_NAME_MAX) return null;
  if (typeof category.createdAt !== "number" || !Number.isFinite(category.createdAt)) return null;
  return { id: category.id, name: category.name, createdAt: category.createdAt };
}

export function sortCategories(categories: readonly Category[]): Category[] {
  return [...categories].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

function readTask(value: unknown): Task | null {
  if (!value || typeof value !== "object") return null;
  const task = value as Record<string, unknown>;
  if (!isId(task.id)) return null;
  if (typeof task.title !== "string" || task.title !== task.title.trim()) return null;
  if (!task.title || charLength(task.title) > TITLE_MAX) return null;
  if (typeof task.notes !== "string" || task.notes !== task.notes.trim()) return null;
  if (charLength(task.notes) > NOTES_MAX) return null;
  if (typeof task.completed !== "boolean") return null;
  if (task.photoId != null && !isId(task.photoId)) return null;
  if (task.categoryId != null && !isId(task.categoryId)) return null;
  if (typeof task.createdAt !== "number" || !Number.isFinite(task.createdAt)) return null;
  if (typeof task.updatedAt !== "number" || !Number.isFinite(task.updatedAt)) return null;
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    completed: task.completed,
    photoId: typeof task.photoId === "string" ? task.photoId : null,
    categoryId: typeof task.categoryId === "string" ? task.categoryId : null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 80;
}
