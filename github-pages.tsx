import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CaminoMap from "./app/CaminoMap";
import "./app/globals.css";

window.__CAMINO_BASE_PATH__ = import.meta.env.BASE_URL;

const root = document.getElementById("root");
if (!root) throw new Error("Could not find the application root.");

createRoot(root).render(
  <StrictMode>
    <CaminoMap />
  </StrictMode>,
);
