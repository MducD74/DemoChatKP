import { NextResponse } from "next/server";
import { store } from "@/server";
import { seedDemo } from "@/core/service";

export async function POST() {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "chỉ dùng khi dev" }, { status: 403 });
  return NextResponse.json(await seedDemo(store));
}
