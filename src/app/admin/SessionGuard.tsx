"use client";

import { useEffect } from "react";

/**
 * Sends an admin back to the login page when their session has expired.
 *
 * The session lasts twelve hours, and a dashboard left open overnight keeps working until the first
 * button is pressed -- at which point every page showed whatever the failed request returned, with
 * no way to tell an expired login from a broken feature.
 *
 * Done by wrapping fetch rather than at each call site: there are ten admin clients and any new one
 * would have had to remember. The wrapper only reacts to admin API calls, and only to 401, so it
 * cannot change the meaning of any other response.
 */
export function SessionGuard() {
  useEffect(() => {
    const original = window.fetch;

    window.fetch = async (input, init) => {
      const response = await original(input, init);
      const url = String(typeof input === "string" ? input : input instanceof Request ? input.url : input);

      if (response.status === 401 && url.includes("/api/admin/") && !url.includes("/api/admin/login")) {
        window.location.href = "/admin/login";
      }

      return response;
    };

    return () => {
      window.fetch = original;
    };
  }, []);

  return null;
}
