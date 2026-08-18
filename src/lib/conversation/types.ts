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
};
