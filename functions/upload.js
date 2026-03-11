import { errorHandling, telemetryData } from "./utils/middleware";

// 安全防护：允许的 MIME 类型前缀白名单
const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/'];

// 安全防护：高危文件扩展名黑名单（防止 MIME 伪造绕过）
const BLOCKED_EXTENSIONS = [
    'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx',       // JavaScript/TypeScript
    'php', 'phtml', 'phar', 'php3', 'php4', 'php5', // PHP
    'py', 'pyc', 'pyo',                              // Python
    'rb', 'pl', 'sh', 'bash', 'zsh', 'csh',         // 脚本语言
    'exe', 'dll', 'so', 'bat', 'cmd', 'ps1', 'vbs', // 可执行文件
    'jsp', 'jspx', 'asp', 'aspx', 'cer', 'asa',     // Web 服务端脚本
    'cfm', 'cfml', 'cgi', 'htaccess', 'env',        // 配置/CGI
    'html', 'htm', 'xhtml', 'svg',                   // 可执行 HTML/SVG
    'jar', 'war', 'class',                            // Java
    'msi', 'scr', 'com',                              // Windows 可执行
];

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const clonedRequest = request.clone();
        const formData = await clonedRequest.formData();

        await errorHandling(context);
        telemetryData(context);

        const uploadFile = formData.get('file');
        if (!uploadFile) {
            throw new Error('No file uploaded');
        }

        const fileName = uploadFile.name;
        const fileExtension = fileName.split('.').pop().toLowerCase();

        // ===== 安全检查 1：MIME 类型白名单 =====
        const isAllowedMime = ALLOWED_MIME_PREFIXES.some(prefix => uploadFile.type.startsWith(prefix));
        if (!isAllowedMime) {
            console.warn(`[SECURITY] Blocked upload: MIME type "${uploadFile.type}" not allowed. File: "${fileName}"`);
            return new Response(
                JSON.stringify({ error: 'File type not allowed. Only images, videos, and audio files are accepted.' }),
                { status: 403, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // ===== 安全检查 2：扩展名黑名单（防止 MIME 伪造） =====
        if (BLOCKED_EXTENSIONS.includes(fileExtension)) {
            console.warn(`[SECURITY] Blocked upload: extension ".${fileExtension}" is blacklisted. File: "${fileName}"`);
            return new Response(
                JSON.stringify({ error: 'File extension not allowed.' }),
                { status: 403, headers: { 'Content-Type': 'application/json' } }
            );
        }

        const telegramFormData = new FormData();
        telegramFormData.append("chat_id", env.TG_Chat_ID);

        // 根据文件类型选择合适的上传方式
        let apiEndpoint;
        if (uploadFile.type.startsWith('image/')) {
            telegramFormData.append("photo", uploadFile);
            apiEndpoint = 'sendPhoto';
        } else if (uploadFile.type.startsWith('audio/')) {
            telegramFormData.append("audio", uploadFile);
            apiEndpoint = 'sendAudio';
        } else if (uploadFile.type.startsWith('video/')) {
            telegramFormData.append("video", uploadFile);
            apiEndpoint = 'sendVideo';
        }

        const result = await sendToTelegram(telegramFormData, apiEndpoint, env);

        if (!result.success) {
            throw new Error(result.error);
        }

        const fileId = getFileId(result.data);

        if (!fileId) {
            throw new Error('Failed to get file ID');
        }

        // 将文件信息保存到 KV 存储
        if (env.img_url) {
            await env.img_url.put(`${fileId}.${fileExtension}`, "", {
                metadata: {
                    TimeStamp: Date.now(),
                    ListType: "None",
                    Label: "None",
                    liked: false,
                    fileName: fileName,
                    fileSize: uploadFile.size,
                }
            });
        }

        return new Response(
            JSON.stringify([{ 'src': `/file/${fileId}.${fileExtension}` }]),
            {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    } catch (error) {
        console.error('Upload error:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}

function getFileId(response) {
    if (!response.ok || !response.result) return null;

    const result = response.result;
    if (result.photo) {
        return result.photo.reduce((prev, current) =>
            (prev.file_size > current.file_size) ? prev : current
        ).file_id;
    }
    if (result.document) return result.document.file_id;
    if (result.video) return result.video.file_id;
    if (result.audio) return result.audio.file_id;

    return null;
}

async function sendToTelegram(formData, apiEndpoint, env, retryCount = 0) {
    const MAX_RETRIES = 2;
    const apiUrl = `https://api.telegram.org/bot${env.TG_Bot_Token}/${apiEndpoint}`;

    try {
        const response = await fetch(apiUrl, { method: "POST", body: formData });
        const responseData = await response.json();

        if (response.ok) {
            return { success: true, data: responseData };
        }

        // 图片上传失败时转为文档方式重试
        if (retryCount < MAX_RETRIES && apiEndpoint === 'sendPhoto') {
            console.log('Retrying image as document...');
            const newFormData = new FormData();
            newFormData.append('chat_id', formData.get('chat_id'));
            newFormData.append('document', formData.get('photo'));
            return await sendToTelegram(newFormData, 'sendDocument', env, retryCount + 1);
        }

        return {
            success: false,
            error: responseData.description || 'Upload to Telegram failed'
        };
    } catch (error) {
        console.error('Network error:', error);
        if (retryCount < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
            return await sendToTelegram(formData, apiEndpoint, env, retryCount + 1);
        }
        return { success: false, error: 'Network error occurred' };
    }
}