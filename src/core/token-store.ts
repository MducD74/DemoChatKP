// Kho token theo kênh, mã hóa, nằm cạnh dữ liệu chat. Dùng cho kênh có token xoay vòng (Zalo OA, TikTok)
// và token tĩnh (Meta page token).
import { mutate, type Store } from "./store";
import { decryptJson, encryptJson } from "./secret";

export interface ChannelTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number; // ms epoch
  refreshExpiresAt: number; // ms epoch
}

export interface TokenStore {
  get(channelId: string): Promise<ChannelTokens | null>;
  save(channelId: string, t: ChannelTokens): Promise<void>;
}

export function storeBackedTokens(store: Store): TokenStore {
  return {
    async get(channelId) {
      const blob = (await store.load()).secrets?.[channelId];
      return blob ? decryptJson<ChannelTokens>(blob) : null;
    },
    async save(channelId, t) {
      await mutate(store, (db) => {
        (db.secrets ??= {})[channelId] = encryptJson(t);
      });
    },
  };
}

// Token tĩnh (không hết hạn theo lịch), như page access token của Meta.
const sKey = (channelId: string) => `static:${channelId}`;
export const staticTokens = (store: Store) => ({
  async get(channelId: string): Promise<string | null> {
    const blob = (await store.load()).secrets?.[sKey(channelId)];
    return blob ? decryptJson<{ token: string }>(blob).token : null;
  },
  async save(channelId: string, token: string) {
    await mutate(store, (db) => {
      (db.secrets ??= {})[sKey(channelId)] = encryptJson({ token });
    });
  },
});
