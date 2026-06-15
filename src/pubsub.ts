import { Socket } from "net";

export class PubSub {
  private channels = new Map<string, Set<Socket>>();
  private socketSubs = new Map<Socket, Set<string>>();

  subscribe(socket: Socket, channel: string): number {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    this.channels.get(channel)!.add(socket);

    if (!this.socketSubs.has(socket)) {
      this.socketSubs.set(socket, new Set());
    }
    this.socketSubs.get(socket)!.add(channel);

    return this.channels.get(channel)!.size;
  }

  unsubscribe(socket: Socket, channel?: string): number {
    if (channel) {
      const subs = this.channels.get(channel);
      if (subs) {
        subs.delete(socket);
        if (subs.size === 0) {
          this.channels.delete(channel);
        }
      }
      const socketChannels = this.socketSubs.get(socket);
      if (socketChannels) {
        socketChannels.delete(channel);
        if (socketChannels.size === 0) {
          this.socketSubs.delete(socket);
        }
      }
    } else {
      const socketChannels = this.socketSubs.get(socket);
      if (socketChannels) {
        for (const ch of socketChannels) {
          const subs = this.channels.get(ch);
          if (subs) {
            subs.delete(socket);
            if (subs.size === 0) {
              this.channels.delete(ch);
            }
          }
        }
        this.socketSubs.delete(socket);
      }
    }
    return this.socketSubs.get(socket)?.size ?? 0;
  }

  publish(channel: string, message: string): number {
    const subs = this.channels.get(channel);
    if (!subs) return 0;
    const msg = `*3\r\n$7\r\nmessage\r\n$${Buffer.byteLength(channel)}\r\n${channel}\r\n$${Buffer.byteLength(message)}\r\n${message}\r\n`;
    let count = 0;
    for (const socket of subs) {
      try {
        if (!socket.destroyed) {
          socket.write(msg);
          count++;
        }
      } catch {
        // socket write failed
      }
    }
    return count;
  }

  removeClient(socket: Socket) {
    this.unsubscribe(socket);
  }

  getSubscriptionCount(socket: Socket): number {
    return this.socketSubs.get(socket)?.size ?? 0;
  }
}
