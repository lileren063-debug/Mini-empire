// Mini Empire — run the game for Telegram from your own computer (no hosting needed).
// 1) asks for / reads the BotFather token, 2) builds the game, 3) opens a free Cloudflare tunnel
// (gives a temporary https:// address), 4) starts the server, which registers the bot's webhook,
// "/start" reply and "Oyna" menu button with that address. Works while this window stays open.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
const PORT = 3000;

function readEnv() {
  const out = {};
  if (!existsSync(envFile)) return out;
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

async function main() {
  let token = process.env.TELEGRAM_BOT_TOKEN || readEnv().TELEGRAM_BOT_TOKEN;
  if (!token) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log('\nBotFather\'in verdigi token\'i yapistirin (ornek 123456789:AA...) ve Enter\'a basin:');
    token = (await rl.question('> ')).trim();
    rl.close();
    if (!/^\d+:[\w-]{20,}$/.test(token)) {
      console.error('Bu bir bot token\'ina benzemiyor. BotFather -> /mybots -> botunuz -> API Token.');
      process.exit(1);
    }
    appendFileSync(envFile, `\nTELEGRAM_BOT_TOKEN=${token}\n`);
    console.log('Token .env dosyasina kaydedildi (bir dahaki sefere sorulmayacak).');
  }

  console.log('\n[1/3] Oyun derleniyor...');
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });
  if (build.status !== 0) process.exit(build.status ?? 1);

  console.log('\n[2/3] Guvenli internet adresi (tunel) aciliyor...');
  const { bin, install } = await import('cloudflared');
  if (!existsSync(bin)) {
    console.log('Cloudflare tunel programi indiriliyor (ilk sefere ozel)...');
    await install(bin);
  }
  const tunnel = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tunel adresi 60 saniyede alinamadi. Internet baglantinizi kontrol edin.')), 60_000);
    const onData = (buf) => {
      const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) { clearTimeout(timer); resolve(m[0]); }
    };
    tunnel.stdout.on('data', onData);
    tunnel.stderr.on('data', onData);
    tunnel.on('exit', (code) => reject(new Error(`Tunel kapandi (kod ${code}).`)));
  });
  console.log(`Adres: ${url}`);

  console.log('\n[3/3] Oyun sunucusu baslatiliyor...');
  const server = spawn('npm', ['start'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, PORT: String(PORT), PUBLIC_URL: url, TELEGRAM_BOT_TOKEN: token, TRUST_PROXY: 'true' },
  });
  setTimeout(() => {
    console.log('\n=====================================================');
    console.log(' HAZIR! Telegram\'da botunuzu acin ve /start yazin.');
    console.log(` Tarayicida denemek icin: ${url}`);
    console.log(' Bu pencere acik kaldigi surece oyun calisir. Kapatmak icin Ctrl+C.');
    console.log('=====================================================\n');
  }, 8000);

  const stop = () => { tunnel.kill(); server.kill(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  server.on('exit', (code) => { tunnel.kill(); process.exit(code ?? 0); });
}

main().catch((e) => {
  console.error(`\n[HATA] ${e.message}`);
  process.exit(1);
});
