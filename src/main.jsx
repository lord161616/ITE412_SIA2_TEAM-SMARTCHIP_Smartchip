import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/layout.css";
import "./styles/pages.css";

const root = createRoot(document.getElementById("root"));

// App is imported dynamically so a setup problem (e.g. missing .env)
// shows a readable message instead of a blank white page.
import("./App.jsx")
  .then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((error) => {
    console.error(error);
    root.render(
      <div className="fatal-error">
        <h1>SmartChip couldn't start</h1>
        <p>{error.message}</p>
      </div>,
    );
  });
