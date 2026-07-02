import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../store/auth';
import { ApiError } from '../api/client';
import { register as registerApi } from '../api/auth.api';

export function LoginScreen(): JSX.Element {
  const login = useAuth((s) => s.login);
  const status = useAuth((s) => s.status);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleLogin(): Promise<void> {
    if (!email || !password) {
      Alert.alert('입력 필요', '이메일과 비밀번호를 입력하세요');
      return;
    }
    setBusy(true);
    try {
      await login(email, password);
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.code} (${e.status})` : '로그인 실패';
      Alert.alert('로그인 실패', msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(): Promise<void> {
    if (!email || !password) {
      Alert.alert('입력 필요', '이메일과 비밀번호를 입력하세요');
      return;
    }
    setBusy(true);
    try {
      await registerApi(email, password);
      await login(email, password);
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.code} (${e.status})` : '가입 실패';
      Alert.alert('가입 실패', msg);
    } finally {
      setBusy(false);
    }
  }

  const isBusy = busy || status === 'loading';

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.inner}>
          <Text style={styles.title}>로그인</Text>
          <TextInput
            placeholder="이메일"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            style={styles.input}
            editable={!isBusy}
          />
          <TextInput
            placeholder="비밀번호 (8자 이상)"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            style={styles.input}
            editable={!isBusy}
          />

          <TouchableOpacity
            onPress={handleLogin}
            disabled={isBusy}
            style={[styles.button, isBusy && styles.buttonDisabled]}
          >
            {isBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>로그인</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={handleRegister} disabled={isBusy} style={styles.linkButton}>
            <Text style={styles.linkText}>처음이신가요? 가입하기</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 32, textAlign: 'center' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#fae100',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontSize: 16, fontWeight: '700', color: '#000' },
  linkButton: { marginTop: 16, alignItems: 'center' },
  linkText: { color: '#666', fontSize: 14 },
});
