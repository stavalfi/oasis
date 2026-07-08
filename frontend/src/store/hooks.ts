/**
 * hooks.ts
 *
 * Typed versions of the react-redux hooks, so components get full type
 * inference for dispatch and selected state.
 */
import { useDispatch, useSelector } from "react-redux";
import { type AppDispatch, type RootState } from "./store.ts";

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
