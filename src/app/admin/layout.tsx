import type { ReactNode } from "react";
import { SessionGuard } from "./SessionGuard";

/**
 * Wraps every admin page, so the expired-session redirect covers pages added later without anyone
 * having to remember it.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SessionGuard />
      {children}
    </>
  );
}
