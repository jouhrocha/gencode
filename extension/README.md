# Gencode AI Bridge

Proveedor de modelos de lenguaje para el chat de VS Code / VSGencode mediante cualquier endpoint OpenAI-compatible.

## Que aporta

- Registra el `vendor` `gencode` en el selector de modelos del chat.
- Habla `/chat/completions` con streaming SSE y `/models` para descubrir catalogo.
- Soporta herramientas (`tool_calls`) e imagenes en entrada.
- No incluye telemetria, ni endpoints de Microsoft, ni prompts de sistema propios: el prompt lo compone el cliente.

## Configuracion

| Ajuste | Por defecto | Descripcion |
|---|---|---|
| `gencodeAi.baseUrl` | `http://127.0.0.1:11434/v1` | Endpoint sin barra final. Ollama, LM Studio, vLLM, OpenAI. |
| `gencodeAi.apiKey` | vacio | Enviada como `Authorization: Bearer`. |
| `gencodeAi.models` | `[]` | Si esta vacio se consulta `GET {baseUrl}/models`. |
| `gencodeAi.maxOutputTokens` | `4096` | `max_tokens` por peticion. |
| `gencodeAi.temperature` | `0` | Muestreo. |

Ejemplo para Ollama:

```json
{
  "gencodeAi.baseUrl": "http://127.0.0.1:11434/v1",
  "gencodeAi.models": [{ "id": "qwen2.5-coder", "maxInputTokens": 32768, "toolCalling": true }]
}
```

## Instalacion

```bash
code --install-extension gencode-ai-bridge-0.1.0.vsix
```

## Flujo de una peticion

1. El chat pide modelos al proveedor.
2. El proveedor devuelve el catalogo configurado o descubierto.
3. El chat envia los mensajes; el proveedor los traduce a formato OpenAI.
4. El stream se reemite como `LanguageModelTextPart` y `LanguageModelToolCallPart`.

Sin llamadas a ningun host distinto de `gencodeAi.baseUrl`.
