// Preloaded in the capture runner and Next server. Allow only local sockets.
const { Socket } = require("node:net");
const connect = Socket.prototype.connect;
const loopback = new Set(["localhost", "127.0.0.1", "::1", "::ffff:127.0.0.1"]);
Socket.prototype.connect = function (...args) {
  const [target, address] = Array.isArray(args[0]) ? args[0] : args;
  const host = typeof target === "object" ? target.host : typeof address === "string" ? address : undefined;
  if (host && !loopback.has(host)) throw new Error("Recording environment blocked a non-loopback socket");
  return connect.apply(this, args);
};
