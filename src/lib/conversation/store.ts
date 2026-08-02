import type { ConversationState } from "./types";
import { getServiceSupabase } from "@/lib/supabase/server";

const states = new Map<string, ConversationState>();

export async function getConversationState(phone: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return states.get(phone) ?? {};
  }

  const { data, error } = await supabase
    .from("conversation_states")
    .select("state")
    .eq("phone", phone)
    .maybeSingle();

  if (error) {
    console.error("Failed to load conversation state", error);
    return states.get(phone) ?? {};
  }

  return (data?.state as ConversationState | null) ?? {};
}

export async function setConversationState(phone: string, state: ConversationState) {
  states.set(phone, state);

  const supabase = getServiceSupabase();

  if (!supabase) {
    return;
  }

  const { error } = await supabase.from("conversation_states").upsert(
    {
      phone,
      state
    },
    {
      onConflict: "phone"
    }
  );

  if (error) {
    console.error("Failed to save conversation state", error);
  }
}
