import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { startScroll } from "./scroll.js";
import "./styles/index.css";

startScroll();
createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
