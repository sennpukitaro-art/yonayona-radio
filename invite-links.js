'use strict';
const crypto = require('node:crypto');

// Pending links reserve one MC slot. A link is consumed before a room starts.
class InviteLinks {
  constructor({ now = Date.now, ttlMs = 30 * 60 * 1000, limit = 1000 } = {}) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.limit = limit;
    this.links = new Map();
    this.hosts = new Map();
  }
  get(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(token)) return;
    const link = this.links.get(token);
    if (link && link.expiresAt > this.now()) return link;
  }
  forHost(hostId) { return this.get(this.hosts.get(hostId)); }
  create(hostId) {
    const current = this.forHost(hostId);
    if (current) return current;
    if (this.links.size >= this.limit) return;
    const link = { token: crypto.randomBytes(18).toString('base64url'), hostId, expiresAt: this.now() + this.ttlMs };
    this.links.set(link.token, link);
    this.hosts.set(hostId, link.token);
    return link;
  }
  remove(token) {
    const link = this.links.get(token);
    if (!link) return;
    this.links.delete(token);
    if (this.hosts.get(link.hostId) === token) this.hosts.delete(link.hostId);
    return link;
  }
  take(token) { return this.get(token) && this.remove(token); }
  cancel(hostId) { return this.remove(this.hosts.get(hostId)); }
  expire() {
    const expired = [];
    for (const link of this.links.values()) {
      if (link.expiresAt <= this.now()) expired.push(this.remove(link.token));
    }
    return expired;
  }
}
module.exports = InviteLinks;
