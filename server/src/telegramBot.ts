import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/**
 * Minimal Telegram bot integration (no extra dependency):
 *  - POST /api/telegram/webhook receives updates (verified with Telegram's secret-token header),
 *    and answers /start with a button that opens the game as a Mini App;
 *  - on startup, registers the webhook and the chat menu button ("Play") with the Bot API.
 * Requires TELEGRAM_BOT_TOKEN and PUBLIC_URL (the public HTTPS address of this server).
 */
export interface BotOptions {
  token: string;
  publicUrl: string;
  /** Injectable for tests. */
  fetchFn?: typeof fetch;
  log?: (msg: string) => void;
}

export function webhookSecret(token: string): string {
  return createHash('sha256').update(`mini-empire-webhook:${token}`).digest('hex').slice(0, 48);
}

async function callBot(o: BotOptions, method: string, body: unknown) {
  const res = await (o.fetchFn ?? fetch)(`https://api.telegram.org/bot${o.token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description ?? res.status}`);
  return data;
}

export async function registerTelegramBot(app: FastifyInstance, o: BotOptions) {
  const secret = webhookSecret(o.token);
  const gameUrl = o.publicUrl.replace(/\/$/, '');

  app.post('/api/telegram/webhook', async (req, reply) => {
    const got = Buffer.from(String(req.headers['x-telegram-bot-api-secret-token'] ?? ''));
    const want = Buffer.from(secret);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return reply.code(401).send({ ok: false });
    const update = req.body as { message?: { chat?: { id?: number }; text?: string } };
    const chatId = update?.message?.chat?.id;
    const text = update?.message?.text ?? '';
    if (chatId && /^\/(start|play|oyna)\b/.test(text)) {
      await callBot(o, 'sendMessage', {
        chat_id: chatId,
        text: '🏰 Mini Empire\'a hoş geldin! Krallığını kur, ordunu eğit, klanına katıl ve 100 günlük sezonda zirveye çık.\n\nBaşlamak için aşağıdaki butona dokun.',
        reply_markup: { inline_keyboard: [[{ text: '🏰 Oyunu Aç', web_app: { url: gameUrl } }]] },
      }).catch((e) => o.log?.(String(e)));
    }
    return { ok: true };
  });

  app.addHook('onReady', async () => {
    try {
      await callBot(o, 'setWebhook', { url: `${gameUrl}/api/telegram/webhook`, secret_token: secret, allowed_updates: ['message'] });
      await callBot(o, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Oyna', web_app: { url: gameUrl } } });
      o.log?.('Telegram bot webhook and menu button registered');
    } catch (e) {
      o.log?.(`Telegram bot setup failed (the game still works): ${(e as Error).message}`);
    }
  });
}
