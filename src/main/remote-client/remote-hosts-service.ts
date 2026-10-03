import type { RemoteHostAddInput, RemoteHostInfo, RemotePairResponse } from "../../shared/remote-types";
import type { NewRemoteHost } from "./host-registry";
import { parsePairInput, type PairTarget } from "./pair-host";

export interface RemoteHostsServiceOptions {
  registry: {
    canStore(): boolean;
    list(): Promise<RemoteHostInfo[]>;
    save(input: NewRemoteHost): Promise<RemoteHostInfo>;
    remove(hostId: string): Promise<void>;
    clearToken(hostId: string): Promise<void>;
  };
  windows: {
    open(hostId: string, sessionId?: string): Promise<void>;
    closeHost(hostId: string): void;
  };
  pair(target: PairTarget, deviceName: string): Promise<RemotePairResponse>;
  /** 호스트의 기기 목록에 보일 이 PC의 이름. */
  deviceName: string;
  allowLoopback: boolean;
  /** 목록이 바뀔 때마다 메인 창에 알린다. */
  announce(hosts: RemoteHostInfo[]): void;
}

/** 이 PC가 클라이언트로서 다른 PC를 등록·삭제·여는 흐름. 저장은 레지스트리, 창은 RemoteWindows가 맡는다. */
export function createRemoteHostsService(options: RemoteHostsServiceOptions) {
  const announce = async () => options.announce(await options.registry.list());
  return {
    list: () => options.registry.list(),

    async add(input: RemoteHostAddInput): Promise<RemoteHostInfo> {
      // 저장할 수 없는 환경이면 호스트에 기기를 등록시키기 전에 멈춘다.
      if (!options.registry.canStore()) throw new Error("이 환경에서는 토큰을 안전하게 저장할 수 없습니다");
      const target = parsePairInput(input, { allowLoopback: options.allowLoopback });
      const paired = await options.pair(target, options.deviceName);
      const info = await options.registry.save({
        hostId: paired.hostId,
        name: paired.hostName,
        address: target.address,
        deviceId: paired.deviceId,
        token: paired.token,
      });
      // 열려 있던 창은 옛 토큰을 들고 있다.
      options.windows.closeHost(paired.hostId);
      await announce();
      return info;
    },

    async remove(hostId: string): Promise<void> {
      options.windows.closeHost(hostId);
      await options.registry.remove(hostId);
      await announce();
    },

    open: (hostId: string) => options.windows.open(hostId),

    /** 호스트가 토큰을 거절했다(원격 창의 브리지가 알린다). */
    async unpaired(hostId: string): Promise<void> {
      await options.registry.clearToken(hostId);
      await announce();
    },
  };
}
