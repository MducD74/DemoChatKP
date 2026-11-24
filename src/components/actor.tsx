"use client";
import { createContext, useContext } from "react";
import type { Actor } from "@/core/staff";

export interface ActorCtx { me: Actor; staff: Actor[]; away?: Record<string, boolean> }
export const ActorContext = createContext<ActorCtx>({ me: { uid: "admin", name: "Quản trị (thử)", role: "admin" }, staff: [] });
export const useActor = () => useContext(ActorContext);
export const staffLabel = (staff: Actor[], uid?: string) => staff.find((s) => s.uid === uid)?.name ?? uid ?? "";
