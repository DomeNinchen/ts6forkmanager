import { useMutation } from '@tanstack/react-query';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../stores/auth.store';
import { useNavigate } from 'react-router';
import { useRecheckUpdate } from './use-update-check';

export function useLogin() {
  const { setAuth } = useAuthStore();
  const navigate = useNavigate();
  const recheckUpdate = useRecheckUpdate();

  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      authApi.login(username, password),
    onSuccess: (data) => {
      setAuth(data.accessToken, data.refreshToken, data.user);
      // Fresh update-check right on login rather than whatever the 6h
      // background timer last cached - login is a natural moment an admin
      // actually looks at the app, so it's worth the one extra GitHub call.
      recheckUpdate.mutate();
      navigate('/dashboard');
    },
  });
}

export function useLogout() {
  const { refreshToken, logout } = useAuthStore();
  const navigate = useNavigate();

  return () => {
    if (refreshToken) authApi.logout(refreshToken).catch(() => {});
    logout();
    navigate('/login');
  };
}
