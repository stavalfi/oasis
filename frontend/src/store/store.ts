/**
 * store.ts
 *
 * The single Redux store. One slice per domain (auth, projects, tickets, API
 * keys), each with its own async thunks that wrap the typed API client.
 */
import { configureStore } from "@reduxjs/toolkit";
import { apiKeysReducer } from "./api-keys-slice.ts";
import { authReducer } from "./auth-slice.ts";
import { projectsReducer } from "./projects-slice.ts";
import { ticketsReducer } from "./tickets-slice.ts";

export const store = configureStore({
  reducer: {
    apiKeys: apiKeysReducer,
    auth: authReducer,
    projects: projectsReducer,
    tickets: ticketsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
