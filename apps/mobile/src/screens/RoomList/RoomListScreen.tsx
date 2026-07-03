import { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../../store/auth';
import { useRoomList } from './useRoomList';
import type { RoomListItem } from '../../api/types';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'RoomList'>;

function roomTitle(room: RoomListItem): string {
  return room.type === 'direct'
    ? (room.otherUser?.nickname ?? '대화상대')
    : (room.name ?? '그룹채팅');
}

export function RoomListScreen({ navigation }: Props): JSX.Element {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const { rooms, loading, refreshing, error, refresh, retry } = useRoomList();

  const handlePressRoom = useCallback(
    (room: RoomListItem): void => {
      navigation.navigate('ChatRoom', { roomId: room.id, title: roomTitle(room) });
    },
    [navigation],
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{user?.nickname ?? '나'}</Text>
          <Text style={styles.subtitle}>{user?.email}</Text>
        </View>
        <TouchableOpacity onPress={() => void logout()} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.center}>
          <Text style={styles.error}>오류: {error}</Text>
          <TouchableOpacity onPress={retry} style={styles.retry}>
            <Text>다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : rooms.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.muted}>아직 채팅방이 없습니다</Text>
        </View>
      ) : (
        <FlatList
          data={rooms}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
          }
          renderItem={({ item }) => <RoomRow room={item} onPress={handlePressRoom} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </SafeAreaView>
  );
}

function RoomRow({
  room,
  onPress,
}: {
  room: RoomListItem;
  onPress: (room: RoomListItem) => void;
}): JSX.Element {
  const title = roomTitle(room);
  const preview = room.lastMessage?.content ?? '메시지 없음';
  return (
    <TouchableOpacity style={styles.row} onPress={() => onPress(room)}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rowPreview} numberOfLines={1}>
          {preview}
        </Text>
      </View>
      {room.unreadCount > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{room.unreadCount}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 12, color: '#666', marginTop: 2 },
  logoutBtn: { padding: 8 },
  logoutText: { color: '#666', fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowPreview: { fontSize: 14, color: '#666', marginTop: 4 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#eee', marginLeft: 16 },
  badge: {
    backgroundColor: '#ff4444',
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  muted: { color: '#999' },
  error: { color: 'red', marginBottom: 12 },
  retry: { padding: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8 },
});
