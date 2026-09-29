# trailer/receiver.py — tiny upload receiver for the trailer page. Run: python3 trailer/receiver.py <out-dir>
# POST /upload?name=x.mp4 writes the body to <out-dir>/x.mp4 (the page renders offline and posts frames, sheets, the MP4).
import http.server, os, re, sys
from urllib.parse import urlparse, parse_qs
OUT=sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin','*');self.send_header('Access-Control-Allow-Methods','POST, OPTIONS');self.send_header('Access-Control-Allow-Headers','*')
    def do_OPTIONS(self):
        self.send_response(204);self.cors();self.end_headers()
    def do_POST(self):
        q=parse_qs(urlparse(self.path).query);name=re.sub(r'[^a-zA-Z0-9_.-]','',q.get('name',['out.bin'])[0])
        n=int(self.headers.get('Content-Length',0));data=b''
        while len(data)<n: data+=self.rfile.read(n-len(data))
        os.makedirs(OUT,exist_ok=True)
        with open(os.path.join(OUT,name),'wb') as f: f.write(data)
        self.send_response(200);self.cors();self.end_headers();self.wfile.write(b'ok')
    def log_message(self,*a): pass
http.server.ThreadingHTTPServer(('127.0.0.1',5199),H).serve_forever()
