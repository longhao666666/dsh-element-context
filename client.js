/**
 * UI element context bridge — CLIENT half.
 *
 * Official bundle client-artifact format: a side-effecting script that
 * registers ONE lazy factory through `window.__ModuleLoader__`, whose `id`
 * must equal the package name. It is NOT `return {...}`, NOT `module.exports`,
 * and NOT the dynamic-sandbox shape (no `host.call`, no `harness`).
 *
 * Two ways to associate an element with the next prompt:
 *   1. Manual: type a CSS selector or `file:line` into the dock chip.
 *   2. Pick: arm the probe, then click the element inside the Sidebar browser.
 *      The Desktop browser tab is an Electron `<webview>`; this half is the
 *      embedder, so it injects the probe with `executeJavaScript` and reads
 *      captures back by polling. The guest keeps its sandbox: the probe is an
 *      ordinary page script with DOM access only.
 *
 * React comes from the browser module table via the injected `require`.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-element-context',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Exact route the Host half answers. */
    const ROUTE = '/element-context';

    /** Dedicated debug route: diagnostics never overwrite the published element. */
    const DIAGNOSTICS_ROUTE = '/element-context/diagnostics';

    /** Global the injected probe installs in the guest page. */
    const PROBE_KEY = '__DSH_ELEMENT_PICKER__';

    /** Desktop browser guests carry this attribute (see ui-sidebar-browser). */
    const WEBVIEW_SELECTOR = 'webview[data-sidebar-browser-frame="webview"]';

    /** Association cap: every element costs ~400 prompt tokens on each following turn. */
    const MAX_ELEMENTS = 32;

    /** Chips rendered inline before the strip collapses into a "+N" pill. */
    const VISIBLE_CHIPS = 10;

    //#region probe
    /**
     * Guest-side probe. Fully self-contained: it is serialized with
     * `Function.prototype.toString` and evaluated inside the visited page, so it
     * may not close over anything from this module.
     */
    function probeInstall() {
      const KEY = '__DSH_ELEMENT_PICKER__';
      const existing = window[KEY];
      if (existing && existing.version === 1) return;

      const ACCENT = '#2f6fed';
      const SOURCE_ATTRS = ['data-loc', 'data-source-loc', 'data-source', 'data-src-loc', 'data-dsh-loc'];
      const STYLE_KEYS = [
        'display', 'position', 'width', 'height', 'margin', 'padding', 'border', 'border-radius',
        'background-color', 'color', 'font-family', 'font-size', 'font-weight', 'line-height',
        'letter-spacing', 'text-align', 'gap', 'flex-direction', 'align-items', 'justify-content',
        'box-shadow', 'opacity', 'overflow', 'cursor', 'transition',
      ];
      const state = { mode: false, pending: null, target: null };
      let box = null;
      let tag = null;
      let frame = 0;
      let flash = 0;
      let previousCursor = null;

      const round = (value) => {
        const n = Math.round(Number(value) * 100) / 100;
        return Number.isFinite(n) ? n : 0;
      };

      /** `div#id` / `button.primary` short name used by tooltips and vicinity. */
      const describe = (el) => {
        const name = el.tagName ? el.tagName.toLowerCase() : 'node';
        if (el.id) return name + '#' + el.id;
        const first = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean)[0] : '';
        return first ? name + '.' + first : name;
      };

      const cssEscape = (value) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/g, '\\$&'));

      /** Nearest build-time source location on the element or one of its ancestors. */
      const lookupLoc = (el) => {
        let node = el;
        for (let depth = 0; node && node.nodeType === 1 && depth < 6; depth += 1) {
          for (const attr of SOURCE_ATTRS) {
            const value = node.getAttribute(attr);
            if (value) return { value, isSelf: node === el, owner: describe(node) };
          }
          node = node.parentElement;
        }
        return { value: null, isSelf: false, owner: null };
      };

      const unique = (selector, el) => {
        try {
          const found = document.querySelectorAll(selector);
          return found.length === 1 && found[0] === el;
        } catch (error) {
          return false;
        }
      };

      const typeIndex = (node) => {
        let index = 0;
        let sibling = node;
        while (sibling) {
          if (sibling.nodeType === 1 && sibling.tagName === node.tagName) index += 1;
          sibling = sibling.previousElementSibling;
        }
        return index;
      };

      const segment = (node) => {
        const name = node.tagName.toLowerCase();
        if (node.id) return name + '#' + cssEscape(node.id);
        const classes = typeof node.className === 'string' ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
        const loc = node.getAttribute('data-loc');
        const base = name + classes.map((one) => '.' + cssEscape(one)).join('') + (loc ? '[data-loc="' + loc + '"]' : '');
        return unique(base, node) ? base : base + ':nth-of-type(' + typeIndex(node) + ')';
      };

      /** Smart path first, exhaustive nth-child chain as the fallback. */
      const selectorOf = (el) => {
        const parts = [];
        let node = el;
        while (node && node.nodeType === 1 && node !== document.documentElement && parts.length < 6) {
          parts.unshift(segment(node));
          if (node.id) break;
          node = node.parentElement;
        }
        const path = parts.join(' > ');
        if (unique(path, el)) return path;
        const chain = [];
        let cursor = el;
        while (cursor && cursor.nodeType === 1) {
          let one = cursor.tagName.toLowerCase();
          const parent = cursor.parentElement;
          if (parent) {
            let index = 1;
            let sibling = cursor;
            while (sibling.previousElementSibling) {
              sibling = sibling.previousElementSibling;
              index += 1;
            }
            one += ':nth-child(' + index + ')';
          }
          chain.unshift(one);
          if (cursor === document.body) break;
          cursor = parent;
        }
        return chain.join(' > ');
      };

      const vicinity = (el) => {
        const chain = [];
        let node = el.parentElement;
        while (node && node.nodeType === 1 && node !== document.documentElement && chain.length < 4) {
          chain.unshift(describe(node));
          node = node.parentElement;
        }
        return chain;
      };

      const text = (el) => String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);

      const size = (value) => round(parseFloat(value) || 0);

      const extract = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const loc = lookupLoc(el);
        const computedStyle = {};
        for (const key of STYLE_KEYS) {
          const value = style.getPropertyValue(key);
          if (value) computedStyle[key] = String(value).slice(0, 96);
        }
        return {
          source: 'picker',
          url: location.href,
          pageTitle: document.title,
          sourceLoc: loc.value,
          sourceLocIsSelf: loc.isSelf,
          sourceLocOwner: loc.owner,
          selector: selectorOf(el),
          tagName: el.tagName ? el.tagName.toLowerCase() : '',
          id: el.id || '',
          className: typeof el.className === 'string' ? el.className : '',
          role: el.getAttribute('role') || '',
          type: el.getAttribute('type') || '',
          name: el.getAttribute('name') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          placeholder: el.getAttribute('placeholder') || '',
          innerText: text(el),
          ancestors: vicinity(el),
          rect: { x: round(rect.left), y: round(rect.top), width: round(rect.width), height: round(rect.height) },
          boxModel: {
            padding: [size(style.paddingTop), size(style.paddingRight), size(style.paddingBottom), size(style.paddingLeft)],
            margin: [size(style.marginTop), size(style.marginRight), size(style.marginBottom), size(style.marginLeft)],
            border: [size(style.borderTopWidth), size(style.borderRightWidth), size(style.borderBottomWidth), size(style.borderLeftWidth)],
            borderRadius: style.borderRadius,
            boxSizing: style.boxSizing,
          },
          computedStyle,
          viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 },
          pickedAt: new Date().toISOString(),
        };
      };

      const ensure = () => {
        if (box && box.isConnected) return;
        box = document.createElement('div');
        box.setAttribute('data-dsh-picker', 'box');
        box.style.cssText = [
          'position:fixed', 'left:0', 'top:0', 'z-index:2147483646', 'pointer-events:none', 'display:none',
          'box-sizing:border-box', 'border:1px solid ' + ACCENT, 'background:rgba(47,111,237,0.14)', 'border-radius:2px',
        ].join(';');
        tag = document.createElement('div');
        tag.setAttribute('data-dsh-picker', 'label');
        tag.style.cssText = [
          'position:fixed', 'left:0', 'top:0', 'z-index:2147483647', 'pointer-events:none', 'display:none',
          'max-width:70vw', 'overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap',
          'font:11px/16px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
          'color:#fff', 'background:' + ACCENT, 'border-radius:3px', 'padding:1px 6px',
        ].join(';');
        const host = document.body || document.documentElement;
        if (host) host.append(box, tag);
      };

      const hide = () => {
        if (box) box.style.display = 'none';
        if (tag) tag.style.display = 'none';
      };

      const draw = (el) => {
        if (!el || el === box || el === tag || (el.hasAttribute && el.hasAttribute('data-dsh-picker'))) {
          hide();
          return;
        }
        ensure();
        const rect = el.getBoundingClientRect();
        const captured = Date.now() < flash;
        box.style.display = 'block';
        box.style.left = round(rect.left) + 'px';
        box.style.top = round(rect.top) + 'px';
        box.style.width = round(rect.width) + 'px';
        box.style.height = round(rect.height) + 'px';
        box.style.borderColor = captured ? '#16a34a' : ACCENT;
        box.style.background = captured ? 'rgba(22,163,74,0.14)' : 'rgba(47,111,237,0.14)';
        const loc = lookupLoc(el);
        const head = loc.value ? loc.value + ' · ' : '';
        tag.style.display = 'block';
        tag.style.background = captured ? '#16a34a' : ACCENT;
        tag.textContent = (captured ? '✓ 已采集 · ' : '') + head + describe(el) + '  ' + Math.round(rect.width) + ' × ' + Math.round(rect.height);
        tag.style.left = Math.max(2, Math.min(rect.left, window.innerWidth - 60)) + 'px';
        tag.style.top = Math.max(2, rect.top > 24 ? rect.top - 20 : rect.bottom + 4) + 'px';
      };

      const setMode = (value) => {
        const on = value === true;
        if (state.mode === on) return state.mode;
        state.mode = on;
        if (on) {
          state.pending = null;
          state.target = null;
          flash = 0;
          previousCursor = document.documentElement.style.cursor;
          document.documentElement.style.cursor = 'crosshair';
        } else {
          state.target = null;
          flash = 0;
          hide();
          if (previousCursor !== null) {
            document.documentElement.style.cursor = previousCursor;
            previousCursor = null;
          }
        }
        return state.mode;
      };

      const onMove = (event) => {
        if (!state.mode || frame) return;
        const x = event.clientX;
        const y = event.clientY;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          const el = document.elementFromPoint(x, y);
          state.target = el && el.nodeType === 1 ? el : null;
          if (state.target) draw(state.target);
          else hide();
        });
      };

      const swallow = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };

      const onDown = (event) => {
        if (state.mode) swallow(event);
      };

      const onClick = (event) => {
        if (!state.mode) return;
        swallow(event);
        const el = state.target || (event.target && event.target.nodeType === 1 ? event.target : null);
        if (!el) return;
        // One-shot capture: the mode stays armed so the next click adds the next
        // element; the embedder owns disarming (toggle or Escape).
        state.pending = extract(el);
        flash = Date.now() + 900;
        draw(el);
      };

      const onKey = (event) => {
        if (event.key !== 'Escape' || !state.mode) return;
        swallow(event);
        setMode(false);
      };

      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('pointerdown', onDown, true);
      window.addEventListener('pointerup', onDown, true);
      window.addEventListener('mousedown', onDown, true);
      window.addEventListener('mouseup', onDown, true);
      window.addEventListener('click', onClick, true);
      window.addEventListener('keydown', onKey, true);

      window[KEY] = {
        version: 1,
        setMode,
        isMode: () => state.mode,
        take: () => {
          const picked = state.pending;
          state.pending = null;
          return picked;
        },
      };
    }
    //#endregion

    /** Serialized probe, evaluated in the guest page on every document load. */
    const PROBE_SOURCE = '(' + probeInstall.toString() + ')();';

    /** Poll snippet: reports probe presence/mode and takes one capture. */
    const POLL_SOURCE = '(function(){try{var p=window[' + JSON.stringify(PROBE_KEY) + '];'
      + 'if(!p)return JSON.stringify({installed:false});'
      + 'return JSON.stringify({installed:true,mode:!!p.isMode(),pending:p.take()||null});'
      + '}catch(e){return JSON.stringify({installed:false,error:String(e&&e.message||e)})}})()';

    /** Mode push snippet; a missing probe is fine (it re-arms on next injection). */
    const modeSource = (on) => 'try{var p=window[' + JSON.stringify(PROBE_KEY) + '];if(p)p.setMode(' + (on ? 'true' : 'false') + ');}catch(e){}';

    /** Build the element payload from one raw line of manual input. */
    function payloadFrom(raw) {
      const isLocation = raw.includes(':') && !raw.startsWith('.');
      return {
        source: 'manual',
        sourceLoc: isLocation ? raw : null,
        selector: isLocation ? null : raw,
        tagName: 'target-node',
        className: '',
        innerText: '',
        boxModel: null,
        computedStyle: null,
      };
    }

    /** Key used to deduplicate one element within the association list. */
    function elementKey(element) {
      return element.selector || element.sourceLoc || (element.tagName + '.' + String(element.className || ''));
    }

    /**
     * One shared context object owns the published elements, the probe loop and
     * the guest registry, so the dock chip stays a plain subscriber and an
     * unmounted chip never stops picking.
     */
    function createElementContext() {
      let state = { elements: [], armed: false, target: 'unknown', webviews: 0, error: null, notice: null };
      const listeners = new Set();
      const wired = new WeakMap();
      const diagnostics = { webviews: 0, injects: 0, polls: 0, failures: 0, picks: 0, lastEvent: null, lastError: null, updatedAt: null };
      let timer = 0;
      let lastReported = 0;

      const notify = () => {
        for (const listener of listeners) {
          try {
            listener(state);
          } catch (error) {
            console.error('[element-context] subscriber failed:', error);
          }
        }
      };

      const setState = (patch) => {
        let changed = false;
        for (const key of Object.keys(patch)) {
          if (state[key] !== patch[key]) changed = true;
        }
        if (!changed) return;
        state = { ...state, ...patch };
        notify();
      };

      /** Debug channel; throttled so a live poll loop stays quiet. */
      const report = (event, error) => {
        diagnostics.lastEvent = event;
        if (error) diagnostics.lastError = String(error).slice(0, 300);
        if (event === 'pick') diagnostics.picks += 1;
        const now = Date.now();
        if (now - lastReported < 2000 && event !== 'pick') return;
        lastReported = now;
        diagnostics.updatedAt = new Date().toISOString();
        void fetch(DIAGNOSTICS_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(diagnostics),
        }).catch(() => {});
      };

      const guests = () => Array.from(document.querySelectorAll(WEBVIEW_SELECTOR));

      const visible = (el) => el.getClientRects().length > 0;

      const call = (el, source) => {
        try {
          return Promise.resolve(el.executeJavaScript(source));
        } catch (error) {
          return Promise.reject(error);
        }
      };

      const fail = (record, where, error) => {
        record.failures += 1;
        diagnostics.failures += 1;
        report(where + '-failed', (error && error.message) || error);
      };

      const pushMode = (el, record) => {
        call(el, modeSource(state.armed)).catch((error) => fail(record, 'mode', error));
      };

      const inject = (el, record) => {
        if (typeof el.executeJavaScript !== 'function') {
          setState({ target: 'unavailable', error: 'executeJavaScript unavailable in this host' });
          report('injection-unavailable');
          return;
        }
        call(el, PROBE_SOURCE).then(() => {
          record.injected = true;
          record.failures = 0;
          diagnostics.injects += 1;
          if (state.target !== 'ok') setState({ target: 'ok', error: null });
          pushMode(el, record);
          report('inject-ok');
        }).catch((error) => fail(record, 'inject', error));
      };

      const wire = (el) => {
        const record = { injected: false, busy: false, failures: 0 };
        wired.set(el, record);
        for (const name of ['dom-ready', 'did-finish-load', 'did-navigate', 'did-stop-loading']) {
          el.addEventListener(name, () => inject(el, record));
        }
        inject(el, record);
        return record;
      };

      /** Publish the whole association list; the Host half answers 401 for stale pages. */
      const store = (elements) => fetch(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ elements }),
      }).then((res) => res.json()).then((body) => {
        if (!body || !body.ok) throw new Error((body && body.error) || 'write rejected');
        setState({ elements: body.elements || [], notice: null });
        return body.elements;
      }).catch((error) => {
        report('store-failed', error);
        throw error;
      });

      const load = () => fetch(ROUTE, { headers: { accept: 'application/json' } })
        .then((res) => res.json())
        .then((body) => {
          const list = body && Array.isArray(body.elements)
            ? body.elements
            : body && body.element ? [body.element] : [];
          setState({ elements: list });
        })
        .catch((error) => report('load-failed', error));

      /** Add or refresh one element while respecting the cap. */
      const add = (element) => {
        const list = state.elements;
        const key = elementKey(element);
        const index = list.findIndex((item) => elementKey(item) === key);
        if (index < 0 && list.length >= MAX_ELEMENTS) {
          setState({ notice: '最多关联 ' + MAX_ELEMENTS + ' 个元素，先移除一个再拾取' });
          report('limit-reached');
          return Promise.resolve(list);
        }
        const next = index < 0
          ? [...list, element]
          : list.map((item, at) => (at === index ? element : item));
        return store(next);
      };

      const remove = (index) => store(state.elements.filter((_item, at) => at !== index));

      const clear = () => store([]);

      const handle = (pending) => {
        report('pick');
        void add(pending).catch(() => {});
      };

      const poll = () => {
        try {
          const list = guests();
          if (list.length !== state.webviews) setState({ webviews: list.length });
          diagnostics.webviews = list.length;
          for (const el of list) {
            const record = wired.get(el) || wire(el);
            if (record.busy || !visible(el)) continue;
            record.busy = true;
            call(el, POLL_SOURCE).then((raw) => {
              diagnostics.polls += 1;
              const parsed = typeof raw === 'string' ? JSON.parse(raw) : null;
              if (!parsed) return;
              if (parsed.installed && state.target !== 'ok') setState({ target: 'ok', error: null });
              // A capture left over from a disarmed session is dropped, not stored.
              if (parsed.pending && state.armed) handle(parsed.pending);
            }).catch((error) => fail(record, 'poll', error)).finally(() => {
              record.busy = false;
            });
          }
        } catch (error) {
          report('poll-loop-failed', error);
        }
        timer = window.setTimeout(poll, state.armed ? 250 : 900);
      };

      const arm = (on) => {
        if (on && guests().length === 0) {
          report('arm-without-browser');
          return false;
        }
        setState({ armed: on, error: null, notice: null });
        for (const el of guests()) pushMode(el, wired.get(el) || wire(el));
        return on;
      };

      return {
        start: () => {
          poll();
          report('started');
        },
        stop: () => window.clearTimeout(timer),
        arm,
        load,
        add,
        remove,
        clear,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getState: () => state,
      };
    }

    function createDockChip(context) {
      return function ElementDockChip() {
        const [view, setView] = React.useState(context.getState());
        const [draft, setDraft] = React.useState('');
        const [busy, setBusy] = React.useState(false);

        React.useEffect(() => context.subscribe(setView), []);
        React.useEffect(() => {
          void context.load();
        }, []);
        React.useEffect(() => {
          if (!view.armed) return undefined;
          const onKey = (event) => {
            if (event.key === 'Escape') context.arm(false);
          };
          document.addEventListener('keydown', onKey);
          return () => document.removeEventListener('keydown', onKey);
        }, [view.armed]);

        // TEMP geometry probe: reports the dock's real box vs the composer card
        // so alignment can be verified from the diagnostics file without a
        // screenshot. Remove once the centering issue is settled.
        React.useEffect(() => {
          const send = () => {
            const root = document.querySelector('[data-dsh-element-dock]');
            if (!root) return;
            const stack = root.parentElement;
            const bar = stack ? stack.lastElementChild : null;
            const barInput = bar ? bar.querySelector('textarea, [contenteditable="true"]') : null;
            const dockInput = root.querySelector('input');
            const box = (el) => {
              if (!el) return null;
              const r = el.getBoundingClientRect();
              return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
            };
            const rootStyle = getComputedStyle(root);
            const stackStyle = stack ? getComputedStyle(stack) : null;
            const barStyle = bar ? getComputedStyle(bar) : null;
            const phase = document.querySelector('[data-phase]');
            void fetch(DIAGNOSTICS_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                geometry: {
                  at: new Date().toISOString(),
                  phase: phase ? phase.getAttribute('data-phase') : null,
                  viewport: { w: window.innerWidth, h: window.innerHeight },
                  dockRoot: box(root),
                  dockComputed: {
                    display: rootStyle.display,
                    width: rootStyle.width,
                    maxWidth: rootStyle.maxWidth,
                    marginLeft: rootStyle.marginLeft,
                    marginRight: rootStyle.marginRight,
                  },
                  dockVars: {
                    clearance: rootStyle.getPropertyValue('--dsh-composer-side-clearance').trim(),
                    cardMax: rootStyle.getPropertyValue('--dsh-composer-card-max-width').trim(),
                  },
                  dockInput: box(dockInput),
                  stack: box(stack),
                  stackComputed: stackStyle
                    ? { display: stackStyle.display, width: stackStyle.width, padding: stackStyle.padding, alignItems: stackStyle.alignItems }
                    : null,
                  bar: box(bar),
                  barComputed: barStyle
                    ? { display: barStyle.display, padding: barStyle.padding, alignItems: barStyle.alignItems }
                    : null,
                  barInput: box(barInput),
                },
              }),
            }).catch(() => {});
          };
          const t1 = window.setTimeout(send, 800);
          const t2 = window.setTimeout(send, 3000);
          const t3 = window.setTimeout(send, 8000);
          return () => {
            window.clearTimeout(t1);
            window.clearTimeout(t2);
            window.clearTimeout(t3);
          };
        }, []);

        const run = (task) => {
          setBusy(true);
          return task()
            .catch((err) => console.error('[element-context] write failed:', err))
            .finally(() => setBusy(false));
        };

        const commit = () => {
          const raw = draft.trim();
          if (raw === '' || busy) return;
          void run(() => context.add(payloadFrom(raw))).then(() => setDraft(''));
        };

        const rowStyle = {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          flexWrap: 'wrap',
        };

        const controlStyle = {
          fontSize: '12px',
          padding: '3px 8px',
          borderRadius: '4px',
          border: '1px solid var(--dsw-alias-border-l3)',
          background: 'transparent',
          color: 'inherit',
          outline: 'none',
        };

        const noBrowser = view.webviews === 0;
        const hint = view.armed
          ? '在右侧浏览器页面里点击目标控件，可连续拾取多个；Esc 结束'
          : noBrowser
            ? '先在右侧打开浏览器标签页'
            : view.error || '点击右侧页面上的控件，采集其选择器与样式';

        const pickButton = h('button', {
          type: 'button',
          disabled: noBrowser,
          title: hint,
          onClick: () => context.arm(!view.armed),
          style: {
            ...controlStyle,
            cursor: noBrowser ? 'default' : 'pointer',
            opacity: noBrowser ? 0.5 : 1,
            borderColor: view.armed ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l3)',
            color: view.armed ? 'var(--dsw-alias-state-business-primary)' : 'inherit',
          },
        }, view.armed ? '点选中…（Esc 结束）' : '点选元素');

        const status = view.notice
          ? h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-state-warn-primary, #b45309)' } }, view.notice)
          : noBrowser ? null : h('span', {
            title: view.error || hint,
            style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' },
          }, view.target === 'ok' ? '● 探针就绪' : view.target === 'unavailable' ? '▲ 无法注入探针' : '○ 等待页面');

        /**
         * Same box as the composer card: full width minus the composer's side
         * clearance, capped by the card's own max width, centered with auto
         * margins. This mirrors the harness dock convention (QueueDock,
         * TodoPanel) so the row lines up with the input card in both the hero
         * and the active-session layout; without the variables it degrades to
         * the full slot width, exactly as before.
         */
        const stackStyle = {
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          marginBottom: '6px',
          boxSizing: 'border-box',
          width: 'calc(100% - 2 * var(--dsh-composer-side-clearance, 0px))',
          maxWidth: 'var(--dsh-composer-card-max-width, none)',
          marginLeft: 'auto',
          marginRight: 'auto',
        };

        const composer = h(
          'div',
          { style: rowStyle },
          h('input', {
            value: draft,
            placeholder: '输入 CSS Selector 或 文件:行号',
            onChange: (e) => setDraft(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter') commit();
            },
            style: { ...controlStyle, minWidth: '240px' },
          }),
          h('button', { type: 'button', onClick: commit, style: { ...controlStyle, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1 } }, '关联UI元素'),
          pickButton,
          status,
        );

        const elements = view.elements;
        if (elements.length === 0) {
          return h('div', { 'data-dsh-element-dock': '', style: stackStyle }, composer);
        }

        const chipNode = (item, index) => h(
          'span',
          {
            key: String(index) + ':' + elementKey(item),
            title: (item.sourceLoc ? item.sourceLoc + '\n' : '') + (item.selector || ''),
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px',
              padding: '1px 2px 1px 6px',
              borderRadius: '4px',
              background: 'var(--dsw-alias-bg-layer-1)',
              border: '1px solid var(--dsw-alias-border-l3)',
              maxWidth: '320px',
            },
          },
          h('code', {
            style: {
              fontFamily: 'monospace',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          }, item.sourceLoc || item.selector || ('<' + item.tagName + '>')),
          h('button', {
            type: 'button',
            onClick: () => void run(() => context.remove(index)),
            title: '移除此元素',
            style: {
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'inherit',
              fontSize: '13px',
              lineHeight: 1,
              padding: '0 3px',
            },
          }, '\u00d7'),
        );

        const hidden = elements.slice(VISIBLE_CHIPS);
        const approxKb = Math.max(1, Math.round(JSON.stringify(elements).length / 1024));
        const chips = h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              flexWrap: 'wrap',
              justifyContent: 'center',
              padding: '4px 8px',
              fontSize: '12px',
              borderRadius: '4px',
              width: 'fit-content',
              maxWidth: '100%',
              margin: '0 auto',
              background: 'var(--dsw-alias-bg-base)',
              border: '1px solid var(--dsw-alias-border-l3)',
              color: 'var(--dsw-alias-label-primary)',
            },
          },
          h('span', {
            style: { fontWeight: 600, flex: 'none' },
            title: '已关联 ' + elements.length + ' 个元素，约占 ' + approxKb + ' KB 上下文；每轮请求都会带上，删掉不再需要的元素可以省 token。',
          }, elements.length > 1 ? 'UI 上下文 (' + elements.length + '):' : 'UI 上下文:'),
          ...elements.slice(0, VISIBLE_CHIPS).map(chipNode),
          hidden.length > 0
            ? h('span', {
              title: hidden.map((item) => item.sourceLoc || item.selector || ('<' + item.tagName + '>')).join('\n'),
              style: {
                padding: '1px 6px',
                borderRadius: '4px',
                background: 'var(--dsw-alias-bg-layer-1)',
                border: '1px solid var(--dsw-alias-border-l3)',
                color: 'var(--dsw-alias-label-tertiary)',
              },
            }, '+' + hidden.length)
            : null,
          elements.length > 1
            ? h('button', {
              type: 'button',
              onClick: () => void run(() => context.clear()),
              title: '清空全部关联元素',
              style: { ...controlStyle, border: 'none', color: 'var(--dsw-alias-label-tertiary)' },
            }, '清空')
            : null,
        );

        return h(
          'div',
          { 'data-dsh-element-dock': '', style: stackStyle },
          chips,
          composer,
        );
      };
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const context = createElementContext();
        context.start();
        ctx.effect(() => () => context.stop(), 'ui-element-context: guest probe loop');

        const Chip = createDockChip(context);

        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.dock',
              id: 'dsh-element-picker-dock-item',
              order: 100,
            },
            Chip,
          ),
        );
      },
    };
  },
});