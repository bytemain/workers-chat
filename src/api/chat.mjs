import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { showRoutes } from 'hono/dev';
import { MAX_MESSAGE_LENGTH } from '../common/constants.mjs';
import { getPath, splitPath } from 'hono/utils/url';

// `handleErrors()` is a little utility function that can wrap an HTTP request handler in a
// try/catch and return errors to the client. You probably wouldn't want to use this in production
// code but it is convenient when debugging and iterating.
async function handleErrors(request, func) {
  try {
    return await func();
  } catch (err) {
    if (request.headers.get('Upgrade') == 'websocket') {
      // Annoyingly, if we return an HTTP error in response to a WebSocket request, Chrome devtools
      // won't show us the response body! So... let's send a WebSocket response with an error
      // frame instead.
      let pair = new WebSocketPair();
      pair[1].accept();
      pair[1].send(JSON.stringify({ error: err.stack }));
      pair[1].close(1011, 'Uncaught exception during session setup');
      return new Response(null, { status: 101, webSocket: pair[0] });
    } else {
      return new Response(err.stack, { status: 500 });
    }
  }
}

/**
 *
 * @param {(app: Hono) => void} mount
 * @returns
 */
function ignite(mount) {
  const app = new Hono();
  mount(app);
  app.onError((err, c) => {
    console.error(`${err}`);
    return c.text('Error: ' + err.message, 500);
  });
  app.use('*', cors());
  showRoutes(app, { verbose: true });
  return app;
}

