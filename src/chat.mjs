import HTML from "./chat.html";
import { HashtagManager } from "./hashtag.mjs";
import { Hono } from 'hono'
import { getPath, splitPath } from 'hono/utils/url'

// `handleErrors()` is a little utility function that can wrap an HTTP request handler in a
// try/catch and return errors to the client. You probably wouldn't want to use this in production
// code but it is convenient when debugging and iterating.
async function handleErrors(request, func) {
  try {
    return await func();
  } catch (err) {
    if (request.headers.get("Upgrade") == "websocket") {
      // Annoyingly, if we return an HTTP error in response to a WebSocket request, Chrome devtools
      // won't show us the response body! So... let's send a WebSocket response with an error
      // frame instead.
      let pair = new WebSocketPair();
      pair[1].accept();
      pair[1].send(JSON.stringify({ error: err.stack }));
      pair[1].close(1011, "Uncaught exception during session setup");
      return new Response(null, { status: 101, webSocket: pair[0] });
    } else {
      return new Response(err.stack, { status: 500 });
    }
  }
}




function ignite(mount) {
  const app = new Hono();

  mount(app);

  app.notFound((c) => {
    return c.text('not found', 404)
  });

  app.onError((err, c) => {
    console.error(`${err}`)
    return c.text('Error: ' + err.message, 500)
  });

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
      let id = env.rooms.newUniqueId();
      return new Response(id.toString(), { headers: { "Access-Control-Allow-Origin": "*" } });
    });

    api.all('/room/*', async (c, next) => {
      const path = getPath(c.req)
      console.log("Processing path:", path);
      const segments = splitPath(path);
      console.log("Segments:", segments);
      const name = segments[2];
      if (!name) {
        return new Response("You must specify a room name", { status: 401 });
      }
      c.set('name', name);
      c.set('path', segments.slice(3).join('/'));
      await next()
    })

    api.all('/room/*', async (c) => {
      // OK, the request is for `/api/room/<name>/...{path}`. It's time to route to the Durable Object
      // for the specific room.
      const name = c.get('name')
      const path = c.get('path')
      console.log("Routing to room:", name, path);
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
        return new Response("Name too long", { status: 404 });
      }

      // Get the Durable Object stub for this room! The stub is a client object that can be used
      // to send messages to the remote Durable Object instance. The stub is returned immediately;
      // there is no need to await it. This is important because you would not want to wait for
      // a network round trip before you could start sending requests. Since Durable Objects are
      // created on-demand when the ID is first used, there's nothing to wait for anyway; we know
      // an object will be available somewhere to receive our requests.
      let roomObject = env.rooms.get(id);
      const newUrl = new URL(request.url);
      newUrl.pathname = "/" + path;
      console.log("Forwarding to DO with path:", newUrl.toString());

      // Send the request to the object. The `fetch()` method of a Durable Object stub has the
      // same signature as the global `fetch()` function, but the request is always sent to the
      // object, regardless of the request's URL.
      return roomObject.fetch(newUrl, request);
    });

    // Define API routes here
    return api;
  }

  app.get('/', () => {
    return new Response(HTML, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
  });

  app.route('/api', apiRoutes());
  app.get('/files/*', async (c) => {
    const { env, req } = c;
    const url = new URL(req.url);
    const path = url.pathname.slice(7).split('/'); // Remove '/files/' prefix

    if (!path[0]) {
      return new Response("Not found", { status: 404 });
    }

    // Get the file from R2
    const fileKey = path.join("/");
    const object = await env.CHAT_FILES.get(fileKey);

    if (object === null) {
      return new Response("File not found", { status: 404 });
    }

    // Return the file with appropriate headers
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("Cache-Control", "public, max-age=31536000");

    return new Response(object.body, { headers });
  });
});

export default {
  async fetch(request, env, ctx) {
    return await handleErrors(request, async () => {
      return app.fetch(request, env, ctx);
    });
  }
}

// =======================================================================================
// The ChatRoom Durable Object Class

// ChatRoom implements a Durable Object that coordinates an individual chat room. Participants
// connect to the room using WebSockets, and the room broadcasts messages from each participant
// to all others.
export class ChatRoom {
  constructor(state, env) {
    this.state = state

    // `state.storage` provides access to our durable storage. It provides a simple KV
    // get()/put() interface.
    this.storage = state.storage;

    // `env` is our environment bindings (discussed earlier).
    this.env = env;

    // Initialize hashtag manager
    this.hashtagManager = new HashtagManager(this.storage);

    // We will track metadata for each client WebSocket object in `sessions`.
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
        err => webSocket.close(1011, err.stack));

