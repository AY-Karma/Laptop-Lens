import React, { useCallback, useEffect, useState } from "react";
import { ActionIcon } from "./views/ActionIcon";
import "./device-controls.css";

export async function nativeCall(method, ...args) {
  const api = window.pywebview?.api;
  if (!api?.[method])
    throw new Error("Open the Laptop Lens desktop app to use this action.");
  return api[method](...args);
}

export async function routeTo(key, notify) {
  try {
    const result = await nativeCall("open_destination", key);
    notify({ error: !result.opened, text: result.message || result.error });
    return result;
  } catch (error) {
    notify({ error: true, text: error.message });
    return { opened: false };
  }
}

function useNativeResource(method, args = [], interval = null, enabled = true) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const signature = JSON.stringify(args);
  const reload = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const nativeArgs = JSON.parse(signature);
      if (method === "get_device_controls") nativeArgs[0] = refresh === true;
      const value = await nativeCall(method, ...nativeArgs);
      if (value.error && !value.controls) throw new Error(value.error);
      setData(value);
      setError("");
      return value;
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }, [method, signature]);
  useEffect(() => {
    if (enabled && window.pywebview?.api) reload();
    else setLoading(false);
    if (enabled) window.addEventListener("pywebviewready", reload);
    const timer = enabled && interval ? setInterval(reload, interval) : null;
    return () => {
      if (enabled) window.removeEventListener("pywebviewready", reload);
      if (timer) clearInterval(timer);
    };
  }, [reload, interval, enabled]);
  return { data, setData, error, loading, reload };
}

export function RouteButton({ to, label, notify, subtle = false }) {
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState(null);
  const open = async () => {
    setBusy(true);
    const result = await routeTo(to, notify);
    setFallback(result.fallback ?? null);
    setBusy(false);
  };
  return (
    <div className="route-action">
      <button
        className={subtle ? "link-action" : "button"}
        onClick={open}
        disabled={busy}
      >
        {busy ? "Opening…" : label}
        <ActionIcon name="external" />
      </button>
      {fallback && (
        <button
          className="link-action"
          onClick={() => routeTo(fallback, notify)}
        >
          {fallback === "vantage_store"
            ? "Open Microsoft Store listing"
            : "Open fallback destination"}
        </button>
      )}
    </div>
  );
}

function VendorFallback({ text, notify }) {
  return (
    <div className="vendor-fallback">
      <p>{text}</p>
      <RouteButton
        to="vantage"
        label="Open Lenovo Vantage"
        notify={notify}
        subtle
      />
    </div>
  );
}

function ControlCard({
  title,
  subtitle,
  state,
  children,
  fallback,
  notify,
  badge,
}) {
  return (
    <article className="control-card" data-control={title}>
      <div className="control-title">
        <h3>{title}</h3>
        <span className={`control-badge ${state?.available ? "direct" : ""}`}>
          {badge || (state?.available ? "In app" : "Lenovo route")}
        </span>
      </div>
      <p className="control-description">{subtitle}</p>
      {state?.available ? (
        children
      ) : (
        <VendorFallback
          text={
            fallback ||
            state?.reason ||
            "This firmware control is managed by Lenovo Vantage."
          }
          notify={notify}
        />
      )}
    </article>
  );
}