const app = ignite((app) => {
  function apiRoutes() {
    const api = new Hono();

    api.post('/room', (c) => {
      // POST to /api/room creates a private room.
      //
      // Incidentally, this code doesn't actually store anything. It just generates a valid
      // unique ID for this namespace. Each durable object namespace has its own ID space, but
      // IDs from one namespace are not valid for any other.
      //
      // The IDs returned by `newUniqueId()` are unguessable, so are a valid way to implement
      // "anyone with the link can access" sharing. Additionally, IDs generated this way have
      // a performance benefit over IDs generated from names: When a unique ID is generated,
      // the system knows it is unique without having to communicate with the rest of the
      // world -- i.e., there is no way that someone in the UK and someone in New Zealand
      // could coincidentally create the same ID at the same time, because unique IDs are,
      // well, unique!
      let id = c.env.rooms.newUniqueId();
      return new Response(id.toString());
    });

    api.all('/room/*', async (c, next) => {
      const path = getPath(c.req);
      console.log('Processing path:', path);
      const segments = splitPath(path);
      console.log('Segments:', segments);
      const name = segments[2];
      if (!name) {
        return new Response('You must specify a room name', { status: 401 });
      }
      c.set('name', name);
      c.set('path', segments.slice(3).join('/'));
      await next();
    });

    api.all('/room/*', async (c) => {
      // OK, the request is for `/api/room/<name>/...{path}`. It's time to route to the Durable Object
      // for the specific room.
      const name = c.get('name');
      const path = c.get('path');
      console.log('Routing to room:', name, path);
      const { env } = c;
      const request = c.req.raw;
      // Each Durable Object has a 256-bit unique ID. IDs can be derived from string names, or
      // chosen randomly by the system.
      let id;
      if (name.match(/^[0-9a-f]{64}$/)) {
        // The name is 64 hex digits, so let's assume it actually just encodes an ID. We use this
        // for private rooms. `idFromString()` simply parses the text as a hex encoding of the raw
        // ID (and verifies that this is a valid ID for this namespace).
        id = env.rooms.idFromString(name);
      } else if (name.length <= 32) {
        // Treat as a string room name (limited to 32 characters). `idFromName()` consistently
        // derives an ID from a string.
        id = env.rooms.idFromName(name);
      } else {
        return new Response('Name too long', { status: 404 });
      }
      // Get the Durable Object stub for this room! The stub is a client object that can be used
      // to send messages to the remote Durable Object instance. The stub is returned immediately;
      // there is no need to await it. This is important because you would not want to wait for
      // a network round trip before you could start sending requests. Since Durable Objects are
      // created on-demand when the ID is first used, there's nothing to wait for anyway; we know
      // an object will be available somewhere to receive our requests.
      let roomObject = env.rooms.get(id);
      const newUrl = new URL(request.url);
      newUrl.pathname = '/' + path;
      console.log('Forwarding to DO with path:', newUrl.toString());

      // Send the request to the object. The `fetch()` method of a Durable Object stub has the
      // same signature as the global `fetch()` function, but the request is always sent to the
      // object, regardless of the request's URL.
      return roomObject.fetch(newUrl, request);
    });

    return api;
  }

  app.route('/api', apiRoutes());

  app.get('/files/*', async (c) => {
    const { env, req } = c;
    const url = new URL(req.url);
    const path = url.pathname.slice(7).split('/');

    if (!path[0]) {
      return new Response('Not found', { status: 404 });
    }

    const fileKey = path.join('/');
    const object = await env.CHAT_FILES.get(fileKey);

    if (object === null) {
      return new Response('File not found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000');

    return new Response(object.body, { headers });
  });

  app.notFound(async (c) => {
    const response = await c.env.ASSETS.fetch(c.req.raw);

    console.log('Serving asset:', c.req.raw.url);
    // Clone the response so we can modify headers
    const newResponse = new Response(response.body, response);
    const contentType = newResponse.headers.get('Content-Type');

    if (contentType) {
      let newContentType = contentType;
      if (contentType.includes('charset=')) {
        newContentType = contentType.replace(
          /charset=[^;,\s]*/i,
          'charset=UTF-8',
        );
      } else if (
        contentType.includes('text/') ||
        contentType.includes('application/json') ||
        contentType.includes('application/javascript')
      ) {
        newContentType += '; charset=UTF-8';
      }
      newResponse.headers.set('Content-Type', newContentType);
    }

    return newResponse;
  });
});

export default {
  async fetch(request, env, ctx) {
    return await handleErrors(request, async () => {
      return app.fetch(request, env, ctx);
    });
  },
};

// =======================================================================================
// SQLite-backed ChatRoom Durable Object

// ChatRoom implements a Durable Object that coordinates an individual chat room. Participants
// connect to the room using WebSockets, and the room broadcasts messages from each participant
// to all others.
export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.storage = state.storage;
    this.sql = state.storage.sql;
    this.env = env;

    // Initialize database schema
    this.initDatabase();

    // Destruction timers
    this.destructionTimer = null;
    this.destructionTime = null;
    this.destructionBroadcastInterval = null;

    // Track WebSocket sessions
    this.sessions = new Map();
    this.state.getWebSockets().forEach((webSocket) => {
      // The constructor may have been called when waking up from hibernation,
      // so get previously serialized metadata for any existing WebSockets.
      let meta = webSocket.deserializeAttachment();

      // Set up our rate limiter client.
      // The client itself can't have been in the attachment, because structured clone doesn't work on functions.
      // DO ids aren't cloneable, restore the ID from its hex string
      let limiterId = this.env.limiters.idFromString(meta.limiterId);
      let limiter = new RateLimiterClient(
        () => this.env.limiters.get(limiterId),
        (err) => webSocket.close(1011, err.stack),
      );

      // We don't send any messages to the client until it has sent us the initial user info
      // message. Until then, we will queue messages in `session.blockedMessages`.
      // This could have been arbitrarily large, so we won't put it in the attachment.
      let blockedMessages = [];
      this.sessions.set(webSocket, { ...meta, limiter, blockedMessages });
    });

    this.lastTimestamp = 0;
    this.app = this.createApp();
    this.restoreDestructionTimer();
  }

  // Initialize SQLite database schema
  initDatabase() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT UNIQUE NOT NULL,
        timestamp INTEGER NOT NULL,
        username TEXT NOT NULL,
        message TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'general',
        reply_to_id TEXT,
        edited_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);

      CREATE TABLE IF NOT EXISTS threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_message_id TEXT NOT NULL,
        reply_message_id TEXT NOT NULL,
        reply_timestamp INTEGER NOT NULL,
        FOREIGN KEY (parent_message_id) REFERENCES messages(message_id),
        FOREIGN KEY (reply_message_id) REFERENCES messages(message_id)
      );

      CREATE INDEX IF NOT EXISTS idx_threads_parent ON threads(parent_message_id);

      CREATE TABLE IF NOT EXISTS edit_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        old_message TEXT NOT NULL,
        edited_at INTEGER NOT NULL,
        FOREIGN KEY (message_id) REFERENCES messages(message_id)
      );

      CREATE TABLE IF NOT EXISTS room_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS file_references (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        file_key TEXT NOT NULL,
        FOREIGN KEY (message_id) REFERENCES messages(message_id)
      );

      CREATE INDEX IF NOT EXISTS idx_file_refs_message ON file_references(message_id);
    `);
  }

  // Restore destruction timer
  async restoreDestructionTimer() {
    try {
      const results = this.sql
        .exec(`SELECT value FROM room_metadata WHERE key = 'destruction-time'`)
        .toArray();

      if (results.length > 0) {
        const result = results[0];
        const destructionTime = parseInt(result.value);
        const now = Date.now();
        const remaining = destructionTime - now;

        if (remaining <= 0) {
          await this.executeDestruction();
        } else {
          this.destructionTime = destructionTime;
          this.destructionTimer = setTimeout(() => {
            this.executeDestruction();
          }, remaining);

          this.destructionBroadcastInterval = setInterval(() => {
            const remaining = Math.max(
              0,
              Math.floor((this.destructionTime - Date.now()) / 1000),
            );
            this.broadcast({
              destructionUpdate: {
                countdown: remaining,
                destructionTime: this.destructionTime,
              },
            });
          }, 1000);
        }
      }
    } catch (err) {
      console.error('Failed to restore destruction timer:', err);
    }
  }

  createApp() {
    return ignite((app) => {
      app.all('/websocket', async (c) => {
        const { req } = c;
        const request = req.raw;
        // The request is to `/api/room/<name>/websocket`. A client is trying to establish a new
        // WebSocket session.
        if (request.headers.get('Upgrade') != 'websocket') {
          return new Response('Expected WebSocket', { status: 400 });
        }

        // Get the client's IP address for use with the rate limiter.
        let ip = request.headers.get('CF-Connecting-IP');

        // To accept the WebSocket request, we create a WebSocketPair (which is like a socketpair,
        // i.e. two WebSockets that talk to each other), we return one end of the pair in the
        // response, and we operate on the other end. Note that this API is not part of the
        // Fetch API standard; unfortunately, the Fetch API / Service Workers specs do not define
        // any way to act as a WebSocket server today.
        let pair = new WebSocketPair();

        // We're going to take pair[1] as our end, and return pair[0] to the client.
        await this.handleSession(pair[1], ip);

        // Now we return the other end of the pair to the client.
        return new Response(null, { status: 101, webSocket: pair[0] });
      });

      app.post('/upload', async (c) => {
        const { req } = c;
        const request = req.raw;
        let ip = request.headers.get('CF-Connecting-IP');

        // Rate limit check
        let limiterId = this.env.limiters.idFromName(ip);
        let limiter = this.env.limiters.get(limiterId);
        let response = await limiter.fetch('https://dummy-url', {
          method: 'POST',
        });
        let cooldown = +(await response.text());

        if (cooldown > 0) {
          return c.json(
            { error: 'Rate limit exceeded. Please wait before uploading.' },
            { status: 429 },
          );
        }

        const formData = await request.formData();
        const file = formData.get('file');

        if (!file || !(file instanceof File)) {
          return c.json({ error: 'No file provided' }, { status: 400 });
        }

        if (file.size > 10 * 1024 * 1024) {
          return c.json(
            { error: 'File too large (max 10MB)' },
            { status: 413 },
          );
        }

        const fileId = crypto.randomUUID();
        const fileExtension = file.name.split('.').pop() || 'bin';
        const fileKey = `${fileId}.${fileExtension}`;

        await this.env.CHAT_FILES.put(fileKey, file.stream(), {
          httpMetadata: {
            contentType: file.type || 'application/octet-stream',
          },
        });

        const fileUrl = `/files/${fileKey}`;
        return c.json({
          success: true,
          fileUrl: fileUrl,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
        });
      });

      app.get('/channels', async (c) => {
        const cursor = this.sql.exec(`
          SELECT 
            channel,
            COUNT(*) as count,
            MAX(timestamp) as lastUsed
          FROM messages
          GROUP BY channel
          ORDER BY lastUsed DESC
          LIMIT 100
        `);

        const channels = cursor.toArray();
        return c.json({ channels });
      });

      app.get('/channel/:channelName/messages', async (c) => {
        const channelName = c.req.param('channelName');
        const limit = parseInt(c.req.query('limit') || '100');

        if (!channelName) {
          return c.json({ error: "Missing 'channelName' parameter" }, 400);
        }

        console.log(
          'Fetching messages for channel:',
          channelName,
          'limit:',
          limit,
        );
        const cursor = this.sql.exec(
          `
          SELECT 
            message_id as messageId,
            timestamp,
            username as name,
            message,
            channel,
            reply_to_id as replyToId,
            edited_at as editedAt
          FROM messages
          WHERE channel = ?
          ORDER BY timestamp DESC
          LIMIT ?
        `,
          channelName,
          limit,
        );

        const messages = cursor.toArray().reverse(); // Reverse to get chronological order
        return c.json({ channel: channelName, messages });
      });

      app.get('/channel/search', async (c) => {
        const query = c.req.query('q') || '';

        const cursor = this.sql.exec(
          `
          SELECT 
            channel,
            COUNT(*) as count,
            MAX(timestamp) as lastUsed
          FROM messages
          WHERE channel LIKE ?
          GROUP BY channel
          ORDER BY lastUsed DESC
          LIMIT 20
        `,
          query + '%',
        );

        const results = cursor.toArray();
        return c.json({ query, results });
      });

      app.delete('/message/:messageId', async (c) => {
        const messageId = c.req.param('messageId');
        const { username } = await c.req.json();

        if (!messageId) {
          return c.json({ error: "Missing 'messageId' parameter" }, 400);
        }

        // Find and verify ownership
        const msgCursor = this.sql.exec(
          `SELECT username, message FROM messages WHERE message_id = ?`,
          messageId,
        );

        const messageData = msgCursor.one();
        if (!messageData) {
          return c.json({ error: 'Message not found' }, 404);
        }

        if (messageData.username !== username) {
          return c.json(
            { error: 'You can only delete your own messages' },
            { status: 403 },
          );
        }

        // Delete message and related data
        this.sql.exec(
          `
          DELETE FROM edit_history WHERE message_id = ?;
          DELETE FROM threads WHERE parent_message_id = ? OR reply_message_id = ?;
          DELETE FROM file_references WHERE message_id = ?;
          DELETE FROM messages WHERE message_id = ?;
        `,
          messageId,
          messageId,
          messageId,
          messageId,
          messageId,
        );

        this.broadcast({ messageDeleted: messageId });
        return c.json({ success: true, messageId });
      });

      app.put('/message/:messageId', async (c) => {
        const messageId = c.req.param('messageId');
        const { username, newMessage } = await c.req.json();

        if (!messageId || !newMessage) {
          return c.json(
            { error: "Missing 'messageId' or 'newMessage' parameter" },
            400,
          );
        }

        if (newMessage.length > MAX_MESSAGE_LENGTH) {
          return c.json({ error: 'Message too long' }, 400);
        }

        // Find and verify
        const msgCursor = this.sql.exec(
          `SELECT username, message FROM messages WHERE message_id = ?`,
          messageId,
        );

        const messageData = msgCursor.one();
        if (!messageData) {
          return c.json({ error: 'Message not found' }, 404);
        }

        if (messageData.username !== username) {
          return c.json({ error: 'You can only edit your own messages' }, 403);
        }

        if (messageData.message.startsWith('FILE:')) {
          return c.json({ error: 'Cannot edit file messages' }, 400);
        }

        // Save to edit history
        const editedAt = Date.now();
        this.sql.exec(
          `
          INSERT INTO edit_history (message_id, old_message, edited_at)
          VALUES (?, ?, ?);
          
          UPDATE messages
          SET message = ?, edited_at = ?
          WHERE message_id = ?;
        `,
          messageId,
          messageData.message,
          editedAt,
          newMessage,
          editedAt,
          messageId,
        );

        this.broadcast({
          messageEdited: {
            messageId,
            message: newMessage,
            editedAt,
          },
        });

        return c.json({
          success: true,
          messageId,
          message: newMessage,
          editedAt,
        });
      });

      app.get('/info', async (c) => {
        try {
          const nameCursor = this.sql.exec(
            `SELECT value FROM room_metadata WHERE key = 'name'`,
          );
          const noteCursor = this.sql.exec(
            `SELECT value FROM room_metadata WHERE key = 'note'`,
          );

          const info = {};
          const nameResult = nameCursor.one();
          const noteResult = noteCursor.one();

          if (nameResult) info.name = nameResult.value;
          if (noteResult) info.note = noteResult.value;

          return c.json(info);
        } catch (err) {
          return c.json({});
        }
      });

      app.put('/info', async (c) => {
        const data = await c.req.json();
        let changed = false;

        if (data.name !== undefined) {
          this.sql.exec(
            `
            INSERT OR REPLACE INTO room_metadata (key, value)
            VALUES ('name', ?)
          `,
            data.name,
          );
          changed = true;
        }

        if (data.note !== undefined) {
          this.sql.exec(
            `
            INSERT OR REPLACE INTO room_metadata (key, value)
            VALUES ('note', ?)
          `,
            data.note,
          );
          changed = true;
        }

        if (changed) {
          this.broadcast({
            roomInfoUpdate: {
              name: data.name,
              note: data.note,
            },
          });
        }

        return c.json({ success: true });
      });

      app.get('/thread/:messageId', async (c) => {
        const messageId = c.req.param('messageId');
        if (!messageId) {
          return new Response('Method not allowed', { status: 405 });
        }

        try {
          const nested = c.req.query('nested') === 'true';

          if (nested) {
            // Recursive query for nested replies
            const cursor = this.sql.exec(
              `
              WITH RECURSIVE thread_tree AS (
                SELECT message_id, reply_to_id, 0 as depth
                FROM messages
                WHERE message_id = ?
                
                UNION ALL
                
                SELECT m.message_id, m.reply_to_id, tt.depth + 1
                FROM messages m
                INNER JOIN thread_tree tt ON m.reply_to_id = tt.message_id
                WHERE tt.depth < 10
              )
              SELECT 
                m.message_id as messageId,
                m.timestamp,
                m.username as name,
                m.message,
                m.channel,
                m.reply_to_id as replyToId,
                m.edited_at as editedAt
              FROM thread_tree tt
              INNER JOIN messages m ON tt.message_id = m.message_id
              WHERE tt.depth > 0
              ORDER BY m.timestamp ASC
            `,
              messageId,
            );

            const allReplies = cursor.toArray();
            return c.json({ replies: allReplies });
          } else {
            // Direct replies only
            const cursor = this.sql.exec(
              `
              SELECT 
                message_id as messageId,
                timestamp,
                username as name,
                message,
                channel,
                reply_to_id as replyToId,
                edited_at as editedAt
              FROM messages
              WHERE reply_to_id = ?
              ORDER BY timestamp ASC
            `,
              messageId,
            );

            const replies = cursor.toArray();
            return c.json({ replies });
          }
        } catch (err) {
          console.error('Thread query error:', err);
          return c.json({ error: err.message }, 500);
        }
      });

      app.post('/destruction/start', async (c) => {
        try {
          const { countdownSeconds } = await c.req.json();
          const countdown = parseInt(countdownSeconds) || 300;

          if (countdown < 10 || countdown > 86400) {
            return c.json(
              { error: 'Countdown must be between 10 and 86400 seconds' },
              400,
            );
          }

          this.destructionTime = Date.now() + countdown * 1000;

          this.sql.exec(
            `
            INSERT OR REPLACE INTO room_metadata (key, value)
            VALUES ('destruction-time', ?)
          `,
            this.destructionTime.toString(),
          );

          if (this.destructionTimer) {
            clearTimeout(this.destructionTimer);
          }
          if (this.destructionBroadcastInterval) {
            clearInterval(this.destructionBroadcastInterval);
          }

          this.destructionTimer = setTimeout(() => {
            this.executeDestruction();
          }, countdown * 1000);

          this.destructionBroadcastInterval = setInterval(() => {
            const remaining = Math.max(
              0,
              Math.floor((this.destructionTime - Date.now()) / 1000),
            );
            this.broadcast({
              destructionUpdate: {
                countdown: remaining,
                destructionTime: this.destructionTime,
              },
            });

            if (remaining <= 0) {
              clearInterval(this.destructionBroadcastInterval);
              this.destructionBroadcastInterval = null;
            }
          }, 1000);

          this.broadcast({
            destructionUpdate: {
              countdown,
              destructionTime: this.destructionTime,
            },
          });

          return c.json({
            success: true,
            countdown,
            destructionTime: this.destructionTime,
          });
        } catch (err) {
          console.error('Failed to start destruction:', err);
          return c.json({ error: err.message }, 500);
        }
      });

      app.post('/destruction/cancel', async (c) => {
        try {
          if (this.destructionTimer) {
            clearTimeout(this.destructionTimer);
            this.destructionTimer = null;
          }
          if (this.destructionBroadcastInterval) {
            clearInterval(this.destructionBroadcastInterval);
            this.destructionBroadcastInterval = null;
          }

          this.destructionTime = null;

          this.sql.exec(
            `DELETE FROM room_metadata WHERE key = 'destruction-time'`,
          );

          this.broadcast({
            destructionUpdate: {
              cancelled: true,
            },
          });

          return c.json({ success: true });
        } catch (err) {
          console.error('Failed to cancel destruction:', err);
          return c.json({ error: err.message }, 500);
        }
      });

      app.get('/export', async (c) => {
        try {
          const nameCursor = this.sql.exec(
            `SELECT value FROM room_metadata WHERE key = 'name'`,
          );
          const noteCursor = this.sql.exec(
            `SELECT value FROM room_metadata WHERE key = 'note'`,
          );

          const roomInfo = {};
          try {
            const nameResult = nameCursor.one();
            if (nameResult) roomInfo.name = nameResult.value;
          } catch (e) {}

          try {
            const noteResult = noteCursor.one();
            if (noteResult) roomInfo.note = noteResult.value;
          } catch (e) {}

          const messagesCursor = this.sql.exec(`
            SELECT 
              message_id as messageId,
              timestamp,
              username as name,
              message,
              channel,
              reply_to_id as replyToId,
              edited_at as editedAt,
              created_at as createdAt
            FROM messages
            ORDER BY timestamp ASC
          `);

          const messages = messagesCursor.toArray();

          return c.json({
            roomInfo,
            messages,
            exportedAt: Date.now(),
          });
        } catch (err) {
          console.error('Export error:', err);
          return c.json({ error: err.message }, 500);
        }
      });
    });
  }

  async fetch(request) {
    return await handleErrors(request, async () => {
      let url = new URL(request.url);
      return this.app.fetch(request);
    });
  }

  async handleSession(webSocket, ip) {
    this.state.acceptWebSocket(webSocket);

    let limiterId = this.env.limiters.idFromName(ip);
    let limiter = new RateLimiterClient(
      () => this.env.limiters.get(limiterId),
      (err) => webSocket.close(1011, err.stack),
    );

    let session = { limiterId, limiter, blockedMessages: [] };
    webSocket.serializeAttachment({
      ...webSocket.deserializeAttachment(),
      limiterId: limiterId.toString(),
    });
    this.sessions.set(webSocket, session);

    // Queue join messages
    for (let otherSession of this.sessions.values()) {
      if (otherSession.name) {
        session.blockedMessages.push(
          JSON.stringify({ joined: otherSession.name }),
        );
      }
    }
  }

  async webSocketMessage(webSocket, msg) {
    try {
      let session = this.sessions.get(webSocket);
      if (session.quit) {
        webSocket.close(1011, 'WebSocket broken');
        return;
      }

      if (!session.limiter.checkLimit()) {
        webSocket.send(
          JSON.stringify({
            error: 'Your IP is being rate-limited. Please try again later.',
          }),
        );
        return;
      }

      let data = JSON.parse(msg);

      if (!session.name) {
        session.name = '' + (data.name || 'anonymous');
        session.name = session.name.substring(0, 32);

        if (session.blockedMessages.length > 0) {
          session.blockedMessages.forEach((queued) => {
            try {
              webSocket.send(queued);
            } catch (err) {
              session.quit = true;
            }
          });
          session.blockedMessages = [];
        }

        this.broadcast({ joined: session.name });
        webSocket.send(JSON.stringify({ ready: true }));
        return;
      }

      // Construct message
      data = {
        name: session.name,
        message: '' + data.message,
        messageId: data.messageId || crypto.randomUUID(),
        replyTo: data.replyTo || null,
        channel: data.channel || 'general',
      };

      // Validate channel
      if (data.channel.length > 100) {
        throw new Error('Channel name too long');
      }

      // Validate message length
      if (data.message.startsWith('FILE:')) {
        const parts = data.message.substring(5).split('|');
        if (parts.length < 3) {
          throw new Error('Invalid file message format');
        }
      } else if (data.message.length > MAX_MESSAGE_LENGTH) {
        throw new Error('Message too long');
      }

      data.timestamp = Math.max(Date.now(), this.lastTimestamp + 1);
      this.lastTimestamp = data.timestamp;

      // Broadcast
      let dataStr = JSON.stringify(data);
      this.broadcast(dataStr);

      // Save to database
      this.sql.exec(
        `
        INSERT INTO messages (
          message_id, timestamp, username, message, channel,
          reply_to_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        data.messageId,
        data.timestamp,
        data.name,
        data.message,
        data.channel,
        data.replyTo?.messageId || null,
        Date.now(),
      );

      // Update thread index if reply
      if (data.replyTo && data.replyTo.messageId) {
        this.sql.exec(
          `
          INSERT INTO threads (parent_message_id, reply_message_id, reply_timestamp)
          VALUES (?, ?, ?)
        `,
          data.replyTo.messageId,
          data.messageId,
          data.timestamp,
        );

        // Broadcast thread update
        const countCursor = this.sql.exec(
          `
          SELECT COUNT(*) as count FROM threads WHERE parent_message_id = ?
        `,
          data.replyTo.messageId,
        );
        const countResult = countCursor.one();

        this.broadcast({
          threadUpdate: {
            messageId: data.replyTo.messageId,
            threadInfo: {
              replyCount: countResult.count,
            },
          },
        });
      }

      // Track file reference
      if (data.message.startsWith('FILE:')) {
        const parts = data.message.substring(5).split('|');
        const fileUrl = parts[0];
        const fileKey = fileUrl.replace('/files/', '');

        this.sql.exec(
          `
          INSERT INTO file_references (message_id, file_key)
          VALUES (?, ?)
        `,
          data.messageId,
          fileKey,
        );
      }
    } catch (err) {
      webSocket.send(JSON.stringify({ error: err.stack }));
    }
  }

  async closeOrErrorHandler(webSocket) {
    let session = this.sessions.get(webSocket) || {};
    session.quit = true;
    this.sessions.delete(webSocket);
    if (session.name) {
      this.broadcast({ quit: session.name });
    }
  }

  async webSocketClose(webSocket, code, reason, wasClean) {
    this.closeOrErrorHandler(webSocket);
  }

  async webSocketError(webSocket, error) {
    this.closeOrErrorHandler(webSocket);
  }

  broadcast(message) {
    if (typeof message !== 'string') {
      message = JSON.stringify(message);
    }

    let quitters = [];
    this.sessions.forEach((session, webSocket) => {
      if (session.name) {
        try {
          webSocket.send(message);
        } catch (err) {
          session.quit = true;
          quitters.push(session);
        }
      } else {
        session.blockedMessages.push(message);
      }
    });

    quitters.forEach((quitter) => {
      if (quitter.name) {
        this.sessions.delete(quitter);
      }
    });
  }

  async executeDestruction() {
    try {
      console.log('Executing room destruction...');

      this.broadcast({
        destructionUpdate: {
          roomDestroyed: true,
        },
      });

      // Close all WebSockets
      for (const [webSocket, session] of this.sessions.entries()) {
        try {
          webSocket.close(1000, 'Room destroyed');
        } catch (e) {}
      }
      this.sessions.clear();

      // Get all file references for R2 deletion
      const cursor = this.sql.exec(`SELECT file_key FROM file_references`);
      const filesToDelete = cursor.toArray().map((row) => row.file_key);

      // Delete all R2 files
      console.log(`Deleting ${filesToDelete.length} files from R2...`);
      for (const fileKey of filesToDelete) {
        try {
          await this.env.CHAT_FILES.delete(fileKey);
        } catch (e) {
          console.error(`Failed to delete file ${fileKey}:`, e);
        }
      }

      // Delete all database data
      console.log('Deleting all database data...');
      this.sql.exec(`
        DROP TABLE IF EXISTS messages;
        DROP TABLE IF EXISTS threads;
        DROP TABLE IF EXISTS edit_history;
        DROP TABLE IF EXISTS room_metadata;
        DROP TABLE IF EXISTS file_references;
      `);

      // Reinitialize schema
      this.initDatabase();

      // Clear timers
      if (this.destructionTimer) {
        clearTimeout(this.destructionTimer);
        this.destructionTimer = null;
      }
      if (this.destructionBroadcastInterval) {
        clearInterval(this.destructionBroadcastInterval);
        this.destructionBroadcastInterval = null;
      }
      this.destructionTime = null;

      console.log('Room destruction completed');
    } catch (err) {
      console.error('Failed to execute room destruction:', err);
    }
  }
}

