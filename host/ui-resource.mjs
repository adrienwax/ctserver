import fs from 'node:fs';

// Read before sending headers so a missing asset ends with a real HTTP error.
export function sendUIResource(response, file, type) {
  try {
    const bytes = fs.readFileSync(file);
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    response.end(bytes);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('UI resource unavailable');
  }
}
