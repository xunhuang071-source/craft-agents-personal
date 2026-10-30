import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import net from 'node:net';
import tls from 'node:tls';

/** AWS uses Node HTTP rather than fetch. Never let its offline smoke escape. */
function blocked(): never {
  throw new Error('OFFLINE_NODE_NETWORK_BLOCKED');
}
http.request = blocked as typeof http.request;
http.get = blocked as typeof http.get;
https.request = blocked as typeof https.request;
https.get = blocked as typeof https.get;
http2.connect = blocked as typeof http2.connect;
net.connect = blocked as typeof net.connect;
net.createConnection = blocked as typeof net.createConnection;
net.Socket.prototype.connect = blocked as typeof net.Socket.prototype.connect;
tls.connect = blocked as typeof tls.connect;