// =======================================================================================
// The RateLimiter Durable Object class.

// RateLimiter implements a Durable Object that tracks the frequency of messages from a particular
// source and decides when messages should be dropped because the source is sending too many
// messages.
//
// We utilize this in ChatRoom, above, to apply a per-IP-address rate limit. These limits are
// global, i.e. they apply across all chat rooms, so if a user spams one chat room, they will find
// themselves rate limited in all other chat rooms simultaneously.
export class RateLimiter {
  constructor(state, env) {
    // Timestamp at which this IP will next be allowed to send a message. Start in the distant
    // past, i.e. the IP can send a message now.
    this.nextAllowedTime = 0;
  }

  // Our protocol is: POST when the IP performs an action, or GET to simply read the current limit.
  // Either way, the result is the number of seconds to wait before allowing the IP to perform its
  // next action.
  async fetch(request) {
    return await handleErrors(request, async () => {
      let now = Date.now() / 1000;
      this.nextAllowedTime = Math.max(now, this.nextAllowedTime);

      if (request.method == 'POST') {
        this.nextAllowedTime += 1 / 10; // 10 requests per second
      }

      // Return the number of seconds that the client needs to wait.
      //
      // We provide a "grace" period of 300 seconds (5 minutes), meaning that the client can make thousands of requests
      // in a quick burst before they start being limited.
      let cooldown = Math.max(0, this.nextAllowedTime - now - 300);
      return new Response(cooldown);
    });
  }
}

