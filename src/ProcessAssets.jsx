import React, { useCallback, useEffect, useRef, useState } from "react";
import { nativeCall } from "./DeviceControls";

export const processKey = p => `${p.pid}:${p.identity ?? ""}`;
export const hasIdentity = p => p && typeof p.identity === "string" && p.identity.length > 0;

export function ProcessIcon({ src }) {
  const [failed, setFailed] = useState(null);
  const validSource = typeof src === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(src);
  if (validSource && failed !== src) return <img src={src} alt="" onError={() => setFailed(src)} />;
  return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="2" width="14" height="16" rx="2" /><path d="M6 6h8M6 10h8M6 14h5" /></svg>;
}

export function useProcessAssets(processes) {
  const [assets, setAssets] = useState({});
  const requested = useRef(new Set());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const live = new Set(processes.map(processKey));
    requested.current.forEach(key => { if (!live.has(key)) requested.current.delete(key); });
    setAssets(previous => {
      if (Object.keys(previous).every(key => live.has(key))) return previous;
      return Object.fromEntries(Object.entries(previous).filter(([key]) => live.has(key)));
    });
  }, [processes]);
  const loadVisible = useCallback(async rows => {
    if (!window.pywebview?.api?.get_process_icons) return;
    for (let i = 0; i < rows.length; i += 32) {
      if (!mounted.current) return;
      const batch = rows.slice(i, i + 32).filter(p => hasIdentity(p) && !requested.current.has(processKey(p)));
      if (!batch.length) continue;
      batch.forEach(p => requested.current.add(processKey(p)));
      try {
        const result = await nativeCall("get_process_icons", batch.map(({ pid, identity }) => ({ pid, identity })));
        if (!mounted.current) return;
        setAssets(previous => {
          const next = { ...previous };
          batch.forEach(p => { const key = processKey(p); next[key] = { icon: result.icons?.[key], name: result.names?.[key] }; });
          return next;
        });
      } catch {
        // Keep the document fallback if Windows does not expose an icon.
      }
    }
  }, []);
  return { assets, loadVisible };
}

export function useVisibleProcessAssets(rows, loadVisible) {
  const signature = rows.map(processKey).join("|");
  useEffect(() => {
    const load = () => loadVisible(rows);
    load();
    window.addEventListener("pywebviewready", load);
    return () => window.removeEventListener("pywebviewready", load);
  }, [signature, loadVisible]);
}