      // We don't send any messages to the client until it has sent us the initial user info
      // message. Until then, we will queue messages in `session.blockedMessages`.
      // This could have been arbitrarily large, so we won't put it in the attachment.
      let blockedMessages = [];
      this.sessions.set(webSocket, { ...meta, limiter, blockedMessages });
    });

    // We keep track of the last-seen message's timestamp just so that we can assign monotonically
    // increasing timestamps even if multiple messages arrive simultaneously (see below). There's
    // no need to store this to disk since we assume if the object is destroyed and recreated, much
    // more than a millisecond will have gone by.
    this.lastTimestamp = 0;
    this.app = this.createApp();
  }

  createApp() {
    return ignite(app => {
      app.all('/websocket', async (c) => {
        const { req } = c;
        const request = req.raw;
        // The request is to `/api/room/<name>/websocket`. A client is trying to establish a new
        // WebSocket session.
        if (request.headers.get("Upgrade") != "websocket") {
          return new Response("expected websocket", { status: 400 });
        }

        // Get the client's IP address for use with the rate limiter.
        let ip = request.headers.get("CF-Connecting-IP");

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
        // Handle file upload
        const { req } = c;
        const request = req.raw;
        // Get the client's IP address for rate limiting
        let ip = request.headers.get("CF-Connecting-IP");

        // Check rate limit
        let limiterId = this.env.limiters.idFromName(ip);
        let limiter = this.env.limiters.get(limiterId);
        let response = await limiter.fetch("https://dummy-url", { method: "POST" });
        let cooldown = +(await response.text());
        if (cooldown > 0) {
          return new Response(JSON.stringify({ error: "Rate limited. Please try again later." }), {
            status: 429,
            headers: { "Content-Type": "application/json" }
          });
        }

        // Parse multipart form data
        const formData = await request.formData();
        const file = formData.get("file");

        if (!file || !(file instanceof File)) {
          return new Response(JSON.stringify({ error: "No file provided" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }

        // Validate file size (10MB max)
        if (file.size > 10 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: "File too large. Maximum size is 10MB." }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }

        // Generate unique file key
        const fileId = crypto.randomUUID();
        const fileExtension = file.name.split('.').pop() || 'bin';
        const fileKey = `${fileId}.${fileExtension}`;

        // Upload to R2
        await this.env.CHAT_FILES.put(fileKey, file.stream(), {
          httpMetadata: {
            contentType: file.type || "application/octet-stream"
          }
        });

        // Return the file URL
        const fileUrl = `/files/${fileKey}`;
        return new Response(JSON.stringify({
          success: true,
          fileUrl: fileUrl,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size
        }), {
          headers: { "Content-Type": "application/json" }
        });
      });

      app.get('/hashtags', async (c) => {
        const tags = await this.hashtagManager.getAllHashtags(100);
        return new Response(JSON.stringify({ hashtags: tags }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      });

      app.get('/hashtag', async (c) => {
        const tag = c.req.query("tag");
        if (!tag) {
          return new Response(JSON.stringify({ error: "Missing 'tag' parameter" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }

        const messages = await this.hashtagManager.getMessagesForTag(tag, 100);
        return new Response(JSON.stringify({ tag, messages }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      });

      app.get('/hashtag/search', async (c) => {
        const query = c.req.query("q") || "";
        const tags = await this.hashtagManager.searchHashtags(query, 20);
        return new Response(JSON.stringify({ query, results: tags }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      });

      app.get('/info', async (c) => {
        const info = await this.storage.get("room-info") || {};
        return new Response(JSON.stringify(info), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      });

      app.put('/info', async (c) => {
        const data = c.json();
        let info = await this.storage.get("room-info") || {};

        // Track what changed
        let changed = false;

        // Update name if provided
        if (data.name !== undefined && data.name !== info.name) {
          info.name = data.name;
          changed = true;
        }

        // Update note if provided
        if (data.note !== undefined && data.note !== info.note) {
          info.note = data.note;
          changed = true;
        }

        await this.storage.put("room-info", info);

        // Broadcast the update to all connected clients
        if (changed) {
          // Create a plain object to ensure JSON serialization works
          this.broadcast({
            roomInfoUpdate: {
              name: info.name,
              note: info.note
            }
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      });

      app.get('/thread/:messageId', async (c) => {
        const messageId = c.req.param('messageId');

        if (!messageId) {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          // Check if nested parameter is set
          const nested = c.req.query('nested') === 'true';

          if (nested) {
            // Return all nested replies recursively
            const allReplies = await this.getAllThreadReplies(messageId);
            return new Response(JSON.stringify({ replies: allReplies }), {
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
              }
            });
          } else {
            // Return only direct replies (original behavior)
            const threadKey = `thread:${messageId}`;
            const threadReplies = await this.storage.get(threadKey) || [];

            // Load the actual reply messages
            const replies = [];
            for (const reply of threadReplies) {
              try {
                const msgData = await this.storage.get(reply.key);
                if (msgData) {
                  const msg = typeof msgData === 'string' ? JSON.parse(msgData) : msgData;
                  replies.push(msg);
                }
              } catch (e) {
                console.error('Failed to load reply:', e);
              }
            }

            return new Response(JSON.stringify({ replies }), {
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
              }
            });
          }
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
      });

    });
  }

  // The system will call fetch() whenever an HTTP request is sent to this Object. Such requests
  // can only be sent from other Worker code, such as the code above; these requests don't come
  // directly from the internet. In the future, we will support other formats than HTTP for these
  // communications, but we started with HTTP for its familiarity.
  async fetch(request) {
    return await handleErrors(request, async () => {
      let url = new URL(request.url);
      console.log("ChatRoom handling request for:", url.pathname);
      return this.app.fetch(request);
    });
  }

  // handleSession() implements our WebSocket-based chat protocol.
  async handleSession(webSocket, ip) {
    // Accept our end of the WebSocket. This tells the runtime that we'll be terminating the
    // WebSocket in JavaScript, not sending it elsewhere.
    this.state.acceptWebSocket(webSocket);

    // Set up our rate limiter client.
    let limiterId = this.env.limiters.idFromName(ip);
    let limiter = new RateLimiterClient(
      () => this.env.limiters.get(limiterId),
      err => webSocket.close(1011, err.stack));

    // Create our session and add it to the sessions map.
    let session = { limiterId, limiter, blockedMessages: [] };
    // attach limiterId to the webSocket so it survives hibernation
    webSocket.serializeAttachment({ ...webSocket.deserializeAttachment(), limiterId: limiterId.toString() });
    this.sessions.set(webSocket, session);

    // Queue "join" messages for all online users, to populate the client's roster.
    for (let otherSession of this.sessions.values()) {
      if (otherSession.name) {
        session.blockedMessages.push(JSON.stringify({ joined: otherSession.name }));
      }
    }

    // Load the last 100 messages from the chat history stored on disk, and send them to the
    // client.
    let storage = await this.storage.list({ reverse: true, limit: 100 });
    let backlog = [...storage.values()];
    backlog.reverse();
    backlog.forEach(value => {
      // Ensure old messages have messageId for compatibility
      try {
        const msg = typeof value === 'string' ? JSON.parse(value) : value;
        if (!msg.messageId && msg.timestamp && msg.name) {
          // Generate legacy messageId for old messages
          msg.messageId = `${msg.timestamp}-${msg.name}`;
          value = JSON.stringify(msg);
        }
      } catch (e) {
        // If parsing fails, use original value
      }
      session.blockedMessages.push(value);
    });
  }

  async webSocketMessage(webSocket, msg) {
    try {
      let session = this.sessions.get(webSocket);
      if (session.quit) {
        // Whoops, when trying to send to this WebSocket in the past, it threw an exception and
        // we marked it broken. But somehow we got another message? I guess try sending a
        // close(), which might throw, in which case we'll try to send an error, which will also
        // throw, and whatever, at least we won't accept the message. (This probably can't
        // actually happen. This is defensive coding.)
        webSocket.close(1011, "WebSocket broken.");
        return;
      }

      // Check if the user is over their rate limit and reject the message if so.
      if (!session.limiter.checkLimit()) {
        webSocket.send(JSON.stringify({
          error: "Your IP is being rate-limited, please try again later."
        }));
        return;
      }

      // I guess we'll use JSON.
      let data = JSON.parse(msg);

      if (!session.name) {
        // The first message the client sends is the user info message with their name. Save it
        // into their session object.
        const requestedName = "" + (data.name || "anonymous");

        // Don't let people use ridiculously long names. (This is also enforced on the client,
        // so if they get here they are not using the intended client.)
        if (requestedName.length > 32) {
          webSocket.send(JSON.stringify({ error: "Name too long." }));
          webSocket.close(1009, "Name too long.");
          return;
        }

        // Check if this username is already taken
        let existingSession = null;
        for (let [ws, otherSession] of this.sessions.entries()) {
          if (otherSession.name === requestedName && otherSession !== session) {
            existingSession = { ws, session: otherSession };
            break;
          }
        }

        // If the username is taken, kick out the old connection (likely a stale connection)
        if (existingSession) {
          try {
            // Close the old connection
            existingSession.ws.close(1000, "Reconnected from another session");
            this.sessions.delete(existingSession.ws);
            // Broadcast that the user left
            this.broadcast({ quit: requestedName });
          } catch (err) {
            // If closing fails, the connection is probably already dead, which is fine
            console.log("Failed to close existing session:", err);
          }
        }

        session.name = requestedName;
        // attach name to the webSocket so it survives hibernation
        webSocket.serializeAttachment({ ...webSocket.deserializeAttachment(), name: session.name });

        // Deliver all the messages we queued up since the user connected.
        session.blockedMessages.forEach(queued => {
          // Apply JSON if we weren't given a string to start with.
          if (typeof queued !== "string") {
            queued = JSON.stringify(queued);
          }

          webSocket.send(queued);
        });
        delete session.blockedMessages;

        // Broadcast to all other connections that this user has joined.
        this.broadcast({ joined: session.name });

        webSocket.send(JSON.stringify({ ready: true }));
        return;
      }

      // Construct sanitized message for storage and broadcast.
      data = {
        name: session.name,
        message: "" + data.message,
        messageId: data.messageId || crypto.randomUUID(),  // Generate UUID if not provided
        replyTo: data.replyTo || null  // Include reply information if present
      };

      // Check if this is a file message
      if (data.message.startsWith("FILE:")) {
        // File messages have format: "FILE:{fileUrl}|{fileName}|{fileType}"
        // No additional validation needed as the file was already uploaded
      } else {
        // Block people from sending overly long messages. This is also enforced on the client,
        // so to trigger this the user must be bypassing the client code.
        if (data.message.length > 6000) {
          webSocket.send(JSON.stringify({ error: "Message too long." }));
          return;
        }
      }

      // Add timestamp. Here's where this.lastTimestamp comes in -- if we receive a bunch of
      // messages at the same time (or if the clock somehow goes backwards????), we'll assign
      // them sequential timestamps, so at least the ordering is maintained.
      data.timestamp = Math.max(Date.now(), this.lastTimestamp + 1);
      this.lastTimestamp = data.timestamp;

      // Broadcast the message to all other WebSockets.
      let dataStr = JSON.stringify(data);
      this.broadcast(dataStr);

      // Save message.
      let key = new Date(data.timestamp).toISOString();
      await this.storage.put(key, dataStr);

      // If this is a reply, update thread index
      if (data.replyTo && data.replyTo.messageId) {
        await this.updateThreadIndex(data.replyTo.messageId, key, data);
      }

      // Index hashtags in the message
      await this.hashtagManager.indexMessage(key, data.message, data.timestamp);
    } catch (err) {
      // Report any exceptions directly back to the client. As with our handleErrors() this
      // probably isn't what you'd want to do in production, but it's convenient when testing.
      webSocket.send(JSON.stringify({ error: err.stack }));
    }
  }

  // On "close" and "error" events, remove the WebSocket from the sessions list and broadcast
  // a quit message.
  async closeOrErrorHandler(webSocket) {
    let session = this.sessions.get(webSocket) || {};
    session.quit = true;
    this.sessions.delete(webSocket);
    if (session.name) {
      this.broadcast({ quit: session.name });
    }
  }

  async webSocketClose(webSocket, code, reason, wasClean) {
    this.closeOrErrorHandler(webSocket)
  }

  async webSocketError(webSocket, error) {
    this.closeOrErrorHandler(webSocket)
  }

  // Update thread index when a reply is posted
  async updateThreadIndex(parentMessageId, replyKey, replyData) {
    try {
      // Get or create thread index
      const threadKey = `thread:${parentMessageId}`;
      let threadReplies = await this.storage.get(threadKey) || [];

      // Add this reply to the thread
      threadReplies.push({
        key: replyKey,
        timestamp: replyData.timestamp
      });

      // Save updated thread index
      await this.storage.put(threadKey, threadReplies);

      // Update parent message's threadInfo
      // Try to find the parent message by searching storage
      // Since messageId might be UUID or timestamp-based, we need to search
      const messages = await this.storage.list();
      for (const [key, value] of messages) {
        if (key.startsWith('thread:')) continue; // Skip thread indexes

        try {
          const msg = typeof value === 'string' ? JSON.parse(value) : value;
          if (msg.messageId === parentMessageId) {
            msg.threadInfo = {
              replyCount: threadReplies.length,
              lastReplyTime: replyData.timestamp
            };
            await this.storage.put(key, JSON.stringify(msg));

            // Broadcast the updated threadInfo to all clients
            this.broadcast({
              threadUpdate: {
                messageId: parentMessageId,
                threadInfo: msg.threadInfo
              }
            });
            break;
          }
        } catch (e) {
          // Skip invalid entries
          continue;
        }
      }
    } catch (err) {
      console.error('Failed to update thread index:', err);
    }
  }

  // Get all replies for a thread recursively (including nested replies)
  async getAllThreadReplies(rootMessageId) {
    const allReplies = [];
    const visited = new Set();

    // Recursive function to collect replies
    const collectReplies = async (messageId) => {
      if (visited.has(messageId)) {
        return; // Prevent infinite loops
      }
      visited.add(messageId);

      // Get direct replies to this message
      const threadKey = `thread:${messageId}`;
      const threadReplies = await this.storage.get(threadKey) || [];

      // Load each reply message
      for (const replyRef of threadReplies) {
        try {
          const msgData = await this.storage.get(replyRef.key);
          if (msgData) {
            const msg = typeof msgData === 'string' ? JSON.parse(msgData) : msgData;
            allReplies.push(msg);

            // Recursively get replies to this reply
            if (msg.messageId) {
              await collectReplies(msg.messageId);
            }
          }
        } catch (e) {
          console.error('Failed to load reply:', e);
        }
      }
    };

    // Start collecting from the root message
    await collectReplies(rootMessageId);

    return allReplies;
  }

  // broadcast() broadcasts a message to all clients.
  broadcast(message) {
    // Apply JSON if we weren't given a string to start with.
    if (typeof message !== "string") {
      message = JSON.stringify(message);
    }

    // Iterate over all the sessions sending them messages.
    let quitters = [];
    this.sessions.forEach((session, webSocket) => {
      if (session.name) {
        try {
          webSocket.send(message);
        } catch (err) {
          // Whoops, this connection is dead. Remove it from the map and arrange to notify
          // everyone below.
          session.quit = true;
          quitters.push(session);
          this.sessions.delete(webSocket);
        }
      } else {
        // This session hasn't sent the initial user info message yet, so we're not sending them
        // messages yet (no secret lurking!). Queue the message to be sent later.
        session.blockedMessages.push(message);
      }
    });

    quitters.forEach(quitter => {
      if (quitter.name) {
        this.broadcast({ quit: quitter.name });
      }
    });
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

      if (request.method == "POST") {
        // POST request means the user performed an action.
        // We allow one action per 0.1 seconds (10 messages per second)
        this.nextAllowedTime += 0.1;
      }

      // Return the number of seconds that the client needs to wait.
      //
      // We provide a "grace" period of 300 seconds (5 minutes), meaning that the client can make thousands of requests
      // in a quick burst before they start being limited.
      let cooldown = Math.max(0, this.nextAllowedTime - now - 300);
      return new Response(cooldown);
    })
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

    // Call the callback to get the initial stub.
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
        response = await this.limiter.fetch("https://dummy-url", { method: "POST" });
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
        response = await this.limiter.fetch("https://dummy-url", { method: "POST" });
      }

      // The response indicates how long we want to pause before accepting more requests.
      let cooldown = +(await response.text());
      await new Promise(resolve => setTimeout(resolve, cooldown * 1000));

      // Done waiting.
      this.inCooldown = false;
    } catch (err) {
      this.reportError(err);
    }
  }
}
