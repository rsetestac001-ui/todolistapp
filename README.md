# 待辦記事簿

手機優先的純前端待辦記事簿。可以用繁體中文寫低標題同備註，每則記事亦可以附上一張相片。重新載入瀏覽器之後，文字同相片都會保留。

沒有登入，亦沒有後端。相片不會上傳。

## 環境

需要 Node.js 20 或更新版本。

## 本地執行

```bash
npm install
npm run dev
```

然後打開 <http://localhost:5173>。

## 建置

```bash
npm run build
npm run preview
```

`npm run build` 會先做型別檢查，再把靜態檔輸出到 `dist/`。`npm run preview` 用本地伺服器預覽建置結果。

## 檢查

```bash
npm run typecheck
npm test
```

`npm run check` 會依次執行型別檢查、測試同建置。

## 本機儲存限制

- 文字記事自動存在此瀏覽器的 `localStorage`，鍵名係 `todolistapp.notebook.v1`。
- 相片會先縮到最長邊 1600 像素、存成 JPEG，再放進 IndexedDB 資料庫 `todolistapp.photos`，避免塞滿 `localStorage`。
- 資料只留在此瀏覽器，不會上傳到 GitHub、伺服器或其他裝置，亦不會跨裝置同步。
- 換瀏覽器、換裝置、無痕視窗，或清除呢個網站的資料之後，文字同相片都不會保留。
- 「拍照」會交畀瀏覽器。支援的手機瀏覽器會打開後置相機；桌面電腦或者唔支援相機時，請用「選擇相片」揀圖片檔。沒有相機都可以只寫文字。
- 儲存空間受瀏覽器配額限制。如果寫入失敗，畫面會如實提示，唔會假裝相片已經儲存。
- 如果已儲存的文字損壞，程式不會覆蓋原來的內容。舊有、未有相片欄位的記事仍然可以讀取。
