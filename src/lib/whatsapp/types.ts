export type IncomingWhatsAppMessage = {
  provider: "twilio" | "meta";
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
  parseIncoming(formData: FormData): IncomingWhatsAppMessage;
  sendText(to: string, body: string): Promise<void>;
};
