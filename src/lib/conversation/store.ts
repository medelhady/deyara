import type { ConversationState } from "./types";

const states = new Map<string, ConversationState>();

export function getConversationState(phone: string) {
  return states.get(phone) ?? {};
}

export function setConversationState(phone: string, state: ConversationState) {
  states.set(phone, state);
}
