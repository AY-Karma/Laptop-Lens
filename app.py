"""Laptop Lens: a loopback-only, read-only laptop observatory."""
import argparse
import csv
import io
import json
import math
import socket
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from urllib.request import urlopen

from telemetry import Monitor

ROOT = Path(__file__).resolve().parent


class LocalServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR can let a second collector steal the same port.
    allow_reuse_address = False

    def server_bind(self):
        if sys.platform == 'win32':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def make_handler(monitor, port, desktop=False):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            origin = self.headers.get('Origin')
            allowed = (f'http://127.0.0.1:{port}', f'http://localhost:{port}')
            if (self.headers.get('Host') not in (f'127.0.0.1:{port}', f'localhost:{port}')
                    or origin not in allowed or self.headers.get('Content-Type') != 'application/json'):
                self.send_error(403)
                return
            if self.path != '/api/settings':
                self.send_error(404)
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 1024:
                    raise ValueError('Invalid request size')
                settings = json.loads(self.rfile.read(length))
                if not isinstance(settings, dict):
                    raise ValueError('Expected settings object')
                if set(settings) == {'gpuEnabled'} and isinstance(settings['gpuEnabled'], bool):
                    monitor.set_gpu_enabled(settings['gpuEnabled'])
                elif set(settings) == {'intervalSeconds'}:
                    monitor.set_interval(settings['intervalSeconds'])
                elif set(settings) == {'processesEnabled'} and type(settings['processesEnabled']) is bool:
                    monitor.set_processes_enabled(settings['processesEnabled'])
                elif set(settings) == {'processesEnabled', 'processesIntervalSeconds'}:
                    monitor.set_processes_enabled(settings['processesEnabled'], settings['processesIntervalSeconds'])
                elif set(settings) == {'active'} and type(settings['active']) is bool:
                    monitor.set_active(settings['active'])
                else:
                    raise ValueError('Unsupported setting')
            except (ValueError, TypeError):
                self.send_error(400)
                return
            self.send_response(204)
            self.send_header('Content-Length', '0')
            self.end_headers()

        def do_GET(self):
            # Reject DNS rebinding and cross-origin requests. No remote binding or CORS.
            if self.headers.get('Host') not in (f'127.0.0.1:{port}', f'localhost:{port}'):
                self.send_error(403)
                return
            origin = self.headers.get('Origin')
            if origin and origin not in (f'http://127.0.0.1:{port}', f'http://localhost:{port}'):
                self.send_error(403)
                return
            path = urlsplit(self.path).path
            headers = {}
            if path == '/api/snapshot':
                query = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
                since_values = query.get('since', [])
                process_values = query.get('processSince', [])
                if (len(since_values) > 1 or len(process_values) > 1
                        or set(query) - {'since', 'processSince'}):
                    self.send_error(400)
                    return
                history_since = None
                process_since = None
                if since_values:
                    try:
                        history_since = float(since_values[0])
                    except ValueError:
                        self.send_error(400)
                        return
                    if not math.isfinite(history_since) or history_since < 0:
                        self.send_error(400)
                        return
                if process_values:
                    try:
                        process_since = int(process_values[0])
                    except ValueError:
                        self.send_error(400)
                        return
                    if process_since < 0:
                        self.send_error(400)
                        return
                content = json.dumps({**monitor.snapshot(history_since, process_since), 'desktop': desktop}, allow_nan=False).encode()
                mime = 'application/json; charset=utf-8'
            elif path == '/api/export':
                content = json.dumps(monitor.snapshot(), indent=2, allow_nan=False).encode()
                mime = 'application/json; charset=utf-8'
                headers['Content-Disposition'] = 'attachment; filename="laptop-lens-report.json"'
            elif path == '/api/history.csv':
                stream = io.StringIO(newline='')
                rows = monitor.snapshot()['history']
                keys = ['timestamp', 'cpu', 'memoryPercent', 'diskRead', 'diskWrite', 'netDown', 'netUp']
                writer = csv.DictWriter(stream, fieldnames=keys, extrasaction='ignore')
                writer.writeheader()
                writer.writerows(rows)
                content, mime = stream.getvalue().encode(), 'text/csv; charset=utf-8'
                headers['Content-Disposition'] = 'attachment; filename="laptop-lens-history.csv"'
            elif path in ('/', '/laptop-lens.png') or path.startswith('/assets/'):
                import mimetypes
                public = (ROOT / 'dist').resolve()
                asset = (public / ('index.html' if path == '/' else path.lstrip('/'))).resolve()
                if not asset.is_relative_to(public) or not asset.is_file():
                    self.send_error(404, 'Build the frontend with npm run build first')
                    return
                content = asset.read_bytes()
                mime = (mimetypes.guess_type(str(asset))[0] or 'application/octet-stream')
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
            for key, value in headers.items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(content)

        def log_message(self, *args):
            pass
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--open', action='store_true', help='Open the dashboard in your browser')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('port must be between 1 and 65535')
    url = f'http://127.0.0.1:{args.port}'
    monitor = Monitor()
    try:
        server = LocalServer(('127.0.0.1', args.port), make_handler(monitor, args.port))
    except OSError:
        try:
            with urlopen(url + '/api/snapshot', timeout=2) as response:
                existing = json.load(response)
        except Exception:
            existing = {}
        if existing.get('app') != 'Laptop Lens':
            raise
        print(f'Laptop Lens is already running at {url}', flush=True)
        if args.open:
            webbrowser.open(url)
        return
    monitor.start()
    print(f'Laptop Lens is running at {url}\nRead-only. No account. No cloud. Ctrl+C stops collection.', flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        monitor.request_stop()
        server.server_close()


if __name__ == '__main__':
    main()
