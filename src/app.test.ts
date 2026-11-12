import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountApp, type KeyValueStore } from "./app";
import { STORAGE_KEY, serializeTasks, type Task } from "./model";
import { imageFileError, memoryPhotoRepository, PhotoError, type PhotoRepository, type PreparedPhoto } from "./photos";

let container: HTMLDivElement;
let clock = 1_700_000_000_000;
let sequence = 0;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  localStorage.clear();
  clock = 1_700_000_000_000;
  sequence = 0;
});

afterEach(() => {
  document.body.replaceChildren();
});

function setup(
  options: {
    storage?: KeyValueStore;
    photos?: PhotoRepository | null;
    preparePhoto?: (file: File) => Promise<PreparedPhoto>;
  } = {},
) {
  return mountApp(container, {
    storage: options.storage,
    photos: options.photos === undefined ? memoryPhotoRepository() : options.photos,
    preparePhoto: options.preparePhoto,
    now: () => ++clock,
    newId: () => `id-${++sequence}`,
  });
}

function input(id: string): HTMLInputElement {
  const node = container.querySelector(`#${id}`);
  if (!(node instanceof HTMLInputElement)) throw new Error(`Missing input ${id}`);
  return node;
}

function textarea(id: string): HTMLTextAreaElement {
  const node = container.querySelector(`#${id}`);
  if (!(node instanceof HTMLTextAreaElement)) throw new Error(`Missing textarea ${id}`);
  return node;
}

function fill(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true }));
}

function clickControl(label: string, root: ParentNode = container) {
  const matches = [...root.querySelectorAll("button, input")].filter((element) => {
    const text = element.textContent?.replace(/\s+/g, "") ?? "";
    return element.getAttribute("aria-label") === label || text === label.replace(/\s+/g, "");
  });
  const match = matches[0];
  if (matches.length !== 1 || !(match instanceof HTMLElement)) {
    throw new Error(`Expected one ${label}, found ${matches.length}`);
  }
  match.click();
}

function addTask(title: string, notes = "") {
  fill(input("add-title"), title);
  fill(textarea("add-notes"), notes);
  const form = container.querySelector("#add-form");
  if (!(form instanceof HTMLFormElement)) throw new Error("Missing add form");
  form.requestSubmit();
}

function titles(): string[] {
  return [...container.querySelectorAll(".task-title")].map((node) => node.textContent ?? "");
}

