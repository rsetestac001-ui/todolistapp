import { describe, expect, it } from "vitest";
import {
  PHOTO_DB_NAME,
  PHOTO_MAX_BYTES,
  imageFileError,
  openPhotoRepository,
} from "./photos";

describe("image files", () => {
  it("accepts images and rejects other files, empty files, and oversized files", () => {
    expect(imageFileError(new File(["png"], "market.png", { type: "image/png" }))).toBeNull();
    expect(imageFileError(new File(["jpg"], "camera.jpg", { type: "" }))).toBeNull();
    expect(imageFileError(new File(["hello"], "note.txt", { type: "text/plain" }))).toBe("請選擇圖片檔。");
    expect(imageFileError(new File([], "empty.png", { type: "image/png" }))).toBe("這張相片是空的。");
    const huge = new File(["x"], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(huge, "size", { value: PHOTO_MAX_BYTES + 1 });
    expect(imageFileError(huge)).toBe("相片太大，請選一張小於 20MB 的圖片。");
  });
});

describe("IndexedDB photo repository", () => {
  it("saves, reads, and deletes a blob outside localStorage", async () => {
    const { indexedDB } = await import("fake-indexeddb");
    const repo = await openPhotoRepository(indexedDB);
    const blob = new Blob(["image-bytes"], { type: "image/jpeg" });
    await repo.put({ id: "pic-1", blob, contentType: "image/jpeg", width: 4, height: 2 });
    const stored = await repo.get("pic-1");
    expect(await stored?.blob.text()).toBe("image-bytes");
    expect(stored?.width).toBe(4);
    await repo.delete("pic-1");
    expect(await repo.get("pic-1")).toBeNull();
    expect(PHOTO_DB_NAME).toBe("todolistapp.photos");
  });
});
