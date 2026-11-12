import { describe, expect, it } from "vitest";
import {
  CATEGORY_NAME_MAX,
  NOTES_MAX,
  STORAGE_KEY,
  TITLE_MAX,
  countTasks,
  createCategory,
  createTask,
  deleteCategory,
  filterTasks,
  parseNotebook,
  removeTask,
  renameCategory,
  serializeNotebook,
  sortTasks,
  tasksForCategory,
  toggleTask,
  updateTask,
  validateCategoryName,
  validateNotes,
  validateTitle,
} from "./model";

const meta = { id: "task-1", now: 1_700_000_000_000 };

describe("validateTitle", () => {
  it("rejects blank titles and accepts trimmed text", () => {
    expect(validateTitle("   ")).toBe("請寫低標題。");
    expect(validateTitle("  買餸  ")).toBeNull();
  });

  it("rejects titles over the limit", () => {
    expect(validateTitle("事".repeat(TITLE_MAX + 1))).toMatch(/不可超過/);
    expect(validateTitle("事".repeat(TITLE_MAX))).toBeNull();
  });
});

describe("validateNotes", () => {
  it("allows empty notes and rejects notes over the limit", () => {
    expect(validateNotes("  \n  ")).toBeNull();
    expect(validateNotes("字".repeat(NOTES_MAX + 1))).toMatch(/不可超過/);
  });
});

describe("task mutations", () => {
  it("creates a task and preserves internal multiline notes", () => {
    const task = createTask(
      { title: "  覆郵件  ", notes: "  第一行\n\n第二行  " },
      meta,
    );
    expect(task).toEqual({
      id: "task-1",
      title: "覆郵件",
      notes: "第一行\n\n第二行",
      completed: false,
      photoId: null,
      categoryId: null,
      createdAt: meta.now,
      updatedAt: meta.now,
    });
  });

  it("edits title and notes, toggles completion, and removes the task", () => {
    const original = createTask({ title: "覆郵件", notes: "草稿" }, meta);
    const edited = updateTask([original], original.id, { title: "覆客", notes: "已寫\n低" }, 20);
    expect(edited[0]).toMatchObject({ title: "覆客", notes: "已寫\n低", updatedAt: 20, completed: false });

    const done = toggleTask(edited, original.id, 30);
    expect(done[0]?.completed).toBe(true);
    const undone = toggleTask(done, original.id, 40);
    expect(undone[0]?.completed).toBe(false);

    expect(removeTask(undone, original.id)).toEqual([]);
    expect(removeTask(undone, "missing")).toEqual(undone);
  });

  it("does not create a task with an empty title", () => {
    expect(() => createTask({ title: " ", notes: "" }, meta)).toThrow(/標題/);
  });
});

describe("filters and counts", () => {
  const tasks = sortTasks([
    createTask({ title: "較舊", notes: "" }, { id: "a", now: 1 }),
    createTask({ title: "較新", notes: "" }, { id: "b", now: 2 }),
  ]);

  it("sorts newest first and counts each bucket", () => {
    expect(tasks.map((task) => task.title)).toEqual(["較新", "較舊"]);
    const done = toggleTask(tasks, "a", 3);
    expect(countTasks(done)).toEqual({ all: 2, active: 1, completed: 1 });
    expect(filterTasks(done, "active").map((task) => task.id)).toEqual(["b"]);
    expect(filterTasks(done, "completed").map((task) => task.id)).toEqual(["a"]);
    expect(filterTasks(done, "all")).toHaveLength(2);
  });
});

