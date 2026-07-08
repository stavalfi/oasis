/**
 * projects-slice.ts
 *
 * The creatable projects and which one is selected. Projects arrive with their
 * issue type and dynamic fields, so the create form can render without more
 * round trips.
 */
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { type Project, fetchProjects } from "../client.ts";

export interface ProjectsState {
  list: Project[];
  selectedProjectKey: string | undefined;
  loading: boolean;
  error: string | undefined;
}

const initialState: ProjectsState = {
  error: undefined,
  list: [],
  loading: false,
  selectedProjectKey: undefined,
};

/** Load the projects the user can create issues in. */
export const loadProjects = createAsyncThunk("projects/loadProjects", () => fetchProjects());

const projectsSlice = createSlice({
  extraReducers: (builder) => {
    builder
      .addCase(loadProjects.pending, (state) => {
        state.loading = true;
        state.error = undefined;
      })
      .addCase(loadProjects.fulfilled, (state, action) => {
        state.loading = false;
        state.list = action.payload;
        const [firstProject] = action.payload;
        state.selectedProjectKey ??= firstProject?.key;
      })
      .addCase(loadProjects.rejected, (state) => {
        state.loading = false;
        state.error = "We couldn't load your projects. Please try again.";
      });
  },
  initialState,
  name: "projects",
  reducers: {
    selectProject: (state, action: { payload: string }) => {
      state.selectedProjectKey = action.payload;
    },
  },
});

export const { selectProject } = projectsSlice.actions;
export const projectsReducer = projectsSlice.reducer;
