import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { InteractiveTrendChart } from "./views/InteractiveTrendChart";
import { DitherDonut, allocationColor } from "./views/overview/DitherCharts";
import { DitherBar } from "./views/DitherBar";
import { ActionIcon } from "./views/ActionIcon";
import TaskManagerView from "./TaskManagerView";
import { ProcessIcon, processKey, useProcessAssets, useVisibleProcessAssets } from "./ProcessAssets";
import "./fin-charts.css";
import "./style.css";
import {
  DeviceControls,
  DeviceDetails,
  SystemUpdates,
  RouteButton,
  routeTo,
} from "./DeviceControls";

const bytes = (n, digits = 1) => {
  if (n == null || !Number.isFinite(n)) return "Unavailable";
  if (n === 0) return "0 B";
  const unit = Math.min(
    4,
    Math.max(0, Math.floor(Math.log(n) / Math.log(1024))),
  );
  return `${(n / 1024 ** unit).toFixed(unit ? digits : 0)} ${["B", "KiB", "MiB", "GiB", "TiB"][unit]}`;
};
const rate = (n) => (n == null ? "Waiting" : `${bytes(n)}/s`);
const pct = (n) => (n == null ? "—" : `${n.toFixed(1)}%`);
const time = (n) =>
  new Date(n * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const age = (n) =>
  n == null
    ? "not sampled"
    : `${Math.max(0, Math.round(Date.now() / 1000 - n))}s ago`;
const list = (n) => (Array.isArray(n) ? n : n ? [n] : []);
const duration = (n) =>
  `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
const cpuLines = [
  { key: "cpu", label: "CPU load", color: "#96c8ff" },
  { key: "memoryPercent", label: "Memory", color: "#c8afff" },
];
const diskLines = [
  { key: "diskRead", label: "Read", color: "#96c8ff" },
  { key: "diskWrite", label: "Write", color: "#ffc382" },
];
const netLines = [
  { key: "netDown", label: "Download", color: "#96ffb4" },
  { key: "netUp", label: "Upload", color: "#96c8ff" },
];

function Metric({ label, value, unit, note, values, color = "blue" }) {
  const palette = {
    blue: "#96c8ff",
    purple: "#c8afff",
    green: "#96ffb4",
    orange: "#ffc382",
  };
  const nums = values.filter((v) => v != null);
  const max = Math.max(1, ...nums);
  const path = nums
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${(i * 120) / Math.max(1, nums.length - 1)},${40 - (v / max) * 32}`,
    )
    .join(" ");
  return (
    <article className="metric">
      <span className="eyebrow">{label}</span>
      <div className="metric-value">
        {value}
        <small>{unit}</small>
      </div>
      <p>{note}</p>
      <svg className="sparkline" viewBox="0 0 120 45" aria-hidden="true">
        <path
          d={path}
          stroke={palette[color]}
          fill="none"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </article>
  );
}

