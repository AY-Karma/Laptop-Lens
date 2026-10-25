"""Opt-in packaged app verification. Never enabled for ordinary launches."""
import json
import threading

from desktop import DesktopApi


class SmokeApi(DesktopApi):
    def __init__(self, monitor, output, port):
        super().__init__(monitor)
        self._output = output
        self._port = port
        self._done = threading.Event()
        self._routes = []

    def open_destination(self, key):
        # Verify UI dispatch without launching external apps in a smoke test.
        from system_actions import DESTINATIONS
        if key != 'vantage' and key not in DESTINATIONS:
            return {'opened': False, 'error': 'Unknown smoke-test destination'}
        self._routes.append(key)
        return {'opened': True, 'message': 'Route recorded by test harness.'}

    def report_probe(self, result):
        result['port'] = self._port
        result['nativeTitle'] = self._window.title
        result['routes'] = self._routes
        self._output.write_text(json.dumps(result, indent=2), encoding='utf-8')
        self._done.set()
        self._window.destroy()

    def _attach(self, window):
        def loaded():
            window.run_js("""
            (async () => {
              const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
              try {
                for (let i = 0; i < 100 && !document.querySelector('.metric'); i++) await wait(100);
                const data = await fetch('/api/snapshot').then(r => r.json());
                for (let i = 0; i < 70 && !document.querySelector('.overview-process-app img')?.naturalWidth; i++) await wait(100);
                const fontAudit = () => [...new Set([...document.querySelectorAll('body *')]
                  .filter(e => e.getClientRects().length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
                  .map(e => getComputedStyle(e).fontFamily))];
                const result = {
                  desktop: data.desktop, cpu: data.current?.cpu,
                  processes: data.current?.processes.length,
                  logoLoaded: !!document.querySelector('.brand-logo')?.naturalWidth,
                  canvases: document.querySelectorAll('canvas').length,
                  nativeExportBridge: typeof window.pywebview.api.save_report === 'function',
                  overview: document.querySelector('h1')?.textContent,
                  overviewAppIcons: [...document.querySelectorAll('.overview-process-app img')].filter(img => img.naturalWidth > 0).length,
                  overviewIconSlots: document.querySelectorAll('.overview-process-app').length,
                  typography: {
                    families: { overview: fontAudit() },
                    bodyPx: parseFloat(getComputedStyle(document.body).fontSize),
                    titlePx: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
                    titleWeight: getComputedStyle(document.querySelector('h1')).fontWeight,
                  },
                  outboundResources: performance.getEntriesByType('resource').filter(r => !r.name.startsWith(location.origin)).map(r => r.name),
                };
                document.querySelector('nav button:nth-child(3)').click(); await wait(100);
                result.hardware = document.querySelector('h1')?.textContent;
                result.typography.families.hardware = fontAudit();
                document.querySelector('nav button:nth-child(2)').click(); await wait(200);
                result.performanceDefault = document.querySelector('.tm-detail-heading h2')?.textContent;
                result.performanceGraph = !!document.querySelector('.tm-detail svg[role="img"]');
                for (let i = 0; i < 150; i++) {
                  const reading = await fetch('/api/snapshot').then(r => r.json());
                  if (reading.hardware.memory?.speedMts) break;
                  await wait(100);
                }
                await wait(2200);
                result.resourceCount = document.querySelectorAll('.tm-resource').length;
                result.performanceMemoryText = document.querySelector('.tm-memory-details')?.textContent;
                result.composition = !!document.querySelector('.tm-composition-used');
                result.performanceOverflow = document.documentElement.scrollWidth > innerWidth;
                result.typography.families.performance = fontAudit();
                result.removedBranding = !/Fin-v1|NO ADS|NO SUBSCRIPTIONS|YOUR LAPTOP, UNDERSTOOD/.test(document.body.innerText);
                const speed = document.querySelector('select[aria-label="Refresh speed"]');
                result.refreshSpeeds = [...speed.options].map(o => Number(o.value));
                const chooseSpeed = async value => {
                  const select = document.querySelector('select[aria-label="Refresh speed"]');
                  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
                  setter.call(select, String(value)); select.dispatchEvent(new Event('change', { bubbles: true }));
                  for (let i = 0; i < 60; i++) {
                    await wait(100);
                    const reading = await fetch('/api/snapshot').then(r => r.json());
                    if (reading.intervalSeconds === value && !select.disabled) return reading;
                  }
                  throw new Error('Refresh setting did not reach collector');
                };
                await chooseSpeed(1); await wait(2400);
                const fast = await fetch('/api/snapshot').then(r => r.json());
                result.fastSampleGap = fast.history.at(-1).timestamp - fast.history.at(-2).timestamp;
                result.fastLiveLabel = document.querySelector('.live-status')?.textContent.trim();
                await chooseSpeed(5);
                result.slowSetting = (await fetch('/api/snapshot').then(r => r.json())).intervalSeconds;
                await chooseSpeed(2);
                document.querySelector('#tm-resource-cpu')?.click(); await wait(100);
                result.cpuDetail = document.querySelector('.tm-detail-heading h2')?.textContent;
                document.querySelector('.tm-core-control input')?.click(); await wait(100);
                result.logicalProcessorGraphs = document.querySelectorAll('.tm-core-grid svg').length;
                const resource = kind => [...document.querySelectorAll('.tm-resource')].find(b => b.id.startsWith(`tm-resource-${kind}:`));
                result.resourceDetails = {};
                for (const kind of ['disk', 'network', 'gpu']) {
                  resource(kind)?.click(); await wait(100);
                  result.resourceDetails[kind] = document.querySelector('.tm-detail-heading h2')?.textContent;
                }
                document.querySelector('#tm-resource-memory')?.click(); await wait(100);
                [...document.querySelectorAll('.tm-duration button')].find(b => b.textContent === '4 min')?.click(); await wait(100);
                result.selectedDuration = document.querySelector('.tm-duration [aria-pressed="true"]')?.textContent;
                document.querySelector('#tm-tab-processes')?.click();
                for (let i = 0; i < 70 && !document.querySelector('.tm-process-name img')?.naturalWidth; i++) await wait(100);
                result.processRows = document.querySelectorAll('.tm-process-table tbody tr').length;
                result.processIcons = [...document.querySelectorAll('.tm-process-name img')].filter(img => img.naturalWidth > 0).length;
                document.querySelector('.tm-process-table th:nth-child(4) button')?.click(); await wait(100);
                result.memorySort = document.querySelector('.tm-process-table th:nth-child(4)')?.getAttribute('aria-sort');
                result.nativeProcessActions = ['get_process_icons', 'end_process', 'open_process_location', 'run_new_task'].every(k => typeof window.pywebview.api[k] === 'function');
                document.querySelector('.tm-process-name')?.click(); await wait(100);
                result.processSelected = !!document.querySelector('.tm-process-name[aria-pressed="true"]');
                result.typography.families.processes = fontAudit();
                const nav = text => [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === text).click();
                nav('Device Controls');
                for (let i = 0; i < 100 && !document.querySelector('[aria-label="Rapid Charge"]'); i++) await wait(100);
                const controls = await window.pywebview.api.get_device_controls();
                result.controlsCards = document.querySelectorAll('.control-card').length;
                result.typography.controlDescriptionPx = parseFloat(getComputedStyle(document.querySelector('.control-description')).fontSize);
                result.controlsOverflow = document.documentElement.scrollWidth > innerWidth;
                result.typography.families.controls = fontAudit();
                result.chargingMode = controls.controls.battery_mode?.value;
                result.usbMode = controls.controls.always_usb?.value;
                result.admin = controls.admin;
                result.rapidSwitch = document.querySelector('[aria-label="Rapid Charge"]')?.getAttribute('aria-checked');
                const nativeRoute = [...document.querySelectorAll('.device-controls-page button')].find(b => b.textContent.includes('Open camera settings'));
                nativeRoute?.click(); await wait(100);
                window.scrollTo(0, 500); await wait(100);
                nav('System Updates'); await wait(100);
                result.updatesHeading = document.querySelector('h1')?.textContent;
                result.typography.families.updates = fontAudit();
                result.navigationScrollY = window.scrollY;
                nav('Hardware');
                for (let i = 0; i < 100 && document.querySelectorAll('.detail-row').length < 10; i++) await wait(100);
                result.deviceDetailRows = document.querySelectorAll('.detail-row').length;
                const details = await window.pywebview.api.get_device_details(false);
                result.serialRedacted = details.details?.serialNumber === 'Hidden';
                [...document.querySelectorAll('nav button')].at(-1).click(); await wait(100);
                result.typography.families.coverage = fontAudit();
                await window.pywebview.api.report_probe(result);
              } catch (error) { await window.pywebview.api.report_probe({error: String(error)}); }
            })();
            """)
        window.events.loaded += loaded
