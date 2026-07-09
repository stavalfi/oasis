/**
 * api-keys-slice.ts
 *
 * API key management: the list, the create lifecycle, and the raw key shown
 * exactly once after creation.
 */
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import { deleteApiKey, fetchApiKeys, postApiKey } from "../client.ts";
import type { ApiKeyMetadata } from "../client.ts";

export interface ApiKeysState {
  list: ApiKeyMetadata[];
  newlyCreatedKey: string | undefined;
  loading: boolean;
  creating: boolean;
  error: string | undefined;
}

const initialState: ApiKeysState = {
  creating: false,
  error: undefined,
  list: [],
  loading: false,
  newlyCreatedKey: undefined,
};

/** Load the user's API keys (metadata only). */
export const loadApiKeys = createAsyncThunk("apiKeys/loadApiKeys", () => fetchApiKeys());

/** Create an API key (the response includes the raw key, shown once), then
 * refresh the list so the new key's metadata appears. */
export const createApiKey = createAsyncThunk(
  "apiKeys/createApiKey",
  async (request: { name: string; expiresInDays: number }, thunkApi) => {
    const created = await postApiKey(request);
    await thunkApi.dispatch(loadApiKeys());
    return created;
  },
);

/** Revoke an API key by id. */
export const revokeApiKey = createAsyncThunk("apiKeys/revokeApiKey", async (id: string) => {
  await deleteApiKey(id);
  return id;
});

const apiKeysSlice = createSlice({
  extraReducers: (builder) => {
    builder
      .addCase(loadApiKeys.pending, (state) => {
        state.loading = true;
      })
      .addCase(loadApiKeys.fulfilled, (state, action) => {
        state.loading = false;
        state.list = action.payload;
      })
      .addCase(loadApiKeys.rejected, (state) => {
        state.loading = false;
        state.error = "We couldn't load your API keys. Please try again.";
      })
      .addCase(createApiKey.pending, (state) => {
        state.creating = true;
        state.error = undefined;
      })
      .addCase(createApiKey.fulfilled, (state, action) => {
        state.creating = false;
        state.newlyCreatedKey = action.payload.key;
      })
      .addCase(createApiKey.rejected, (state) => {
        state.creating = false;
        state.error = "We couldn't create the key. Please try again.";
      })
      .addCase(revokeApiKey.fulfilled, (state, action: PayloadAction<string>) => {
        state.list = state.list.filter((apiKey) => apiKey.id !== action.payload);
      });
  },
  initialState,
  name: "apiKeys",
  reducers: {
    clearNewlyCreatedKey: (state) => {
      state.newlyCreatedKey = undefined;
    },
  },
});

export const { clearNewlyCreatedKey } = apiKeysSlice.actions;
export const apiKeysReducer = apiKeysSlice.reducer;
