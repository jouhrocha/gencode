"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const VENDOR = 'gencode';
function config() {
    return vscode.workspace.getConfiguration('gencodeAi');
}
function baseUrl() {
    return config().get('baseUrl', 'http://127.0.0.1:11434/v1').replace(/\/+$/, '');
}
function headers() {
    const key = config().get('apiKey', '');
    const h = { 'Content-Type': 'application/json' };
    if (key) {
        h['Authorization'] = `Bearer ${key}`;
    }
    return h;
}
function configuredModels() {
    return config().get('models', []) ?? [];
}
async function discoveredModels() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
        const response = await fetch(`${baseUrl()}/models`, { headers: headers(), signal: controller.signal });
        if (!response.ok) {
            return [];
        }
        const payload = (await response.json());
        return (payload.data ?? [])
            .map(entry => entry.id)
            .filter((id) => typeof id === 'string' && id.length > 0)
            .map(id => ({ id }));
    }
    catch {
        return [];
    }
    finally {
        clearTimeout(timer);
    }
}
let cache;
let cacheKey = '';
async function resolveModels() {
    const key = `${baseUrl()}|${JSON.stringify(configuredModels())}`;
    if (cache && cacheKey === key) {
        return cache;
    }
    const explicit = configuredModels();
    const models = explicit.length > 0 ? explicit : await discoveredModels();
    cache = models;
    cacheKey = key;
    return models;
}
function toOpenAiContent(part) {
    if (part instanceof vscode.LanguageModelTextPart) {
        return { type: 'text', text: part.value };
    }
    if (part instanceof vscode.LanguageModelDataPart) {
        const mime = part.mimeType ?? 'application/octet-stream';
        if (!mime.startsWith('image/')) {
            return undefined;
        }
        const bytes = part.data;
        if (!bytes) {
            return undefined;
        }
        return { type: 'image_url', image_url: { url: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` } };
    }
    if (typeof part === 'string') {
        return { type: 'text', text: part };
    }
    return undefined;
}
function toolResultText(part) {
    return part.content
        .map(item => (item instanceof vscode.LanguageModelTextPart ? item.value : JSON.stringify(item)))
        .join('');
}
function buildMessages(messages) {
    const out = [];
    for (const message of messages) {
        const role = message.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
        const toolCalls = [];
        const parts = [];
        const toolResults = [];
        for (const part of message.content) {
            if (part instanceof vscode.LanguageModelToolCallPart) {
                toolCalls.push({ id: part.callId, type: 'function', function: { name: part.name, arguments: JSON.stringify(part.input ?? {}) } });
                continue;
            }
            if (part instanceof vscode.LanguageModelToolResultPart) {
                toolResults.push({ role: 'tool', tool_call_id: part.callId, content: toolResultText(part) });
                continue;
            }
            const converted = toOpenAiContent(part);
            if (converted) {
                parts.push(converted);
            }
        }
        const onlyText = parts.every(p => p.type === 'text');
        const mergedText = onlyText ? parts.map(p => p.text ?? '').join('') : parts;
        if (toolResults.length > 0) {
            out.push(...toolResults);
            if (parts.length > 0 || toolCalls.length > 0) {
                out.push({ role, content: parts.length > 0 ? mergedText : null, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) });
            }
            continue;
        }
        if (parts.length === 0 && toolCalls.length === 0) {
            continue;
        }
        out.push({ role, content: parts.length > 0 ? mergedText : null, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) });
    }
    return out;
}
function estimateTokens(text) {
    return Math.max(1, Math.ceil(text.length / 4));
}
function messageText(message) {
    return message.content
        .map(part => (part instanceof vscode.LanguageModelTextPart ? part.value : ''))
        .join('');
}
class GencodeProvider {
    changed = new vscode.EventEmitter();
    onDidChangeLanguageModelChatInformation = this.changed.event;
    refresh() {
        cache = undefined;
        cacheKey = '';
        this.changed.fire();
    }
    async provideLanguageModelChatInformation() {
        const models = await resolveModels();
        return models.map(model => ({
            id: model.id,
            name: model.name ?? model.id,
            family: model.id,
            version: '1.0.0',
            maxInputTokens: model.maxInputTokens ?? 128000,
            maxOutputTokens: model.maxOutputTokens ?? 4096,
            capabilities: {
                imageInput: model.imageInput ?? false,
                toolCalling: model.toolCalling ?? true
            }
        }));
    }
    async provideLanguageModelChatResponse(model, messages, options, progress, token) {
        const body = {
            model: model.id,
            messages: buildMessages(messages),
            stream: true,
            temperature: config().get('temperature', 0),
            max_tokens: config().get('maxOutputTokens', 4096)
        };
        if (options.tools && options.tools.length > 0) {
            body.tools = options.tools.map(tool => ({
                type: 'function',
                function: { name: tool.name, description: tool.description, parameters: tool.inputSchema ?? { type: 'object', properties: {} } }
            }));
        }
        const controller = new AbortController();
        const cancellation = token.onCancellationRequested(() => controller.abort());
        let response;
        try {
            response = await fetch(`${baseUrl()}/chat/completions`, {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify(body),
                signal: controller.signal
            });
        }
        catch (error) {
            cancellation.dispose();
            throw new Error(`No se pudo contactar con ${baseUrl()}: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!response.ok || !response.body) {
            cancellation.dispose();
            const detail = await response.text().catch(() => '');
            throw new Error(`El endpoint devolvio ${response.status}. ${detail.slice(0, 500)}`);
        }
        const pending = new Map();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const flushLine = (line) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) {
                return;
            }
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') {
                return;
            }
            let chunk;
            try {
                chunk = JSON.parse(data);
            }
            catch {
                return;
            }
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) {
                return;
            }
            if (typeof delta.content === 'string' && delta.content.length > 0) {
                progress.report(new vscode.LanguageModelTextPart(delta.content));
            }
            for (const call of delta.tool_calls ?? []) {
                const current = pending.get(call.index) ?? { id: '', name: '', arguments: '' };
                if (call.id) {
                    current.id = call.id;
                }
                if (call.function?.name) {
                    current.name = call.function.name;
                }
                if (call.function?.arguments) {
                    current.arguments += call.function.arguments;
                }
                pending.set(call.index, current);
            }
        };
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                buffer += decoder.decode(value, { stream: true });
                let newline = buffer.indexOf('\n');
                while (newline >= 0) {
                    flushLine(buffer.slice(0, newline));
                    buffer = buffer.slice(newline + 1);
                    newline = buffer.indexOf('\n');
                }
                if (token.isCancellationRequested) {
                    await reader.cancel();
                    break;
                }
            }
            flushLine(buffer);
        }
        finally {
            cancellation.dispose();
        }
        for (const [index, call] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
            let input = {};
            try {
                input = call.arguments ? JSON.parse(call.arguments) : {};
            }
            catch {
                input = {};
            }
            progress.report(new vscode.LanguageModelToolCallPart(call.id || `call_${index}`, call.name, input));
        }
    }
    async provideTokenCount(_model, text) {
        if (typeof text === 'string') {
            return estimateTokens(text);
        }
        return estimateTokens(messageText(text));
    }
}
function activate(context) {
    const provider = new GencodeProvider();
    context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(VENDOR, provider));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('gencodeAi')) {
            provider.refresh();
        }
    }));
}
function deactivate() {
}
//# sourceMappingURL=extension.js.map