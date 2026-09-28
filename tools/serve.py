"""Static server for the project, plus POST /save so the Riso Lab can write
finished backgrounds into backgrounds/ (PNG image + JSON recipe)."""
import http.server, os, re, sys
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'backgrounds')

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        # Dev server: never let the browser serve a stale module after an edit.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != '/save':
            return self.send_error(404)
        q = parse_qs(url.query)
        name = re.sub(r'[^a-z0-9_-]', '', q.get('name', [''])[0].lower())
        ext = q.get('ext', ['png'])[0]
        if not name or ext not in ('png', 'json'):
            return self.send_error(400, 'bad name or ext')
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, f'{name}.{ext}'), 'wb') as f:
            f.write(body)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(f'backgrounds/{name}.{ext}'.encode())

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
