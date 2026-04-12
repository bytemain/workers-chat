/**
 * RxDB Schema Definitions
 *
 * Defines collections for messages, reactions, channels, and pins.
 * These schemas replace the TinyBase table definitions.
 */

export const messagesSchema = {
  version: 0,
  primaryKey: 'messageId',
  type: 'object',
  properties: {
    messageId: { type: 'string', maxLength: 100 },
    text: { type: 'string' },
    username: { type: 'string' },
    channel: { type: 'string' },
    timestamp: { type: 'number' },
    replyToId: { type: ['string', 'null'] },
    editedAt: { type: ['number', 'null'] },
    _deleted: { type: 'boolean' },
  },
  required: ['messageId', 'text', 'username', 'channel', 'timestamp'],
  indexes: ['timestamp', 'channel', ['channel', 'timestamp'], 'username'],
};

export const reactionsSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    messageId: { type: 'string' },
    reactionId: { type: 'string' },
    username: { type: 'string' },
    timestamp: { type: 'number' },
    _deleted: { type: 'boolean' },
  },
  required: ['id', 'messageId', 'reactionId', 'username', 'timestamp'],
  indexes: ['messageId', ['messageId', 'reactionId', 'username']],
};

export const channelsSchema = {
  version: 0,
  primaryKey: 'channel',
  type: 'object',
  properties: {
    channel: { type: 'string', maxLength: 100 },
    count: { type: 'number' },
    lastUsed: { type: 'number' },
    _deleted: { type: 'boolean' },
  },
  required: ['channel'],
  indexes: ['lastUsed'],
};

export const pinsSchema = {
  version: 0,
  primaryKey: 'messageId',
  type: 'object',
  properties: {
    messageId: { type: 'string', maxLength: 100 },
    channelName: { type: 'string' },
    pinnedAt: { type: 'number' },
    _deleted: { type: 'boolean' },
  },
  required: ['messageId', 'channelName', 'pinnedAt'],
  indexes: ['channelName'],
};

export const roomSettingsSchema = {
  version: 0,
  primaryKey: 'key',
  type: 'object',
  properties: {
    key: { type: 'string', maxLength: 100 },
    value: { type: 'string' },
    _deleted: { type: 'boolean' },
  },
  required: ['key', 'value'],
};
