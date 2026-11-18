import { OnEvent } from '@nestjs/event-emitter';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { SessionResolver } from '../auth/jwt.guard';
import { VISIT_UPDATED, VisitUpdatedEvent } from '../visits/visit-lifecycle.service';

const allowedOrigin = (origin: string | undefined, callback: (err: Error | null, ok?: boolean) => void) => {
  const allowed = (process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim());
  // Mobile app origin nahi bhejti; browsers ko list mein hona zaroori hai.
  callback(null, !origin || allowed.includes(origin));
};

/** Live screens ko sirf "yeh visit badla" batata hai. Client data API se dobara laata hai. */
@WebSocketGateway({ namespace: '/live', cors: { origin: allowedOrigin } })
export class LiveGateway implements OnGatewayConnection {
  @WebSocketServer() private readonly server!: Namespace;

  constructor(private readonly sessions: SessionResolver) {}

  async handleConnection(client: Socket): Promise<void> {
    const token: unknown = client.handshake.auth?.token;
    const user = typeof token === 'string' ? await this.sessions.resolve(token) : null;
    // App doosra premises chune to woh user ke apne premises mein se hi ho (HTTP ke X-Premises-Id jaisa).
    const wanted: unknown = client.handshake.auth?.premisesId;
    const premisesId = typeof wanted === 'string' && wanted ? wanted : user?.premisesId;
    if (!user || !premisesId || !user.premisesIds.includes(premisesId)) {
      client.disconnect(true);
      return;
    }
    await client.join(`premises:${premisesId}`);
    client.emit('ready');
  }

  @OnEvent(VISIT_UPDATED)
  onVisitUpdated(event: VisitUpdatedEvent): void {
    this.server.to(`premises:${event.premisesId}`).emit('visit.updated', {
      visitId: event.visitId,
      status: event.status,
    });
  }
}
