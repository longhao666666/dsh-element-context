/**
 * UI element context bridge - HOST half.
 *
 * An ordinary Cordis plugin in the real Node process: it has no `harness`
 * global and no `host.call` (those belong to the dynamic sandbox). The Client
 * half reaches it over one exact HTTP route, guarded by the connection layer's
 * trust policy.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Plugin runtime state lives under ~/.dsh, which exists on every DSH install. */
const STATE_DIR = join(homedir(), '.dsh');

/** Where the selected element is published. */
const STATE_PATH = join(STATE_DIR, 'element-context.json');

/** Where the Client half's probe diagnostics land (debug channel, not context). */
const DIAGNOSTICS_PATH = join(STATE_DIR, 'element-context-diagnostics.json');

/** Exact route the Client half calls. */
const ROUTE_PATH = '/element-context';

/** Separate exact route for the Client half's probe diagnostics. */
const DIAGNOSTICS_ROUTE_PATH = '/element-context/diagnostics';

/** Request-body ceiling for the element route; 32 rich elements is ~50 KB. */
const ELEMENT_BODY_LIMIT = 256 * 1024;

/**
 * Read the published elements. The file holds an array; a legacy single-object
 * file and a missing file both resolve to "nothing selected".
 */
function readElements() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) return parsed.filter((item) => item !== null && typeof item === 'object');
  if (parsed !== null && typeof parsed === 'object') {
    if (Array.isArray(parsed.elements)) return parsed.elements.filter((item) => item !== null && typeof item === 'object');
    return [parsed];
  }
  return [];
}

/** Persist the association list. */
function writeElements(list) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(list, null, 2) + '\n', 'utf8');
}

/** Read the last probe diagnostics report; absence means the Client half never ran. */
function readDiagnostics() {
  try {
    return JSON.parse(readFileSync(DIAGNOSTICS_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/** Render one selected element as a prompt-context block. */
function renderElement(el, index) {
  return [
    '<target_ui_element' + (index === null ? '' : ' index="' + index + '"') + '>',
    el.sourceLoc ? '  SourceLocation: ' + el.sourceLoc + (el.sourceLocIsSelf === false && el.sourceLocOwner ? ' (nearest annotated ancestor: ' + el.sourceLocOwner + ')' : '') : null,
    el.selector ? '  Selector: ' + el.selector : null,
    el.tagName ? '  Tag: <' + el.tagName
      + (el.id ? ' id="' + el.id + '"' : '')
      + (el.className ? ' class="' + el.className + '"' : '')
      + (el.role ? ' role="' + el.role + '"' : '')
      + (el.type ? ' type="' + el.type + '"' : '')
      + (el.name ? ' name="' + el.name + '"' : '') + '>' : null,
    el.innerText ? '  TextContent: "' + el.innerText + '"' : null,
    el.url ? '  PageUrl: ' + el.url + (el.pageTitle ? ' — ' + el.pageTitle : '') : null,
    Array.isArray(el.ancestors) && el.ancestors.length > 0 ? '  Vicinity: ' + el.ancestors.join(' > ') : null,
    el.rect ? '  ViewportRect: ' + JSON.stringify(el.rect) : null,
    el.boxModel ? '  BoxModel: ' + JSON.stringify(el.boxModel) : null,
    el.computedStyle ? '  ComputedStyle: ' + JSON.stringify(el.computedStyle) : null,
    '</target_ui_element>',
  ].filter(Boolean).join('\n');
}

/** Render the association list as the prompt-context block. */
function render(list) {
  if (list.length === 0) return '';
  if (list.length === 1) return renderElement(list[0], null);
  return [
    '<target_ui_elements count="' + list.length + '">',
    ...list.map((el, index) => renderElement(el, index + 1)),
    '</target_ui_elements>',
  ].join('\n');
}

/** Collect a request body with a hard size cap. */
async function readBody(req, limit = 64 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Answer one request with JSON. */
function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

export const name = 'ui-element-context';
export const inject = ['systemPrompt', 'webServer', 'connection'];

export function apply(ctx) {
  /**
   * Answer an untrusted or unauthenticated request; true when it was rejected.
   * The shipped `open-in-app` route uses this same guard: the connection layer
   * applies its Host/Origin fence (403) then browser authentication (401), which
   * is what stops a cross-site `no-cors` POST from reaching this route.
   */
  const rejected = (req, res) => {
    const rejection = ctx.connection.requestRejection(req);
    if (rejection === undefined) return false;
    res.statusCode = rejection;
    res.end();
    return true;
  };

  // Evaluated on every prompt assembly, so the context always tracks the file.
  ctx.systemPrompt.context({
    name: 'inspected-ui-element',
    order: 120,
    text: () => render(readElements()),
  });

  // ctx.effect() is what ties the route to this plugin's lifetime: without it the
  // route is never released on unload, and a reload fails with a duplicate-route
  // error. The shipped routes wrap register() exactly like this.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: async (req, res) => {
      if (rejected(req, res)) return;
      if (req.method === 'GET' || req.method === 'HEAD') {
        sendJson(res, 200, { elements: readElements() });
        return;
      }
      if (req.method === 'POST') {
        let parsed;
        try {
          parsed = JSON.parse(await readBody(req, ELEMENT_BODY_LIMIT));
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid JSON body' });
          return;
        }
        // `elements` replaces the whole list; `element` (or a bare object) is the
        // single-element form the manual path uses.
        const candidate = parsed !== null && typeof parsed === 'object' && 'elements' in parsed
          ? parsed.elements
          : parsed !== null && typeof parsed === 'object' && 'element' in parsed
            ? (parsed.element === null ? [] : [parsed.element])
            : (parsed === null ? [] : [parsed]);
        const malformed = !Array.isArray(candidate)
          || candidate.some((item) => item === null || typeof item !== 'object' || Array.isArray(item))
          || candidate.length > 64;
        if (malformed) {
          sendJson(res, 400, { ok: false, error: 'elements must be an array of objects (max 64)' });
          return;
        }
        try {
          writeElements(candidate);
        } catch (error) {
          sendJson(res, 500, {
            ok: false,
            error: String(error && error.message ? error.message : error),
          });
          return;
        }
        sendJson(res, 200, { ok: true, elements: candidate });
        return;
      }
      sendJson(res, 405, { ok: false, error: 'method ' + req.method + ' not allowed' });
    },
  }), 'ui-element-context: /element-context route');

  // Debug channel, deliberately split from the element route: a Client half from a
  // newer bundle can never overwrite the published element with a diagnostics body.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: DIAGNOSTICS_ROUTE_PATH,
    handler: async (req, res) => {
      if (rejected(req, res)) return;
      if (req.method === 'GET' || req.method === 'HEAD') {
        sendJson(res, 200, { diagnostic: readDiagnostics() });
        return;
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method ' + req.method + ' not allowed' });
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { ok: false, error: 'invalid JSON body' });
        return;
      }
      try {
        mkdirSync(STATE_DIR, { recursive: true });
        writeFileSync(DIAGNOSTICS_PATH, JSON.stringify({
          receivedAt: new Date().toISOString(),
          diagnostic: parsed !== null && typeof parsed === 'object' ? parsed.diagnostic ?? parsed : parsed,
        }, null, 2) + '\n', 'utf8');
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          error: String(error && error.message ? error.message : error),
        });
        return;
      }
      sendJson(res, 200, { ok: true });
    },
  }), 'ui-element-context: /element-context/diagnostics route');
}