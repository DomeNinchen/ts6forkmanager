import { useMutation } from '@tanstack/react-query';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../stores/auth.store';
import { useNavigate } from 'react-router';
import { useRecheckUpdate } from './use-update-check';
import { getDeviceToken, setDeviceToken } from '../lib/device-token';

const TRUSTED_DEVICE_DAYS = 15;

/** Shared by a plain login and a completed 2FA challenge - both end the same way. */
function useCompleteLogin() {
  const { setAuth } = useAuthStore();
  const navigate = useNavigate();
  const recheckUpdate = useRecheckUpdate();

  return (data: { accessToken: string; refreshToken: string; user: any; deviceToken?: string }) => {
    setAuth(data.accessToken, data.refreshToken, data.user);
    if (data.deviceToken) setDeviceToken(data.user.username, data.deviceToken, TRUSTED_DEVICE_DAYS);
    // Fresh update-check right on login rather than whatever the 6h
    // background timer last cached - login is a natural moment an admin
    // actually looks at the app, so it's worth the one extra GitHub call.
    recheckUpdate.mutate();
    navigate('/dashboard');
  };
}

/** Returns tokens directly, or { requiresTotp: true, ticket } if a 2FA code is still needed. */
export function useLogin() {
  const completeLogin = useCompleteLogin();

  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      authApi.login(username, password, getDeviceToken(username)),
    onSuccess: (data) => {
      if (!data.requiresTotp) completeLogin(data);
    },
  });
}

export function useVerifyTotp() {
  const completeLogin = useCompleteLogin();

  return useMutation({
    mutationFn: ({ ticket, code, rememberDevice }: { ticket: string; code: string; rememberDevice: boolean }) =>
      authApi.verifyTotp(ticket, code, rememberDevice),
    onSuccess: completeLogin,
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
