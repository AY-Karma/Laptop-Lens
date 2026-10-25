import json
import os
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import Mock

from app import make_handler
from telemetry import Monitor, battery_details, insights
from windows_processes import cpu_delta
import psutil


class TelemetryTests(unittest.TestCase):
    def test_refresh_change_interrupts_slow_sampling_wait(self):
        monitor = Monitor(interval=5)
        worker = threading.Thread(target=monitor._sample_loop)
        worker.start()
        try:
            deadline = time.monotonic() + 3
            while not monitor.current and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertIsNotNone(monitor.current)
            first = monitor.current['timestamp']
            monitor.set_interval(1)
            deadline = time.monotonic() + 1.8
            while monitor.current['timestamp'] == first and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertGreater(monitor.current['timestamp'], first)
            self.assertEqual(monitor.snapshot()['intervalSeconds'], 1)
        finally:
            monitor.request_stop()
            worker.join(1)
            self.assertFalse(worker.is_alive())

    def test_hidden_collection_suspends_and_resumes(self):
        monitor = Monitor(interval=5)
        worker = threading.Thread(target=monitor._sample_loop)
        worker.start()
        try:
            deadline = time.monotonic() + 3
            while not monitor.current and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertIsNotNone(monitor.current)
            monitor.set_active(False)
            paused_at = monitor.current['timestamp']
            time.sleep(.3)
            self.assertEqual(monitor.current['timestamp'], paused_at)
            monitor.set_active(True)
            deadline = time.monotonic() + 1.5
            while monitor.current['timestamp'] == paused_at and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertGreater(monitor.current['timestamp'], paused_at)
        finally:
            monitor.request_stop()
            worker.join(1)
            self.assertFalse(worker.is_alive())

    def test_process_sampler_uses_its_own_refresh_interval(self):
        monitor = Monitor()
        sampler = Mock(return_value=([{'pid': 123, 'cpu': 1.0}], 0))
        monitor.process_sampler.sample = sampler
        monitor.set_processes_enabled(True, 5)
        first = monitor.sample()
        second = monitor.sample()
        self.assertEqual(sampler.call_count, 1)
        self.assertEqual(second['processes'], first['processes'])
        monitor.set_processes_enabled(True, 2)
        monitor.sample()
        self.assertEqual(sampler.call_count, 2)

    def test_new_and_reused_pids_have_no_cpu_estimate(self):
        self.assertIsNone(cpu_delta(None, 100, 50, 2, 16))
        self.assertIsNone(cpu_delta((100, 20, 1, 'old'), 101, 50, 2, 16))
        self.assertIsNone(cpu_delta((100, 60, 1, 'old'), 100, 50, 2, 16))

    def test_cpu_is_normalized_across_processors(self):
        self.assertEqual(cpu_delta((100, 0, 1, 'app'), 100, 10_000_000, 2, 16), 6.25)

    def test_battery_health_requires_matching_valid_capacities(self):
        data = {'batteryFull': [{'InstanceName': 'a', 'FullChargedCapacity': 70000}],
                'batteryDesign': [{'InstanceName': 'b', 'DesignedCapacity': 80000}]}
        self.assertTrue(all(b['healthPercent'] is None for b in battery_details(data)))
        data['batteryDesign'][0]['InstanceName'] = 'a'
        self.assertEqual(battery_details(data)[0]['healthPercent'], 87.5)
        data['batteryDesign'][0]['DesignedCapacity'] = 0xFFFFFFFF
        self.assertIsNone(battery_details(data)[0]['healthPercent'])

    def test_one_cpu_spike_does_not_trigger_sustained_load(self):
        current = {'timestamp': 100, 'cpu': 99, 'memory': {'percent': 40}, 'volumes': [], 'battery': None, 'gpu': None}
        self.assertEqual(insights([{'timestamp': 100, 'cpu': 99}], current)[0]['level'], 'ok')
        samples = [{'timestamp': t, 'cpu': 90} for t in range(60, 101, 2)]
        self.assertEqual(insights(samples, current)[0]['title'], 'Sustained CPU load')

    def test_live_windows_readings_and_idle_exclusion(self):
        monitor = Monitor()
        monitor.set_processes_enabled(True)
        reading = monitor.sample()
        self.assertGreater(reading['memory']['total'], 0)
        self.assertTrue(reading['processes'])
        self.assertTrue(all(p['pid'] != 0 for p in reading['processes']))
        self.assertTrue(all(p['cpu'] is None for p in reading['processes']))
        self.assertTrue(all(p['memory'] is None or p['memory'] >= 0 for p in reading['processes']))
        own = next(p for p in reading['processes'] if p['pid'] == os.getpid())
        self.assertLess(abs(own['memory'] - psutil.Process().memory_info().rss), 10 * 1024 ** 2)


