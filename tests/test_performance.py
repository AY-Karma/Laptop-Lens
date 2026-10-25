import base64
import os
import subprocess
import sys
import time
import unittest

import psutil

from desktop import serialize_export
from process_actions import ProcessActions, validate_reference
from windows_performance import WindowsPerformance, graph_sample, rates_between
from windows_processes import WindowsProcesses


class PerformanceTests(unittest.TestCase):
    def test_counter_baseline_reset_and_units(self):
        self.assertEqual(rates_between(None, 10, (100, 200)), [None, None])
        self.assertEqual(rates_between((10, (100, 200)), 12, (300, 600)), [100, 200])
        self.assertEqual(rates_between((10, (100, 200)), 12, (90, 600)), [None, None])
        self.assertEqual(rates_between((10, (100, 200)), 10, (300, 600)), [None, None])

    def test_native_memory_and_real_disk_samples(self):
        sampler = WindowsPerformance()
        try:
            sampler.sample(0, psutil.virtual_memory(), {}, None)
            time.sleep(.15)
            result = sampler.sample(0, psutil.virtual_memory(), {}, None)
            memory = result['memory']
            self.assertEqual(memory['totalBytes'], memory['inUseBytes'] + memory['availableBytes'])
            self.assertGreaterEqual(memory['commitLimitBytes'], memory['committedBytes'])
            self.assertGreater(memory['pagedPoolBytes'], 0)
            self.assertIsNone(memory['compressedBytes'])
            self.assertEqual(len(result['cpu']['perCore']), psutil.cpu_count())
            for disk in result['disks']:
                self.assertNotEqual(disk['id'], '_Total')
                if disk['activePercent'] is not None:
                    self.assertTrue(0 <= disk['activePercent'] <= 100)
                if disk['responseMs'] is not None:
                    self.assertGreaterEqual(disk['responseMs'], 0)
            graph = graph_sample(result)
            self.assertEqual(graph['memoryUsedBytes'], memory['inUseBytes'])
            csv, _ = serialize_export({'history': [{'timestamp': 1, 'cpu': 2, 'performance': graph}]}, 'csv')
            self.assertIn('timestamp,cpu', csv)
        finally:
            sampler.close()


class ProcessActionTests(unittest.TestCase):
    def setUp(self):
        self.sampler = WindowsProcesses()
        self.actions = ProcessActions(self.sampler)

    def test_bad_references_and_self_guard(self):
        for pid, identity in [(True, '1'), (0, '1'), (5, 1), (5, 'nan'), (-2, '1')]:
            with self.assertRaises(ValueError): validate_reference(pid, identity)
        rows, _ = self.sampler.sample()
        own = next(row for row in rows if row['pid'] == os.getpid())
        self.assertFalse(own['canEnd'])
        with self.assertRaises(ValueError):
            self.actions.end(own['pid'], own['identity'], lambda *args: self.fail('Self must never reach confirmation'))

    def test_pid_identity_cancel_and_end_disposable_child(self):
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'], creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            rows, _ = self.sampler.sample()
            row = next(row for row in rows if row['pid'] == child.pid)
            with self.assertRaises(ValueError):
                self.actions.end(child.pid, str(int(row['identity']) + 1), lambda *a: True)
            self.assertIsNone(child.poll())
            result = self.actions.end(child.pid, row['identity'], lambda *a: False)
            self.assertTrue(result['cancelled'])
            self.assertIsNone(child.poll())
            self.assertTrue(self.actions.end(child.pid, row['identity'], lambda *a: True)['success'])
            child.wait(timeout=5)
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=5)

    def test_actual_shell_icon_png_and_friendly_name(self):
        rows, _ = self.sampler.sample()
        own = next(row for row in rows if row['pid'] == os.getpid())
        response = self.actions.icons([own])
        key = f"{own['pid']}:{own['identity']}"
        png = response['icons'][key].split(',', 1)[1]
        self.assertTrue(base64.b64decode(png).startswith(b'\x89PNG\r\n\x1a\n'))
        self.assertTrue(response['names'][key])
        self.assertNotIn('path', own)
        self.assertEqual(self.actions.icons([{**own, 'identity': '1'}])['icons'], {})
        with self.assertRaises(ValueError): self.actions.icons([own] * 33)


if __name__ == '__main__':
    unittest.main()
