/**
 * tickets-slice.ts
 *
 * Recent tickets per project and the create-finding lifecycle. Creating a
 * finding refreshes that project's recent list so the new ticket appears.
 */
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { fetchRecentTickets, postFinding } from "../client.ts";
import type { CreateFindingRequest, Ticket } from "../client.ts";

export interface TicketsState {
  recentByProjectKey: Record<string, Ticket[]>;
  creating: boolean;
  createError: string | undefined;
}

const initialState: TicketsState = {
  createError: undefined,
  creating: false,
  recentByProjectKey: {},
};

/** Load the recent app-created tickets for a project. */
export const loadRecentTickets = createAsyncThunk(
  "tickets/loadRecentTickets",
  (projectKey: string) => fetchRecentTickets(projectKey),
);

/** Create a finding, then refresh the project's recent tickets. */
export const createFinding = createAsyncThunk(
  "tickets/createFinding",
  async (request: CreateFindingRequest, thunkApi) => {
    const created = await postFinding(request);
    await thunkApi.dispatch(loadRecentTickets(request.projectKey));
    return created;
  },
);

const ticketsSlice = createSlice({
  extraReducers: (builder) => {
    builder
      .addCase(loadRecentTickets.fulfilled, (state, action) => {
        state.recentByProjectKey[action.meta.arg] = action.payload;
      })
      .addCase(createFinding.pending, (state) => {
        state.creating = true;
        state.createError = undefined;
      })
      .addCase(createFinding.fulfilled, (state) => {
        state.creating = false;
      })
      .addCase(createFinding.rejected, (state, action) => {
        state.creating = false;
        state.createError =
          action.error.message ??
          "We couldn't create the finding. Please check the fields and try again.";
      });
  },
  initialState,
  name: "tickets",
  reducers: {},
});

export const ticketsReducer = ticketsSlice.reducer;
