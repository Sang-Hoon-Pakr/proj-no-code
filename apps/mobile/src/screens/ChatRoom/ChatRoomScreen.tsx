import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../../store/auth';
import { useConnection } from '../../store/connection';
import { MAX_MESSAGE_LEN, useChatRoom } from './useChatRoom';
import type { ChatListItem, PendingMessage } from './useChatRoom';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import type { ChatMessage } from '../../api/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatRoom'>;

export function ChatRoomScreen({ navigation, route }: Props): JSX.Element {
  const { roomId, title } = route.params;
  const myUserId = useAuth((s) => s.user?.id);
  const showDisconnectedBanner = useConnection((s) => s.showBanner);
  const { items, loading, loadingMore, error, reload, loadOlder, send, retry } =
    useChatRoom(roomId);
  const [draft, setDraft] = useState('');

  const handleSend = useCallback((): void => {
    if (!draft.trim()) return;
    send(draft);
    setDraft('');
  }, [draft, send]);

  const renderItem = useCallback(
    ({ item }: { item: ChatListItem }) => {
      if (item.kind === 'pending') {
        return <PendingBubble pending={item.pending} onRetry={retry} />;
      }
      return <MessageBubble message={item.message} isMine={item.message.senderId === myUserId} />;
    },
    [myUserId, retry],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.backBtn} />
        </View>

        {showDisconnectedBanner ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>연결 끊김 — 재연결 시도 중</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.error}>오류: {error}</Text>
            <TouchableOpacity onPress={reload} style={styles.retryLoad}>
              <Text>다시 시도</Text>
            </TouchableOpacity>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.muted}>아직 메시지가 없습니다</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            inverted
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            onEndReached={loadOlder}
            onEndReachedThreshold={0.4}
            windowSize={10}
            contentContainerStyle={styles.listContent}
            ListFooterComponent={
              loadingMore ? <ActivityIndicator style={styles.moreSpinner} /> : null
            }
          />
        )}

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="메시지 입력"
            autoCorrect={false}
            autoCapitalize="none"
            multiline
            maxLength={MAX_MESSAGE_LEN}
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={!draft.trim()}
            style={[styles.sendBtn, !draft.trim() && styles.sendBtnDisabled]}
          >
            <Text style={styles.sendText}>전송</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function keyExtractor(item: ChatListItem): string {
  return item.kind === 'message' ? item.message.id : item.pending.id;
}

function MessageBubble({
  message,
  isMine,
}: {
  message: ChatMessage;
  isMine: boolean;
}): JSX.Element {
  return (
    <View style={[styles.bubbleRow, isMine ? styles.rowMine : styles.rowOther]}>
      {isMine ? <Text style={styles.time}>{formatTime(message.createdAt)}</Text> : null}
      <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleOther]}>
        <Text style={styles.bubbleText}>{message.content}</Text>
      </View>
      {!isMine ? <Text style={styles.time}>{formatTime(message.createdAt)}</Text> : null}
    </View>
  );
}

function PendingBubble({
  pending,
  onRetry,
}: {
  pending: PendingMessage;
  onRetry: (messageId: string) => void;
}): JSX.Element {
  return (
    <View style={[styles.bubbleRow, styles.rowMine]}>
      {pending.status === 'sending' ? (
        <Text style={styles.time}>전송 중</Text>
      ) : (
        <TouchableOpacity onPress={() => onRetry(pending.id)} style={styles.retrySend}>
          <Text style={styles.retrySendText}>↻ 재시도</Text>
        </TouchableOpacity>
      )}
      <View style={[styles.bubble, styles.bubbleMine, styles.bubblePending]}>
        <Text style={styles.bubbleText}>{pending.content}</Text>
      </View>
    </View>
  );
}

// 서버 createdAt은 ISO 8601 UTC — 로컬 타임존 변환은 클라이언트 책임 (api-conventions).
function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  backBtn: { width: 40, alignItems: 'center' },
  backText: { fontSize: 28, lineHeight: 28, color: '#333' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  banner: { backgroundColor: '#b00020', paddingVertical: 6, alignItems: 'center' },
  bannerText: { color: '#fff', fontSize: 12 },
  listContent: { paddingVertical: 12, paddingHorizontal: 12 },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginVertical: 3,
    gap: 6,
  },
  rowMine: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '72%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
  },
  bubbleMine: { backgroundColor: '#ffe812' },
  bubbleOther: { backgroundColor: '#f0f0f0' },
  bubblePending: { opacity: 0.7 },
  bubbleText: { fontSize: 15, color: '#111' },
  time: { fontSize: 10, color: '#999', marginBottom: 2 },
  retrySend: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#ffecec',
    marginBottom: 2,
  },
  retrySendText: { fontSize: 11, color: '#b00020' },
  moreSpinner: { marginVertical: 12 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
  },
  input: {
    flex: 1,
    maxHeight: 100,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#f5f5f5',
    fontSize: 15,
  },
  sendBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: '#ffe812',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendText: { fontSize: 14, fontWeight: '600', color: '#111' },
  muted: { color: '#999' },
  error: { color: 'red', marginBottom: 12 },
  retryLoad: { padding: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8 },
});
