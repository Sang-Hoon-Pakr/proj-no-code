import { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../../store/auth';
import { useConnection } from '../../store/connection';
import { useChatRoom } from './useChatRoom';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import type { ChatMessage } from '../../api/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatRoom'>;

export function ChatRoomScreen({ navigation, route }: Props): JSX.Element {
  const { roomId, title } = route.params;
  const myUserId = useAuth((s) => s.user?.id);
  const showDisconnectedBanner = useConnection((s) => s.showBanner);
  const { messages, loading, loadingMore, error, reload, loadOlder } = useChatRoom(roomId);

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <MessageBubble message={item} isMine={item.senderId === myUserId} />
    ),
    [myUserId],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
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
          <TouchableOpacity onPress={reload} style={styles.retry}>
            <Text>다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.muted}>아직 메시지가 없습니다</Text>
        </View>
      ) : (
        <FlatList
          data={messages}
          inverted
          keyExtractor={(item) => item.id}
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
    </SafeAreaView>
  );
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

// 서버 createdAt은 ISO 8601 UTC — 로컬 타임존 변환은 클라이언트 책임 (api-conventions).
function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
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
  bubbleText: { fontSize: 15, color: '#111' },
  time: { fontSize: 10, color: '#999', marginBottom: 2 },
  banner: { backgroundColor: '#b00020', paddingVertical: 6, alignItems: 'center' },
  bannerText: { color: '#fff', fontSize: 12 },
  moreSpinner: { marginVertical: 12 },
  muted: { color: '#999' },
  error: { color: 'red', marginBottom: 12 },
  retry: { padding: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8 },
});
