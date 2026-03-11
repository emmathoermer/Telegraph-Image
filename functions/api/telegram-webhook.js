/**
 * Telegram Bot Webhook 处理函数
 * 
 * 功能：在 Telegram 中发送图片/视频给 Bot，自动返回图床链接
 * 路径：POST /api/telegram-webhook?secret=xxx
 */

export async function onRequestPost(context) {
    const { request, env } = context;

    // 验证 webhook 密钥，防止他人伪造请求
    const url = new URL(request.url);
    const secret = url.searchParams.get('secret');
    if (!env.TG_Webhook_Secret || secret !== env.TG_Webhook_Secret) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        const update = await request.json();

        // 只处理私聊消息（安全起见，不处理群组消息）
        if (!update.message || update.message.chat.type !== 'private') {
            return new Response('OK');
        }

        const message = update.message;
        const chatId = message.chat.id;

        // 处理 /start 命令
        if (message.text === '/start') {
            await sendTelegramMessage(env, chatId, 
                '👋 欢迎使用图床 Bot！\n\n' +
                '📸 直接发送图片或视频，我会返回图床链接。\n\n' +
                '支持的格式：图片、视频、GIF'
            );
            return new Response('OK');
        }

        // 处理 /help 命令
        if (message.text === '/help') {
            await sendTelegramMessage(env, chatId,
                '📖 使用说明：\n\n' +
                '1. 直接发送图片 → 返回图床链接\n' +
                '2. 发送视频 → 返回视频链接\n' +
                '3. 发送 GIF → 返回 GIF 链接\n\n' +
                '链接格式：\n' +
                '• 直接链接\n' +
                '• Markdown 格式\n' +
                '• HTML 格式'
            );
            return new Response('OK');
        }

        // 获取图床域名
        const hostOrigin = url.origin.includes('pages.dev') 
            ? url.origin 
            : `https://${env.CUSTOM_DOMAIN || url.hostname}`;

        let fileId = null;
        let fileExt = 'jpg';
        let fileSize = 0;
        let fileType = '图片';

        // 处理图片
        if (message.photo && message.photo.length > 0) {
            // 取最大尺寸的图片
            const photo = message.photo[message.photo.length - 1];
            fileId = photo.file_id;
            fileExt = 'jpg';
            fileSize = photo.file_size || 0;
            fileType = '图片';
        }
        // 处理视频
        else if (message.video) {
            fileId = message.video.file_id;
            fileExt = 'mp4';
            fileSize = message.video.file_size || 0;
            fileType = '视频';
        }
        // 处理 GIF（Telegram 中 GIF 以 animation 传输）
        else if (message.animation) {
            fileId = message.animation.file_id;
            fileExt = 'gif';
            fileSize = message.animation.file_size || 0;
            fileType = 'GIF';
        }
        // 处理以文件形式发送的图片/视频
        else if (message.document) {
            const mimeType = message.document.mime_type || '';
            if (mimeType.startsWith('image/') || mimeType.startsWith('video/')) {
                fileId = message.document.file_id;
                fileExt = getExtFromMime(mimeType, message.document.file_name);
                fileSize = message.document.file_size || 0;
                fileType = mimeType.startsWith('image/') ? '图片' : '视频';
            } else {
                await sendTelegramMessage(env, chatId, 
                    '❌ 不支持的文件类型。\n\n只支持图片、视频和 GIF。', 
                    message.message_id
                );
                return new Response('OK');
            }
        }
        // 不支持的消息类型
        else {
            await sendTelegramMessage(env, chatId, 
                '📸 请发送图片、视频或 GIF，我会返回图床链接。', 
                message.message_id
            );
            return new Response('OK');
        }

        // 生成图床链接
        const fileKey = `${fileId}.${fileExt}`;
        const fileUrl = `${hostOrigin}/file/${fileKey}`;

        // 保存到 KV（供管理后台查看）
        if (env.img_url) {
            await env.img_url.put(fileKey, "", {
                metadata: {
                    TimeStamp: Date.now(),
                    ListType: "None",
                    Label: "None",
                    liked: false,
                    fileName: fileKey,
                    fileSize: fileSize,
                }
            });
        }

        // 回复链接
        const replyText = 
            `✅ ${fileType}已上传！\n\n` +
            `🔗 链接:\n${fileUrl}\n\n` +
            `📋 Markdown:\n\`![image](${fileUrl})\`\n\n` +
            `🌐 HTML:\n\`<img src="${fileUrl}">\``;

        await sendTelegramMessage(env, chatId, replyText, message.message_id);

        return new Response('OK');

    } catch (error) {
        console.error('[Webhook Error]', error.message);
        return new Response('Internal Error', { status: 500 });
    }
}

/**
 * 发送 Telegram 消息
 */
async function sendTelegramMessage(env, chatId, text, replyToMessageId = null) {
    const payload = {
        chat_id: chatId,
        text: text,
        disable_web_page_preview: true,
    };
    if (replyToMessageId) {
        payload.reply_to_message_id = replyToMessageId;
    }

    await fetch(`https://api.telegram.org/bot${env.TG_Bot_Token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}

/**
 * 从 MIME 类型或文件名提取扩展名
 */
function getExtFromMime(mimeType, fileName) {
    // 优先从文件名取
    if (fileName && fileName.includes('.')) {
        return fileName.split('.').pop().toLowerCase();
    }
    // 从 MIME 类型推断
    const mimeMap = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/quicktime': 'mov',
    };
    return mimeMap[mimeType] || 'jpg';
}
