/**
 * main.tsx
 *
 * SPA entry point. Mounts React with the Redux store and the router.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app.tsx";
import { store } from "./store/store.ts";

const rootElement = document.querySelector("#root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <Provider store={store}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </Provider>
    </StrictMode>,
  );
}