describe("todo notebook", () => {
  it("starts empty, explains local-only storage, and does not write until a task is added", () => {
    const store = memoryStore();
    setup({ storage: store });
    expect(container.querySelector("#storage-notice")?.textContent).toContain(
      "資料只留在此瀏覽器，不會同步到 GitHub 或其他裝置",
    );
    expect(container.querySelector("#storage-notice")?.textContent).toContain("不會上傳相片");
    expect(container.querySelector("#storage-notice")?.textContent).toContain("沒有相機都可以選擇相片檔");
    expect(container.querySelector("#empty-state")?.textContent).toContain("記事簿還是空白的");
    expect(container.querySelector("#summary")?.textContent).toBe("共 0 項 · 未完成 0 · 已完成 0");
    expect(container.querySelector(".task")).toBeNull();
    expect(store.getItem(STORAGE_KEY)).toBeNull();
  });

  it("rejects a blank title and keeps the notebook empty", () => {
    setup({ storage: memoryStore() });
    addTask("   ", "沒有標題");
    expect(container.querySelector("#add-error")?.textContent).toBe("請寫低標題。");
    expect(container.querySelector(".task")).toBeNull();
    expect(document.activeElement).toBe(input("add-title"));
  });

  it("adds, edits, completes, filters, and renders hostile multiline text as text", () => {
    setup({ storage: memoryStore() });
    const hostile = "<img src=x onerror=alert(1)>";
    addTask(hostile, "<script>alert(1)</script>\n第二行");

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(titles()).toEqual([hostile]);
    expect(container.querySelector(".task-notes")?.textContent).toBe("<script>alert(1)</script>\n第二行");
    expect(container.querySelector("#summary")?.textContent).toContain("未完成 1");
    expect(container.querySelector("#status")?.textContent).toBe(`已加入「${hostile}」`);
    expect(input("add-title").value).toBe("");

    clickControl(`編輯「${hostile}」`);
    fill(input("edit-title-id-1"), "買餸");
    fill(textarea("edit-notes-id-1"), "菜心\n豆腐");
    clickControl("儲存");
    expect(titles()).toEqual(["買餸"]);
    expect(container.querySelector(".task-notes")?.textContent).toBe("菜心\n豆腐");
    expect(container.querySelector("#status")?.textContent).toBe("已更新「買餸」");

    clickControl("標記「買餸」為已完成");
    expect(container.querySelector("#tab-completed")?.getAttribute("aria-selected")).not.toBe("true");
    clickControl("已完成，1 項");
    expect(container.querySelector("#tab-completed")?.getAttribute("aria-selected")).toBe("true");
    expect(titles()).toEqual(["買餸"]);
    expect(container.querySelector(".task")?.classList.contains("is-done")).toBe(true);

    clickControl("未完成，0 項");
    expect(container.querySelector("#empty-state")?.textContent).toContain("沒有未完成的記事");
    expect(titles()).toEqual([]);

    clickControl("已完成，1 項");
    clickControl("標記「買餸」為未完成");
    clickControl("未完成，1 項");
    expect(titles()).toEqual(["買餸"]);
    expect(container.querySelector("#empty-state")?.hasAttribute("hidden")).toBe(true);
  });

  it("requires a second step before deleting and can cancel", () => {
    const store = memoryStore();
    setup({ storage: store });
    addTask("覆郵件", "第一段\n第二段");
    clickControl("刪除「覆郵件」");
    expect(titles()).toEqual([]);
    expect(container.textContent).toContain("確定刪除「覆郵件」？刪除後無法復原。");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("取消刪除");
    expect(store.getItem(STORAGE_KEY)).toContain("覆郵件");

    clickControl("取消刪除");
    expect(titles()).toEqual(["覆郵件"]);
    expect(container.querySelector("#status")?.textContent).toBe("已取消刪除");

    clickControl("刪除「覆郵件」");
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(titles()).toEqual(["覆郵件"]);

    clickControl("刪除「覆郵件」");
    clickControl("確定刪除「覆郵件」");
    expect(container.querySelector(".task")).toBeNull();
    expect(container.querySelector("#empty-state")?.textContent).toContain("記事簿還是空白的");
    expect(container.querySelector("#status")?.textContent).toBe("已刪除「覆郵件」");
    const saved = store.getItem(STORAGE_KEY);
    expect(saved).toBeTruthy();
    expect(saved).not.toContain("覆郵件");
  });

  it("keeps an edit draft when delete is cancelled and discards a blank edit", () => {
    setup({ storage: memoryStore() });
    addTask("原本", "舊備註");
    clickControl("編輯「原本」");
    fill(input("edit-title-id-1"), "   ");
    clickControl("儲存");
    expect(container.querySelector("#edit-error-id-1")?.textContent).toBe("請寫低標題。");
    expect(titles()).toEqual([]);

    fill(input("edit-title-id-1"), "未儲存");
    clickControl("刪除「原本」");
    clickControl("取消刪除");
    expect(input("edit-title-id-1").value).toBe("未儲存");
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(titles()).toEqual(["原本"]);
  });

  it("submits multiline notes with Ctrl+Enter and moves filters with the keyboard", () => {
    setup({ storage: memoryStore() });
    fill(input("add-title"), "交租");
    const notes = textarea("add-notes");
    fill(notes, "第一行\n第二行");
    notes.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(container.querySelector(".task")).toBeNull();
    notes.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    expect(titles()).toEqual(["交租"]);
    expect(container.querySelector(".task-notes")?.textContent).toBe("第一行\n第二行");

    const all = container.querySelector("#tab-all");
    if (!(all instanceof HTMLButtonElement)) throw new Error("Missing all tab");
    all.focus();
    all.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(container.querySelector("#tab-active")?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement?.id).toBe("tab-active");
    expect(titles()).toEqual(["交租"]);
    all.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(container.querySelector("#empty-state")?.textContent).toContain("沒有已完成的記事");
  });

  it("reloads tasks from storage and refuses to overwrite corrupt data", () => {
    const store = memoryStore();
    const app = setup({ storage: store });
    addTask("買餸", "菜\n水果");
    clickControl("標記「買餸」為已完成");
    app.destroy();

    const next = document.createElement("div");
    document.body.append(next);
    mountApp(next, { storage: store, now: () => ++clock, newId: () => `id-${++sequence}` });
    expect(next.querySelector(".task-title")?.textContent).toBe("買餸");
    expect(next.querySelector(".task-notes")?.textContent).toBe("菜\n水果");
    expect(next.querySelector("input[type='checkbox']")?.hasAttribute("checked") ||
      (next.querySelector("input[type='checkbox']") as HTMLInputElement | null)?.checked).toBe(true);

    const corrupt = memoryStore({ [STORAGE_KEY]: "{" });
    const broken = document.createElement("div");
    document.body.append(broken);
    mountApp(broken, { storage: corrupt, now: () => ++clock, newId: () => `id-${++sequence}` });
    expect(broken.textContent).toContain("無法讀取此瀏覽器已儲存的記事");
    const title = broken.querySelector("#add-title");
    const form = broken.querySelector("#add-form");
    if (!(title instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) throw new Error("Missing form");
    title.value = "新記事";
    form.requestSubmit();
    expect(broken.querySelector(".task-title")?.textContent).toBe("新記事");
    expect(corrupt.getItem(STORAGE_KEY)).toBe("{");
  });

  it("keeps the session when the browser refuses to write", () => {
    const store = throwingStore();
    setup({ storage: store });
    addTask("暫時", "只係呢一頁");
    expect(titles()).toEqual(["暫時"]);
    expect(container.textContent).toContain("無法寫入此瀏覽器，最新變更只留在目前頁面。");
    expect(store.writes).toBe(1);
  });

  it("uses the browser store on a later visit", () => {
    const app = mountApp(container, { now: () => ++clock, newId: () => `id-${++sequence}` });
    addTask("留低", "");
    app.destroy();
    const next = document.createElement("div");
    document.body.append(next);
    mountApp(next, { now: () => ++clock, newId: () => `id-${++sequence}` });
    expect(next.querySelector(".task-title")?.textContent).toBe("留低");
    expect(localStorage.getItem(STORAGE_KEY)).toContain("留低");
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(saved ?? "null") as { tasks: Task[] };
    expect(parsed.tasks[0]?.notes).toBe("");
    expect(serializeTasks(parsed.tasks)).toBe(saved);
  });
});

// File inputs are simulated in happy-dom. Nothing here opens a physical camera.
describe("photo attachments (simulated file input, not a device camera)", () => {
  it("points 拍照 at an environment camera input and 選擇相片 at a plain image file", () => {
    setup();
    const camera = fileInput("camera");
    const library = fileInput("library");
    expect(camera.getAttribute("capture")).toBe("environment");
    expect(camera.accept).toBe("image/*");
    expect(library.hasAttribute("capture")).toBe(false);
    expect(library.accept).toBe("image/*");

    let cameraClicks = 0;
    let libraryClicks = 0;
    camera.addEventListener("click", () => {
      cameraClicks += 1;
    });
    library.addEventListener("click", () => {
      libraryClicks += 1;
    });
    clickControl("拍照");
    clickControl("選擇相片");
    expect(cameraClicks).toBe(1);
    expect(libraryClicks).toBe(1);
    expect(container.querySelector(".photo-hint")?.textContent).toContain("沒有相機可以選擇相片檔");
  });

  it("rejects a non-image and an empty file without creating a task", async () => {
    const photos = memoryPhotoRepository();
    setup({ photos });
    fill(input("add-title"), "買餸");
    chooseFile("library", new File(["hello"], "note.txt", { type: "text/plain" }));
    await flush();
    expect(container.querySelector(".photo-error")?.textContent).toBe("請選擇圖片檔。");
    expect(container.querySelector(".photo-preview")).toBeNull();

    chooseFile("camera", new File([], "empty.png", { type: "image/png" }));
    await flush();
    expect(container.querySelector(".photo-error")?.textContent).toBe("這張相片是空的。");
    expect(photos.records.size).toBe(0);

    clickControl("加入記事");
    expect(titles()).toEqual(["買餸"]);
    expect(container.querySelector(".task-photo")).toBeNull();
  });

  it("stores a selected image in the photo repository, reloads it, and can remove it", async () => {
    const store = memoryStore();
    const photos = memoryPhotoRepository();
    const app = setup({ storage: store, photos, preparePhoto: fakePrepare });
    fill(input("add-title"), "買餸");
    fill(textarea("add-notes"), "菜心\n豆腐");
    chooseFile("library", new File(["png"], "market.png", { type: "image/png" }));
    await flush();
    const preview = container.querySelector(".photo-preview img");
    expect(preview).toBeInstanceOf(HTMLImageElement);
    expect(preview?.getAttribute("alt")).toBe("相片預覽");
    expect(preview?.getAttribute("src")?.startsWith("blob:")).toBe(true);

    clickControl("加入記事");
    await flush();
    expect(titles()).toEqual(["買餸"]);
    expect(container.querySelector(".task-photo")?.getAttribute("alt")).toBe("這則記事的相片");
    const saved = store.getItem(STORAGE_KEY) ?? "";
    expect(saved).not.toContain("jpeg-bytes");
    const parsed = JSON.parse(saved) as { tasks: Task[] };
    const photoId = parsed.tasks[0]?.photoId;
    expect(photoId).toBeTruthy();
    expect(await photos.records.get(photoId ?? "")?.blob.text()).toBe("jpeg-bytes");

    app.destroy();
    const next = document.createElement("div");
    document.body.append(next);
    const reloaded = mountApp(next, {
      storage: store,
      photos,
      preparePhoto: fakePrepare,
      now: () => ++clock,
      newId: () => `id-${++sequence}`,
    });
    await flush();
    expect(next.querySelector(".task-notes")?.textContent).toBe("菜心\n豆腐");
    expect(next.querySelector(".task-photo")).toBeInstanceOf(HTMLImageElement);

    clickControl("編輯「買餸」", next);
    clickControl("移除相片", next);
    expect(next.querySelector(".photo-preview")).toBeNull();
    clickControl("儲存", next);
    await flush();
    expect(next.querySelector(".task-photo")).toBeNull();
    expect(photos.records.size).toBe(0);
    reloaded.destroy();

    const again = document.createElement("div");
    document.body.append(again);
    mountApp(again, {
      storage: store,
      photos,
      now: () => ++clock,
      newId: () => `id-${++sequence}`,
    });
    await flush();
    expect(again.querySelector(".task-title")?.textContent).toBe("買餸");
    expect(again.querySelector(".task-photo")).toBeNull();
    expect(again.textContent).not.toContain("相片未能讀取");
  });

  it("keeps a legacy text task and does not save a note when the photo store rejects the blob", async () => {
    const legacy = JSON.stringify({
      version: 1,
      tasks: [{ id: "old", title: "舊筆記", notes: "只係文字", completed: false, createdAt: 1, updatedAt: 2 }],
    });
    setup({ storage: memoryStore({ [STORAGE_KEY]: legacy }) });
    expect(titles()).toEqual(["舊筆記"]);
    expect(container.querySelector(".task-photo")).toBeNull();

    const photos = memoryPhotoRepository();
    photos.put = async () => {
      throw new Error("quota");
    };
    document.body.replaceChildren();
    container = document.createElement("div");
    document.body.append(container);
    setup({ photos, preparePhoto: fakePrepare });
    fill(input("add-title"), "未能存");
    chooseFile("camera", new File(["png"], "shot.png", { type: "image/png" }));
    await flush();
    clickControl("加入記事");
    await flush();
    expect(titles()).toEqual([]);
    expect(container.querySelector(".photo-error")?.textContent).toContain("相片未能儲存");
    expect(photos.records.size).toBe(0);
    expect(input("add-title").value).toBe("未能存");
  });
});

function fileInput(kind: "camera" | "library", root: ParentNode = container): HTMLInputElement {
  const node = root.querySelector(`#add-form input[data-photo-input="${kind}"]`);
  if (!(node instanceof HTMLInputElement)) throw new Error(`Missing ${kind} input`);
  return node;
}

function chooseFile(kind: "camera" | "library", file: File) {
  const input = fileInput(kind);
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function fakePrepare(file: File): Promise<PreparedPhoto> {
  const problem = imageFileError(file);
  if (problem) return Promise.reject(new PhotoError(problem));
  return Promise.resolve({
    blob: new Blob(["jpeg-bytes"], { type: "image/jpeg" }),
    contentType: "image/jpeg",
    width: 12,
    height: 8,
  });
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
  };
}

function throwingStore(): KeyValueStore & { writes: number } {
  const store = {
    writes: 0,
    getItem() {
      return null;
    },
    setItem() {
      store.writes += 1;
      throw new Error("quota");
    },
  };
  return store;
}
