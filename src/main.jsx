import React from "react";
import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import App from "./App.jsx";

// Vercel Web Analytics: cookieless, so it needs no consent banner and doesn't
// change what the privacy policy has to promise. It only reports from Vercel
// deployments — nothing is sent from localhost, so local dev stays clean.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <Analytics />
  </React.StrictMode>
);
