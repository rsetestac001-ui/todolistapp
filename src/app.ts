import {
  NOTES_MAX,
  STORAGE_KEY,
  TITLE_MAX,
  type FilterId,
  type Task,
  countTasks,
  createTask,
  filterTasks,
  isFilterId,
  parseTasks,
  removeTask,
  serializeTasks,
  sortTasks,
  toggleTask,
  updateTask,
  validateNotes,
  validateTitle,
} from "./model";

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type MountOptions = {
  storage?: KeyValueStore;
  now?: () => number;
  newId?: () => string;
};

type FocusRequest =
  | { kind: "add-title" }
  | { kind: "add-notes" }
  | { kind: "tab"; filter: FilterId }
  | { kind: "checkbox"; id: string }
  | { kind: "edit-title"; id: string }
  | { kind: "edit-notes"; id: string }
  | { kind: "edit-button"; id: string }
  | { kind: "delete-button"; id: string }
  | { kind: "cancel-delete"; id: string };

const FILTER_ORDER: FilterId[] = ["all", "active", "completed"];

const FILTER_LABEL: Record<FilterId, string> = {
  all: "全部",
  active: "未完成",
  completed: "已完成",
};

const STORAGE_NOTE =
  "資料只留在此瀏覽器，不會同步到 GitHub 或其他裝置。清除網站資料或換瀏覽器後便會消失。";