describe("categories", () => {
  it("rejects blank, whitespace, reserved, duplicate, and over-long names", () => {
    expect(validateCategoryName("   ", [])).toBe("請寫低分類名稱。");
    expect(validateCategoryName(" 未分類 ", [])).toBe("「未分類」唔可以做分類名稱。");
    expect(validateCategoryName("類".repeat(CATEGORY_NAME_MAX + 1), [])).toMatch(/不可超過/);
    const created = createCategory([], "  家事  ", { id: "cat-1", now: 5 });
    expect(created.category).toEqual({ id: "cat-1", name: "家事", createdAt: 5 });
    expect(validateCategoryName("家事", created.categories)).toBe("已經有呢個分類。");
    expect(validateCategoryName("家事", created.categories, "cat-1")).toBeNull();
    expect(() => renameCategory(created.categories, "cat-1", "   ")).toThrow(/分類名稱/);
  });

  it("renames without changing the id and moves notes to 未分類 without touching photos", () => {
    const first = createCategory([], "家事", { id: "cat-1", now: 1 });
    const renamed = renameCategory(first.categories, "cat-1", "  買餸  ");
    expect(renamed).toEqual([{ id: "cat-1", name: "買餸", createdAt: 1 }]);
    const task = createTask({ title: "洗碗", notes: "今晚", photoId: "pic-9", categoryId: "cat-1" }, meta);
    const removed = deleteCategory(renamed, [task], "cat-1");
    expect(removed.categories).toEqual([]);
    expect(removed.tasks[0]).toMatchObject({
      id: task.id,
      title: "洗碗",
      notes: "今晚",
      photoId: "pic-9",
      categoryId: null,
    });
  });

  it("filters a category together with completion status", () => {
    const home = createTask({ title: "洗碗", notes: "", categoryId: "cat-1" }, { id: "a", now: 1 });
    const done = toggleTask([home], "a", 2)[0];
    if (!done) throw new Error("missing task");
    const errand = createTask({ title: "交租", notes: "", categoryId: "cat-1" }, { id: "b", now: 3 });
    const loose = createTask({ title: "覆郵件", notes: "", categoryId: null }, { id: "c", now: 4 });
    const tasks = [done, errand, loose];
    const homeTasks = tasksForCategory(tasks, { kind: "category", id: "cat-1" });
    expect(filterTasks(homeTasks, "active").map((task) => task.id)).toEqual(["b"]);
    expect(filterTasks(homeTasks, "completed").map((task) => task.id)).toEqual(["a"]);
    expect(tasksForCategory(tasks, { kind: "uncategorized" }).map((task) => task.id)).toEqual(["c"]);
    expect(filterTasks(tasks, "active").map((task) => task.id)).toEqual(["b", "c"]);
  });
});

describe("storage parsing", () => {
  it("round-trips tasks and categories, and treats a missing value as an empty notebook", () => {
    expect(STORAGE_KEY).toBe("todolistapp.notebook.v1");
    const tasks = [createTask({ title: "買餸", notes: "菜\n水果", categoryId: "cat-1" }, meta)];
    const categories = createCategory([], "家事", { id: "cat-1", now: 4 }).categories;
    const raw = serializeNotebook({ tasks, categories });
    expect(JSON.parse(raw)).toMatchObject({ version: 2, categories, tasks });
    expect(parseNotebook(raw)).toEqual({ ok: true, tasks, categories });
    expect(parseNotebook(null)).toEqual({ ok: true, tasks: [], categories: [] });
  });

  it("rejects corrupt payloads instead of returning a partial list", () => {
    expect(parseNotebook("{")).toEqual({ ok: false });
    expect(parseNotebook("null")).toEqual({ ok: false });
    const raw = JSON.stringify({
      version: 1,
      tasks: [
        createTask({ title: "完好", notes: "" }, meta),
        { id: "bad", title: "  未修剪  ", notes: "", completed: false, createdAt: 1, updatedAt: 1 },
      ],
    });
    expect(parseNotebook(raw)).toEqual({ ok: false });
    expect(parseNotebook(JSON.stringify({ version: 2, tasks: [] }))).toEqual({ ok: false });
    expect(parseNotebook(JSON.stringify({ version: 3, categories: [], tasks: [] }))).toEqual({ ok: false });
  });

  it("keeps text tasks and photo ids that were saved before categories existed", () => {
    const legacy = JSON.stringify({
      version: 1,
      tasks: [
        { id: "old", title: "舊筆記", notes: "沒有相片", completed: false, createdAt: 1, updatedAt: 1 },
        {
          id: "photo",
          title: "舊相片",
          notes: "仍然在",
          completed: true,
          photoId: "pic-keep",
          createdAt: 2,
          updatedAt: 3,
        },
      ],
    });
    expect(parseNotebook(legacy)).toEqual({
      ok: true,
      categories: [],
      tasks: [
        {
          id: "photo",
          title: "舊相片",
          notes: "仍然在",
          completed: true,
          photoId: "pic-keep",
          categoryId: null,
          createdAt: 2,
          updatedAt: 3,
        },
        {
          id: "old",
          title: "舊筆記",
          notes: "沒有相片",
          completed: false,
          photoId: null,
          categoryId: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const withPhoto = createTask({ title: "有相", notes: "", photoId: "pic-1", categoryId: "cat-1" }, meta);
    const parsed = parseNotebook(serializeNotebook({ tasks: [withPhoto], categories: [] }));
    if (!parsed.ok) throw new Error("expected photo task to parse");
    expect(parsed.tasks[0]?.photoId).toBe("pic-1");
    expect(parsed.tasks[0]?.categoryId).toBeNull();
    expect(updateTask([withPhoto], withPhoto.id, { title: "改名", notes: "" }, 5)[0]).toMatchObject({
      photoId: "pic-1",
      categoryId: "cat-1",
    });
    expect(updateTask([withPhoto], withPhoto.id, { title: "改名", notes: "", photoId: null, categoryId: null }, 6)[0]).toMatchObject({
      photoId: null,
      categoryId: null,
    });
  });
});
