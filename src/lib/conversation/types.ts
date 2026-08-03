export type Intent =
  | "add_property"
  | "search_property"
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
  hasLocation?: boolean;
  awaitingConfirmation?: boolean;
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
  activeContactRequestId?: string;
  draftProperty?: DraftProperty;
};
