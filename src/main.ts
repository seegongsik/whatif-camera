import "./style.css";
import { App } from "./ui/app.js";

const root = document.getElementById("app");
if (root) void new App(root).start();
