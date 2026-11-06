// Host half of dsh-tjing-reading (竹居).
//
// The reader itself runs entirely in the Client half (client.js): documents are
// imported through the browser file picker and persisted in IndexedDB. This half
// adds exactly one capability — 「AI 问书」: the browser posts the excerpts it
// retrieved from the open book, and the Host streams a model answer that is
// constrained to those excerpts. No book text is stored on the Host.

/** Authenticated Fetch route the browser posts questions to (`/api` + path). */
const CHAT_PATH = '/api/bookshelf/ai/chat';
const MODELS_PATH = '/api/bookshelf/ai/models';
const MAX_QUESTION_CHARS = 4000;
const MAX_PASSAGES = 12;
const MAX_PASSAGE_CHARS = 6000;
const MAX_CONTEXT_CHARS = 16000;
const MAX_HISTORY_TURNS = 8;
const MAX_HISTORY_CHARS = 1200;
const DEFAULT_MAX_TOKENS = 1400;
// How many routes one question may try before the answer reports a failure.
const MAX_ROUTE_ATTEMPTS = 4;

/** Trim to a hard character budget without splitting a surrogate pair. */
function clip(value, max) {
  const text = typeof value === 'string' ? value : '';
  if (text.length <= max) return text;
  let cut = max;
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return text.slice(0, cut);
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Passages the browser retrieved, in reading order, capped for the prompt. */
function normalizePassages(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  let total = 0;
  for (const item of list) {
    if (out.length >= MAX_PASSAGES) break;
    const text = clip(item?.text, MAX_PASSAGE_CHARS).trim();
    if (text === '') continue;
    if (total + text.length > MAX_CONTEXT_CHARS) break;
    total += text.length;
    out.push({ label: clip(item?.label, 120).trim(), text });
  }
  return out;
}

function normalizeHistory(raw) {
  const list = Array.isArray(raw) ? raw.slice(-MAX_HISTORY_TURNS * 2) : [];
  const out = [];
  for (const item of list) {
    const role = item?.role === 'assistant' ? 'assistant' : 'user';
    const text = clip(item?.text, MAX_HISTORY_CHARS).trim();
    if (text === '') continue;
    out.push({ role, content: [{ type: 'text', text }] });
  }
  return out;
}

function systemPrompt(book) {
  const title = clip(book?.title, 160).trim() || '这本书';
  const author = clip(book?.author, 80).trim();
  return [
    `你是《${title}》${author ? `（${author}）` : ''}的专属阅读助手，名字叫「竹居」。`,
    '你在和一位正在读这本书的读者对话，你的全部答案都必须来自下面给出的【原文片段】。',
    '',
    '硬性规则：',
    '1. 只能依据【原文片段】作答。禁止使用你自己的知识、常识、记忆、推断或对外部世界的了解补充任何内容。',
    '2. 如果片段里没有足够的信息回答，就直接说「这段原文里没有提到」，并说明片段里实际写了什么相关的内容。不要猜测，不要补充背景知识。',
    '3. 引用原文时用引号标出，并注明出处，例如（第3章）。不要编造原文中不存在的人名、数字、引文或情节。',
    '4. 用简体中文回答，2 到 5 句话，直给结论，不要说「根据片段」之类的套话。',
    '5. 读者问的是概念解释时，也只用原文里的说法解释，不要引入书外的定义。',
  ].join('\n');
}

function composeUserMessage(book, passages, question) {
  const chapter = clip(book?.chapter, 160).trim();
  const blocks = [];
  if (passages.length === 0) {
    blocks.push('【原文片段】\n（没有检索到相关原文）');
  } else {
    blocks.push('【原文片段】');
    passages.forEach((item, index) => {
      const label = item.label || `片段 ${index + 1}`;
      blocks.push(`〔${label}〕\n${item.text}`);
    });
  }
  blocks.push('');
  if (chapter) blocks.push(`读者当前在读：${chapter}`);
  blocks.push(`读者的问题：${question}`);
  return blocks.join('\n\n');
}

/** SSE frame; the browser parses `data:` lines only. */
function frame(value) {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function sseResponse(iterator, abort) {
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const push = (value) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(frame(value))); } catch { closed = true; }
      };
      let finished = false;
      try {
        for await (const chunk of iterator) {
          if (chunk.type === 'text-delta') {
            if (chunk.text) push({ d: chunk.text });
            continue;
          }
          if (chunk.type !== 'finish') continue;
          finished = true;
          const reason = chunk.reason;
          if (reason?.kind === 'error' || reason?.kind === 'aborted') {
            push({ e: reason.failure?.message ?? '模型调用失败' });
          } else {
            push({ done: true });
          }
        }
        if (!finished) push({ done: true });
      } catch (error) {
        push({ e: String(error?.message ?? error) });
      } finally {
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}

