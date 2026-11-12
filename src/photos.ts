export const PHOTO_DB_NAME = "todolistapp.photos";
export const PHOTO_STORE = "photos";
export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_JPEG_QUALITY = 0.82;
export const PHOTO_MAX_BYTES = 20 * 1024 * 1024;

export type PreparedPhoto = {
  blob: Blob;
  contentType: "image/jpeg";
  width: number;
  height: number;
};

export type StoredPhoto = PreparedPhoto & { id: string };

export type PhotoRepository = {
  get(id: string): Promise<StoredPhoto | null>;
  put(photo: StoredPhoto): Promise<void>;
  delete(id: string): Promise<void>;
};

export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoError";
  }
}

const IMAGE_EXT = /\.(avif|bmp|gif|heic|heif|jpe?g|png|webp)$/i;

export function imageFileError(file: File): string | null {
  if (file.size <= 0) return "這張相片是空的。";
  if (file.size > PHOTO_MAX_BYTES) return "相片太大，請選一張小於 20MB 的圖片。";
  const typeOk = file.type.startsWith("image/");
  const nameOk = IMAGE_EXT.test(file.name);
  if (typeOk || (file.type === "" && nameOk)) return null;
  return "請選擇圖片檔。";
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const problem = imageFileError(file);
  if (problem) throw new PhotoError(problem);
  try {
    return await compressImage(file);
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    throw new PhotoError("無法處理這張相片。請改用 JPEG 或 PNG。");
  }
}

export function memoryPhotoRepository(): PhotoRepository & { records: Map<string, StoredPhoto> } {
  const records = new Map<string, StoredPhoto>();
  return {
    records,
    async get(id) {
      return records.get(id) ?? null;
    },
    async put(photo) {
      records.set(photo.id, photo);
    },
    async delete(id) {
      records.delete(id);
    },
  };
}

export function openPhotoRepository(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<PhotoRepository> {
  if (!factory) return Promise.reject(new PhotoError("此瀏覽器未能儲存相片。"));
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(PHOTO_DB_NAME, 1);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE, { keyPath: "id" });
    };
    request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
    request.onsuccess = () => resolve(repositoryFromDb(request.result));
  });
}

async function compressImage(file: File): Promise<PreparedPhoto> {
  const loaded = await loadImage(file);
  try {
    const longest = Math.max(loaded.width, loaded.height);
    if (!longest) throw new PhotoError("無法處理這張相片。請改用 JPEG 或 PNG。");
    const scale = Math.min(1, PHOTO_MAX_EDGE / longest);
    const width = Math.max(1, Math.round(loaded.width * scale));
    const height = Math.max(1, Math.round(loaded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new PhotoError("無法處理這張相片。請改用 JPEG 或 PNG。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(loaded.source, 0, 0, width, height);
    const blob = await canvasToJpeg(canvas);
    if (!blob || blob.size === 0) throw new PhotoError("無法處理這張相片。請改用 JPEG 或 PNG。");
    return { blob, contentType: "image/jpeg", width, height };
  } finally {
    loaded.close();
  }
}

type LoadedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

async function loadImage(file: File): Promise<LoadedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close() {
        bitmap.close();
      },
    };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new PhotoError("無法處理這張相片。請改用 JPEG 或 PNG。"));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close() {},
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      reject(new PhotoError("無法處理這張相片。請改用 JPEG 或 PNG。"));
      return;
    }
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", PHOTO_JPEG_QUALITY);
  });
}

function repositoryFromDb(db: IDBDatabase): PhotoRepository {
  return {
    async get(id) {
      const value = await requestToPromise(objectStore(db, "readonly").get(id));
      return readStored(value);
    },
    async put(photo) {
      const bytes = await photo.blob.arrayBuffer();
      const request = objectStore(db, "readwrite").put({
        id: photo.id,
        bytes,
        contentType: photo.contentType,
        width: photo.width,
        height: photo.height,
      });
      const finished = transactionFinished(request);
      await requestToPromise(request);
      await finished;
    },
    async delete(id) {
      const request = objectStore(db, "readwrite").delete(id);
      const finished = transactionFinished(request);
      await requestToPromise(request);
      await finished;
    },
  };
}

function objectStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(PHOTO_STORE, mode).objectStore(PHOTO_STORE);
}

function transactionFinished(request: IDBRequest): Promise<void> {
  const transaction = request.transaction;
  if (!transaction) return Promise.resolve();
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("indexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("indexedDB transaction aborted"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB request failed"));
  });
}

function readStored(value: unknown): StoredPhoto | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { id?: unknown; bytes?: unknown; blob?: unknown; width?: unknown; height?: unknown };
  if (typeof record.id !== "string") return null;
  const blob = blobFromRecord(record.bytes) ?? (record.blob instanceof Blob ? record.blob : null);
  if (!blob) return null;
  return {
    id: record.id,
    blob,
    contentType: "image/jpeg",
    width: typeof record.width === "number" ? record.width : 0,
    height: typeof record.height === "number" ? record.height : 0,
  };
}

function blobFromRecord(bytes: unknown): Blob | null {
  if (bytes instanceof ArrayBuffer) return new Blob([bytes], { type: "image/jpeg" });
  if (ArrayBuffer.isView(bytes)) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return new Blob([copy], { type: "image/jpeg" });
  }
  return null;
}
