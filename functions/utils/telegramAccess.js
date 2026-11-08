// Who may use the Telegram bot (functions/api/telegram-webhook.js).
//
// - TG_Allowed_Users (comma or space separated Telegram user IDs), if set,
//   is the exact list.
// - Otherwise, if TG_Chat_ID is a plain positive number it is a private chat
//   with one person, and only that person is allowed.
// - Otherwise TG_Chat_ID is the storage channel/group, and its human admins
//   are allowed (looked up with getChatAdministrators; the bot is an admin
//   there because it posts uploads to it).
//
// Any lookup failure means "not allowed", so a stranger never gets a link.

export function explicitAllowList(env) {
    return String(env.TG_Allowed_Users || '')
        .split(/[\s,]+/)
        .filter(Boolean);
}

export async function isAllowedBotUser(env, userId) {
    if (userId === undefined || userId === null || userId === '') return false;
    const id = String(userId);

    const explicit = explicitAllowList(env);
    if (explicit.length > 0) return explicit.includes(id);

    const chat = String(env.TG_Chat_ID || '').trim();
    if (/^\d+$/.test(chat)) return chat === id;
    if (!chat || !env.TG_Bot_Token) return false;

    try {
        const res = await fetch(
            `https://api.telegram.org/bot${env.TG_Bot_Token}/getChatAdministrators?chat_id=${encodeURIComponent(chat)}`
        );
        const data = await res.json();
        if (!data || data.ok !== true || !Array.isArray(data.result)) return false;
        return data.result.some(member =>
            member && member.user && member.user.is_bot !== true && String(member.user.id) === id
        );
    } catch (e) {
        console.error('[Webhook] admin lookup failed', e && e.message);
        return false;
    }
}