/**
 * The model the reader's own session is running on. A Harness may have no
 * default model configured while every live Session still has a working route
 * (`Session.requestHeader().config`), which is the one the user actually picked.
 */
function sessionRoute(ctx) {
  try {
    const live = ctx.get('sessions')?.list?.() ?? [];
    let best;
    for (const session of live) {
      const config = session?.requestHeader?.()?.config;
      if (!config?.provider || !config?.model) continue;
      const seq = Number(session?.seq ?? 0);
      if (!best || seq > best.seq) best = { seq, provider: config.provider, model: config.model };
    }
    return best;
  } catch {
    return undefined;
  }
}

/** Every route worth trying, most likely first. */
async function candidateRoutes(ctx, llm, options) {
  const out = [];
  const push = (provider, model) => {
    if (!provider || !model) return;
    if (out.some((item) => item.provider === provider && item.model === model)) return;
    out.push({ provider, model });
  };
  if (options.provider && options.model) push(options.provider, options.model);
  // The model picked in the reader's own selector beats any default.
  if (options.requested) push(options.requested.provider, options.requested.model);
  const session = sessionRoute(ctx);
  if (session) push(session.provider, session.model);
  try {
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.();
    push(selection?.provider, selection?.model);
  } catch { /* no default model service */ }
  let providers = [];
  try { providers = llm.listProviders?.() ?? []; } catch { providers = []; }
  for (const entry of providers) {
    const id = entry?.id;
    if (!id || out.some((item) => item.provider === id)) continue;
    try {
      const models = await llm.listModels(id);
      push(id, models?.[0]?.id);
    } catch { /* provider without a catalogue */ }
  }
  return out;
}

/**
 * Order the candidates: routes whose adapter can build a call go first. A
 * provider with no credential usually fails here (`no API key for provider
 * route …`), so an unconfigured Harness default never shadows a working route.
 * Routes that fail the probe stay in the list as a last resort, because some
 * adapters only resolve their credential when the request is actually built.
 */
async function orderRoutes(ctx, llm, options, signal) {
  const routes = await candidateRoutes(ctx, llm, options);
  const ready = [];
  const rest = [];
  for (const route of routes) {
    try {
      if (typeof llm.prepareCall === 'function') await llm.prepareCall(route, signal);
      ready.push(route);
    } catch {
      rest.push(route);
    }
  }
  return [...ready, ...rest];
}

/**
 * Stream the answer, moving to the next route while nothing has been shown yet.
 * A credential failure arrives as an `error` finish chunk rather than a throw,
 * so retrying here is what keeps 「AI 问书」 working when the Harness default
 * model points at a provider that was never given an API key.
 */
async function* streamWithFallback(llm, routes, buildOptions) {
  let lastError;
  for (const route of routes) {
    let emitted = false;
    let retry = false;
    try {
      for await (const chunk of llm.stream(buildOptions(route))) {
        if (chunk.type === 'text-delta' && chunk.text) emitted = true;
        if (chunk.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
          lastError = chunk.reason.failure?.message;
          if (!emitted && chunk.reason.kind === 'error') { retry = true; break; }
          yield chunk;
          return;
        }
        yield chunk;
      }
      if (!retry) return;
    } catch (error) {
      if (emitted) throw error;
      lastError = String(error?.message ?? error);
    }
  }
  yield { type: 'finish', reason: { kind: 'error', failure: { message: lastError ?? '没有可用的模型路由' } } };
}

