import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const revalidate = 0;

export async function GET() {
  const db = getSupabase();
  const { data } = await db
    .from("leader_config")
    .select("*")
    .eq("id", 1)
    .single();
  return NextResponse.json({ leader: data ?? null });
}
