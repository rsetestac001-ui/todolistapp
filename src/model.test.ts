import { describe, expect, it } from "vitest";
import {
  NOTES_MAX,
  STORAGE_KEY,
  TITLE_MAX,
  countTasks,
  createTask,
  filterTasks,
  parseTasks,
  removeTask,
  serializeTasks,
  sortTasks,
  toggleTask,
  updateTask,
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

describe("storage parsing", () => {
  it("round-trips tasks and treats a missing value as an empty notebook", () => {
    expect(STORAGE_KEY).toBe("todolistapp.notebook.v1");
    const tasks = [createTask({ title: "買餸", notes: "菜\n水果" }, meta)];
    const raw = serializeTasks(tasks);
    expect(JSON.parse(raw)).toMatchObject({ version: 1, tasks });
    expect(parseTasks(raw)).toEqual({ ok: true, tasks });
    expect(parseTasks(null)).toEqual({ ok: true, tasks: [] });
  });

  it("rejects corrupt payloads instead of returning a partial list", () => {
    expect(parseTasks("{")).toEqual({ ok: false });
    expect(parseTasks("null")).toEqual({ ok: false });
    const raw = JSON.stringify({
      version: 1,
      tasks: [
        createTask({ title: "完好", notes: "" }, meta),
        { id: "bad", title: "  未修剪  ", notes: "", completed: false, createdAt: 1, updatedAt: 1 },
      ],
    });
    expect(parseTasks(raw)).toEqual({ ok: false });
    expect(parseTasks(JSON.stringify({ version: 2, tasks: [] }))).toEqual({ ok: false });
  });

  it("keeps text tasks that were saved before photos existed", () => {
    const legacy = JSON.stringify({
      version: 1,
      tasks: [{ id: "old", title: "舊筆記", notes: "沒有相片", completed: false, createdAt: 1, updatedAt: 1 }],
    });
    expect(parseTasks(legacy)).toEqual({
      ok: true,
      tasks: [
        {
          id: "old",
          title: "舊筆記",
          notes: "沒有相片",
          completed: false,
          photoId: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const withPhoto = createTask({ title: "有相", notes: "", photoId: "pic-1" }, meta);
    const parsed = parseTasks(serializeTasks([withPhoto]));
    if (!parsed.ok) throw new Error("expected photo task to parse");
    expect(parsed.tasks[0]?.photoId).toBe("pic-1");
    expect(updateTask([withPhoto], withPhoto.id, { title: "改名", notes: "" }, 5)[0]?.photoId).toBe("pic-1");
    expect(updateTask([withPhoto], withPhoto.id, { title: "改名", notes: "", photoId: null }, 6)[0]?.photoId).toBeNull();
  });
});
