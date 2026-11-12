# 待辦記事簿

手機優先的純前端待辦記事簿。可以用繁體中文寫低標題同備註，重新載入瀏覽器之後仍然保留。

沒有登入，亦沒有後端。

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

- 記事自動存在此瀏覽器的 `localStorage`，鍵名係 `todolistapp.notebook.v1`。
- 資料只留在此瀏覽器，不會同步到 GitHub、伺服器或其他裝置。
- 換瀏覽器、換裝置、無痕視窗，或清除呢個網站的資料之後，記事不會保留。
- 儲存空間受瀏覽器配額限制。如果寫入失敗，畫面會提示，該次變更只留在目前頁面。
- 如果已儲存的資料損壞，程式不會覆蓋原來的內容。
