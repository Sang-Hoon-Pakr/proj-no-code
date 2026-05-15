import { api } from './client';
import type { RoomListResponse } from './types';

export async function listMyRooms(cursor?: string, limit?: number): Promise<RoomListResponse> {
  return api<RoomListResponse>('/rooms/me', {
    query: { cursor, limit },
  });
}