async function handleChat(ctx, request, options) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid-json' }, 400);
  }
  const question = clip(body?.question, MAX_QUESTION_CHARS).trim();
  if (question === '') return jsonResponse({ error: 'empty-question' }, 400);

  const llm = ctx.get('llm');
  if (!llm) {
    return jsonResponse({ error: 'llm-unavailable', message: '这个 Harness 没有装载模型服务（ctx.llm）。' }, 503);
  }

  const abort = new AbortController();
  if (request.signal) {
    if (request.signal.aborted) abort.abort();
    else request.signal.addEventListener('abort', () => abort.abort(), { once: true });
  }

  const picked = body?.model;
  const requestOptions = picked && typeof picked.provider === 'string' && picked.provider !== ''
    && typeof picked.model === 'string' && picked.model !== ''
    ? { ...options, requested: { provider: picked.provider, model: picked.model } }
    : options;
  const routes = await orderRoutes(ctx, llm, requestOptions, abort.signal);
  if (routes.length === 0) {
    return jsonResponse({ error: 'model-unavailable', message: '还没有选择默认模型。' }, 503);
  }

  const book = { title: body?.book?.title, author: body?.book?.author, chapter: body?.book?.chapter };
  const passages = normalizePassages(body?.passages);
  const history = normalizeHistory(body?.history);
  const messages = [...history, { role: 'user', content: [{ type: 'text', text: composeUserMessage(book, passages, question) }] }];
  const system = systemPrompt(book);

  // Cap the retries: a genuine provider outage must not fan out over every route.
  const iterator = streamWithFallback(llm, routes.slice(0, MAX_ROUTE_ATTEMPTS), (route) => ({
    provider: route.provider,
    model: route.model,
    system,
    messages,
    temperature: 0.2,
    maxTokens: options.maxTokens,
    signal: abort.signal,
  }));
  return sseResponse(iterator, abort);
}

/**
 * List every model the reader may pick, plus the route a question would use if
 * nothing is picked. The picker mirrors the Harness model selector: one flat
 * list tagged with its provider.
 */
async function handleModels(ctx, options) {
  const llm = ctx.get('llm');
  if (!llm) {
    return jsonResponse({ error: 'llm-unavailable', message: '这个 Harness 没有装载模型服务（ctx.llm）。' }, 503);
  }
  const models = [];
  let providers = [];
  try { providers = llm.listProviders?.() ?? []; } catch { providers = []; }
  for (const entry of providers) {
    const id = entry?.id;
    if (!id) continue;
    let list = [];
    try { list = (await llm.listModels(id)) ?? []; } catch { list = []; }
    for (const model of list) {
      if (!model?.id) continue;
      models.push({ provider: id, providerName: entry.name ?? id, id: model.id, name: model.name ?? model.id });
    }
  }
  let current;
  try {
    current = (await orderRoutes(ctx, llm, options, undefined))[0];
  } catch { /* keep the picker usable even when probing fails */ }
  return jsonResponse({ models, current: current ?? null });
}

/**
 * Register the ask-the-book endpoints on the authenticated browser transport.
 * @param ctx - Host plugin context.
 * @param config - optional `provider` / `model` / `maxTokens` overrides.
 */
export function apply(ctx, config = {}) {
  const options = {
    provider: typeof config?.provider === 'string' && config.provider !== '' ? config.provider : undefined,
    model: typeof config?.model === 'string' && config.model !== '' ? config.model : undefined,
    maxTokens: Number.isFinite(config?.maxTokens) && config.maxTokens > 0
      ? Math.floor(config.maxTokens)
      : DEFAULT_MAX_TOKENS,
  };
  ctx.inject(['connection'], (child) => {
    child.effect(() => child.connection.fetch.register({
      path: CHAT_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => handleChat(child, request, options),
    }), 'bookshelf: ask-the-book endpoint');
    child.effect(() => child.connection.fetch.register({
      path: MODELS_PATH,
      // POST, not GET: the /api carrier is RPC-shaped and rejects a bodiless GET
      // before the exact route is consulted, so the list travels as a POST body.
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: () => handleModels(child, options),
    }), 'bookshelf: ask-the-book model list');
  });
}
