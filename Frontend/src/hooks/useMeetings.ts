"use client";

import { useState, useEffect } from "react";
import { fetchLiveMeetings } from "@/services/meetingsApi";
import { fetchMeetings as fetchMockMeetings } from "@/services/mockApi";
import type { Meeting } from "@/types";

export function useMeetings() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchLiveMeetings();
        if (!cancelled) setMeetings(data);
      } catch {
        // Backend not running — fall back to mock data
        try {
          const data = await fetchMockMeetings();
          if (!cancelled) setMeetings(data);
        } catch {
          if (!cancelled) setMeetings([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  return { meetings, loading };
}