// RateLimiterClient implements rate limiting logic on the caller's side.
class RateLimiterClient {
  // The constructor takes two functions:
  // * getLimiterStub() returns a new Durable Object stub for the RateLimiter object that manages
  //   the limit. This may be called multiple times as needed to reconnect, if the connection is
  //   lost.
  // * reportError(err) is called when something goes wrong and the rate limiter is broken. It
  //   should probably disconnect the client, so that they can reconnect and start over.
  constructor(getLimiterStub, reportError) {
    this.getLimiterStub = getLimiterStub;
    this.reportError = reportError;
    this.limiter = getLimiterStub();

    // When `inCooldown` is true, the rate limit is currently applied and checkLimit() will return
    // false.
    this.inCooldown = false;
  }

  // Call checkLimit() when a message is received to decide if it should be blocked due to the
  // rate limit. Returns `true` if the message should be accepted, `false` to reject.
  checkLimit() {
    if (this.inCooldown) {
      return false;
    }
    this.inCooldown = true;
    this.callLimiter();
    return true;
  }

  // callLimiter() is an internal method which talks to the rate limiter.
  async callLimiter() {
    try {
      let response;
      try {
        // Currently, fetch() needs a valid URL even though it's not actually going to the
        // internet. We may loosen this in the future to accept an arbitrary string. But for now,
        // we have to provide a dummy URL that will be ignored at the other end anyway.
        response = await this.limiter.fetch('https://dummy-url', {
          method: 'POST',
        });
      } catch (err) {
        // `fetch()` threw an exception. This is probably because the limiter has been
        // disconnected. Stubs implement E-order semantics, meaning that calls to the same stub
        // are delivered to the remote object in order, until the stub becomes disconnected, after
        // which point all further calls fail. This guarantee makes a lot of complex interaction
        // patterns easier, but it means we must be prepared for the occasional disconnect, as
        // networks are inherently unreliable.
        //
        // Anyway, get a new limiter and try again. If it fails again, something else is probably
        // wrong.
        this.limiter = this.getLimiterStub();
        response = await this.limiter.fetch('https://dummy-url', {
          method: 'POST',
        });
      }

      let cooldown = +(await response.text());
      await new Promise((resolve) => setTimeout(resolve, cooldown * 1000));
      this.inCooldown = false;
    } catch (err) {
      this.reportError(err);
    }
  }
}
