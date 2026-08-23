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
};

export type DraftProperty = {
  type?: string;
  area?: string;
  landmark?: string;
  price?: number;
  rooms?: number;
  hasVideo?: boolean;
  videoUrl?: string;
  videoContentType?: string;
  hasLocation?: boolean;
  awaitingConfirmation?: boolean;
  updatedAt?: string;
};

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
};