class ApiTests(unittest.TestCase):
    def test_refresh_setting_validates_values_and_updates_collector(self):
        headers = {'Origin': self.base, 'Content-Type': 'application/json'}
        for seconds in (1, 5, 2):
            with urlopen(Request(self.base + '/api/settings', data=json.dumps({'intervalSeconds': seconds}).encode(), headers=headers)) as response:
                self.assertEqual(response.status, 204)
            self.assertEqual(self.monitor.snapshot()['intervalSeconds'], seconds)
        for bad in (0, -1, .5, 100, True, '1', None, []):
            with self.assertRaises(HTTPError) as error:
                urlopen(Request(self.base + '/api/settings', data=json.dumps({'intervalSeconds': bad}).encode(), headers=headers))
            self.assertEqual(error.exception.code, 400)
        self.assertEqual(self.monitor.interval, 2)

    def test_snapshot_history_can_be_requested_incrementally(self):
        with self.monitor.lock:
            self.monitor.samples.clear()
            self.monitor.samples.extend([
                {'timestamp': 1.0, 'cpu': 1, 'memoryPercent': 2,
                 'diskRead': 0, 'diskWrite': 0, 'netDown': 0, 'netUp': 0,
                 'performance': {}},
                {'timestamp': 2.0, 'cpu': 3, 'memoryPercent': 4,
                 'diskRead': 0, 'diskWrite': 0, 'netDown': 0, 'netUp': 0,
                 'performance': {}},
            ])
            self.monitor.current = {'timestamp': 2.0, 'cpu': 3, 'memory': {'percent': 4},
                                    'volumes': [], 'battery': None, 'gpu': None,
                                    'processes': [{'pid': 77}], 'processesSkipped': 0}
            self.monitor.process_generation = 8
        full = self.monitor.snapshot()
        delta = self.monitor.snapshot(history_since=1.0)
        self.assertEqual(len(full['history']), 2)
        self.assertNotIn('history', delta)
        self.assertEqual([row['timestamp'] for row in delta['historyDelta']], [2.0])
        sparse_processes = self.monitor.snapshot(history_since=1.0, process_since=8)
        self.assertNotIn('processes', sparse_processes['current'])
        full_processes = self.monitor.snapshot(history_since=1.0, process_since=7)
        self.assertEqual(full_processes['current']['processes'], [{'pid': 77}])
        resumed = self.monitor.snapshot(history_since=0.0)
        self.assertEqual(len(resumed['history']), 2)
        with urlopen(self.base + '/api/snapshot?since=1.0&processSince=8') as response:
            api_delta = json.load(response)
        self.assertNotIn('history', api_delta)
        self.assertNotIn('processes', api_delta['current'])
        self.assertEqual([row['timestamp'] for row in api_delta['historyDelta']], [2.0])
        with self.assertRaises(HTTPError) as error:
            urlopen(self.base + '/api/snapshot?since=NaN')
        self.assertEqual(error.exception.code, 400)
        with self.assertRaises(HTTPError) as error:
            urlopen(self.base + '/api/snapshot?processSince=bad')
        self.assertEqual(error.exception.code, 400)

    def test_process_and_activity_settings_are_validated(self):
        headers = {'Origin': self.base, 'Content-Type': 'application/json'}
        for setting, expected in (({'processesEnabled': True, 'processesIntervalSeconds': 2}, True), ({'active': False}, False)):
            with urlopen(Request(self.base + '/api/settings', data=json.dumps(setting).encode(), headers=headers)) as response:
                self.assertEqual(response.status, 204)
            if 'processesEnabled' in setting:
                self.assertEqual(self.monitor.processes_enabled, expected)
                self.assertEqual(self.monitor.processes_interval, 2)
            else:
                self.assertEqual(self.monitor.active, expected)
        for setting in ({'processesEnabled': 'true'}, {'active': 1}):
            with self.assertRaises(HTTPError) as error:
                urlopen(Request(self.base + '/api/settings', data=json.dumps(setting).encode(), headers=headers))
            self.assertEqual(error.exception.code, 400)
        setting = {'processesEnabled': True, 'processesIntervalSeconds': 10}
        with self.assertRaises(HTTPError) as error:
            urlopen(Request(self.base + '/api/settings', data=json.dumps(setting).encode(), headers=headers))
        self.assertEqual(error.exception.code, 400)

    @classmethod
    def setUpClass(cls):
        cls.monitor = Monitor()
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), lambda *args: None)
        cls.port = cls.server.server_port
        cls.server.RequestHandlerClass = make_handler(cls.monitor, cls.port)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.port}'

    @classmethod
    def tearDownClass(cls):
        cls.monitor.request_stop()
        cls.server.shutdown()
        cls.server.server_close()

    def test_export_and_csv_work_without_samples(self):
        with urlopen(self.base + '/api/export') as r:
            self.assertIn('attachment', r.headers['Content-Disposition'])
            self.assertEqual(json.load(r)['history'], [])
        with urlopen(self.base + '/api/history.csv') as r:
            self.assertTrue(r.read().startswith(b'timestamp,cpu,'))

    def test_cross_origin_and_untrusted_host_are_rejected(self):
        for headers in ({'Origin': 'https://example.com'}, {'Host': 'evil.example'}):
            with self.assertRaises(HTTPError) as error:
                urlopen(Request(self.base + '/api/snapshot', headers=headers))
            self.assertEqual(error.exception.code, 403)

    def test_static_traversal_cannot_read_source(self):
        with self.assertRaises(HTTPError) as error:
            urlopen(self.base + '/assets/../../telemetry.py')
        self.assertEqual(error.exception.code, 404)

    def test_settings_require_same_origin_and_boolean(self):
        headers = {'Origin': self.base, 'Content-Type': 'application/json'}
        req = Request(self.base + '/api/settings', data=b'{"gpuEnabled":false}', headers=headers)
        with urlopen(req) as response:
            self.assertEqual(response.status, 204)
        self.assertFalse(self.monitor.snapshot()['gpuEnabled'])
        req = Request(self.base + '/api/settings', data=b'{"gpuEnabled":"false"}', headers=headers)
        with self.assertRaises(HTTPError) as error:
            urlopen(req)
        self.assertEqual(error.exception.code, 400)
        req = Request(self.base + '/api/settings', data=b'{"gpuEnabled":true}', headers={'Content-Type': 'application/json'})
        with self.assertRaises(HTTPError) as error:
            urlopen(req)
        self.assertEqual(error.exception.code, 403)


if __name__ == '__main__':
    unittest.main()
