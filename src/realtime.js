import { Server } from 'socket.io';
import { authForSocket } from './auth.js';
import config from './config.js';

let io = null;

function reject(socket) {
  socket.emit('unauthorized');
  socket.disconnect(true);
}

export function initRealtime(httpServer) {
  const allowAll = config.corsOrigins.includes('*');
  io = new Server(httpServer, {
    cors: { origin: allowAll ? true : config.corsOrigins },
  });

  io.on('connection', (socket) => {
    const { token, room } = socket.handshake.auth || {};
    const auth = authForSocket(token);

    if (room === 'admin') {
      // Full admin overview — admin role only.
      if (auth?.role !== 'admin') return reject(socket);
      socket.join('staff');
    } else if (['bar', 'kitchen', 'station'].includes(room)) {
      // Station displays — admin or station role.
      if (!auth || !['admin', 'station'].includes(auth.role)) return reject(socket);
      socket.join('staff');
      socket.join(`station:${room}`);
    } else if (auth?.role === 'waiter') {
      socket.join(`waiter:${auth.waiter.id}`);
    } else {
      socket.disconnect(true);
      return;
    }
  });

  return io;
}

export function emitNewOrder(order) {
  if (!io) return;
  // Staff screens (admin + station displays) get the full order.
  io.to('staff').emit('order:new', order);
  // The waiter who placed it gets a confirmation.
  if (order.waiter_id) io.to(`waiter:${order.waiter_id}`).emit('order:confirmed', order);
}

export function emitOrderUpdate(payload) {
  if (!io) return;
  io.to('staff').emit('order:update', payload);
}

export function getIo() {
  return io;
}
