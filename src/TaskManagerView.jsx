import React, { useEffect, useMemo, useState } from "react";
import { nativeCall, RouteButton } from "./DeviceControls";
import "./task-manager.css";
import { ProcessIcon, processKey, hasIdentity, useProcessAssets, useVisibleProcessAssets } from "./ProcessAssets";

const unavailable = "Unavailable";
const valid = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const number = (n) => valid(n) ? n.toLocaleString() : unavailable;
const percent = (n) => valid(n) ? `${n.toFixed(1)}%` : unavailable;
const unit = (n, suffix, digits = 1) => valid(n) ? `${n.toFixed(digits)} ${suffix}` : unavailable;
const bytes = (n) => {
  if (!valid(n)) return unavailable;
  const i = n === 0 ? 0 : Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** Math.max(0, i)).toFixed(i > 0 ? 1 : 0)} ${["B", "KiB", "MiB", "GiB", "TiB"][Math.max(0, i)]}`;
};
const rate = (n) => valid(n) ? `${bytes(n)}/s` : unavailable;
const bytePair = (used, total) => valid(used) || valid(total) ? `${bytes(used)} / ${bytes(total)}` : unavailable;
const clock = (n) => new Date(n * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const spanLabel = (n) => n <= 60 ? `${n} seconds` : `${n / 60} minutes`;
const cpuSeries = [{ key: "value", label: "CPU busy" }];
const memorySeries = [{ key: "value", label: "Used physical memory" }];
const ioSeries = [{ key: "readBytesPerSec", label: "Read" }, { key: "writeBytesPerSec", label: "Write", dashed: true }];
const networkSeries = [{ key: "receiveBytesPerSec", label: "Receive" }, { key: "sendBytesPerSec", label: "Send", dashed: true }];

function paths(rows, key, start, end, max, gap) {
  const segments = [];
  let points = [];
  let previous = null;
  for (const row of rows) {
    if (!valid(row[key]) || (previous != null && row.timestamp - previous > gap)) {
      if (points.length) segments.push(points);
      points = [];
    }
    if (valid(row[key])) points.push([Math.max(0, Math.min(1000, (row.timestamp - start) / (end - start) * 1000)), 200 - Math.min(1, row[key] / max) * 200]);
    previous = row.timestamp;
  }
  if (points.length) segments.push(points);
  return segments;
}

// Time is never stretched to fill a short history. Missing samples break the line.
function HistoryGraph({ rows, series = cpuSeries, seconds, end, max, formatter = percent, title, mini = false, gap = 8 }) {
  const [hover, setHover] = useState(null);
  const start = end - seconds;
  const visible = rows.filter((r) => valid(r.timestamp) && r.timestamp >= start && r.timestamp <= end);
  const values = visible.flatMap((r) => series.map((s) => r[s.key])).filter(valid);
  const ceiling = valid(max) && max > 0 ? max : values.length ? Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(...values, 1)))) : 1;
  const active = hover == null ? null : visible[Math.min(hover, visible.length - 1)];
  const move = (event) => {
    if (!visible.length) return;
    const box = event.currentTarget.getBoundingClientRect();
    const at = start + (event.clientX - box.left) / box.width * seconds;
    let index = 0;
    visible.forEach((r, i) => { if (Math.abs(r.timestamp - at) < Math.abs(visible[index].timestamp - at)) index = i; });
    setHover(index);
  };
  const keys = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") return setHover(null);
    if (event.key === "Home") return setHover(0);
    if (event.key === "End") return setHover(Math.max(0, visible.length - 1));
    setHover((old) => Math.max(0, Math.min(visible.length - 1, (old ?? visible.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))));
  };
  return (
    <div className={`tm-graph ${mini ? "tm-graph-mini" : ""}`}>
      {!mini && <div className="tm-chart-caption"><span>{title}</span><span>{values.length || valid(max) ? formatter(ceiling) : unavailable}</span></div>}
      <div className="tm-plot">
        <svg viewBox="0 0 1000 200" preserveAspectRatio="none" role={mini ? undefined : "img"} aria-hidden={mini || undefined}
          aria-label={mini ? undefined : `${title}. ${spanLabel(seconds)} history. Arrow keys inspect samples.`}
          tabIndex={mini ? undefined : 0} onPointerMove={mini ? undefined : move} onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(Math.max(0, visible.length - 1))} onBlur={() => setHover(null)} onKeyDown={keys}>
          {[0, 50, 100, 150, 200].map((y) => <line className="tm-grid" key={`h${y}`} x1="0" x2="1000" y1={y} y2={y} />)}
          {Array.from({ length: mini ? 5 : 13 }, (_, i) => <line className="tm-grid" key={`v${i}`} x1={i * 1000 / (mini ? 4 : 12)} x2={i * 1000 / (mini ? 4 : 12)} y1="0" y2="200" />)}
          {series.flatMap((s, i) => paths(visible, s.key, start, end, ceiling, gap).map((points, index) => {
            const line = points.map(([x, y], j) => `${j ? "L" : "M"}${x},${y}`).join(" ");
            return <g key={`${s.key}-${index}`}>
              {i === 0 && points.length > 1 && <path className="tm-area" d={`${line} L${points.at(-1)[0]},200 L${points[0][0]},200 Z`} />}
              <path className={`tm-line ${s.dashed ? "tm-line-dashed" : ""}`} d={line} />
              {points.length === 1 && <circle className="tm-single-point" cx={points[0][0]} cy={points[0][1]} r="2" />}
            </g>;
          }))}
          {!mini && active && <line className="tm-cursor" x1={(active.timestamp - start) / seconds * 1000} x2={(active.timestamp - start) / seconds * 1000} y1="0" y2="200" />}
        </svg>
        {!mini && !values.length && <div className="tm-chart-empty">{rows.length ? "Unavailable for this period" : "Waiting for samples"}</div>}
      </div>
      {!mini && <>
        <div className="tm-chart-axis"><span>{spanLabel(seconds)}</span><span>{spanLabel(seconds / 2)} ago</span><span>0</span></div>
        <div className="tm-readout" aria-live="off">
          {active ? <><time>{clock(active.timestamp)}</time>{series.map((s) => <span key={s.key}>{s.label} <strong>{formatter(active[s.key])}</strong></span>)}</> : <span>Hover or focus the graph to inspect samples</span>}
        </div>
        {series.length > 1 && <div className="tm-legend">{series.map((s) => <span key={s.key}><i className={s.dashed ? "is-dashed" : ""} />{s.label}</span>)}</div>}
      </>}
    </div>
  );
}

function Metrics({ items, small = false }) {
  return <dl className={`tm-metrics ${small ? "tm-metrics-small" : ""}`}>{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={value === unavailable ? "is-unavailable" : ""}>{value ?? unavailable}</dd></div>)}</dl>;
}

function MemoryDetail({ memory, hardware, rows, chart }) {
  const complete = valid(memory.totalBytes) && memory.totalBytes > 0 && valid(memory.inUseBytes) && valid(memory.availableBytes)
    && Math.abs(memory.totalBytes - memory.inUseBytes - memory.availableBytes) <= Math.max(4096, memory.totalBytes * 0.001);
  return <>
    <div className="tm-detail-heading"><h2>Memory</h2><span>{valid(hardware.installedBytes) ? `${bytes(hardware.installedBytes)} installed` : "Installed memory unavailable"}</span></div>
    <HistoryGraph {...chart} rows={rows} series={memorySeries} max={memory.totalBytes} formatter={bytes} title="Physical memory usage" />
    <section className="tm-composition"><h3>Memory composition</h3>
      <div className="tm-composition-bar" role="img" aria-label={complete ? `${bytes(memory.inUseBytes)} used physical memory, ${bytes(memory.availableBytes)} available, of ${bytes(memory.totalBytes)} usable` : "Memory composition unavailable"}>
        {complete ? <><div className="tm-composition-used" style={{ width: `${memory.inUseBytes / memory.totalBytes * 100}%`, borderRightWidth: memory.inUseBytes > 0 && memory.availableBytes > 0 ? 1 : 0 }} title={`Used physical memory: ${bytes(memory.inUseBytes)}`} /><div className="tm-composition-available" style={{ flex: 1 }} title={`Available: ${bytes(memory.availableBytes)}`} /></> : <span>{unavailable}</span>}
      </div>
      <div className="tm-composition-labels"><span>Used physical memory · {bytes(memory.inUseBytes)}</span><span>Available · {bytes(memory.availableBytes)}</span></div>
    </section>
    <div className="tm-memory-details">
      <Metrics items={[["Used physical memory", bytes(memory.inUseBytes)], ["Available", bytes(memory.availableBytes)], ["Committed / limit", bytePair(memory.committedBytes, memory.commitLimitBytes)], ["Cached", bytes(memory.cachedBytes)], ["Paged pool", bytes(memory.pagedPoolBytes)], ["Non-paged pool", bytes(memory.nonPagedPoolBytes)], ["Compressed", bytes(memory.compressedBytes)], ["System cache", bytes(memory.systemCacheBytes)]]} />
      <Metrics small items={[["Speed", unit(hardware.speedMts, "MT/s", 0)], ["Slots used", valid(hardware.slotsUsed) && valid(hardware.slotsTotal) ? `${hardware.slotsUsed} of ${hardware.slotsTotal}` : unavailable], ["Form factor", hardware.formFactor], ["Memory type", hardware.memoryType], ["Hardware reserved", bytes(hardware.hardwareReservedBytes)], ["OS usable", bytes(memory.totalBytes)]]} />
    </div>
    <p className="tm-note">Available includes reclaimable memory. Cached and system cache overlap the composition; they are not separate segments.</p>
  </>;
}

function Performance({ data }) {
  const [selection, setSelection] = useState("memory");
  const [seconds, setSeconds] = useState(60);
  const [perCore, setPerCore] = useState(false);
  const current = data.current ?? {};
  const performance = current.performance ?? {};
  const hw = data.hardware ?? {};
  const cpu = performance.cpu ?? { percent: current.cpu };
  const memory = performance.memory ?? { totalBytes: current.memory?.total, inUseBytes: current.memory?.used, availableBytes: current.memory?.available };
  const history = data.history ?? [];
  const end = current.timestamp ?? history.at(-1)?.timestamp ?? Date.now() / 1000;
  const chart = { seconds, end, gap: Math.max(8, (data.intervalSeconds ?? 2) * 3) };
  const memoryRows = history.map((r) => ({ timestamp: r.timestamp, value: r.performance?.memoryUsedBytes }));
  const cpuRows = history.map((r) => ({ timestamp: r.timestamp, value: r.cpu }));
  const resources = [
    { key: "cpu", kind: "cpu", title: "CPU", subtitle: percent(cpu.percent), rows: cpuRows, max: 100 },
    { key: "memory", kind: "memory", title: "Memory", subtitle: bytePair(memory.inUseBytes, memory.totalBytes), rows: memoryRows, max: memory.totalBytes },
    ...(performance.disks ?? []).map((d) => ({ key: `disk:${d.id}`, kind: "disk", title: d.label || d.name || `Disk ${d.id}`, subtitle: `${d.mediaType || "Physical disk"} · ${percent(d.activePercent)}`, device: d, rows: history.map((r) => ({ timestamp: r.timestamp, ...r.performance?.disks?.[d.id], value: r.performance?.disks?.[d.id]?.activePercent })), max: 100 })),
    ...(performance.networks ?? []).map((n) => ({ key: `network:${n.id}`, kind: "network", title: n.name || n.id, subtitle: n.isUp === false ? "Disconnected" : `S ${rate(n.sendBytesPerSec)} · R ${rate(n.receiveBytesPerSec)}`, device: n, rows: history.map((r) => ({ timestamp: r.timestamp, ...r.performance?.networks?.[n.id], value: r.performance?.networks?.[n.id]?.receiveBytesPerSec })) })),
    ...(performance.gpus ?? []).map((g, i) => ({ key: `gpu:${g.id}`, kind: "gpu", title: `GPU ${i}`, subtitle: `${percent(g.percent)} · ${g.name || "NVIDIA"}`, device: g, rows: history.map((r) => ({ timestamp: r.timestamp, ...r.performance?.gpus?.[g.id], value: r.performance?.gpus?.[g.id]?.percent })), max: 100 })),
  ];
  const selected = resources.find((r) => r.key === selection) ?? resources[1];
  const device = selected.device ?? {};
  const changeResource = (event) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...event.currentTarget.querySelectorAll('[role="tab"]')];
    const currentIndex = buttons.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (currentIndex + (event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    setSelection(resources[next].key);
    buttons[next].focus();
  };
  return <div className="tm-performance">
    <div className="tm-resource-rail" role="tablist" aria-label="Performance resources" aria-orientation="vertical" onKeyDown={changeResource}>
      {resources.map((r) => <button key={r.key} role="tab" id={`tm-resource-${r.key}`} aria-controls="tm-resource-detail" aria-selected={r.key === selected.key} tabIndex={r.key === selected.key ? 0 : -1} className="tm-resource" title={`${r.title}: ${r.subtitle}`} onClick={() => setSelection(r.key)}>
        <HistoryGraph rows={r.rows} seconds={60} end={end} max={r.max} mini gap={chart.gap} />
        <span className="tm-resource-copy"><strong>{r.title}</strong><span>{r.subtitle}</span></span>
      </button>)}
      {!performance.disks?.length && <p className="tm-rail-note">Physical disks · Unavailable</p>}
      {!performance.networks?.length && <p className="tm-rail-note">Network interfaces · Unavailable</p>}
      {!performance.gpus?.length && <p className="tm-rail-note">NVIDIA GPU · Unavailable</p>}
    </div>
    <section className="tm-detail" role="tabpanel" id="tm-resource-detail" aria-labelledby={`tm-resource-${selected.key}`}>
      <div className="tm-detail-tools"><span>Performance history</span><div className="tm-duration" role="group" aria-label="Performance history duration">{[[60, "60 sec"], [240, "4 min"], [900, "15 min"]].map(([s, label]) => <button key={s} aria-pressed={seconds === s} onClick={() => setSeconds(s)}>{label}</button>)}</div></div>
      {selected.kind === "memory" && <MemoryDetail memory={memory} hardware={hw.memory ?? {}} rows={memoryRows} chart={chart} />}
      {selected.kind === "cpu" && <>
        <div className="tm-detail-heading"><h2>CPU</h2><span>{hw.cpu?.Name || unavailable}</span></div>
        {!!cpu.perCore?.length && <div className="tm-core-control"><label><input type="checkbox" checked={perCore} onChange={(e) => setPerCore(e.target.checked)} />Logical processors</label></div>}
        {perCore && cpu.perCore?.length ? <div className="tm-core-grid">{cpu.perCore.map((_, i) => <HistoryGraph key={i} {...chart} rows={history.map((r) => ({ timestamp: r.timestamp, value: r.performance?.cpuPerCore?.[i] }))} title={`Logical processor ${i}`} max={100} />)}</div> : <HistoryGraph {...chart} rows={cpuRows} title="CPU busy" max={100} />}
        <Metrics items={[["CPU busy", percent(cpu.percent)], ["Reported speed", unit(valid(cpu.frequencyMhz) ? cpu.frequencyMhz / 1000 : null, "GHz", 2)], ["Processes", number(cpu.processCount)], ["Threads", number(cpu.threadCount)], ["Handles", number(cpu.handleCount)], ["Up time", valid(cpu.uptimeSeconds) ? `${Math.floor(cpu.uptimeSeconds / 86400)}d ${Math.floor(cpu.uptimeSeconds % 86400 / 3600)}h ${Math.floor(cpu.uptimeSeconds % 3600 / 60)}m` : unavailable]]} />
        <Metrics small items={[["Cores", number(hw.cpu?.NumberOfCores)], ["Logical processors", number(cpu.logicalProcessors ?? hw.cpu?.NumberOfLogicalProcessors)], ["Maximum specified speed", unit(valid(hw.cpu?.MaxClockSpeed) ? hw.cpu.MaxClockSpeed / 1000 : null, "GHz", 2)], ["L2 cache", valid(hw.cpu?.L2CacheSize) ? bytes(hw.cpu.L2CacheSize * 1024) : unavailable], ["L3 cache", valid(hw.cpu?.L3CacheSize) ? bytes(hw.cpu.L3CacheSize * 1024) : unavailable]]} />
        <p className="tm-note">CPU busy measures occupied processor time. Reported speed is separate from utilization.</p>
      </>}
      {selected.kind === "disk" && <>
        <div className="tm-detail-heading"><h2>{selected.title}</h2><span>{device.model || unavailable}</span></div>
        <HistoryGraph {...chart} rows={selected.rows} title="Active time" max={100} />
        <HistoryGraph {...chart} rows={selected.rows} title="Disk transfer rate" series={ioSeries} formatter={rate} />
        <Metrics items={[["Active time", percent(device.activePercent)], ["Average response time", unit(device.responseMs, "ms", 2)], ["Read speed", rate(device.readBytesPerSec)], ["Write speed", rate(device.writeBytesPerSec)]]} />
        <Metrics small items={[["Capacity", bytes(device.totalBytes)], ["Type", device.mediaType], ["Bus", device.busType], ["System disk", device.isSystem == null ? unavailable : device.isSystem ? "Yes" : "No"]]} />
      </>}
      {selected.kind === "network" && <>
        <div className="tm-detail-heading"><h2>{selected.title}</h2><span>{device.description || unavailable}</span></div>
        <HistoryGraph {...chart} rows={selected.rows} title="Interface throughput" series={networkSeries} formatter={rate} />
        <Metrics items={[["Send", rate(device.sendBytesPerSec)], ["Receive", rate(device.receiveBytesPerSec)], ["Link speed", unit(device.speedMbps, "Mbps", 0)], ["Connection", device.isUp == null ? unavailable : device.isUp ? "Connected" : "Disconnected"]]} />
        <Metrics small items={[["Adapter", device.description], ["IPv4 address", Array.isArray(device.ipv4) ? device.ipv4.join(", ") || unavailable : device.ipv4], ["IPv6 address", Array.isArray(device.ipv6) ? device.ipv6.join(", ") || unavailable : device.ipv6], ["MAC address", device.mac]]} />
        <p className="tm-note">Throughput is measured for this interface only. Link speed is the negotiated connection rate, not internet capacity.</p>
      </>}
      {selected.kind === "gpu" && <>
        <div className="tm-detail-heading"><h2>{selected.title}</h2><span>{device.name || "NVIDIA GPU"}</span></div>
        <HistoryGraph {...chart} rows={selected.rows} title="GPU utilization" max={100} />
        <HistoryGraph {...chart} rows={selected.rows.map((r) => ({ timestamp: r.timestamp, value: r.dedicatedUsedBytes }))} title="Dedicated GPU memory" max={device.dedicatedTotalBytes} formatter={bytes} />
        <Metrics items={[["Utilization", percent(device.percent)], ["Dedicated memory", bytePair(device.dedicatedUsedBytes, device.dedicatedTotalBytes)], ["Temperature", unit(device.temperature, "°C", 0)], ["Power", unit(device.powerWatts, "W")]]} />
        <Metrics small items={[["Driver version", device.driverVersion], ["Last GPU sample", valid(device.updatedAt) ? clock(device.updatedAt) : unavailable], ["GPU engine breakdown", unavailable]]} />
        <p className="tm-note">NVIDIA sampling has its own cadence. Utilization is device-wide; individual engine attribution is unavailable.</p>
      </>}
    </section>
  </div>;
}

function ProcessList({ current, notify }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: "cpu", descending: true });
  const [selectedKey, setSelectedKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const processes = current.processes ?? [];
  const { assets, loadVisible } = useProcessAssets(processes);
  const filtered = useMemo(() => processes.filter((p) => `${assets[processKey(p)]?.name ?? ""} ${p.name} ${p.pid}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => {
    const value = (p) => sort.key === "name" ? assets[processKey(p)]?.name || p.name || "" : p[sort.key];
    const av = value(a), bv = value(b);
    if (av == null) return bv == null ? a.pid - b.pid : 1;
    if (bv == null) return -1;
    const comparison = typeof av === "string" ? av.localeCompare(bv) : av - bv;
    return (sort.descending ? -comparison : comparison) || a.pid - b.pid;
  }), [processes, assets, search, sort]);
  const lastPage = Math.max(0, Math.ceil(filtered.length / 64) - 1);
  const activePage = Math.min(page, lastPage);
  const rows = filtered.slice(activePage * 64, (activePage + 1) * 64);
  useVisibleProcessAssets(rows, loadVisible);
  const selected = rows.find((p) => processKey(p) === selectedKey);
  const act = async (method) => {
    if (busy) return;
    if (method !== "run_new_task" && !hasIdentity(selected)) return;
    setBusy(true);
    try {
      const result = method === "run_new_task" ? await nativeCall(method) : await nativeCall(method, selected.pid, selected.identity);
      if (!result.cancelled) notify({ error: !(result.opened || result.success), text: result.message || result.error || (result.success ? "Process ended." : result.opened ? "Opened." : "The action could not be completed.") });
    } catch (error) { notify({ error: true, text: error.message }); }
    finally { setBusy(false); }
  };
  const changeSort = (key) => { setSort((previous) => ({ key, descending: previous.key === key ? !previous.descending : key !== "name" })); setPage(0); };
  const columns = [["name", "Name"], ["pid", "PID"], ["cpu", "CPU busy"], ["memory", "Working set"], ["ioRead", "I/O read"], ["ioWrite", "I/O write"]];
  const moveRow = (event, index) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    setSelectedKey(processKey(rows[next]));
    event.currentTarget.parentElement.children[next]?.querySelector("button")?.focus();
  };
  return <section className="tm-process-list" aria-label="Processes">
    <div className="tm-process-toolbar"><label className="tm-search"><svg className="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></svg><input aria-label="Search processes" placeholder="Search name or PID" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} /></label><span>{filtered.length} of {processes.length} processes · {current.processesSkipped ?? 0} restricted</span></div>
    <div className="tm-process-actions"><button className="button" onClick={() => act("run_new_task")} disabled={busy}>Run new task</button><button className="button" onClick={() => act("open_process_location")} disabled={busy || !hasIdentity(selected)}>Open file location</button><button className="button tm-end-task" onClick={() => act("end_process")} disabled={busy || !hasIdentity(selected) || selected.canEnd !== true}>End task…</button><span>{selected ? `${assets[processKey(selected)]?.name || selected.name} · PID ${selected.pid}` : "Select a process"}</span></div>
    <div className="tm-table-scroll"><table className="tm-process-table"><thead><tr>{columns.map(([key, label]) => <th key={key} aria-sort={sort.key === key ? sort.descending ? "descending" : "ascending" : "none"}><button onClick={() => changeSort(key)}>{label}{sort.key === key && <span aria-hidden="true">{sort.descending ? " ↓" : " ↑"}</span>}</button></th>)}</tr></thead>
      <tbody>{rows.map((p, index) => {
        const key = processKey(p), asset = assets[key];
        return <tr key={key} className={selectedKey === key ? "is-selected" : ""} onClick={() => setSelectedKey(key)} onKeyDown={(e) => moveRow(e, index)}>
          <td><button className="tm-process-name" aria-pressed={selectedKey === key} onClick={() => setSelectedKey(key)}><ProcessIcon src={asset?.icon} /><span><strong>{asset?.name || p.name}</strong>{asset?.name && asset.name !== p.name && <small>{p.name}</small>}</span></button></td>
          <td>{p.pid}</td><td>{percent(p.cpu)}</td><td>{bytes(p.memory)}</td><td>{rate(p.ioRead)}</td><td>{rate(p.ioWrite)}</td>
        </tr>;
      })}</tbody></table></div>
    {!rows.length && <p className="tm-list-empty">{search ? "No processes match your search." : "Process data is unavailable."}</p>}
    {filtered.length > 64 && <div className="tm-pagination"><span>{activePage * 64 + 1}–{Math.min((activePage + 1) * 64, filtered.length)} of {filtered.length}</span><button className="button" disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>Previous</button><button className="button" disabled={activePage === lastPage} onClick={() => setPage(activePage + 1)}>Next</button></div>}
    <p className="tm-note">CPU is normalized across logical processors. Working sets can share pages. Process I/O includes non-disk devices; network and GPU engine attribution are unavailable. End task requires native confirmation.</p>
  </section>;
}

