import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import "./styles/reader.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Failed to find root DOM element.");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
