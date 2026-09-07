export type Intent =
  | "greeting"
  | "intro"
  | "add_property"
  | "search_property"
  | "refine_search"
  | "select_property"
  | "request_contact"
  | "send_payment_receipt"
  | "unknown";

export type ExtractedMessage = {
  intent: Intent;
  propertyType?: string;
  area?: string;
  landmark?: string;
  price?: number;
  maxPrice?: number;
  searchText?: string;
  rooms?: number;
  selectedIndex?: number;
  sortBy?: "cheapest" | "expensive";
};

export type ConversationResult = {
  reply: string;
  /**
   * Sent as their own WhatsApp messages after the reply.
   *
   * For text meant to be forwarded on: WhatsApp copies a whole message at a time, so anything a user
   * is asked to pass along has to arrive alone or they are left selecting it by hand.
   */
  followUps?: string[];
  /**
   * Sent as a WhatsApp video message carrying `reply` as its caption, instead of `reply` as text.
   *
   * A link is not a substitute: the renter is on WhatsApp looking at a house, and the whole point of
   * the step is that they watch it without leaving the chat.
   */
  video?: { url: string; label?: string };
  debugIntent: Intent;
};

export type PropertyCandidate = {
  id: string;
  propertyCode?: string;
  ownerPhone?: string;
  title: string;
  type: string;
  area: string;
  landmark: string;
  price: number;
  rooms?: number;
  /** What this owner charges the office. Zero is a real answer, and different from unanswered. */
  commission?: number;
  /** Whatever the owner added beside the room count -- a garage, a sitting room. */
  extras?: string;
};

export type DraftProperty = {
  type?: string;
  area?: string;
  landmark?: string;
  price?: number;
  rooms?: number;
  /**
   * Set by the owner while listing, not by an admin setting.
   *
   * Zero means "no commission on this house" and is a complete answer; undefined means the question
   * has not been reached yet. Anything testing this with Boolean() would confuse the two.
   */
  commission?: number;
  /** Whatever the owner added beside the room count. Written in their own words, kept as given. */
  extras?: string;
  hasVideo?: boolean;
  videoUrl?: string;
  videoContentType?: string;
  hasLocation?: boolean;
  awaitingConfirmation?: boolean;
  updatedAt?: string;
};

import type { CollectState } from "./collect";
import type { DemoState } from "./demo";

export type ConversationState = {
  lastSearchResults?: PropertyCandidate[];
  lastSearchShownCount?: number;
  lastSearchQuery?: ExtractedMessage;
  pendingSearch?: ExtractedMessage;
  selectedPropertyId?: string;
  selectedProperty?: PropertyCandidate;
  selectedPropertyAt?: string;
  awaitingContactChoice?: boolean;
  selectedPropertyVideoViewed?: boolean;
  activeContactRequestId?: string;
  awaitingMaxPriceFilter?: boolean;
  draftProperty?: DraftProperty;
  // Contact request the renter could not pay for yet. Fulfilled automatically once a top-up is approved.
  pendingContactProperty?: PropertyCandidate;
  /**
   * An open walkthrough. Its listing lives here and nowhere else -- see lib/conversation/demo.ts for
   * why nothing is written to the database.
   */
  demo?: DemoState;
  /** A half-answered intake while the bot is in collection mode. */
  collect?: CollectState;
};
