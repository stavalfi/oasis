/**
 * auth-slice.ts
 *
 * Login state: whether we are checking, logged in, or logged out, plus the
 * current user. `loadCurrentUser` runs on startup; a 401 there means logged out.
 */
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { fetchMe, postLogout } from "../client.ts";
import type { MeResponse } from "../client.ts";

type AuthStatus = "checking" | "loggedIn" | "loggedOut";

export interface AuthState {
  status: AuthStatus;
  user: MeResponse | undefined;
}

const initialState: AuthState = { status: "checking", user: undefined };

/** Load the current user (used on startup and after login). */
export const loadCurrentUser = createAsyncThunk("auth/loadCurrentUser", () => fetchMe());

/** End the session on the backend. */
export const logout = createAsyncThunk("auth/logout", () => postLogout());

const authSlice = createSlice({
  extraReducers: (builder) => {
    builder
      .addCase(loadCurrentUser.pending, (state) => {
        state.status = "checking";
      })
      .addCase(loadCurrentUser.fulfilled, (state, action) => {
        state.status = "loggedIn";
        state.user = action.payload;
      })
      .addCase(loadCurrentUser.rejected, (state) => {
        state.status = "loggedOut";
        state.user = undefined;
      })
      .addCase(logout.fulfilled, (state) => {
        state.status = "loggedOut";
        state.user = undefined;
      });
  },
  initialState,
  name: "auth",
  reducers: {
    markLoggedOut: (state) => {
      state.status = "loggedOut";
      state.user = undefined;
    },
  },
});

export const { markLoggedOut } = authSlice.actions;
export const authReducer = authSlice.reducer;
