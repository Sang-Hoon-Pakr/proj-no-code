export interface UserProfile {
  id: string;
  email: string;
  nickname: string;
  profileImageUrl: string | null;
  statusMessage: string | null;
  createdAt: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface RoomListItem {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  lastActivityAt: string;
  lastMessage: {
    id: string;
    senderId: string;
    content: string;
    seq: number;
    createdAt: string;
  } | null;
  unreadCount: number;
  otherUser: {
    id: string;
    nickname: string;
    profileImageUrl: string | null;
    statusMessage: string | null;
  } | null;
}

export interface RoomListResponse {
  rooms: RoomListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  content: string;
  seq: number;
  createdAt: string;
}

export interface MessageListResponse {
  messages: ChatMessage[];
  hasMore: boolean;
  nextBefore: number | null;
}

export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: { code: string };
  instance: string;
}