function Trend({ history, metric, onMetric, range, onRange }) {
  const rows = useMemo(() => {
    const end = history.at(-1)?.timestamp ?? 0;
    return history
      .filter((s) => end - s.timestamp <= range)
      .map((s) => ({ ...s, at: s.timestamp * 1000 }));
  }, [history, range]);
  const lines =
    metric === "load" ? cpuLines : metric === "disk" ? diskLines : netLines;
  return (
    <section className="panel trend-panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">THE BIG PICTURE</span>
          <h2>Activity over time</h2>
        </div>
        <div className="segmented" aria-label="History duration">
          {[
            [300, "5m"],
            [900, "15m"],
            [3600, "1h"],
          ].map(([s, label]) => (
            <button
              key={s}
              onClick={() => onRange(s)}
              aria-pressed={range === s}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-tabs" role="group" aria-label="Chart metric">
        {[
          ["load", "CPU & memory"],
          ["disk", "Disk activity"],
          ["network", "Network"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={metric === key}
            onClick={() => onMetric(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {rows.length >= 2 ? (
        <InteractiveTrendChart
          rows={rows}
          lines={lines}
          valueFormatter={metric === "load" ? pct : rate}
          axisFormatter={metric === "load" ? (n) => `${n}%` : bytes}
          yAxisLabel={
            metric === "load" ? "Utilization · %" : "Throughput · bytes / sec"
          }
          includeZero
          showDifference={false}
          appearance="insight"
          showArea
          ditherColor={metric === "network" ? "green" : "blue"}
        />
      ) : (
        <div className="chart-empty">Collecting the first two samples…</div>
      )}
      <div className="chart-footer">
        <div className="legend">
          {lines.map((l) => (
            <span key={l.key}>
              <i style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
        <span>Hover to inspect · drag to explore · session only</span>
      </div>
    </section>
  );
}

function Memory({ memory }) {
  const [active, setActive] = useState(null);
  const slices = useMemo(
    () => [
      { symbol: "In use", value: memory.used },
      { symbol: "Available", value: memory.available },
    ],
    [memory.used, memory.available],
  );
  return (
    <section className="panel memory-panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">ROOM TO WORK</span>
          <h2>Memory allocation</h2>
        </div>
        <span className="tag">{bytes(memory.total, 0)} installed</span>
      </div>
      <div className="donut-wrap">
        <DitherDonut
          slices={slices}
          active={active}
          onActiveChange={setActive}
          hidden={false}
        />
        <div className="donut-center">
          <strong>
            {active == null ? pct(memory.percent) : bytes(slices[active].value)}
          </strong>
          <span>
            {active == null ? "in use" : slices[active].symbol.toLowerCase()}
          </span>
        </div>
      </div>
      <ul className="allocation-legend">
        {slices.map((s, i) => (
          <li
            key={s.symbol}
            tabIndex={0}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            <span>
              <i style={{ background: allocationColor(i) }} />
              {s.symbol}
            </span>
            <strong>{bytes(s.value)}</strong>
          </li>
        ))}
      </ul>
      <p className="muted tiny">
        Available includes reclaimable memory. Process working sets can share
        pages and do not sum to this total.
      </p>
    </section>
  );
}

function Processes({ processes, skipped = 0, compact = false }) {
  const [sort, setSort] = useState("cpu");
  const [search, setSearch] = useState("");
  const { assets, loadVisible } = useProcessAssets(processes);
  const rows = useMemo(
    () =>
      processes
        .filter((p) =>
          `${p.name} ${p.pid}`.toLowerCase().includes(search.toLowerCase()),
        )
        .sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1))
        .slice(0, compact ? 6 : processes.length),
    [processes, sort, search, compact],
  );
  useVisibleProcessAssets(rows, loadVisible);
  return (
    <section className="panel process-panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">FOLLOW THE WORKLOAD</span>
          <h2>{compact ? "What’s using resources" : "Processes"}</h2>
        </div>
        <span className="tag">
          {processes.length} visible / {skipped} restricted
        </span>
      </div>
      <div className="process-controls">
        <input
          aria-label="Search processes"
          placeholder="Search name or PID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Sort processes"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="cpu">Highest CPU</option>
          <option value="memory">Highest memory</option>
        </select>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Process / PID</th>
              <th>CPU</th>
              <th>Working set</th>
              <th className="bar-col">
                {sort === "cpu" ? "Share of CPU" : "Relative RAM"}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={processKey(p)}>
                <td>
                  <div className="overview-process-app"><ProcessIcon src={assets[processKey(p)]?.icon} /><div><span className="process-name">{p.name}</span><small>{p.pid}</small></div></div>
                </td>
                <td>{pct(p.cpu)}</td>
                <td>{bytes(p.memory)}</td>
                <td className="bar-col">
                  <DitherBar
                    segments={[
                      {
                        value: sort === "cpu" ? (p.cpu ?? 0) : p.memory,
                        color: sort === "cpu" ? "blue" : "purple",
                      },
                    ]}
                    scale={
                      sort === "cpu"
                        ? 100
                        : processes.reduce((n, p) => Math.max(n, p.memory), 1)
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="empty">No matching processes.</p>}
      <p className="muted tiny footnote">
        CPU is normalized across all logical processors. New processes need two
        samples. Restricted or exited processes are skipped; idle capacity is
        excluded.
        {sort === "memory"
          ? " RAM bars scale to the largest visible working set."
          : ""}
      </p>
    </section>
  );
}

function Battery({ current, hardware }) {
  const b = current.battery;
  const details = hardware.batteries?.[0];
  const chargePercent = Number.isFinite(Number(b?.percent))
    ? Math.max(0, Math.min(100, Number(b.percent)))
    : 0;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">POWER & LONGEVITY</span>
          <h2>Battery</h2>
        </div>
        <span className="tag">
          {b ? (b.plugged ? "AC connected" : "On battery") : "Not exposed"}
        </span>
      </div>
      {b ? (
        <>
          <div className="battery-value">
            {pct(b.percent)}
            <span>charge remaining</span>
          </div>
          <div
            className="battery-charge-bar"
            style={{ "--charge-level": `${chargePercent}%` }}
          >
            <DitherBar
              segments={[{ value: b.percent, color: "green" }]}
              scale={100}
              ariaLabel={`Battery ${pct(b.percent)}`}
            />
          </div>
          <div className="facts">
            <div>
              <span>Full charge capacity</span>
              <b>
                {details?.fullMwh
                  ? `${(details.fullMwh / 1000).toFixed(1)} Wh`
                  : "Not exposed"}
              </b>
            </div>
            <div>
              <span>Design capacity</span>
              <b>
                {details?.designMwh
                  ? `${(details.designMwh / 1000).toFixed(1)} Wh`
                  : "Not exposed"}
              </b>
            </div>
            <div>
              <span>Capacity / design</span>
              <b>
                {details?.healthPercent != null
                  ? pct(details.healthPercent)
                  : "Cannot calculate"}
              </b>
            </div>
            <div>
              <span>Charge cycles</span>
              <b>{details?.cycles ?? "Not exposed"}</b>
            </div>
            <div>
              <span>Remaining time</span>
              <b>
                {!b.plugged && b.secondsLeft != null
                  ? `~${duration(b.secondsLeft)}`
                  : "Not estimated"}
              </b>
            </div>
          </div>
          <p className="muted tiny">
            Capacity is reported by battery firmware. Charge level and battery
            wear are different measurements.
          </p>
        </>
      ) : (
        <p className="empty">Windows did not report a battery.</p>
      )}
    </section>
  );
}

function Gpu({ gpu, status, enabled, onToggle }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">GRAPHICS</span>
          <h2>NVIDIA GPU</h2>
        </div>
        <button className="button" onClick={onToggle} aria-pressed={enabled}>
          {enabled ? "Disable polling" : "Enable polling"}
        </button>
      </div>
      {gpu ? (
        <>
          <p className="hardware-name">{gpu.name}</p>
          <div className="gpu-stats">
            <div>
              <strong>
                {gpu.temperature ?? "—"}
                <small>°C</small>
              </strong>
              <span>Core temperature</span>
            </div>
            <div>
              <strong>
                {gpu.percent ?? "—"}
                <small>%</small>
              </strong>
              <span>GPU utilization</span>
            </div>
          </div>
          <DitherBar
            segments={[{ value: gpu.percent ?? 0, color: "orange" }]}
            scale={100}
          />
          <div className="facts">
            <div>
              <span>Dedicated VRAM</span>
              <b>
                {gpu.memoryUsedMb ?? "—"} / {gpu.memoryTotalMb ?? "—"} MiB
              </b>
            </div>
            <div>
              <span>Board power</span>
              <b>{gpu.watts == null ? "Not exposed" : `${gpu.watts} W`}</b>
            </div>
            <div>
              <span>Sample age</span>
              <b>{age(gpu.updatedAt)}</b>
            </div>
          </div>
        </>
      ) : (
        <p className="empty">{status}</p>
      )}
      <p className="muted tiny">
        Lenovo temperature and fan readings are in Device Controls when provider
        access is enabled. Querying NVIDIA may wake a sleeping discrete GPU.
      </p>
    </section>
  );
}

function Storage({ current, hardware }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">STORAGE</span>
          <h2>Space & device status</h2>
        </div>
        <span className="tag">Windows reported</span>
      </div>
      <div className="volume-list">
        {current.volumes.map((d) => (
          <div key={d.mount}>
            <div className="volume-title">
              <b>{d.mount}</b>
              <span>
                {bytes(d.free)} free of {bytes(d.total)}
              </span>
            </div>
            <DitherBar
              segments={[
                { value: d.percent, color: d.percent >= 90 ? "red" : "blue" },
              ]}
              scale={100}
            />
            <p className="muted tiny">{pct(d.percent)} used</p>
          </div>
        ))}
      </div>
      <div className="facts">
        {list(hardware.disks).map((d, i) => (
          <div key={i}>
            <span>
              Disk {d.DeviceId ?? i}: {d.FriendlyName}
            </span>
            <b>{d.HealthStatus || "Unknown"}</b>
          </div>
        ))}
      </div>
      <p className="muted tiny">
        Reported storage status is not a full SMART or surface test. Disk
        throughput is system-wide; it does not measure disk latency.
      </p>
    </section>
  );
}

function Services({ hardware }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">A SMALLER SOFTWARE FOOTPRINT</span>
          <h2>Lenovo services</h2>
        </div>
        <span className="tag">Read only</span>
      </div>
      <div className="facts">
        {list(hardware.services).map((s) => (
          <div key={s.Name}>
            <span>
              {s.DisplayName}
              <small>{s.Name}</small>
            </span>
            <b>{s.Status}</b>
          </div>
        ))}
      </div>
      <details>
        <summary>Why keep hardware services intact?</summary>
        <p>
          Vantage, Lenovo Vantage Service, hotkeys and System Interface
          Foundation have different roles. Blindly disabling them may affect
          device features. This app neither relies on them for Windows/NVIDIA
          readings nor changes their state. Uninstalling Vantage also does not
          cancel a subscription.
        </p>
      </details>
    </section>
  );
}

function Sources({ data, notify, onPage }) {
  const hw = data.hardware;
  return (
    <div className="two-columns">
      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">PROVENANCE</span>
            <h2>Know where each number comes from</h2>
          </div>
        </div>
        <div className="source-list">
          {[
            [
              "CPU, RAM & processes",
              `Windows system APIs via psutil and direct Win32 process queries · every ${data.intervalSeconds} seconds. CPU load describes busy time, not clock speed or throttling.`,
            ],
            [
              "Disk & network",
              `Byte counter differences / measured elapsed time · every ${data.intervalSeconds} seconds. Overview network totals include virtual adapters and loopback.`,
            ],
            [
              "Battery",
              `Windows power status · every ${data.intervalSeconds} seconds. CIM root/wmi capacity and cycles · every 60 seconds where exposed.`,
            ],
            [
              "NVIDIA GPU",
              "Installed nvidia-smi driver utility · every 10 seconds. This is the first NVIDIA device only.",
            ],
            [
              "Hardware & services",
              `Windows CIM, Get-PhysicalDisk, Get-Service and powercfg · every 60 seconds. Last update: ${age(hw.updatedAt)}.`,
            ],
            [
              "History & privacy",
              "Up to one hour of samples held only in memory. Exports stay on your computer.",
            ],
            [
              "Device controls",
              "Lenovo GameZone WMI and the existing Energy Management driver. Settings change only after an explicit action and are checked with a fresh device read. Windows and Lenovo routes open their respective apps.",
            ],
          ].map(([title, detail]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{detail}</p>
            </article>
          ))}
        </div>
      </section>
      <div className="stack">
        <section className="panel">
          <div className="panel-head">
            <h2>Coverage, without guesswork</h2>
          </div>
          <div className="facts">
            <div>
              <span>CPU temperature / fan RPM</span>
              <button
                className="link-action"
                onClick={() => onPage("controls")}
              >
                Lenovo provider access
              </button>
            </div>
            <div>
              <span>Thermal & device controls</span>
              <button
                className="link-action"
                onClick={() => onPage("controls")}
              >
                Device Controls
              </button>
            </div>
            <div>
              <span>BIOS / driver updater</span>
              <button className="link-action" onClick={() => onPage("updates")}>
                System Updates
              </button>
            </div>
            <div>
              <span>Battery conservation mode</span>
              <button
                className="link-action"
                onClick={() => onPage("controls")}
              >
                Charging controls
              </button>
            </div>
            <div>
              <span>Full hardware diagnostics</span>
              <RouteButton
                to="vantage"
                label="Open Lenovo Vantage"
                notify={notify}
                subtle
              />
            </div>
          </div>
          <p className="muted">
            Direct controls are enabled only for interfaces that return valid
            readings. Vendor-only features have explicit routes. BIOS flashing,
            custom fan curves and full hardware tests remain in Lenovo's tools.
          </p>
        </section>
        <section className="panel">
          <h2>Probe status</h2>
          <div className="facts">
            <div>
              <span>Hardware probe duration</span>
              <b>{hw.probeSeconds ?? "—"}s</b>
            </div>
            <div>
              <span>Live sample duration</span>
              <b>{data.current?.collectionMs ?? "Unavailable"} ms</b>
            </div>
            <div>
              <span>Collector interval</span>
              <b>{data.intervalSeconds}s</b>
            </div>
            <div>
              <span>Session started</span>
              <b>{time(data.startedAt)}</b>
            </div>
          </div>
          {Object.entries(hw)
            .filter(([k, v]) => k.endsWith("Error") || k === "error")
            .map(([k, v]) => (
              <p className="probe-error" key={k}>
                <b>{k}</b>: {v}
              </p>
            ))}
          <p className="muted tiny">
            An unavailable probe is left blank; it is never replaced with
            simulated data.
          </p>
        </section>
      </div>
    </div>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [connectionError, setConnectionError] = useState("");
  const [actionMessage, setActionMessage] = useState(null);
  const [page, setPage] = useState("overview");
  const [paused, setPaused] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(2);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const [visibilityReady, setVisibilityReady] = useState(false);
  const historyCursor = useRef(null);
  const processCursor = useRef(null);
  const [range, setRange] = useState(300);
  const [metric, setMetric] = useState("load");
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  useEffect(() => {
    let cancelled = false;
    const syncVisibility = async () => {
      const bridge = window.pywebview;
      if (bridge && typeof bridge.api?.is_window_minimized !== "function") return;
      let minimized = false;
      if (typeof bridge?.api?.is_window_minimized === "function") {
        try {
          minimized = await bridge.api.is_window_minimized();
        } catch {
          minimized = false;
        }
      }
      if (!cancelled) {
        setVisible(document.visibilityState !== "hidden" && !minimized);
        setVisibilityReady(true);
      }
    };
    document.addEventListener("visibilitychange", syncVisibility);
    window.addEventListener("pywebviewready", syncVisibility);
    void syncVisibility();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", syncVisibility);
      window.removeEventListener("pywebviewready", syncVisibility);
    };
  }, []);
  useEffect(() => {
    if (!visibilityReady) return;
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: visible }),
    }).catch(() => {});
  }, [visible, visibilityReady]);
  useEffect(() => {
    if (!actionMessage) return;
    const timer = setTimeout(() => setActionMessage(null), 6000);
    return () => clearTimeout(timer);
  }, [actionMessage]);
  const exportReport = async (event, kind) => {
    const api = window.pywebview?.api;
    if (!api) {
      if (data?.desktop) {
        event.preventDefault();
        setActionMessage({
          error: true,
          text: "The desktop window is still initializing. Try exporting again in a moment.",
        });
      }
      return;
    }
    event.preventDefault();
    try {
      const result = await api.save_report(kind);
      if (result.saved) setActionMessage({ text: `Saved ${result.name}.` });
      else if (result.error)
        setActionMessage({ error: true, text: result.error });
    } catch {
      setActionMessage({
        error: true,
        text: "Could not save the report. Please try again.",
      });
    }
  };
  useEffect(() => {
    if (paused || !visibilityReady || !visible) return;
    let cancelled = false,
      timer,
      controller;
    const poll = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const cursor = historyCursor.current;
        const params = new URLSearchParams();
        if (cursor != null) params.set("since", String(cursor));
        if (processCursor.current != null) params.set("processSince", String(processCursor.current));
        const query = params.toString();
        const endpoint = query ? `/api/snapshot?${query}` : "/api/snapshot";
        const response = await fetch(endpoint, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`Collector returned HTTP ${response.status}`);
        const next = await response.json();
        if (!cancelled) {
          if (Number.isInteger(next.processGeneration)) processCursor.current = next.processGeneration;
          if (Array.isArray(next.historyDelta)) {
            const { historyDelta, ...snapshot } = next;
            if (historyDelta.length) historyCursor.current = historyDelta[historyDelta.length - 1].timestamp;
            setData((previous) => {
              const current = snapshot.current && !Array.isArray(snapshot.current.processes) && previous?.current
                ? { ...snapshot.current, processes: previous.current.processes, processesSkipped: previous.current.processesSkipped }
                : snapshot.current;
              return {
                ...snapshot,
                current,
                history: [...(previous?.history ?? []), ...historyDelta].slice(-3600),
              };
            });
          } else {
            historyCursor.current = next.history?.at(-1)?.timestamp ?? null;
            setData(next);
          }
          setConnectionError("");
        }
      } catch (e) {
        if (!cancelled)
          setConnectionError(
            "Connection lost. Check that the Laptop Lens collector is running.",
          );
      } finally {
        clearTimeout(timeout);
        if (!cancelled) timer = setTimeout(poll, refreshInterval * 1000);
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [paused, refreshInterval, visible, visibilityReady]);
  const changeRefreshInterval = async (seconds) => {
    setRefreshBusy(true);
    try {
      const response = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalSeconds: seconds }),
      });
      if (!response.ok) throw new Error('Could not change refresh speed. Try again.');
      setRefreshInterval(seconds);
    } catch (error) {
      setActionMessage({ error: true, text: error.message });
    } finally { setRefreshBusy(false); }
  };
  const toggleGpu = async () => {
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gpuEnabled: !data.gpuEnabled }),
      });
      if (!response.ok) throw new Error("Settings update failed");
      const next = await fetch("/api/snapshot").then((r) => r.json());
      historyCursor.current = next.history?.at(-1)?.timestamp ?? null;
      processCursor.current = Number.isInteger(next.processGeneration) ? next.processGeneration : null;
      setData(next);
    } catch {
      setConnectionError(
        "Could not change GPU polling. Check that the collector is running.",
      );
    }
  };
  const setProcessSampling = useCallback(async (enabled, interval = 5) => {
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processesEnabled: enabled, processesIntervalSeconds: enabled ? interval : 5 }),
      });
      if (!response.ok && enabled) throw new Error("Process sampling could not start.");
    } catch (error) {
      if (enabled) setActionMessage({ error: true, text: error.message });
    }
  }, []);
  useEffect(() => {
    if (page !== "overview") return;
    setProcessSampling(true, 5);
    return () => setProcessSampling(false, 5);
  }, [page, setProcessSampling]);
  const c = data?.current;
  const hw = data?.hardware ?? {};
  const nav = [
    ["overview", "overview", "Overview"],
    ["processes", "activity", "Processes"],
    ["hardware", "device", "Hardware"],
    ["controls", "preferences", "Device Controls"],
    ["updates", "latest", "System Updates"],
    ["sources", "sources", "Data & coverage"],
  ];
  const model = hw.system?.Model ?? "Detecting hardware";
  const stale = c && Date.now() / 1000 - c.timestamp > Math.max(8, refreshInterval * 3);
  const history = data?.history ?? [];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            setPage("overview");
          }}
        >
          <img className="brand-logo" src="/laptop-lens.png" alt="" />
          Laptop Lens
          <span className="version">{data?.desktop ? "DESKTOP" : "LOCAL"}</span>
        </a>
        <div className="sidebar-section">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map(([id, icon, label]) => (
            <button
              key={id}
              title={label}
              className={page === id ? "active" : ""}
              aria-current={page === id ? "page" : undefined}
              onClick={() => {
                setPage(id);
                if (id === "updates") routeTo("updates", setActionMessage);
              }}
            >
              <ActionIcon name={icon} />
              {label}
              {id === "overview" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="device-badge">
            <ActionIcon name="device" />
            <div>
              <b>Lenovo {model}</b>
              <span>
                {hw.cpu?.Name?.trim().replace("with Radeon Graphics", "") ??
                  "Reading your laptop"}
              </span>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            <b>{nav.find((n) => n[0] === page)?.[2]}</b>
          </div>
          <div className="top-actions">
            <span
              className={`live-status ${paused || connectionError || stale ? "inactive" : ""}`}
            >
              <i />
              {paused
                ? "View paused"
                : connectionError
                  ? "Disconnected"
                  : stale
                    ? "Stale data"
                    : c
                      ? `Live · ${refreshInterval}s`
                      : "Connecting"}
            </span>
            <button
              className="icon-button"
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? "Resume view" : "Pause view"}
            </button>
            <a
              className="button export"
              href="/api/export"
              download
              onClick={(event) => exportReport(event, "json")}
            >
              <ActionIcon name="import" />
              Export report
            </a>
          </div>
        </header>
        <div className="content">
          {actionMessage && (
            <div
              className={`notice ${actionMessage.error ? "" : "success"}`}
              role="status"
            >
              {actionMessage.text}
            </div>
          )}
          <div className="page-heading">
            <div>
              <h1>
                {nav.find((item) => item[0] === page)?.[2]}
              </h1>
              <p>
                {page === "overview"
                  ? "Live system activity and resource usage."
                  : page === "processes"
                    ? "See which apps are using CPU and memory, without guesswork."
                    : page === "hardware"
                      ? "Power, graphics, storage, and the services running underneath."
                      : page === "controls"
                        ? "Lenovo controls and the Windows settings you need, together."
                        : page === "updates"
                          ? "Windows updates, optional drivers, and Lenovo firmware routes."
                          : "Every metric has a source. Every missing sensor stays missing."}
              </p>
            </div>
            <span className="session-label">
              {c ? `UPDATED ${time(c.timestamp)}` : "WAITING FOR COLLECTOR"}
            </span>
          </div>
          {(connectionError || data?.error || stale || paused) && (
            <div className="notice" role="status">
              {connectionError ||
                data?.error ||
                (paused
                  ? "Display paused. Collection continues in the background; exports contain the latest readings."
                  : "The last sample is over 8 seconds old. These readings may be stale.")}
            </div>
          )}
          {!c ? (
            <div className="loading panel">
              {connectionError ||
                "Reading Windows performance counters. Your first live sample will appear shortly…"}
            </div>
          ) : (
            <>
              {page === "overview" && (
                <>
                  <div className="metrics">
                    <Metric
                      label="CPU UTILIZATION"
                      value={c.cpu.toFixed(1)}
                      unit="%"
                      note={`${hw.cpu?.NumberOfLogicalProcessors ?? "—"} logical processors`}
                      values={history.slice(-45).map((s) => s.cpu)}
                    />
                    <Metric
                      label="MEMORY IN USE"
                      value={(c.memory.used / 1024 ** 3).toFixed(1)}
                      unit="GiB"
                      note={`${bytes(c.memory.available)} available`}
                      color="purple"
                      values={history.slice(-45).map((s) => s.memoryPercent)}
                    />
                    <Metric
                      label="GPU TEMPERATURE"
                      value={c.gpu?.temperature ?? "—"}
                      unit="°C"
                      note={
                        c.gpu
                          ? `${c.gpu.percent ?? "—"}% GPU load · ${age(c.gpu.updatedAt)}`
                          : "Sensor unavailable"
                      }
                      color="orange"
                      values={[]}
                    />
                    <Metric
                      label="NETWORK DOWNLOAD"
                      value={
                        c.netDown == null ? "—" : bytes(c.netDown).split(" ")[0]
                      }
                      unit={
                        c.netDown == null
                          ? ""
                          : `${bytes(c.netDown).split(" ")[1]}/s`
                      }
                      note={`Upload ${rate(c.netUp)}`}
                      color="green"
                      values={history.slice(-45).map((s) => s.netDown)}
                    />
                  </div>
                  <div className="overview-charts">
                    <Trend
                      history={history}
                      metric={metric}
                      onMetric={setMetric}
                      range={range}
                      onRange={setRange}
                    />
                    <Memory memory={c.memory} />
                  </div>
                  <div className="lower-grid">
                    <Processes
                      processes={c.processes}
                      skipped={c.processesSkipped}
                      compact
                    />
                    <section className="panel insights">
                      <div className="panel-head">
                        <div>
                          <span className="eyebrow">MAKE SENSE OF IT</span>
                          <h2>What the readings suggest</h2>
                        </div>
                        <ActionIcon name="insights" />
                      </div>
                      {data.insights.map((item, i) => (
                        <article className={`insight ${item.level}`} key={i}>
                          <span className="insight-dot" />
                          <div>
                            <h3>{item.title}</h3>
                            <p>{item.detail}</p>
                          </div>
                        </article>
                      ))}
                      <div className="uptime">
                        <span>Windows uptime</span>
                        <strong>{duration(c.uptimeSeconds)}</strong>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => setPage("sources")}
                      >
                        Explore data coverage <span>↗</span>
                      </button>
                    </section>
                  </div>
                </>
              )}
              {page === "processes" && (
                <TaskManagerView data={data} notify={setActionMessage} refreshInterval={refreshInterval} refreshBusy={refreshBusy} onRefreshIntervalChange={changeRefreshInterval} onProcessPollingChange={setProcessSampling} />
              )}
              {page === "hardware" && (
                <>
                  <DeviceDetails notify={setActionMessage} />
                  <div className="hardware-strip">
                    <div>
                      <span>MODEL</span>
                      <b>
                        {hw.system?.Manufacturer} {model}
                      </b>
                    </div>
                    <div>
                      <span>PROCESSOR</span>
                      <b>{hw.cpu?.Name?.trim() ?? "Detecting"}</b>
                    </div>
                    <div>
                      <span>BIOS</span>
                      <b>{hw.bios?.SMBIOSBIOSVersion ?? "Detecting"}</b>
                    </div>
                  </div>
                  <div className="two-columns">
                    <Battery current={c} hardware={hw} />
                    <Gpu
                      gpu={data.gpuEnabled ? c.gpu : null}
                      status={data.gpuStatus}
                      enabled={data.gpuEnabled}
                      onToggle={toggleGpu}
                    />
                    <Storage current={c} hardware={hw} />
                    <Services hardware={hw} />
                  </div>
                  <section className="panel power-panel">
                    <h2>Windows power plan</h2>
                    <p>{hw.powerPlan ?? "Not exposed"}</p>
                    <details>
                      <summary>
                        Startup entries ({list(hw.startup).length})
                      </summary>
                      <div className="facts">
                        {list(hw.startup).map((s, i) => (
                          <div key={i}>
                            <span>{s.Name}</span>
                            <b>{s.Location}</b>
                          </div>
                        ))}
                      </div>
                      <p className="muted tiny">
                        Windows CIM startup registrations; this is not a
                        complete list of scheduled tasks or app startup
                        permissions.
                      </p>
                    </details>
                  </section>
                </>
              )}
              {page === "controls" && (
                <DeviceControls notify={setActionMessage} />
              )}
              {page === "updates" && (
                <SystemUpdates notify={setActionMessage} />
              )}
              {page === "sources" && (
                <Sources
                  data={data}
                  notify={setActionMessage}
                  onPage={setPage}
                />
              )}
            </>
          )}
          <footer>
            <span>
              <i />
              Local collection · session history
            </span>
            <a
              href="/api/history.csv"
              download
              onClick={(event) => exportReport(event, "csv")}
            >
              Download history CSV ↗
            </a>
          </footer>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
