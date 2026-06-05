const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const API_BASE = process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org";
const API = `${API_BASE}/bot${BOT_TOKEN}`;

export async function sendMessage(chatId: string, text: string, options?: { parse_mode?: string; reply_markup?: unknown }) {
  const res = await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...options }),
  });
  return res.json();
}

export async function setWebhook(url: string) {
  const res = await fetch(`${API}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return res.json();
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
