import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { sendUIResource } from '../host/ui-resource.mjs';
import { checkUIAssets } from './check-ui-assets.mjs';
test('all shipped UI routes and font notices exist with exact bytes', () => {
  const result = checkUIAssets(fileURLToPath(new URL('../', import.meta.url)));
  assert(result.routes >= 10); assert.equal(result.fontPins, 4);
});
test('missing UI asset ends with 404 instead of leaving a hanging request', () => {
  const response = { writeHead(status) { this.status = status; }, end(body) { this.body = body; this.ended = true; } };
  sendUIResource(response, fileURLToPath(new URL('../ui/fonts/does-not-exist.woff2', import.meta.url)), 'font/woff2');
  assert.equal(response.status, 404); assert.equal(response.ended, true); assert.equal(response.body, 'UI resource unavailable');
});
test('existing UI asset returns complete bytes and success', () => {
  const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  sendUIResource(response, fileURLToPath(new URL('../ui/fonts/inter-latin-wght-normal.woff2', import.meta.url)), 'font/woff2');
  assert.equal(response.status, 200); assert.equal(response.headers['Content-Type'], 'font/woff2');
  assert.equal(response.body.subarray(0,4).toString(), 'wOF2');
});
