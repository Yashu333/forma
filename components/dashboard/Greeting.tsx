"use client";

import { useState, useEffect } from "react";

interface Props { userId: string; fallback: string; }

export default function Greeting({ userId, fallback }: Props) {
  const [name, setName] = useState(fallback);

  useEffect(() => {
    const key = `forma_display_name_${userId}`;
    const stored = localStorage.getItem(key);
    if (stored) setName(stored);

    // Update if the user renames themselves in the sidebar
    function onStorage(e: StorageEvent) {
      if (e.key === key && e.newValue) setName(e.newValue);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId]);

  return <span>{name}</span>;
}