export default function TaskManagerView({ data, notify, refreshInterval, refreshBusy, onRefreshIntervalChange, onProcessPollingChange }) {
  const [tab, setTab] = useState("performance");
  useEffect(() => {
    onProcessPollingChange(tab === "processes", refreshInterval);
  }, [tab, refreshInterval, onProcessPollingChange]);
  useEffect(() => () => onProcessPollingChange(false), [onProcessPollingChange]);
  const tabKeys = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "performance" : event.key === "End" ? "processes" : tab === "performance" ? "processes" : "performance";
    setTab(next);
    event.currentTarget.querySelector(`#tm-tab-${next}`)?.focus();
  };
  const timestamp = data.current?.timestamp;
  return <section className="task-manager panel" aria-label="Performance and processes">
    <div className="tm-topbar"><div className="tm-subtabs" role="tablist" aria-label="Task views" onKeyDown={tabKeys}>{[["performance", "Performance"], ["processes", "Processes"]].map(([id, title]) => <button role="tab" key={id} id={`tm-tab-${id}`} aria-controls="tm-view-panel" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>{title}</button>)}</div><div className="tm-topbar-actions"><label className="tm-refresh" title="Updates live CPU, memory, disk, network and process sampling. GPU and hardware sensors keep their separate cadence.">Refresh speed<select aria-label="Refresh speed" value={refreshInterval} disabled={refreshBusy} onChange={e => onRefreshIntervalChange(Number(e.target.value))}><option value={1}>Fast · 1 s</option><option value={2}>Normal · 2 s</option><option value={5}>Slow · 5 s</option></select></label><RouteButton to="task_manager" label="Open Task Manager" notify={notify} subtle /></div></div>
    <div id="tm-view-panel" role="tabpanel" aria-labelledby={`tm-tab-${tab}`}>
      <div hidden={tab !== "performance"}><Performance data={data} /></div>
      {tab === "processes" && <ProcessList current={data.current ?? {}} notify={notify} />}
    </div>
    <div className="tm-status"><span>Session history · {timestamp ? `Sampled ${clock(timestamp)}` : "Waiting for telemetry"}</span><span>{timestamp && Date.now() / 1000 - timestamp > Math.max(8, refreshInterval * 3) ? "Showing last sample · stale" : "Local telemetry"}</span></div>
  </section>;
}
