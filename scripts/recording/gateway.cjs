// Local-only bridge to real GoTrue and PostgREST containers. No mock responses.
const http = require("node:http");

const services = { "/auth/v1": Number(process.env.AUTH_PORT), "/rest/v1": Number(process.env.REST_PORT) };
const server = http.createServer((req, res) => {
  const prefix = Object.keys(services).find(path => req.url === path || req.url.startsWith(path + "/"));
  if (!prefix) {
    res.writeHead(404).end();
    return;
  }
  const forwarded = http.request({
    hostname: "127.0.0.1", port: services[prefix], path: req.url.slice(prefix.length) || "/",
    method: req.method, headers: req.headers,
  }, upstream => {
    res.writeHead(upstream.statusCode, upstream.headers);
    upstream.pipe(res);
  });
  forwarded.on("error", () => res.writeHead(502).end());
  req.pipe(forwarded);
});
server.listen(54321, "127.0.0.1");