export function mountApp(container: HTMLElement, options: MountOptions = {}): { destroy(): void } {
  const doc = container.ownerDocument;
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? defaultId;
  const storage = options.storage ?? probeLocalStorage();
  const abort = new AbortController();

  let tasks: Task[] = [];
  let unavailable = false;
  let loadFailed = false;
  let canPersist = false;
  if (!storage) {
    unavailable = true;
  } else {
    const loaded = readStore(storage);
    if (!loaded.ok) {
      loadFailed = true;
    } else {
      tasks = loaded.tasks;
      canPersist = true;
    }
  }

  let filter: FilterId = "all";
  let editingId: string | null = null;
  let editDraft: { title: string; notes: string } | null = null;
  let pendingDeleteId: string | null = null;
  let addError: string | null = null;
  let editError: string | null = null;
  let saveFailed = false;
  let statusText = "";
  let statusDirty = false;
  let pendingFocus: FocusRequest | null = null;

  const root = el(doc, "div", { className: "sheet" });
  const paper = el(doc, "div", { className: "paper" });
  const inner = el(doc, "div", { className: "paper-inner" });
  const header = el(doc, "header", { className: "masthead" });
  const notice = el(doc, "p", { className: "notice", id: "storage-notice", text: STORAGE_NOTE });
  notice.setAttribute("role", "note");
  const warnings = el(doc, "div", { className: "warnings", id: "warnings" });
  warnings.setAttribute("aria-live", "polite");
  header.append(
    el(doc, "p", { className: "kicker", text: "本機記事" }),
    el(doc, "h1", { text: "待辦記事簿" }),
    el(doc, "p", { className: "lede", text: "寫低要做的事同備註。可以改、可以剔完，刪除前會再問一次。" }),
    notice,
    warnings,
  );

  const addSection = el(doc, "section", { className: "composer", attrs: { "aria-labelledby": "add-heading" } });
  const addForm = el(doc, "form", { id: "add-form", attrs: { novalidate: "novalidate" } });
  const addTitleField = field(doc, {
    id: "add-title",
    name: "title",
    label: "標題",
    control: "input",
    maxLength: TITLE_MAX,
    required: true,
    placeholder: "要做的事",
  });
  const addNotesField = field(doc, {
    id: "add-notes",
    name: "notes",
    label: "備註",
    hint: "（可選，可分行）",
    control: "textarea",
    maxLength: NOTES_MAX,
    placeholder: "補充細節，可分行",
  });
  const addErrorEl = el(doc, "p", {
    className: "field-error",
    id: "add-error",
    attrs: { role: "alert" },
  });
  const addButton = el(doc, "button", {
    className: "btn btn-primary",
    text: "加入記事",
    attrs: { type: "submit" },
  });
  addForm.append(addTitleField.wrap, addNotesField.wrap, addErrorEl, addButton);
  addSection.append(el(doc, "h2", { id: "add-heading", text: "新增記事" }), addForm);

  const listSection = el(doc, "section", { className: "notebook", attrs: { "aria-labelledby": "list-heading" } });
  const tablist = el(doc, "div", {
    className: "filters",
    attrs: { role: "tablist", "aria-label": "篩選記事" },
  });
  const summary = el(doc, "p", { className: "summary", id: "summary" });
  const panel = el(doc, "div", { id: "task-panel", attrs: { role: "tabpanel" } });
  const list = el(doc, "ul", { className: "tasks", id: "task-list" });
  const empty = el(doc, "div", { className: "empty", id: "empty-state" });
  panel.append(list, empty);
  listSection.append(el(doc, "h2", { id: "list-heading", text: "記事列表" }), tablist, summary, panel);

  const status = el(doc, "p", { className: "sr-only", id: "status", attrs: { role: "status" } });
  const main = el(doc, "main");
  main.append(addSection, listSection, status);
  inner.append(header, main);
  paper.append(inner);
  root.append(paper);

  const tabButtons = new Map<FilterId, HTMLButtonElement>();
  for (const id of FILTER_ORDER) {
    const button = el(doc, "button", {
      className: "filter",
      id: `tab-${id}`,
      attrs: { type: "button", role: "tab", "aria-controls": "task-panel" },
    });
    button.dataset.filter = id;
    tablist.append(button);
    tabButtons.set(id, button);
  }

  container.replaceChildren(root);

  function announce(message: string) {
    statusText = message;
    statusDirty = true;
  }

  function persist() {
    if (!storage || !canPersist) return;
    try {
      storage.setItem(STORAGE_KEY, serializeTasks(tasks));
      saveFailed = false;
    } catch {
      saveFailed = true;
    }
  }

  function render() {
    renderWarnings();
    renderAddError();
    renderTabs();
    renderList();
    if (statusDirty) {
      status.textContent = statusText;
      statusDirty = false;
    }
    applyFocus();
  }

  function renderWarnings() {
    const messages: string[] = [];
    if (unavailable) messages.push("此瀏覽器未能使用本機儲存，記事不會在重新載入後保留。");
    if (loadFailed) messages.push("無法讀取此瀏覽器已儲存的記事。為免覆蓋原有資料，今次不會寫入。");
    if (saveFailed) messages.push("無法寫入此瀏覽器，最新變更只留在目前頁面。");
    warnings.replaceChildren(
      ...messages.map((message) => el(doc, "p", { className: "warning", text: message })),
    );
    warnings.hidden = messages.length === 0;
  }

  function renderAddError() {
    addErrorEl.textContent = addError ?? "";
    addErrorEl.hidden = addError === null;
    const notesError = addError?.startsWith("備註") ?? false;
    setInvalid(addTitleField.control, Boolean(addError) && !notesError, "add-error");
    setInvalid(addNotesField.control, notesError, "add-error");
  }

  function renderTabs() {
    const counts = countTasks(tasks);
    const numbers: Record<FilterId, number> = {
      all: counts.all,
      active: counts.active,
      completed: counts.completed,
    };
    for (const id of FILTER_ORDER) {
      const button = tabButtons.get(id);
      if (!button) continue;
      const selected = id === filter;
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
      button.setAttribute("aria-label", `${FILTER_LABEL[id]}，${numbers[id]} 項`);
      button.replaceChildren(
        el(doc, "span", { text: FILTER_LABEL[id] }),
        el(doc, "span", { className: "tab-count", text: String(numbers[id]) }),
      );
    }
    panel.setAttribute("aria-labelledby", `tab-${filter}`);
    const visibleCount = filterTasks(tasks, filter).length;
    if (tasks.length === 0) {
      summary.textContent = "共 0 項 · 未完成 0 · 已完成 0";
    } else if (filter === "all") {
      summary.textContent = `顯示全部 ${counts.all} 項 · 未完成 ${counts.active} · 已完成 ${counts.completed}`;
    } else if (filter === "active") {
      summary.textContent = `顯示 ${visibleCount} 項未完成 · 共 ${counts.all} 項`;
    } else {
      summary.textContent = `顯示 ${visibleCount} 項已完成 · 共 ${counts.all} 項`;
    }
  }

  function renderList() {
    const visible = filterTasks(tasks, filter);
    list.replaceChildren();
    if (visible.length === 0) {
      list.hidden = true;
      empty.hidden = false;
      empty.replaceChildren();
      const title = el(doc, "p", { className: "empty-title" });
      const body = el(doc, "p", { className: "empty-body" });
      if (tasks.length === 0) {
        title.textContent = "記事簿還是空白的";
        body.textContent = "在上方寫低標題，就可以加入第一件事。";
      } else if (filter === "active") {
        title.textContent = "沒有未完成的記事";
        body.textContent = "未完成的事會顯示喺呢度。";
      } else {
        title.textContent = "沒有已完成的記事";
        body.textContent = "剔完的事會顯示喺呢度。";
      }
      empty.append(title, body);
      return;
    }
    list.hidden = false;
    empty.hidden = true;
    empty.replaceChildren();
    for (const task of visible) list.append(renderTask(task));
  }

  function renderTask(task: Task): HTMLLIElement {
    const item = el(doc, "li", { className: task.completed ? "task is-done" : "task" });
    item.dataset.id = task.id;
    if (pendingDeleteId === task.id) {
      item.append(
        el(doc, "p", { className: "confirm-copy", text: `確定刪除「${task.title}」？刪除後無法復原。` }),
        actions(doc, [
          actionButton(doc, "cancel-delete", "取消", "取消刪除"),
          actionButton(doc, "confirm-delete", "確定刪除", `確定刪除「${task.title}」`, "btn btn-danger"),
        ]),
      );
      return item;
    }
    if (editingId === task.id) {
      item.append(renderEditor(task));
      return item;
    }
    const row = el(doc, "div", { className: "task-row" });
    const label = el(doc, "label", { className: "check" });
    const checkbox = doc.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.completed;
    checkbox.setAttribute(
      "aria-label",
      task.completed ? `標記「${task.title}」為未完成` : `標記「${task.title}」為已完成`,
    );
    label.append(checkbox);
    const copy = el(doc, "div", { className: "task-copy" });
    copy.append(el(doc, "h3", { className: "task-title", text: task.title }));
    if (task.notes) copy.append(el(doc, "p", { className: "task-notes", text: task.notes }));
    row.append(label, copy);
    item.append(
      row,
      actions(doc, [
        actionButton(doc, "edit", "編輯", `編輯「${task.title}」`),
        actionButton(doc, "delete", "刪除", `刪除「${task.title}」`, "btn btn-ghost btn-quiet-danger"),
      ]),
    );
    return item;
  }

  function renderEditor(task: Task): HTMLFormElement {
    const draft = editDraft ?? { title: task.title, notes: task.notes };
    const form = el(doc, "form", { className: "edit-form", attrs: { "data-form": "edit", novalidate: "novalidate" } });
    const titleId = `edit-title-${task.id}`;
    const notesId = `edit-notes-${task.id}`;
    const errorId = `edit-error-${task.id}`;
    const titleField = field(doc, {
      id: titleId,
      name: "title",
      label: "標題",
      control: "input",
      maxLength: TITLE_MAX,
      required: true,
      value: draft.title,
    });
    const notesField = field(doc, {
      id: notesId,
      name: "notes",
      label: "備註",
      hint: "（可選，可分行）",
      control: "textarea",
      maxLength: NOTES_MAX,
      value: draft.notes,
    });
    const error = el(doc, "p", { className: "field-error", id: errorId, attrs: { role: "alert" } });
    error.textContent = editError ?? "";
    error.hidden = editError === null;
    const notesError = editError?.startsWith("備註") ?? false;
    setInvalid(titleField.control, Boolean(editError) && !notesError, errorId);
    setInvalid(notesField.control, notesError, errorId);
    const deleteRow = el(doc, "div", { className: "edit-delete" });
    deleteRow.append(actionButton(doc, "delete", "刪除", `刪除「${task.title}」`, "btn btn-ghost btn-quiet-danger"));
    form.append(
      titleField.wrap,
      notesField.wrap,
      error,
      actions(doc, [
        actionButton(doc, "cancel-edit", "取消", "取消編輯"),
        el(doc, "button", { className: "btn btn-primary", text: "儲存", attrs: { type: "submit" } }),
      ]),
      deleteRow,
    );
    return form;
  }

  function applyFocus() {
    const request = pendingFocus;
    pendingFocus = null;
    if (!request) return;
    const target = focusTarget(request);
    if (!target) return;
    target.focus();
    if (target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type === "text")) {
      const end = target.value.length;
      target.setSelectionRange(end, end);
    }
  }

  function focusTarget(request: FocusRequest): HTMLElement | null {
    if (request.kind === "add-title") return addTitleField.control;
    if (request.kind === "add-notes") return addNotesField.control;
    if (request.kind === "tab") return tabButtons.get(request.filter) ?? null;
    if (request.kind === "edit-title") return doc.getElementById(`edit-title-${request.id}`);
    if (request.kind === "edit-notes") return doc.getElementById(`edit-notes-${request.id}`);
    if (request.kind === "checkbox") return taskControl(request.id, 'input[type="checkbox"]');
    if (request.kind === "edit-button") return taskControl(request.id, '[data-action="edit"]');
    if (request.kind === "delete-button") return taskControl(request.id, '[data-action="delete"]');
    return taskControl(request.id, '[data-action="cancel-delete"]');
  }

  function taskControl(id: string, selector: string): HTMLElement | null {
    const node = list.querySelector(`[data-id="${cssEscape(id)}"] ${selector}`);
    return node instanceof HTMLElement ? node : null;
  }

  function onAddSubmit(event: Event) {
    event.preventDefault();
    const title = addTitleField.control.value;
    const notes = addNotesField.control.value;
    const error = validateTitle(title) ?? validateNotes(notes);
    if (error) {
      addError = error;
      pendingFocus = error.startsWith("備註") ? { kind: "add-notes" } : { kind: "add-title" };
      render();
      return;
    }
    let task: Task;
    try {
      task = createTask({ title, notes }, { id: newId(), now: now() });
    } catch (caught) {
      addError = caught instanceof Error ? caught.message : "無法加入。";
      pendingFocus = { kind: "add-title" };
      render();
      return;
    }
    tasks = sortTasks([task, ...tasks]);
    addError = null;
    addTitleField.control.value = "";
    addNotesField.control.value = "";
    persist();
    announce(`已加入「${task.title}」`);
    pendingFocus = { kind: "add-title" };
    render();
  }

  function onEditSubmit(event: Event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.dataset.form !== "edit") return;
    event.preventDefault();
    const id = form.closest<HTMLElement>("[data-id]")?.dataset.id;
    if (!id) return;
    syncDraft(form);
    const draft = editDraft ?? { title: "", notes: "" };
    const error = validateTitle(draft.title) ?? validateNotes(draft.notes);
    if (error) {
      editError = error;
      pendingFocus = error.startsWith("備註") ? { kind: "edit-notes", id } : { kind: "edit-title", id };
      render();
      return;
    }
    let next: Task[];
    try {
      next = updateTask(tasks, id, draft, now());
    } catch (caught) {
      editError = caught instanceof Error ? caught.message : "無法儲存。";
      pendingFocus = { kind: "edit-title", id };
      render();
      return;
    }
    tasks = sortTasks(next);
    const saved = tasks.find((task) => task.id === id);
    editingId = null;
    editDraft = null;
    editError = null;
    persist();
    announce(`已更新「${saved?.title ?? draft.title.trim()}」`);
    pendingFocus = { kind: "edit-button", id };
    render();
  }

  function syncDraft(form: HTMLFormElement) {
    const title = form.elements.namedItem("title");
    const notes = form.elements.namedItem("notes");
    if (title instanceof HTMLInputElement && notes instanceof HTMLTextAreaElement) {
      editDraft = { title: title.value, notes: notes.value };
    }
  }

  function captureOpenDraft() {
    if (!editingId) return;
    const form = list.querySelector<HTMLFormElement>('form[data-form="edit"]');
    if (form) syncDraft(form);
  }

  function beginEdit(id: string) {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    if (pendingDeleteId === id) pendingDeleteId = null;
    editingId = id;
    editDraft = { title: task.title, notes: task.notes };
    editError = null;
    pendingFocus = { kind: "edit-title", id };
    render();
  }

  function beginDelete(id: string) {
    captureOpenDraft();
    pendingDeleteId = id;
    pendingFocus = { kind: "cancel-delete", id };
    render();
  }

  function cancelEdit(id: string) {
    editingId = null;
    editDraft = null;
    editError = null;
    pendingFocus = { kind: "edit-button", id };
    render();
  }

  function cancelDelete(id: string) {
    pendingDeleteId = null;
    pendingFocus = editingId === id ? { kind: "edit-title", id } : { kind: "delete-button", id };
    announce("已取消刪除");
    render();
  }

  function confirmDelete(id: string) {
    const task = tasks.find((item) => item.id === id);
    tasks = removeTask(tasks, id);
    if (editingId === id) {
      editingId = null;
      editDraft = null;
      editError = null;
    }
    pendingDeleteId = null;
    persist();
    announce(task ? `已刪除「${task.title}」` : "已刪除記事");
    const next = filterTasks(tasks, filter)[0];
    pendingFocus = next ? { kind: "checkbox", id: next.id } : { kind: "add-title" };
    render();
  }

  function onListClick(event: Event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button");
    if (!(button instanceof HTMLButtonElement) || !list.contains(button)) return;
    const action = button.dataset.action;
    const id = button.closest<HTMLElement>("[data-id]")?.dataset.id;
    if (!action || !id) return;
    if (action === "edit") beginEdit(id);
    else if (action === "delete") beginDelete(id);
    else if (action === "cancel-edit") cancelEdit(id);
    else if (action === "cancel-delete") cancelDelete(id);
    else if (action === "confirm-delete") confirmDelete(id);
  }

  function onToggle(event: Event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
    const id = target.closest<HTMLElement>("[data-id]")?.dataset.id;
    if (!id) return;
    captureOpenDraft();
    tasks = sortTasks(toggleTask(tasks, id, now()));
    const task = tasks.find((item) => item.id === id);
    persist();
    if (task) announce(task.completed ? `已完成「${task.title}」` : `已標為未完成「${task.title}」`);
    pendingFocus = { kind: "checkbox", id };
    render();
  }

  function onInput(event: Event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const form = target.closest("form");
    if (form === addForm) {
      if (!addError) return;
      addError = null;
      renderAddError();
      return;
    }
    if (!(form instanceof HTMLFormElement) || form.dataset.form !== "edit") return;
    syncDraft(form);
    if (!editError) return;
    editError = null;
    const errorEl = form.querySelector(".field-error");
    if (errorEl instanceof HTMLElement) {
      errorEl.textContent = "";
      errorEl.hidden = true;
    }
    for (const control of form.querySelectorAll("input, textarea")) {
      control.removeAttribute("aria-invalid");
      control.removeAttribute("aria-describedby");
    }
  }

  function onKeyDown(event: Event) {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key === "Escape") {
      if (pendingDeleteId) {
        cancelDelete(pendingDeleteId);
        event.preventDefault();
        return;
      }
      if (editingId) {
        cancelEdit(editingId);
        event.preventDefault();
      }
      return;
    }
    if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement) || !target.form) return;
    event.preventDefault();
    submitForm(target.form);
  }

  function onTabClick(event: Event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button");
    if (!(button instanceof HTMLButtonElement) || !tablist.contains(button)) return;
    const next = button.dataset.filter;
    if (!next || !isFilterId(next)) return;
    filter = next;
    pendingFocus = { kind: "tab", filter };
    render();
  }

  function onTabKeyDown(event: Event) {
    if (!(event instanceof KeyboardEvent)) return;
    const index = FILTER_ORDER.indexOf(filter);
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % FILTER_ORDER.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + FILTER_ORDER.length) % FILTER_ORDER.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = FILTER_ORDER.length - 1;
    else return;
    event.preventDefault();
    const next = FILTER_ORDER[nextIndex];
    if (!next) return;
    filter = next;
    pendingFocus = { kind: "tab", filter };
    render();
  }

  const signal = abort.signal;
  addForm.addEventListener("submit", onAddSubmit, { signal });
  list.addEventListener("submit", onEditSubmit, { signal });
  list.addEventListener("click", onListClick, { signal });
  list.addEventListener("change", onToggle, { signal });
  container.addEventListener("input", onInput, { signal });
  container.addEventListener("keydown", onKeyDown, { signal });
  tablist.addEventListener("click", onTabClick, { signal });
  tablist.addEventListener("keydown", onTabKeyDown, { signal });

  render();

  return {
    destroy() {
      abort.abort();
      container.replaceChildren();
    },
  };
}