function SettingSelect({ control, state, options, apply, busy }) {
  const [choice, setChoice] = useState(String(state?.value ?? ""));
  useEffect(() => setChoice(String(state?.value ?? "")), [state?.value]);
  const current = options.find(
    ([value]) => String(value) === String(state?.value),
  );
  return (
    <div className="setting-editor">
      <span className="current-value">
        {control === 'hybrid' ? 'Configured' : 'Current'}: <b>{current?.[1] ?? "Unknown"}</b>
      </span>
      <div className="setting-actions">
        <select
          aria-label={{thermal: 'Thermal mode', hybrid: 'Hybrid Mode', overdrive: 'Overdrive', touchpad_lock: 'Touchpad lock', always_usb: 'Always On USB'}[control] || control}
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          disabled={busy}
        >
          {options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          className="button primary-action"
          disabled={busy || choice === String(state?.value)}
          onClick={() =>
            apply(
              control,
              typeof options[0][0] === "number" ? Number(choice) : choice,
            )
          }
        >
          Apply
        </button>
      </div>
    </div>
  );
}

export function DeviceControls({ notify }) {
  const { data, setData, error, loading, reload } = useNativeResource(
    "get_device_controls",
    [],
    15000,
  );
  const [busy, setBusy] = useState(false);
  const [elevating, setElevating] = useState(false);
  const controls = data?.controls ?? {};
  const apply = async (key, value) => {
    setBusy(true);
    try {
      const result = await nativeCall("set_device_control", key, value);
      if (result.state) setData(result.state);
      notify({ error: !result.success, text: result.message || result.error });
      if (!result.state) await reload(true);
    } catch (error) {
      notify({ error: true, text: error.message });
    } finally {
      setBusy(false);
    }
  };
  const enable = async () => {
    setElevating(true);
    try {
      const result = await nativeCall("enable_device_controls");
      if (!result.restarting)
        notify({ error: !!result.error, text: result.error || result.message });
    } catch (error) {
      notify({ error: true, text: error.message });
    } finally {
      setElevating(false);
    }
  };
  const state = (key) => controls[key];
  const editor = (key, options) => (
    <SettingSelect
      control={key}
      state={state(key)}
      options={options}
      busy={busy}
      apply={apply}
    />
  );
  const battery = state("battery_mode");
  return (
    <div className="device-controls-page">
      <div className="controls-index" aria-label="Device control sections">
        <a href="#performance-controls">Performance & input</a>
        <a href="#charging-controls">Charging & power</a>
        <a href="#security-controls">Legion Edge & security</a>
        <a href="#appearance-controls">Camera & display</a>
      </div>
      <section className="panel access-panel">
        <div>
          <span className="eyebrow">YOUR HARDWARE, YOUR CHOICE</span>
          <h2>Lenovo device controls</h2>
          <p>
            {data?.admin
              ? "Administrator access enabled. Each change is checked against a fresh device reading."
              : "Charging and USB power work directly when the installed driver allows it. Advanced Lenovo controls may require administrator access."}
          </p>
        </div>
        <div className="access-actions">
          <button
            className="button"
            onClick={() => reload(true)}
            disabled={loading || busy}
          >
            {loading ? "Reading…" : "Refresh controls"}
          </button>
          {data && !data.admin && (
            <button
              className="button primary-action"
              onClick={enable}
              disabled={elevating}
            >
              {elevating ? "Reopening…" : "Enable Lenovo controls"}
            </button>
          )}
        </div>
        {data && !data.admin && (
          <p className="muted tiny access-note">
            Enable opens the Windows administrator prompt and restarts this app.
            Session history resets; no device setting changes until you apply
            one.
          </p>
        )}
      </section>
      {(error || data?.error) && (
        <div className="notice" role="status">
          {error || data.error}
        </div>
      )}
      <div className="section-label" id="performance-controls">
        <h2>Performance, graphics & input</h2>
        <span>Firmware-backed controls</span>
      </div>
      <div className="controls-grid">
        <ControlCard
          title="Thermal mode"
          subtitle="Choose the fan and firmware power profile. Performance needs AC power."
          state={state("thermal")}
          notify={notify}
        >
          {editor("thermal", [
            [1, "Quiet"],
            [2, "Balanced"],
            [3, "Performance"],
          ])}
        </ControlCard>
        <ControlCard
          title="Hybrid Mode"
          subtitle="Select Hybrid graphics or discrete GPU mode. A Windows restart is needed to apply a change."
          state={state("hybrid")}
          notify={notify}
        >
          {editor("hybrid", [
            [0, "Hybrid on"],
            [1, "Hybrid off · discrete GPU"],
          ])}
        </ControlCard>
        <ControlCard
          title="Overdrive"
          subtitle="Panel pixel response-time enhancement. This does not overclock the GPU."
          state={state("overdrive")}
          notify={notify}
        >
          {editor("overdrive", [
            [0, "Off"],
            [1, "On"],
          ])}
        </ControlCard>
        <ControlCard
          title="Touchpad lock"
          subtitle="Disable or restore the built-in touchpad. Keep keyboard or external mouse access available."
          state={state("touchpad_lock")}
          notify={notify}
        >
          {editor("touchpad_lock", [
            [0, "Unlocked"],
            [1, "Locked"],
          ])}
        </ControlCard>
      </div>
      <div className="section-label" id="charging-controls">
        <h2>Charging & power</h2>
        <span>From the installed Lenovo driver</span>
      </div>
      <div className="controls-grid">
        <ControlCard
          title="Battery charging mode"
          subtitle="Conservation uses the firmware's charge limit. Rapid Charge and Conservation are mutually exclusive."
          state={battery}
          notify={notify}
        >
          <div className="charge-switches">
            {[
              ["conservation", "Conservation mode"],
              ["rapid", "Rapid Charge"],
            ].map(([value, label]) => (
              <div key={value}>
                <span>{label}</span>
                <button
                  role="switch"
                  aria-label={label}
                  aria-checked={battery?.value === value}
                  className="control-switch"
                  disabled={busy}
                  onClick={() =>
                    apply(
                      "battery_mode",
                      battery.value === value ? "normal" : value,
                    )
                  }
                >
                  <i />
                </button>
              </div>
            ))}
          </div>
          <p className="control-source">
            Current mode: {battery?.value ?? "Unknown"}
          </p>
        </ControlCard>
        <ControlCard
          title="Always On USB"
          subtitle="Supply power through supported USB ports while sleeping, or while sleeping and shut down."
          state={state("always_usb")}
          notify={notify}
        >
          {editor("always_usb", [
            ["off", "Off"],
            ["sleep", "While sleeping"],
            ["always", "Sleeping + shut down"],
          ])}
        </ControlCard>
        <ControlCard
          title="Flip to start"
          subtitle="Turn on the laptop by opening its lid."
          notify={notify}
          fallback="In Lenovo Vantage, open Device settings → Power → Flip to start. This laptop's boot-variable interface is managed there."
        />
        <ControlCard
          title="Power & sleep"
          subtitle="Windows screen timeouts, sleep behavior and power preferences."
          state={{ available: true }}
          badge="Windows route"
          notify={notify}
        >
          <RouteButton
            to="power"
            label="Open power & sleep settings"
            notify={notify}
            subtle
          />
        </ControlCard>
      </div>
      {!!Object.keys(data?.sensors ?? {}).length && (
        <section className="panel sensor-panel">
          <h2>Lenovo sensor readings</h2>
          <div className="sensor-grid">
            {[
              ["cpuTemperature", "CPU temperature", "°C"],
              ["gpuTemperature", "GPU temperature", "°C"],
              ["fan1Rpm", "Fan 1", "RPM"],
              ["fan2Rpm", "Fan 2", "RPM"],
            ].map(([key, label, unit]) => (
              <div key={key}>
                <span>{label}</span>
                <b>
                  {data.sensors[key] == null
                    ? "Not exposed"
                    : `${data.sensors[key]} ${unit}`}
                </b>
              </div>
            ))}
          </div>
          <p className="muted tiny">
            Source: Lenovo GameZone provider. Refreshed while this section is
            open.
          </p>
        </section>
      )}
      <div className="section-label" id="security-controls">
        <h2>Legion Edge & security</h2>
        <span>Open the relevant service from here</span>
      </div>
      <div className="controls-grid">
        <ControlCard
          title="Network Boost"
          subtitle="Configure Lenovo's application network-priority feature."
          notify={notify}
          fallback="Open the Legion Edge panel in Lenovo Vantage, then use Network Boost and its settings gear."
        />
        <ControlCard
          title="Auto Close"
          subtitle="Choose the application list for Lenovo's gaming cleanup feature."
          notify={notify}
          fallback="Open Legion Edge → Auto Close in Lenovo Vantage to review which applications it may close."
        />
        <ControlCard
          title="WiFi Security"
          subtitle="Use Windows Security or open Lenovo's WiFi Security configuration."
          state={{ available: true }}
          badge="Service routes"
          notify={notify}
        >
          <RouteButton
            to="security"
            label="Open Windows Security settings"
            notify={notify}
            subtle
          />
          <RouteButton
            to="network"
            label="Open network settings"
            notify={notify}
            subtle
          />
          <VendorFallback
            text="Lenovo's own WiFi Security checker is in Vantage → Quick Settings."
            notify={notify}
          />
        </ControlCard>
        <ControlCard
          title="Hardware diagnostics"
          subtitle="Launch the installed Lenovo diagnostic experience."
          notify={notify}
          fallback="In Lenovo Vantage, choose Support → Hardware Scan. Results and any diagnostic run stay in Lenovo's tool."
        />
      </div>
      <div className="section-label" id="appearance-controls">
        <h2>Camera, display & appearance</h2>
        <span>Windows device settings</span>
      </div>
      <div className="controls-grid">
        <ControlCard
          title="Camera"
          subtitle="Camera brightness, contrast and supported image controls, plus camera access permissions."
          state={{ available: true }}
          badge="Windows route"
          notify={notify}
        >
          <RouteButton
            to="camera"
            label="Open camera settings"
            notify={notify}
            subtle
          />
          <RouteButton
            to="camera_privacy"
            label="Camera privacy & access"
            notify={notify}
            subtle
          />
        </ControlCard>
        <ControlCard
          title="Display & graphics"
          subtitle="Brightness, scaling, refresh rate options and application GPU preferences."
          state={{ available: true }}
          badge="Windows route"
          notify={notify}
        >
          <RouteButton
            to="display"
            label="Open display settings"
            notify={notify}
            subtle
          />
          <RouteButton
            to="graphics"
            label="Graphics preferences"
            notify={notify}
            subtle
          />
        </ControlCard>
        <ControlCard
          title="Colors & themes"
          subtitle="Wallpaper, colors and Windows theme preferences."
          state={{ available: true }}
          badge="Windows route"
          notify={notify}
        >
          <RouteButton
            to="personalization"
            label="Open personalization settings"
            notify={notify}
            subtle
          />
        </ControlCard>
        <ControlCard
          title="Startup applications"
          subtitle="Review which applications Windows starts when you sign in."
          state={{ available: true }}
          badge="Windows route"
          notify={notify}
        >
          <RouteButton
            to="startup"
            label="Open startup apps"
            notify={notify}
            subtle
          />
        </ControlCard>
      </div>
    </div>
  );
}

export function SystemUpdates({ notify }) {
  return (
    <div className="updates-page">
      <section className="panel update-hero">
        <div className="update-symbol">
          <ActionIcon name="latest" />
        </div>
        <div>
          <span className="eyebrow">WINDOWS HANDLES THE UPDATE</span>
          <h2>System updates</h2>
          <p>
            Check for Windows updates and supported driver updates in the
            Windows Settings app.
          </p>
          <RouteButton
            to="updates"
            label="Open Windows Update"
            notify={notify}
          />
        </div>
      </section>
      <div className="controls-grid">
        {[
          [
            "optional_updates",
            "Optional & driver updates",
            "Review optional updates offered by Windows.",
          ],
          [
            "update_history",
            "Update history",
            "See installed updates and their details.",
          ],
          [
            "update_options",
            "Update options",
            "Manage active hours and update preferences.",
          ],
          ["recovery", "Recovery", "Open Windows recovery and reset options."],
        ].map(([key, title, description]) => (
          <article className="control-card" key={key}>
            <h3>{title}</h3>
            <p className="control-description">{description}</p>
            <RouteButton
              to={key}
              label={`Open ${title.toLowerCase()}`}
              notify={notify}
              subtle
            />
          </article>
        ))}
        <article className="control-card">
          <h3>Lenovo drivers & BIOS</h3>
          <p className="control-description">
            Use the installed Lenovo updater for device-specific firmware and
            drivers.
          </p>
          <VendorFallback
            text="In Lenovo Vantage, choose System Update. Review each firmware update in Lenovo's updater before installation."
            notify={notify}
          />
        </article>
        <article className="control-card">
          <h3>Lenovo support</h3>
          <p className="control-description">
            Find product support and official downloads. A generic support page
            opens without attaching your serial number.
          </p>
          <RouteButton
            to="support"
            label="Open Lenovo support"
            notify={notify}
            subtle
          />
        </article>
      </div>
      <p className="muted tiny routes-note">
        These actions open the named Windows or Lenovo app. Update availability
        and installation status are shown there.
      </p>
    </div>
  );
}

const formatBytes = (n) =>
  n == null
    ? "Not exposed by Windows"
    : n >= 1024 ** 4
      ? `${(n / 1024 ** 4).toFixed(2)} TiB`
      : `${(n / 1024 ** 3).toFixed(1)} GiB`;
const detailRows = [
  ["deviceName", "Device name"],
  ["family", "Product family"],
  ["model", "Machine type"],
  ["productNumber", "Product number"],
  ["serialNumber", "Serial number"],
  ["bios", "BIOS version"],
  ["processor", "Processor"],
  ["storageBytes", "Storage"],
  ["installedRamBytes", "Installed RAM"],
  ["usableRamBytes", "Usable RAM"],
  ["deviceId", "Device ID"],
  ["productId", "Windows product ID"],
  ["windows", "Windows edition"],
  ["windowsVersion", "Windows version"],
  ["windowsBuild", "Windows build"],
];

export function DeviceDetails({ notify }) {
  const [expanded, setExpanded] = useState(false);
  const [reveal, setReveal] = useState(false);
  const { data, error, loading, reload } = useNativeResource(
    "get_device_details",
    [reveal],
    null,
    expanded,
  );
  const copy = async (key) => {
    try {
      const result = await nativeCall("copy_device_detail", key);
      notify({
        error: !result.copied,
        text: result.copied
          ? key === "all"
            ? "Copied device details, including IDs."
            : "Copied device detail."
          : result.error,
      });
    } catch (error) {
      notify({ error: true, text: error.message });
    }
  };
  const details = data?.details;
  return (
    <details
      className="panel device-details-panel"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="device-details-summary">
        <div>
          <span className="eyebrow">YOUR DEVICE</span>
          <h2>Device details</h2>
        </div>
        <span className="device-details-toggle">
          {expanded ? "Hide details" : "Show details"}
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </summary>
      <div className="device-details-content">
        <div className="details-actions">
          <button className="button" onClick={() => setReveal((v) => !v)}>
            {reveal ? "Hide IDs" : "Reveal IDs"}
          </button>
          <button
            className="button"
            onClick={() => copy("all")}
            disabled={!details}
          >
            Copy all
          </button>
        </div>
        {loading && !details ? (
          <p className="muted">Reading device information?</p>
        ) : error ? (
          <div className="notice">
            {error}
            <button className="link-action" onClick={reload}>
              Try again
            </button>
          </div>
        ) : (
          <div className="device-details-table">
            {detailRows.map(([key, label]) => (
              <div className="detail-row" key={key}>
                <span>{label}</span>
                <b>
                  {key.endsWith("Bytes")
                    ? formatBytes(details?.[key])
                    : details?.[key] || "Not exposed by Windows"}
                </b>
                <button
                  className="copy-detail"
                  aria-label={`Copy ${label.toLowerCase()}`}
                  onClick={() => copy(key)}
                  disabled={!details?.[key]}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <rect x="8" y="8" width="12" height="12" rx="2" />
                    <path d="M16 8V4H4v12h4" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="warranty-row">
          <div>
            <h3>Device warranty</h3>
            <p>
              Check the current entitlement with Lenovo. Enter the serial on
              Lenovo's page if requested.
            </p>
          </div>
          <RouteButton to="warranty" label="Check warranty" notify={notify} />
        </div>
        <p className="muted tiny">
          IDs are loaded only for this section and are excluded from ordinary
          monitoring exports. Copy all includes them. If Windows does not expose
          the full product number, find it in Vantage.
        </p>
        <RouteButton
          to="vantage"
          label="Open Lenovo Vantage"
          notify={notify}
          subtle
        />
      </div>
    </details>
  );
}
