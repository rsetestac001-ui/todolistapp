import "./styles.css";
import { mountApp } from "./app";

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) {
  throw new Error("找不到應用程式根節點");
}

mountApp(root);