function readStore(storage: KeyValueStore): { ok: true; tasks: Task[] } | { ok: false } {
  try {
    return parseTasks(storage.getItem(STORAGE_KEY));
  } catch {
    return { ok: false };
  }
}

function probeLocalStorage(): KeyValueStore | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const probe = `${STORAGE_KEY}.probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

function defaultId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `task-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function submitForm(form: HTMLFormElement) {
  if (typeof form.requestSubmit === "function") {
    form.requestSubmit();
    return;
  }
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function setInvalid(control: HTMLElement, invalid: boolean, describedBy: string) {
  if (invalid) {
    control.setAttribute("aria-invalid", "true");
    control.setAttribute("aria-describedby", describedBy);
    return;
  }
  control.removeAttribute("aria-invalid");
  control.removeAttribute("aria-describedby");
}

function actionButton(
  doc: Document,
  action: string,
  text: string,
  label: string,
  className = "btn btn-ghost",
): HTMLButtonElement {
  return el(doc, "button", {
    className,
    text,
    attrs: { type: "button", "data-action": action, "aria-label": label },
  });
}

function actions(doc: Document, buttons: HTMLButtonElement[]): HTMLDivElement {
  const row = el(doc, "div", { className: "task-actions" });
  row.append(...buttons);
  return row;
}

type FieldOptions = {
  id: string;
  name: string;
  label: string;
  hint?: string;
  maxLength: number;
  required?: boolean;
  placeholder?: string;
  value?: string;
};

function field(doc: Document, options: FieldOptions & { control: "input" }): { wrap: HTMLDivElement; control: HTMLInputElement };
function field(doc: Document, options: FieldOptions & { control: "textarea" }): { wrap: HTMLDivElement; control: HTMLTextAreaElement };
function field(doc: Document, options: FieldOptions & { control: "input" | "textarea" }): {
  wrap: HTMLDivElement;
  control: HTMLInputElement | HTMLTextAreaElement;
} {
  const wrap = el(doc, "div", { className: "field" });
  const label = el(doc, "label", { attrs: { for: options.id } });
  label.append(doc.createTextNode(options.label));
  if (options.hint) label.append(el(doc, "span", { className: "hint", text: options.hint }));
  const control = options.control === "input" ? doc.createElement("input") : doc.createElement("textarea");
  if (control instanceof HTMLInputElement) {
    control.type = "text";
    control.enterKeyHint = "done";
  } else {
    control.rows = 4;
  }
  control.id = options.id;
  control.name = options.name;
  control.maxLength = options.maxLength;
  control.autocomplete = "off";
  control.value = options.value ?? "";
  if (options.placeholder) control.placeholder = options.placeholder;
  if (options.required) control.setAttribute("aria-required", "true");
  wrap.append(label, control);
  return { wrap, control };
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  options: {
    className?: string;
    id?: string;
    text?: string;
    attrs?: Record<string, string>;
  } = {},
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.id) node.id = options.id;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) node.setAttribute(key, value);
  }
  if (options.text !== undefined) node.textContent = options.text;
  return node;
}
