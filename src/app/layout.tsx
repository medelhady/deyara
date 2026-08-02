import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "WhatsApp Real Estate Admin",
  description: "Admin dashboard for a WhatsApp-first real estate platform"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
