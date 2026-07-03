import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../store/auth';
import { useSocketLifecycle } from '../realtime/useSocketLifecycle';
import { LoginScreen } from '../screens/LoginScreen';
import { RoomListScreen } from '../screens/RoomListScreen';
import { ChatRoomScreen } from '../screens/ChatRoom/ChatRoomScreen';

// mobile CLAUDE.md: 네비게이션 파라미터는 typed.
export type RootStackParamList = {
  Login: undefined;
  RoomList: undefined;
  ChatRoom: { roomId: string; title: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator(): JSX.Element {
  const status = useAuth((s) => s.status);
  const hydrate = useAuth((s) => s.hydrate);
  useSocketLifecycle();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (status === 'idle' || status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {status === 'authenticated' ? (
        <>
          <Stack.Screen name="RoomList" component={RoomListScreen} />
          <Stack.Screen name="ChatRoom" component={ChatRoomScreen} />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
}
