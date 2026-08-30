export type IncomingWhatsAppMessage = {
  /**
   * "twilio" is still allowed because conversations rows written before it was removed carry it,
   * and the simulator marks its own traffic so it is distinguishable from a real message.
   */
  provider: "twilio" | "meta" | "simulator";
  messageId?: string;
  from: string;
  to?: string;
  body: string;
  media: Array<{
    url: string;
    contentType: string;
  }>;
  location?: {
    latitude: number;
    longitude: number;
    address?: string;
    label?: string;
  };
};

export type OutgoingWhatsAppMessage = {
  to: string;
  body: string;
  mediaUrl?: string;
};

export type WhatsAppProvider = {
  sendText(to: string, body: string): Promise<void>;
  /** `link` must be fetchable by Meta without our credentials, so a signed URL rather than a path. */
  sendVideo(to: string, link: string, caption?: string): Promise<void>;
};
